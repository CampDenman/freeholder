// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared HTTP skin for authenticated provider feedback routes.
import { MailWebhookError } from "@/core/mail/webhooks";

export function mailWebhookRoute(
  process: (request: Request) => Promise<number>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const processed = await process(request);
      return Response.json({ ok: true, processed });
    } catch (error) {
      if (error instanceof MailWebhookError) {
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      }
      console.error("mail webhook processing failed", error);
      return Response.json(
        { error: "Mail feedback could not be processed." },
        { status: 500 },
      );
    }
  };
}
