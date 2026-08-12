// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Provider feedback authentication and normalization (MASTER.md §12, C1.14).
// Every provider call is mocked: this suite cannot send mail or incur cost.
import {
  createHmac,
  createPrivateKey,
  sign as rsaSign,
} from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  record: vi.fn(async (_input: unknown, _actor?: unknown) => ({
    id: "event-id",
    duplicate: false,
  })),
}));

vi.mock("@/core/mail/service", () => ({
  recordMailProviderEvent: { call: serviceMocks.record },
}));

import { resetEnvForTests } from "@/core/env";
import { mailWebhookRoute } from "@/core/mail/route";
import {
  MailWebhookError,
  processPostmarkWebhook,
  processResendWebhook,
  processSesWebhook,
  resetMailWebhookCachesForTests,
  verifyPostmarkAuthorization,
  verifyResendSignature,
  verifySnsMessage,
} from "@/core/mail/webhooks";

const TOPIC = "arn:aws:sns:us-east-1:123456789012:freeholder-mail";
const CERT_URL =
  "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pem";

// Generated solely for this non-network test. It is a 2048-bit RSA
// self-signed certificate for sns.amazonaws.com with an Amazon-labelled
// issuer and a 2000–2100 validity window. These JWK parts are not credentials
// and can authenticate nothing outside this matching test certificate.
const TEST_CERT_DER =
  "MIIDGTCCAgGgAwIBAgIJAP2zW15OIvxGMA0GCSqGSIb3DQEBCwUAMDoxCzAJBgNVBAYTAlVTMQ8wDQYDVQQKEwZBbWF6b24xGjAYBgNVBAMTEXNucy5hbWF6b25hd3MuY29tMCAXDTAwMDEwMTAwMDAwMFoYDzIxMDAwMTAxMDAwMDAwWjA6MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRowGAYDVQQDExFzbnMuYW1hem9uYXdzLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMnGSzjA7oKogVdhpKh8A9kGfhe+7EmFPZpP2KpjCyOTyXz1uo26dFofh2KbUH23vzVBPrOlak30VuDO+JSWvL7gtL7Qh8L4PT0PFLQ4Oo6crrRB+2+dzHts236sTDPmH89Imf30VdFUzK7QnZBWN8pZDpojXQHkCtwdy76hxEPns5MyWGw7UcG3bIuecRq2xLuwPESL2gSF/FKCxoZgJaNr69s8OorbPVuqYW8B4vhYcIkpDCedehVrD2sG+XphO5M8eXFwTsEhpk9Us34Zw9xM+qs+lWK6cY4iBxhuL474w5ekDbB3SQXkhGEP5ORqGfKB/69yPFrd7Bdu4oRiWP0CAwEAAaMgMB4wHAYDVR0RBBUwE4IRc25zLmFtYXpvbmF3cy5jb20wDQYJKoZIhvcNAQELBQADggEBACkhUlFDTNgoxV1NLC6msOtL8naaVmm5Kn+FRDZOXC4bWCj9rv3tHly6P0sFkOKoN4rRgwz4WeFtf9+RIxxeFTJpMBcgKTPlT9ZDsC+7DQpEWz6rgoQb20sITgUgXP17WqsS33VzpnfSFGacl4KfzwZW8Y07DmKarlbh/SIHGvXwNVuKK6JISY0NNxE3b89TpY5MfR5xvW3OF/QnHDS2rCxsYzacNBaz7sp8WBsIc1DFbkdpddeE4KjyUWLaZb6VLOUnvhASPSHvP6XPCg/87OfYaDGZYJKQN5GS4uj1SCTd5QyObSghiIEHxJ2umOcdnTe2G4WWc07SHPMq8lCLcfQ=";

function base64url(value: string): string {
  return Buffer.from(value, "base64").toString("base64url");
}

const TEST_PRIVATE_KEY = createPrivateKey({
  format: "jwk",
  key: {
    kty: "RSA",
    n: base64url("ycZLOMDugqiBV2GkqHwD2QZ+F77sSYU9mk/YqmMLI5PJfPW6jbp0Wh+HYptQfbe/NUE+s6VqTfRW4M74lJa8vuC0vtCHwvg9PQ8UtDg6jpyutEH7b53Me2zbfqxMM+Yfz0iZ/fRV0VTMrtCdkFY3ylkOmiNdAeQK3B3LvqHEQ+ezkzJYbDtRwbdsi55xGrbEu7A8RIvaBIX8UoLGhmAlo2vr2zw6its9W6phbwHi+FhwiSkMJ516FWsPawb5emE7kzx5cXBOwSGmT1SzfhnD3Ez6qz6VYrpxjiIHGG4vjvjDl6QNsHdJBeSEYQ/k5GoZ8oH/r3I8Wt3sF27ihGJY/Q=="),
    e: base64url("AQAB"),
    d: base64url("KYkzZOx6bNUpQwarsa9Nz3hBrruzwnK2OrTjIjgfS+SZXqrrC0/tsbu5z/eu+yI/L0ROFwcfOgrpc3/HtjbNhfGV443j1KPrX01icrL8gu0IHb1TeCegt2uyR4JKcYiW1cHZSWjp3Zy6QeZZ+SN2eqYYlmxfMgtynNtZXNXKJDwJrZw4BrJq3gsoE8z6PDuweUoNj0mLCHA2psCZtrtA7V4ppxRhVYXEijBhPb6M3RgqyOY/msT+SNi5TeVGmEj7SuBSGRORYVj+oQy+z6Jj7ZN7eefO578PiiFNTw2PFEspCyXYmeWMRhIMcwdjltutKW7HruBIujrrfuFQHEv4NQ=="),
    p: base64url("5Gmoh+gSvYhl2GeJW03dE4PnS8UevYFZ6VJXS8X7IZwom7G4Gj370NdXRGXKm7xbiffESVBwHyL4SgDYiT8jPg6uvOd9vuEV/iwlw6ERTAxSP36aFIaz/IXl3VwE0Sd01XqGEhBKCiqgAcs/Mg/rBfQMz9kMqyZCA9gLHwDvgcM="),
    q: base64url("4iUBT5QbzDZR79nUamO1OghRIVp/arE4p0H90LlHg9/PmXXauRgBN+Ed74Lag5CGDwXO8GaQhVKY/DRf4SnjMzPWt5kAYvYlH1xBQEZc5hltHXrMORBvv1ZI4yiwX30fwGBs+6//4/1Snjsw1hUCKUhUt6cIw9d25BiDJkn4Tj8="),
    dp: base64url("TIdyJgcFsGcw6G7YQLU36z/4kRR8ljXusBQcl5C/8aTmnjPPYUt/QZvE62/HkKJtcS6In5/J0UTgN7tM0b9LyZEVzskpAnlb6wtTo9Yle3ttW0TJzzLKv0MFn0MjgghcRuKEZSz8AagCcFdu1xEqR5ZbbJBmhDmPSMZsA3lGxg0="),
    dq: base64url("FQ8rIxUAzbCVSse3Pz0PyFqz6245BV+BjhnYIBLQ9RfnhjvyZWA15NVC62X9IVlZEpcQ4VQ7yx6Y/ouGDjrPXJpMOYa3AYA4jsYRkYG77vWZMrCXygycy22mlfjZC9tkFI8mNv35z2pswi1y68zDCcMhmISmjU5IVQ9vTyZ+SBM="),
    qi: base64url("nCEJRuYuUaekJ8SVXGNJh3peQi5+SpqYeE5EHYYMVZNSaHM8tP54pJuuDpPCpz9WwsBduLAuWZUzo35oROhpJG7fQlGBWXYpUZUVvsjPMziYsA7gVNUOIqA2mL4B6djxYZvbABHZvcxjXkMr0sTTydKoqIm8ZpJPPg6vVSunrws="),
  },
});

const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----\n${TEST_CERT_DER.match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;

type SnsPayload = Record<string, unknown> & {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
};

function canonicalSnsString(payload: SnsPayload): string {
  const fields =
    payload.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : [
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ];
  return fields
    .filter((field) => payload[field] !== undefined)
    .map((field) => `${field}\n${String(payload[field])}\n`)
    .join("");
}

function signedSns(
  overrides: Record<string, unknown> = {},
  algorithm: "RSA-SHA256" | "RSA-SHA1" = "RSA-SHA256",
): SnsPayload {
  const payload: SnsPayload = {
    Type: "Notification",
    MessageId: "sns-message-1",
    TopicArn: TOPIC,
    Message: JSON.stringify({
      notificationType: "Delivery",
      mail: {
        messageId: "ses-message-1",
        destination: ["customer@example.test"],
        timestamp: "2026-08-12T16:00:00.000Z",
      },
      delivery: {
        recipients: ["customer@example.test"],
        timestamp: "2026-08-12T16:00:01.000Z",
      },
    }),
    Timestamp: "2026-08-12T16:00:02.000Z",
    SignatureVersion: "2",
    Signature: "",
    SigningCertURL: CERT_URL,
    ...overrides,
  };
  payload.Signature = rsaSign(
    algorithm,
    Buffer.from(canonicalSnsString(payload), "utf8"),
    TEST_PRIVATE_KEY,
  ).toString("base64");
  return payload;
}

function certificateResponse(): Response {
  return new Response(TEST_CERT_PEM, {
    status: 200,
    headers: { "content-length": String(Buffer.byteLength(TEST_CERT_PEM)) },
  });
}

function postmarkAuthorization(): string {
  return `Basic ${Buffer.from("hook-user:hook-password").toString("base64")}`;
}

beforeEach(() => {
  serviceMocks.record.mockClear();
  resetMailWebhookCachesForTests();
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
  process.env.POSTMARK_WEBHOOK_USER = "hook-user";
  process.env.POSTMARK_WEBHOOK_PASSWORD = "hook-password";
  process.env.SES_SNS_TOPIC_ARN = TOPIC;
  resetEnvForTests();
});

describe("Resend Svix authentication", () => {
  const body = Buffer.from('{"type":"email.delivered"}');
  const id = "msg_test_123";
  const timestamp = "1786550400";

  function signature(): string {
    const expected = createHmac("sha256", Buffer.alloc(32, 7))
      .update(`${id}.${timestamp}.`)
      .update(body)
      .digest("base64");
    return `v1,${Buffer.alloc(32, 8).toString("base64")} v1,${expected}`;
  }

  it("accepts any valid v1 value in a multi-signature header", () => {
    expect(
      verifyResendSignature({
        body,
        id,
        timestamp,
        signature: signature(),
        secret: process.env.RESEND_WEBHOOK_SECRET!,
        nowSeconds: Number(timestamp),
      }),
    ).toBe(id);
  });

  it("refuses stale, future, missing, and forged signatures", () => {
    for (const candidate of [
      { signature: signature(), nowSeconds: Number(timestamp) + 301 },
      { signature: signature(), nowSeconds: Number(timestamp) - 301 },
      { signature: "v1,Zm9yZ2Vk", nowSeconds: Number(timestamp) },
      { signature: null, nowSeconds: Number(timestamp) },
    ]) {
      expect(() =>
        verifyResendSignature({
          body,
          id,
          timestamp,
          signature: candidate.signature,
          secret: process.env.RESEND_WEBHOOK_SECRET!,
          nowSeconds: candidate.nowSeconds,
        }),
      ).toThrow(MailWebhookError);
    }
  });

  it("uses a stable provider event key so a replay reaches DB idempotency", async () => {
    const payload = Buffer.from(
      JSON.stringify({
        type: "email.delivered",
        created_at: "2026-08-12T16:00:00.000Z",
        data: { email_id: "provider-message", to: ["person@example.test"] },
      }),
    );
    const eventId = "svix-event-1";
    const at = String(Math.floor(Date.now() / 1000));
    const mac = createHmac("sha256", Buffer.alloc(32, 7))
      .update(`${eventId}.${at}.`)
      .update(payload)
      .digest("base64");
    const request = () =>
      new Request("https://example.test/api/mail/webhooks/resend", {
        method: "POST",
        headers: {
          "svix-id": eventId,
          "svix-timestamp": at,
          "svix-signature": `v1,${mac}`,
        },
        body: payload,
      });

    await processResendWebhook(request());
    await processResendWebhook(request());

    expect(serviceMocks.record).toHaveBeenCalledTimes(2);
    expect(serviceMocks.record.mock.calls[0]![0]).toMatchObject({
      externalEventId: `${eventId}:0`,
      providerRef: "provider-message",
      recipient: "person@example.test",
      eventType: "delivered",
    });
    expect(serviceMocks.record.mock.calls[1]![0]).toEqual(
      serviceMocks.record.mock.calls[0]![0],
    );
  });
});

describe("Postmark authentication and normalization", () => {
  it("accepts only the configured Basic credential", () => {
    expect(() =>
      verifyPostmarkAuthorization(
        postmarkAuthorization(),
        "hook-user",
        "hook-password",
      ),
    ).not.toThrow();
    for (const authorization of [null, "Basic", "Basic Zm9yZ2Vk", "x".repeat(5000)]) {
      expect(() =>
        verifyPostmarkAuthorization(
          authorization,
          "hook-user",
          "hook-password",
        ),
      ).toThrow(MailWebhookError);
    }
  });

  it("distinguishes hard and soft bounces from authenticated payloads", async () => {
    const bounce = async (body: Record<string, unknown>) =>
      processPostmarkWebhook(
        new Request("https://example.test/api/mail/webhooks/postmark", {
          method: "POST",
          headers: { authorization: postmarkAuthorization() },
          body: JSON.stringify({
            RecordType: "Bounce",
            MessageID: "postmark-message",
            Email: "person@example.test",
            BouncedAt: "2026-08-12T16:00:00.000Z",
            ...body,
          }),
        }),
      );

    await bounce({ Type: "HardBounce", TypeCode: 1, Inactive: true });
    expect(serviceMocks.record.mock.calls.at(-1)![0]).toMatchObject({
      eventType: "hard_bounce",
      detail: "Postmark hard bounce",
    });

    await bounce({ Type: "Transient", TypeCode: 2, Inactive: false });
    expect(serviceMocks.record.mock.calls.at(-1)![0]).toMatchObject({
      eventType: "soft_bounce",
      detail: "Postmark soft bounce",
    });
  });
});

describe("Amazon SNS and SES authentication", () => {
  it("verifies the AWS canonical string with a generated RSA certificate", async () => {
    const fetcher = vi.fn(async () => certificateResponse());
    const payload = signedSns({ Subject: "SES feedback" });

    await expect(
      verifySnsMessage(payload, {
        topicArn: TOPIC,
        headerTopicArn: TOPIC,
        headerType: "Notification",
        fetch: fetcher,
      }),
    ).resolves.toMatchObject({ MessageId: "sns-message-1" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses SHA-1, untrusted certificate URLs, wrong topics, and header disagreement", async () => {
    const fetcher = vi.fn(async () => certificateResponse());
    const sha1 = signedSns({ SignatureVersion: "1" }, "RSA-SHA1");
    await expect(
      verifySnsMessage(sha1, { topicArn: TOPIC, fetch: fetcher }),
    ).rejects.toMatchObject({ status: 403 });

    for (const payload of [
      signedSns({ SigningCertURL: "https://example.test/SimpleNotificationService-aaaaaaaaaaaaaaaaaaaa.pem" }),
      signedSns({ SigningCertURL: `${CERT_URL}?redirect=1` }),
    ]) {
      await expect(
        verifySnsMessage(payload, { topicArn: TOPIC, fetch: fetcher }),
      ).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      verifySnsMessage(signedSns(), {
        topicArn: `${TOPIC}-wrong`,
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifySnsMessage(signedSns(), {
        topicArn: TOPIC,
        headerTopicArn: `${TOPIC}-wrong`,
        headerType: "Notification",
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifySnsMessage(signedSns(), {
        topicArn: TOPIC,
        headerTopicArn: TOPIC,
        headerType: "SubscriptionConfirmation",
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("keeps the signing-certificate cache bounded", async () => {
    const fetcher = vi.fn(async () => certificateResponse());
    for (let index = 0; index < 9; index += 1) {
      const suffix = `${"a".repeat(24)}${String(index).padStart(2, "0")}`;
      await verifySnsMessage(
        signedSns({
          MessageId: `sns-${index}`,
          SigningCertURL: `https://sns.us-east-1.amazonaws.com/SimpleNotificationService-${suffix}.pem`,
        }),
        { topicArn: TOPIC, fetch: fetcher },
      );
    }
    await verifySnsMessage(signedSns(), { topicArn: TOPIC, fetch: fetcher });
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it("validates the signed subscription URL before confirming it", async () => {
    const token = "subscription-token";
    const subscribeUrl = new URL("https://sns.us-east-1.amazonaws.com/");
    subscribeUrl.searchParams.set("Action", "ConfirmSubscription");
    subscribeUrl.searchParams.set("TopicArn", TOPIC);
    subscribeUrl.searchParams.set("Token", token);
    const payload = signedSns({
      Type: "SubscriptionConfirmation",
      Token: token,
      SubscribeURL: subscribeUrl.toString(),
      Message: "You have chosen to subscribe.",
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      (typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).endsWith(".pem")
        ? certificateResponse()
        : new Response("confirmed", { status: 200 }),
    );
    const request = new Request("https://example.test/api/mail/webhooks/ses", {
      method: "POST",
      headers: {
        "x-amz-sns-topic-arn": TOPIC,
        "x-amz-sns-message-type": "SubscriptionConfirmation",
      },
      body: JSON.stringify(payload),
    });

    await expect(processSesWebhook(request, fetcher)).resolves.toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);

    resetMailWebhookCachesForTests();
    const invalid = signedSns({
      Type: "SubscriptionConfirmation",
      Token: token,
      SubscribeURL: subscribeUrl.toString().replace("amazonaws.com/", "amazonaws.com/not-sns"),
      Message: "You have chosen to subscribe.",
    });
    await expect(
      processSesWebhook(
        new Request("https://example.test/api/mail/webhooks/ses", {
          method: "POST",
          headers: {
            "x-amz-sns-topic-arn": TOPIC,
            "x-amz-sns-message-type": "SubscriptionConfirmation",
          },
          body: JSON.stringify(invalid),
        }),
        fetcher,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("safe route failures", () => {
  it("returns a bounded 4xx for an authenticated malformed provider email", async () => {
    const handler = mailWebhookRoute(processPostmarkWebhook);
    const response = await handler(
      new Request("https://example.test/api/mail/webhooks/postmark", {
        method: "POST",
        headers: { authorization: postmarkAuthorization() },
        body: JSON.stringify({
          RecordType: "Delivery",
          MessageID: "message-id",
          Recipient: "not-an-email and not provider detail",
          DeliveredAt: "2026-08-12T16:00:00.000Z",
        }),
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Postmark webhook recipient is invalid.");
    expect(body.error).not.toContain("not-an-email");
  });

  it("stops a streamed body once it exceeds the webhook limit", async () => {
    const handler = mailWebhookRoute(processPostmarkWebhook);
    const response = await handler(
      new Request("https://example.test/api/mail/webhooks/postmark", {
        method: "POST",
        headers: { authorization: postmarkAuthorization() },
        body: "x".repeat(256 * 1024 + 1),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook payload is too large.",
    });
  });
});
