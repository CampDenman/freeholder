// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Gmail delegated sender (OAuth scope gmail.send only).
import { providerJson, requestWithTimeout } from "@/adapters/mail/http";
import { mimeMessage } from "@/adapters/mail/mime";
import { MailAdapterError, type MailAdapter } from "@/adapters/mail/types";

export function createGmailMail(options: {
  accessToken: string;
  from: string;
  fetch?: typeof globalThis.fetch;
}): MailAdapter {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    id: "gmail",
    kind: "transactional",
    delivers: true,
    async send(message) {
      const response = await requestWithTimeout(
        fetcher,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            raw: Buffer.from(mimeMessage(message, options.from), "utf8").toString(
              "base64url",
            ),
          }),
        },
      );
      const body = await providerJson<{ id?: string }>(response, "Gmail");
      if (!body.id) {
        throw new MailAdapterError(
          "Gmail accepted the request without a message id.",
        );
      }
      return { providerRef: body.id };
    },
  };
}
