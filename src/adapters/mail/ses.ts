// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { AwsClient } from "aws4fetch";
import { providerJson } from "@/adapters/mail/http";
import {
  safeProviderLabel,
} from "@/adapters/mail/http";
import { MailAdapterError, type MailAdapter } from "@/adapters/mail/types";

export function createSesMail(options: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  from: string;
  configurationSet?: string;
  /** Injectable signed fetch seam for deterministic tests. */
  client?: Pick<AwsClient, "fetch">;
}): MailAdapter {
  const client =
    options.client ??
    new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: options.sessionToken,
      service: "ses",
      region: options.region,
      retries: 0,
    });
  const endpoint = `https://email.${options.region}.amazonaws.com/v2/email`;
  return {
    id: "ses",
    kind: "bulk",
    delivers: true,
    async send(message) {
      let response: Response;
      try {
        response = await client.fetch(`${endpoint}/outbound-emails`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
          FromEmailAddress: message.from ?? options.from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: message.text, Charset: "UTF-8" },
                ...(message.html
                  ? { Html: { Data: message.html, Charset: "UTF-8" } }
                  : {}),
              },
              ...(message.deliveryId
                ? {
                    Headers: [
                      { Name: "X-Freeholder-Delivery", Value: message.deliveryId },
                    ],
                  }
                : {}),
            },
          },
          ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
          ConfigurationSetName: options.configurationSet,
          EmailTags: message.deliveryId
            ? [{ Name: "freeholder_delivery", Value: message.deliveryId }]
            : undefined,
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (error instanceof MailAdapterError) throw error;
        throw new MailAdapterError("Amazon SES could not be reached.", true);
      }
      const body = await providerJson<{ MessageId?: string }>(response, "Amazon SES");
      if (!body.MessageId) {
        throw new MailAdapterError(
          "Amazon SES accepted the request without a message id.",
        );
      }
      return { providerRef: body.MessageId };
    },
    async verifySender(sender) {
      const identity = sender.providerIdentity ?? sender.email.split("@")[1] ?? sender.email;
      let response: Response;
      try {
        response = await client.fetch(
          `${endpoint}/identities/${encodeURIComponent(identity)}`,
          { method: "GET", signal: AbortSignal.timeout(30_000) },
        );
      } catch (error) {
        if (error instanceof MailAdapterError) throw error;
        throw new MailAdapterError("Amazon SES could not be reached.", true);
      }
      const body = await providerJson<{
        VerifiedForSendingStatus?: boolean;
        VerificationStatus?: string;
        DkimAttributes?: { Status?: string };
      }>(response, "Amazon SES");
      const providerStatus = safeProviderLabel(
        body.VerificationStatus,
        "pending",
      );
      const dkim = safeProviderLabel(body.DkimAttributes?.Status);
      return {
        status: body.VerifiedForSendingStatus ? "verified" : "pending",
        detail: {
          identity,
          providerStatus,
          dkim,
        },
        message: body.VerifiedForSendingStatus
          ? undefined
          : `Amazon SES reports ${identity} as ${providerStatus}.`,
      };
    },
  };
}
