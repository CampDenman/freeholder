// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Development-only mail sink. It is deliberately non-delivering and never
// writes credentials, reset links, or message content to production logs.
import { env } from "@/core/env";
import type { MailAdapter, OutboundEmail } from "@/adapters/mail/types";

export function createConsoleMail(): MailAdapter {
  let warned = false;
  return {
    id: "console",
    kind: "transactional",
    delivers: false,
    send(message: OutboundEmail) {
      if (env().NODE_ENV === "production") {
        if (!warned) {
          warned = true;
          console.warn(
            "[mail] This instance has no delivering transactional mail adapter. " +
              "Messages are discarded and their content is never written to production logs. " +
              "Connect Gmail/Microsoft or configure SMTP; see .env.example.",
          );
        }
        return Promise.resolve({
          providerRef: `console:${message.deliveryId ?? crypto.randomUUID()}`,
        });
      }

      console.log(
        [
          "",
          "-------- mail (not sent) --------",
          `to:      ${message.to}`,
          `subject: ${message.subject}`,
          "",
          message.text,
          "---------------------------------",
          "",
        ].join("\n"),
      );
      return Promise.resolve({
        providerRef: `console:${message.deliveryId ?? crypto.randomUUID()}`,
      });
    },
  };
}
