// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { MailAdapterError, type MailAdapter } from "@/adapters/mail/types";

export function createNoBulkMail(): MailAdapter {
  return {
    id: "none",
    kind: "bulk",
    delivers: false,
    send() {
      return Promise.reject(
        new MailAdapterError(
          "Bulk mail is not configured. Choose Resend, Postmark, or Amazon SES first.",
        ),
      );
    },
  };
}
