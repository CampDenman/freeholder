// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Choosing the mail implementation (MASTER.md §12, §17): the id comes from
// freeholder.config.ts, the credentials from env, and the environment wins —
// one published image serves instances that send through different mailboxes.
import config from "../../../freeholder.config";
import { env } from "@/core/env";
import { createConsoleMail } from "@/adapters/mail/console";
import { createNoBulkMail } from "@/adapters/mail/none";
import { createPostmarkMail } from "@/adapters/mail/postmark";
import { createResendMail } from "@/adapters/mail/resend";
import { createSesMail } from "@/adapters/mail/ses";
import { createSmtpMail } from "@/adapters/mail/smtp";
import type { MailAdapter } from "@/adapters/mail/types";

export interface MailConfigurationStatus {
  transactional: {
    provider: "smtp" | "console" | "gmail" | "outlook";
    delivers: boolean;
    missing: string[];
    fromAddress: string | null;
  };
  oauth: Array<{
    provider: "google" | "microsoft";
    configured: boolean;
    missing: string[];
  }>;
  bulk: {
    provider: "resend" | "postmark" | "ses" | "none";
    sendConfigured: boolean;
    feedbackConfigured: boolean;
    missing: string[];
    webhookPath: string | null;
    fromAddress: string | null;
  };
}

function configuredAddress(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = /<([^<>]+)>\s*$/.exec(value)?.[1] ?? value;
  const normalized = candidate.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

/** Secret-free setup discovery for admin and doctor surfaces. */
export function mailConfigurationStatus(): MailConfigurationStatus {
  const current = env();
  const transactional =
    current.MAIL_ADAPTER ?? config.adapters.mailTransactional;
  const transactionalRequired =
    transactional === "smtp"
      ? ([
          ["SMTP_HOST", current.SMTP_HOST],
          ["MAIL_FROM", current.MAIL_FROM],
        ] as const)
      : transactional === "gmail"
        ? ([
            ["GOOGLE_OAUTH_CLIENT_ID", current.GOOGLE_OAUTH_CLIENT_ID],
            ["GOOGLE_OAUTH_CLIENT_SECRET", current.GOOGLE_OAUTH_CLIENT_SECRET],
            ["CREDENTIAL_KEY", current.CREDENTIAL_KEY],
          ] as const)
        : transactional === "outlook"
          ? ([
              ["MICROSOFT_OAUTH_CLIENT_ID", current.MICROSOFT_OAUTH_CLIENT_ID],
              ["MICROSOFT_OAUTH_CLIENT_SECRET", current.MICROSOFT_OAUTH_CLIENT_SECRET],
              ["CREDENTIAL_KEY", current.CREDENTIAL_KEY],
            ] as const)
          : [];
  const transactionalMissing = transactionalRequired
    .filter(([, value]) => !value)
    .map(([name]) => name);

  const oauth = (["google", "microsoft"] as const).map((provider) => {
    const required =
      provider === "google"
        ? ([
            ["GOOGLE_OAUTH_CLIENT_ID", current.GOOGLE_OAUTH_CLIENT_ID],
            ["GOOGLE_OAUTH_CLIENT_SECRET", current.GOOGLE_OAUTH_CLIENT_SECRET],
            ["CREDENTIAL_KEY", current.CREDENTIAL_KEY],
          ] as const)
        : ([
            ["MICROSOFT_OAUTH_CLIENT_ID", current.MICROSOFT_OAUTH_CLIENT_ID],
            ["MICROSOFT_OAUTH_CLIENT_SECRET", current.MICROSOFT_OAUTH_CLIENT_SECRET],
            ["CREDENTIAL_KEY", current.CREDENTIAL_KEY],
          ] as const);
    const missing = required
      .filter(([, value]) => !value)
      .map(([name]) => name);
    return { provider, configured: missing.length === 0, missing };
  });

  const bulk = current.MAIL_BULK_ADAPTER ?? config.adapters.mailBulk;
  const bulkRequirements =
    bulk === "resend"
      ? {
          send: [
            ["MAIL_BULK_FROM", current.MAIL_BULK_FROM],
            ["RESEND_API_KEY", current.RESEND_API_KEY],
          ] as const,
          feedback: [
            ["RESEND_WEBHOOK_SECRET", current.RESEND_WEBHOOK_SECRET],
          ] as const,
          path: "/api/mail/webhooks/resend",
        }
      : bulk === "postmark"
        ? {
            send: [
              ["MAIL_BULK_FROM", current.MAIL_BULK_FROM],
              ["POSTMARK_SERVER_TOKEN", current.POSTMARK_SERVER_TOKEN],
            ] as const,
            feedback: [
              ["POSTMARK_WEBHOOK_USER", current.POSTMARK_WEBHOOK_USER],
              ["POSTMARK_WEBHOOK_PASSWORD", current.POSTMARK_WEBHOOK_PASSWORD],
            ] as const,
            path: "/api/mail/webhooks/postmark",
          }
        : bulk === "ses"
          ? {
              send: [
                ["MAIL_BULK_FROM", current.MAIL_BULK_FROM],
                ["SES_ACCESS_KEY_ID", current.SES_ACCESS_KEY_ID],
                ["SES_SECRET_ACCESS_KEY", current.SES_SECRET_ACCESS_KEY],
                ["SES_REGION", current.SES_REGION],
              ] as const,
              feedback: [
                ["SES_CONFIGURATION_SET", current.SES_CONFIGURATION_SET],
                ["SES_SNS_TOPIC_ARN", current.SES_SNS_TOPIC_ARN],
              ] as const,
              path: "/api/mail/webhooks/ses",
            }
          : { send: [] as const, feedback: [] as const, path: null };
  const sendMissing = bulkRequirements.send
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const feedbackMissing = bulkRequirements.feedback
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return {
    transactional: {
      provider: transactional,
      delivers: transactional !== "console" && transactionalMissing.length === 0,
      missing: transactionalMissing,
      fromAddress: configuredAddress(current.MAIL_FROM),
    },
    oauth,
    bulk: {
      provider: bulk,
      sendConfigured: bulk !== "none" && sendMissing.length === 0,
      feedbackConfigured: bulk !== "none" && feedbackMissing.length === 0,
      missing: [...sendMissing, ...feedbackMissing],
      webhookPath: bulkRequirements.path,
      fromAddress: configuredAddress(current.MAIL_BULK_FROM),
    },
  };
}

function build(): MailAdapter {
  const e = env();
  const choice = e.MAIL_ADAPTER ?? config.adapters.mailTransactional;

  switch (choice) {
    case "smtp": {
      // Named rather than defaulted. A half-configured mailer that quietly
      // fell back to the console would tell an owner their receipts are going
      // out while every one of them lands in a log file.
      const missing = (
        [
          ["SMTP_HOST", e.SMTP_HOST],
          ["MAIL_FROM", e.MAIL_FROM],
        ] as const
      )
        .filter(([, value]) => !value)
        .map(([name]) => name);
      if (missing.length > 0) {
        throw new Error(
          `Mail is set to "smtp" but ${missing.join(" and ")} ${
            missing.length === 1 ? "is" : "are"
          } not set. See .env.example.`,
        );
      }
      return createSmtpMail({
        host: e.SMTP_HOST!,
        port: e.SMTP_PORT ? Number(e.SMTP_PORT) : 587,
        user: e.SMTP_USER,
        password: e.SMTP_PASSWORD,
        from: e.MAIL_FROM!,
      });
    }
    case "gmail":
    case "outlook":
      throw new Error(
        `Mail is set to "${choice}", but no active default connected sender was selected. ` +
          `Connect and choose one in Admin → Settings → Mail.`,
      );
    default:
      return createConsoleMail();
  }
}

/** The configured broadcast carrier. Personal mailbox adapters never enter it. */
export function bulkMail(): MailAdapter {
  const e = env();
  const choice = e.MAIL_BULK_ADAPTER ?? config.adapters.mailBulk;
  if (choice === "none") return createNoBulkMail();
  if (!e.MAIL_BULK_FROM) {
    throw new Error(`Mail is set to "${choice}" but MAIL_BULK_FROM is not set.`);
  }
  if (choice === "resend") {
    if (!e.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set.");
    return createResendMail({ apiKey: e.RESEND_API_KEY, from: e.MAIL_BULK_FROM });
  }
  if (choice === "postmark") {
    if (!e.POSTMARK_SERVER_TOKEN) throw new Error("POSTMARK_SERVER_TOKEN is not set.");
    return createPostmarkMail({
      serverToken: e.POSTMARK_SERVER_TOKEN,
      accountToken: e.POSTMARK_ACCOUNT_TOKEN,
      from: e.MAIL_BULK_FROM,
      messageStream: e.POSTMARK_MESSAGE_STREAM,
    });
  }
  if (!e.SES_ACCESS_KEY_ID || !e.SES_SECRET_ACCESS_KEY || !e.SES_REGION) {
    throw new Error(
      "Amazon SES needs SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, and SES_REGION.",
    );
  }
  return createSesMail({
    accessKeyId: e.SES_ACCESS_KEY_ID,
    secretAccessKey: e.SES_SECRET_ACCESS_KEY,
    sessionToken: e.SES_SESSION_TOKEN,
    region: e.SES_REGION,
    from: e.MAIL_BULK_FROM,
    configurationSet: e.SES_CONFIGURATION_SET,
  });
}

let adapter: MailAdapter | undefined;

/** The configured mailer. Built once, on first use. */
export function mail(): MailAdapter {
  adapter ??= build();
  return adapter;
}

export function resetMailForTests(): void {
  adapter = undefined;
}

export type {
  MailAdapter,
  MailProvider,
  OutboundEmail,
  SenderVerification,
} from "@/adapters/mail/types";
