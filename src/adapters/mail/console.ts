// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Mail that goes nowhere, and says so (MASTER.md §12, §17).
//
// The default, because a fresh instance has no SMTP credentials and the
// alternative to printing is refusing to boot. It exists so a developer can
// walk the whole password-reset flow with no account anywhere — the link is
// right there in the terminal.
//
// What it must never do is let anybody believe mail is working. `delivers` is
// false, callers that matter check it, and in production it says out loud that
// every message it was handed was thrown away.
import { env } from "@/core/env";
import type { MailAdapter, OutboundEmail } from "@/adapters/mail/types";

export function createConsoleMail(): MailAdapter {
  let warned = false;
  return {
    id: "console",
    kind: "both",
    delivers: false,
    send(message: OutboundEmail) {
      if (env().NODE_ENV === "production" && !warned) {
        warned = true;
        console.warn(
          "[mail] This instance has no mail adapter configured, so nothing it " +
            "sends will arrive. Password resets, receipts and notifications " +
            "are being written to this log instead. Set MAIL_ADAPTER=smtp and " +
            "the SMTP_* variables — see .env.example.",
        );
      }
      console.log(
        [
          "",
          "──────── mail (not sent) ────────",
          `to:      ${message.to}`,
          `subject: ${message.subject}`,
          "",
          message.text,
          "─────────────────────────────────",
          "",
        ].join("\n"),
      );
      return Promise.resolve({ providerRef: `console:${Date.now()}` });
    },
  };
}
