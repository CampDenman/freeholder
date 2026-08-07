// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Choosing the mail implementation (MASTER.md §12, §17): the id comes from
// freeholder.config.ts, the credentials from env, and the environment wins —
// one published image serves instances that send through different mailboxes.
import config from "../../../freeholder.config";
import { env } from "@/core/env";
import { createConsoleMail } from "@/adapters/mail/console";
import { createSmtpMail } from "@/adapters/mail/smtp";
import type { MailAdapter } from "@/adapters/mail/types";

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
      // §12 wants these, and they need an OAuth consent flow, token storage
      // and refresh that do not exist yet. Refusing is better than pretending:
      // an owner who configured Gmail and silently got the console would only
      // find out from a customer who never received a receipt.
      throw new Error(
        `Mail is set to "${choice}", which needs an OAuth connection Freeholder ` +
          `cannot make yet. Use "smtp" with the same mailbox for now.`,
      );
    default:
      return createConsoleMail();
  }
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

export type { MailAdapter, OutboundEmail } from "@/adapters/mail/types";
