// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: freeze the original mail route without retaining credentials.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { connectedAccounts } from "@/core/connections/schema";
import { env } from "@/core/env";
import { ServiceError, type Tx } from "@/core/service";
import type { MailProvider } from "@/adapters/mail/types";
import { paradiseBaseUrl } from "@/adapters/paradise/config";
import { mailReceipts, type MailReceipts } from "./receipts";
import { decryptMailOutbox, encryptMailOutbox } from "./outbox-crypto";
import { mailDispatchRequests, mailSenders } from "./schema";

export const dispatchRouteSchema = z.object({
  provider: z.string().min(1).max(40), purpose: z.enum(["transactional", "bulk"]),
  from: z.string().max(998), senderId: z.uuid().nullable(),
  connectionId: z.uuid().nullable(), providerAccountId: z.string().max(2_000).nullable(),
  host: z.string().max(2_000).nullable(), port: z.number().int().nullable(),
  user: z.string().max(2_000).nullable(), providerIdentity: z.string().max(2_000).nullable(),
  authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DispatchRoute = z.infer<typeof dispatchRouteSchema>;
type Sender = Pick<typeof mailSenders.$inferSelect, "id" | "email" | "connectedAccountId" | "providerIdentity">;
export type MailRouteInput = { purpose: "transactional" | "bulk"; provider: MailProvider; sender?: Sender; from?: string };

/** This snapshot stays private and encrypted; only its keyed digest is compared. */
export async function originalMailRoute(tx: Tx, input: MailRouteInput, receipts: MailReceipts): Promise<DispatchRoute> {
  const current = env(), sender = input.sender;
  const [account] = sender?.connectedAccountId
    ? await tx.select({ providerAccountId: connectedAccounts.providerAccountId }).from(connectedAccounts).where(eq(connectedAccounts.id, sender.connectedAccountId)).limit(1)
    : [];
  if (sender?.connectedAccountId && !account) throw new ServiceError("conflict", "The original connected mail account is unavailable.");
  const credentials = input.provider === "smtp" ? [current.SMTP_USER ?? null, current.SMTP_PASSWORD ?? null]
    : input.provider === "resend" ? [current.RESEND_API_KEY ?? null]
      : input.provider === "postmark" ? [current.POSTMARK_SERVER_TOKEN ?? null, current.POSTMARK_MESSAGE_STREAM ?? null]
        : input.provider === "ses" ? [current.SES_ACCESS_KEY_ID ?? null, current.SES_SECRET_ACCESS_KEY ?? null, current.SES_REGION ?? null, current.SES_CONFIGURATION_SET ?? null]
          : input.provider === "paradise" ? [current.PARADISEMODERN_API_KEY ?? null, current.PARADISEMODERN_URL ?? null, current.PARADISEMODERN_MAIL_TOPIC ?? null]
            : [input.provider, account?.providerAccountId ?? null];
  return dispatchRouteSchema.parse({
    provider: input.provider, purpose: input.purpose,
    from: input.from ?? sender?.email ?? (input.purpose === "bulk" ? current.MAIL_BULK_FROM : current.MAIL_FROM) ?? "",
    senderId: sender?.id ?? null, connectionId: sender?.connectedAccountId ?? null, providerAccountId: account?.providerAccountId ?? null,
    host: input.provider === "smtp" ? current.SMTP_HOST?.toLowerCase() ?? null
      : input.provider === "paradise" ? paradiseBaseUrl()
        : input.provider === "gmail" ? "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
          : input.provider === "outlook" ? "https://graph.microsoft.com/v1.0/me/sendMail"
            : input.provider === "resend" ? "https://api.resend.com/emails"
              : input.provider === "postmark" ? "https://api.postmarkapp.com/email"
                : input.provider === "ses" ? `https://email.${current.SES_REGION ?? ""}.amazonaws.com/v2/email/outbound-emails` : null,
    port: input.provider === "smtp" ? Number(current.SMTP_PORT ?? "587") : null,
    user: input.provider === "smtp" ? current.SMTP_USER ?? null : null,
    providerIdentity: sender?.providerIdentity ?? null,
    authorizationDigest: receipts.digest("dispatch-authorization", JSON.stringify(credentials)),
  });
}

export async function freezeMailDispatchRequest(tx: Tx, deliveryId: string, route: MailRouteInput, payload: string): Promise<void> {
  const receipts = await mailReceipts(tx), snapshot = await originalMailRoute(tx, route, receipts);
  const encoded = JSON.stringify(snapshot);
  await tx.insert(mailDispatchRequests).values({ deliveryId, routeDigest: receipts.digest("dispatch-route", encoded), payloadDigest: receipts.digest("dispatch-payload", payload), encryptedRoute: encryptMailOutbox(encoded, deliveryId) });
}

export function readOriginalMailRoute(encrypted: string, deliveryId: string): DispatchRoute {
  return dispatchRouteSchema.parse(JSON.parse(decryptMailOutbox(encrypted, deliveryId)) as unknown);
}
/** No hashes, credentials or private lookup authority in operator DTOs. */
export function publicOriginalMailRoute(route: DispatchRoute) {
  const { provider, purpose, from, senderId, connectionId, providerAccountId, host, port, user, providerIdentity } = route;
  return { provider, purpose, from, senderId, connectionId, providerAccountId, host, port, user, providerIdentity };
}
