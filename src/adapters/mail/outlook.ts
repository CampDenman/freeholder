// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Microsoft Graph delegated sender (Mail.Send only).
import { boundedText, requestWithTimeout } from "@/adapters/mail/http";
import { MailAdapterError, type MailAdapter } from "@/adapters/mail/types";

export function createOutlookMail(options: {
  accessToken: string;
  from: string;
  fetch?: typeof globalThis.fetch;
}): MailAdapter {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    id: "outlook",
    kind: "transactional",
    delivers: true,
    async send(message) {
      const response = await requestWithTimeout(
        fetcher,
        "https://graph.microsoft.com/v1.0/me/sendMail",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              subject: message.subject,
              body: {
                contentType: message.html ? "HTML" : "Text",
                content: message.html ?? message.text,
              },
              toRecipients: [{ emailAddress: { address: message.to } }],
              ...(message.replyTo
                ? { replyTo: [{ emailAddress: { address: message.replyTo } }] }
                : {}),
              ...(message.deliveryId
                ? {
                    internetMessageHeaders: [
                      {
                        name: "x-freeholder-delivery",
                        value: message.deliveryId,
                      },
                    ],
                  }
                : {}),
            },
            saveToSentItems: true,
          }),
        },
      );
      if (response.status !== 202) {
        // Consume through the shared bound, but never surface a provider body:
        // OAuth errors can contain tenant/account detail and occasionally echo
        // request fields. Status is enough for an actionable, secret-safe error.
        await boundedText(response);
        throw new MailAdapterError(
          `Microsoft refused the mail request (HTTP ${response.status}).`,
          response.status === 429 || response.status >= 500,
          response.status,
        );
      }
      // Graph intentionally returns 202 with no message id. The internal id is
      // carried in an x- header and is the durable correlation reference.
      return {
        providerRef: `outlook:${message.deliveryId ?? crypto.randomUUID()}`,
      };
    },
  };
}
