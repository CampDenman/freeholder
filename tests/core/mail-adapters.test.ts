// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Mocked adapter contract tests. No request can reach a provider or send mail.
import { afterEach, describe, expect, it, vi } from "vitest";

const smtpMocks = vi.hoisted(() => ({
  send: vi.fn(async () => ({ messageId: "smtp-message" })),
  create: vi.fn(),
}));
smtpMocks.create.mockImplementation(() => ({ sendMail: smtpMocks.send }));

vi.mock("nodemailer", () => ({ createTransport: smtpMocks.create }));

import { createConsoleMail } from "@/adapters/mail/console";
import { createGmailMail } from "@/adapters/mail/gmail";
import { boundedText, providerJson } from "@/adapters/mail/http";
import { mimeMessage } from "@/adapters/mail/mime";
import { createOutlookMail } from "@/adapters/mail/outlook";
import { createPostmarkMail } from "@/adapters/mail/postmark";
import { createResendMail } from "@/adapters/mail/resend";
import { createSesMail } from "@/adapters/mail/ses";
import { createSmtpMail } from "@/adapters/mail/smtp";
import { MailAdapterError, type OutboundEmail } from "@/adapters/mail/types";
import {
  mailConfigurationStatus,
  resetMailForTests,
} from "@/adapters/mail";
import { resetEnvForTests } from "@/core/env";

const MESSAGE: OutboundEmail = {
  to: "customer@example.test",
  subject: "A receipt",
  text: "Plain receipt text",
  html: "<p>Plain receipt text</p>",
  replyTo: "reply@example.test",
  deliveryId: "00000000-0000-4000-8000-000000000123",
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") throw new TypeError("Expected a string request body.");
  return init.body;
}

const changedEnvironment = new Map<string, string | undefined>();

function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changedEnvironment.has(name)) changedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
  resetMailForTests();
}

afterEach(() => {
  for (const [name, value] of changedEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  changedEnvironment.clear();
  resetEnvForTests();
  resetMailForTests();
  vi.restoreAllMocks();
  smtpMocks.send.mockReset();
  smtpMocks.send.mockResolvedValue({ messageId: "smtp-message" });
  smtpMocks.create.mockClear();
});

describe("Gmail and MIME", () => {
  it("submits URL-safe raw MIME with both accessible bodies and correlation", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const adapter = createGmailMail({
      accessToken: "access-token",
      from: "Business <hello@example.test>",
      fetch: async (input, init) => {
        calls.push([input, init]);
        return Response.json({ id: "gmail-message" });
      },
    });

    await expect(adapter.send(MESSAGE)).resolves.toEqual({
      providerRef: "gmail-message",
    });
    expect(requestUrl(calls[0]![0])).toContain("gmail.googleapis.com");
    expect(calls[0]![1]?.headers).toMatchObject({
      authorization: "Bearer access-token",
    });
    const body = JSON.parse(requestBody(calls[0]![1])) as { raw: string };
    const decoded = Buffer.from(body.raw, "base64url").toString("utf8");
    expect(decoded).toContain("From: Business <hello@example.test>");
    expect(decoded).toContain("Plain receipt text");
    expect(decoded).toContain("<p>Plain receipt text</p>");
    expect(decoded).toContain(`X-Freeholder-Delivery: ${MESSAGE.deliveryId}`);
  });

  it("refuses header injection before a provider call", () => {
    expect(() =>
      mimeMessage({ ...MESSAGE, subject: "Receipt\r\nBcc: attacker@example.test" }, "from@example.test"),
    ).toThrow("line break");
    expect(() =>
      mimeMessage({ ...MESSAGE, to: "victim@example.test\nBcc: attacker@example.test" }, "from@example.test"),
    ).toThrow("line break");
  });

  it("requires the provider message id and hides provider bodies", async () => {
    const missing = createGmailMail({
      accessToken: "access-token",
      from: "hello@example.test",
      fetch: async () => Response.json({}),
    });
    await expect(missing.send(MESSAGE)).rejects.toThrow("without a message id");

    const refused = createGmailMail({
      accessToken: "access-token",
      from: "hello@example.test",
      fetch: async () =>
        new Response('{"error":"private-provider-detail"}', { status: 401 }),
    });
    await expect(refused.send(MESSAGE)).rejects.toThrow("HTTP 401");
    await expect(refused.send(MESSAGE)).rejects.not.toThrow("private-provider-detail");
  });
});

describe("Microsoft Graph", () => {
  it("submits a least-privilege message and uses internal correlation for the 202", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const adapter = createOutlookMail({
      accessToken: "graph-token",
      from: "owner@example.test",
      fetch: async (input, init) => {
        calls.push([input, init]);
        return new Response(null, { status: 202 });
      },
    });
    await expect(adapter.send(MESSAGE)).resolves.toEqual({
      providerRef: `outlook:${MESSAGE.deliveryId}`,
    });
    const body = JSON.parse(requestBody(calls[0]![1])) as {
      message: Record<string, unknown>;
      saveToSentItems: boolean;
    };
    expect(body.saveToSentItems).toBe(true);
    expect(body.message).toMatchObject({
      subject: MESSAGE.subject,
      toRecipients: [{ emailAddress: { address: MESSAGE.to } }],
      replyTo: [{ emailAddress: { address: MESSAGE.replyTo } }],
    });
  });

  it("classifies throttling as retryable without leaking a Graph body", async () => {
    const adapter = createOutlookMail({
      accessToken: "graph-token",
      from: "owner@example.test",
      fetch: async () =>
        new Response("private tenant and account detail", { status: 429 }),
    });
    const error = await adapter.send(MESSAGE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MailAdapterError);
    expect(error).toMatchObject({ retryable: true, httpStatus: 429 });
    expect(String(error)).not.toContain("private tenant");
  });
});

describe("bulk HTTP providers", () => {
  it("sends through Resend with provider idempotency and verifies the domain", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const adapter = createResendMail({
      apiKey: "resend-secret",
      from: "Business <news@example.test>",
      fetch: async (input, init) => {
        calls.push([input, init]);
        return requestUrl(input).endsWith("/domains")
          ? Response.json({
              data: [{ id: "domain-id", name: "example.test", status: "verified" }],
            })
          : Response.json({ id: "resend-message" });
      },
    });
    await expect(adapter.send(MESSAGE)).resolves.toEqual({
      providerRef: "resend-message",
    });
    expect(calls[0]![1]?.headers).toMatchObject({
      authorization: "Bearer resend-secret",
      "idempotency-key": MESSAGE.deliveryId,
    });
    await expect(adapter.verifySender?.({ email: "news@example.test" })).resolves.toMatchObject({
      status: "verified",
      detail: { id: "domain-id", domain: "example.test" },
    });
  });

  it("keeps unsafe Resend status text out of the verification response", async () => {
    const adapter = createResendMail({
      apiKey: "secret",
      from: "news@example.test",
      fetch: async () =>
        Response.json({
          data: [
            {
              id: "domain-id",
              name: "example.test",
              status: "<script>provider detail</script>",
            },
          ],
        }),
    });
    await expect(adapter.verifySender?.({ email: "news@example.test" })).resolves.toMatchObject({
      status: "pending",
      detail: { providerStatus: "pending" },
    });
  });

  it("uses separate Postmark server and account credentials", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const adapter = createPostmarkMail({
      serverToken: "server-secret",
      accountToken: "account-secret",
      from: "news@example.test",
      fetch: async (input, init) => {
        calls.push([input, init]);
        return requestUrl(input).includes("/senders")
          ? Response.json({
              SenderSignatures: [
                {
                  ID: 42,
                  EmailAddress: "news@example.test",
                  Confirmed: true,
                  DKIMVerified: true,
                  ReturnPathDomainVerified: true,
                },
              ],
            })
          : Response.json({ MessageID: "postmark-message" });
      },
    });
    await adapter.send(MESSAGE);
    await expect(adapter.verifySender?.({ email: "news@example.test" })).resolves.toMatchObject({
      status: "verified",
      detail: { id: 42, dkim: true, returnPath: true },
    });
    expect(calls[0]![1]?.headers).toMatchObject({
      "x-postmark-server-token": "server-secret",
    });
    expect(calls[1]![1]?.headers).toMatchObject({
      "x-postmark-account-token": "account-secret",
    });
  });

  it("does not pretend Postmark verification ran without an account token", async () => {
    const adapter = createPostmarkMail({
      serverToken: "server-secret",
      from: "news@example.test",
      fetch: async () => {
        throw new Error("must not fetch");
      },
    });
    const verification = await adapter.verifySender?.({ email: "news@example.test" });
    expect(verification?.status).toBe("pending");
    expect(verification?.message).toContain("POSTMARK_ACCOUNT_TOKEN");
  });
});

describe("Amazon SES", () => {
  it("submits a signed-client request with configuration and delivery tags", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const adapter = createSesMail({
      accessKeyId: "access",
      secretAccessKey: "secret",
      region: "us-west-2",
      from: "news@example.test",
      configurationSet: "freeholder-feedback",
      client: {
        fetch: async (input, init) => {
          calls.push([input, init]);
          return Response.json({ MessageId: "ses-message" });
        },
      },
    });
    await expect(adapter.send(MESSAGE)).resolves.toEqual({ providerRef: "ses-message" });
    expect(calls[0]![0]).toBe(
      "https://email.us-west-2.amazonaws.com/v2/email/outbound-emails",
    );
    const request = calls[0]![1] as RequestInit;
    const body = JSON.parse(requestBody(request)) as Record<string, unknown>;
    expect(body).toMatchObject({
      ConfigurationSetName: "freeholder-feedback",
      EmailTags: [{ Name: "freeholder_delivery", Value: MESSAGE.deliveryId }],
      Destination: { ToAddresses: [MESSAGE.to] },
    });
  });

  it("checks the configured SES identity and sanitizes provider labels", async () => {
    const adapter = createSesMail({
      accessKeyId: "access",
      secretAccessKey: "secret",
      region: "us-east-1",
      from: "news@example.test",
      client: {
        fetch: async () =>
          Response.json({
            VerifiedForSendingStatus: false,
            VerificationStatus: "<unsafe>",
            DkimAttributes: { Status: "SUCCESS" },
          }),
      },
    });
    await expect(
      adapter.verifySender?.({
        email: "news@example.test",
        providerIdentity: "example.test",
      }),
    ).resolves.toMatchObject({
      status: "pending",
      detail: { identity: "example.test", providerStatus: "pending", dkim: "SUCCESS" },
    });
  });
});

describe("SMTP and non-delivery modes", () => {
  it("constructs SMTP lazily, submits once, and normalizes transport errors", async () => {
    const adapter = createSmtpMail({
      host: "smtp.example.test",
      port: 587,
      user: "smtp-user",
      password: "smtp-password",
      from: "hello@example.test",
    });
    expect(smtpMocks.create).not.toHaveBeenCalled();
    await expect(adapter.send(MESSAGE)).resolves.toEqual({ providerRef: "smtp-message" });
    expect(smtpMocks.create).toHaveBeenCalledTimes(1);
    expect(smtpMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "hello@example.test",
        to: MESSAGE.to,
        headers: { "X-Freeholder-Delivery": MESSAGE.deliveryId },
      }),
    );

    smtpMocks.send.mockRejectedValueOnce(
      new Error("private host banner and message fragment"),
    );
    const error = await adapter.send(MESSAGE).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ retryable: true });
    expect(String(error)).not.toContain("private host banner");
  });

  it("discards content in production console mode", async () => {
    environment({ NODE_ENV: "production" });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const adapter = createConsoleMail();
    await adapter.send({
      ...MESSAGE,
      text: "https://example.test/reset?token=secret-reset-token",
    });
    await adapter.send(MESSAGE);
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).not.toContain("secret-reset-token");
  });
});

describe("bounded provider responses and secret-free discovery", () => {
  it("stops reading oversized responses and preserves safe retry metadata", async () => {
    await expect(
      boundedText(new Response("x".repeat(256 * 1024 + 1))),
    ).rejects.toThrow("oversized");
    const error = await providerJson(
      new Response('{"error":"rate_limited","secret":"never expose"}', {
        status: 429,
      }),
      "Provider",
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      retryable: true,
      httpStatus: 429,
      providerCode: "rate_limited",
    });
    expect(String(error)).not.toContain("never expose");
  });

  it("reports only variable names and normalized From addresses", () => {
    environment({
      MAIL_ADAPTER: "smtp",
      SMTP_HOST: "smtp.example.test",
      MAIL_FROM: "Business <HELLO@Example.Test>",
      SMTP_PASSWORD: "secret-smtp-password",
      MAIL_BULK_ADAPTER: "resend",
      MAIL_BULK_FROM: "News <NEWS@Example.Test>",
      RESEND_API_KEY: "secret-resend-key",
      RESEND_WEBHOOK_SECRET: undefined,
    });
    const status = mailConfigurationStatus();
    expect(status.transactional).toMatchObject({
      provider: "smtp",
      delivers: true,
      fromAddress: "hello@example.test",
      missing: [],
    });
    expect(status.bulk).toMatchObject({
      provider: "resend",
      sendConfigured: true,
      feedbackConfigured: false,
      fromAddress: "news@example.test",
      missing: ["RESEND_WEBHOOK_SECRET"],
    });
    expect(JSON.stringify(status)).not.toContain("secret-");
  });
});
