// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
