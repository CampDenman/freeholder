// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import {
  providerJson,
  requestWithTimeout,
  safeProviderLabel,
} from "@/adapters/mail/http";
import { MailAdapterError, type MailAdapter } from "@/adapters/mail/types";

export function createResendMail(options: {
  apiKey: string;
  from: string;
  fetch?: typeof globalThis.fetch;
}): MailAdapter {
  const fetcher = options.fetch ?? globalThis.fetch;
  const headers = {
    authorization: `Bearer ${options.apiKey}`,
    "content-type": "application/json",
  };
  return {
    id: "resend",
    kind: "bulk",
    delivers: true,
    async send(message) {
      const response = await requestWithTimeout(fetcher, "https://api.resend.com/emails", {
        method: "POST",
        headers: {
          ...headers,
          ...(message.deliveryId ? { "idempotency-key": message.deliveryId } : {}),
        },
        body: JSON.stringify({
          from: message.from ?? options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          reply_to: message.replyTo,
          headers: message.deliveryId
            ? { "x-freeholder-delivery": message.deliveryId }
            : undefined,
        }),
      });
      const body = await providerJson<{ id?: string }>(response, "Resend");
      if (!body.id) {
        throw new MailAdapterError(
          "Resend accepted the request without an email id.",
        );
      }
      return { providerRef: body.id };
    },
    async verifySender(sender) {
      const response = await requestWithTimeout(
        fetcher,
        "https://api.resend.com/domains",
        { method: "GET", headers },
      );
      const body = await providerJson<{
        data?: Array<{ id?: string; name?: string; status?: string }>;
      }>(response, "Resend");
      const domain = sender.email.split("@")[1]?.toLowerCase();
      const identity = body.data?.find(
        (item) =>
          (sender.providerIdentity && item.id === sender.providerIdentity) ||
          item.name?.toLowerCase() === domain,
      );
      if (!identity) {
        return {
          status: "failed",
          detail: { domain },
          message: "Resend has no sending domain matching this address.",
        };
      }
      const providerStatus = safeProviderLabel(identity.status, "pending");
      return {
        status: providerStatus === "verified" ? "verified" : "pending",
        detail: {
          id: safeProviderLabel(identity.id),
          domain: safeProviderLabel(identity.name),
          providerStatus,
        },
        message:
          providerStatus === "verified"
            ? undefined
            : `Resend reports the domain as ${providerStatus}.`,
      };
    },
  };
}
