// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { providerJson, requestWithTimeout } from "@/adapters/mail/http";
import { MailAdapterError, type MailAdapter } from "@/adapters/mail/types";

export function createPostmarkMail(options: {
  serverToken: string;
  accountToken?: string;
  from: string;
  messageStream?: string;
  fetch?: typeof globalThis.fetch;
}): MailAdapter {
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    id: "postmark",
    kind: "bulk",
    delivers: true,
    async send(message) {
      const response = await requestWithTimeout(
        fetcher,
        "https://api.postmarkapp.com/email",
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-postmark-server-token": options.serverToken,
          },
          body: JSON.stringify({
            From: message.from ?? options.from,
            To: message.to,
            Subject: message.subject,
            TextBody: message.text,
            HtmlBody: message.html,
            ReplyTo: message.replyTo,
            MessageStream: options.messageStream ?? "broadcasts",
            Metadata: message.deliveryId
              ? { freeholder_delivery: message.deliveryId }
              : undefined,
          }),
        },
      );
      const body = await providerJson<{ MessageID?: string }>(response, "Postmark");
      if (!body.MessageID) {
        throw new MailAdapterError(
          "Postmark accepted the request without a message id.",
        );
      }
      return { providerRef: body.MessageID };
    },
    async verifySender(sender) {
      if (!options.accountToken) {
        return {
          status: "pending",
          detail: {},
          message:
            "POSTMARK_ACCOUNT_TOKEN is needed to check the sender signature; sending uses the separate server token.",
        };
      }
      const response = await requestWithTimeout(
        fetcher,
        "https://api.postmarkapp.com/senders?count=500&offset=0",
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-postmark-account-token": options.accountToken,
          },
        },
      );
      const body = await providerJson<{
        SenderSignatures?: Array<{
          ID?: number;
          EmailAddress?: string;
          Confirmed?: boolean;
          DKIMVerified?: boolean;
          ReturnPathDomainVerified?: boolean;
        }>;
      }>(response, "Postmark");
      const identity = body.SenderSignatures?.find(
        (item) => item.EmailAddress?.toLowerCase() === sender.email,
      );
      if (!identity) {
        return {
          status: "failed",
          detail: {},
          message: "Postmark has no sender signature matching this address.",
        };
      }
      return {
        status: identity.Confirmed ? "verified" : "pending",
        detail: {
          id: identity.ID,
          confirmed: identity.Confirmed,
          dkim: identity.DKIMVerified,
          returnPath: identity.ReturnPathDomainVerified,
        },
        message: identity.Confirmed
          ? undefined
          : "Postmark is still waiting for this sender signature to be confirmed.",
      };
    },
  };
}
