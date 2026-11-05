// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Preview mail (MASTER.md §43 C3.36).
//
// A private preview (C3.35) has no public domain, and until now its
// transactional mail failed `assertMailReady` unless a delivering adapter was
// configured, so a customer could not sign in to it. On a preview,
// transactional mail is accepted like it is in the playground, but it reaches
// only the people the preview already involves:
//
//   - the owner addresses in FREEHOLDER_PREVIEW_MAIL_ALLOW; and
//   - contacts of this site. The site is unreachable without the signed
//     preview link, so every contact on a preview arrived through it (or was
//     entered by the owner).
//
// A message to either is delivered through the configured delivering adapter,
// under a preview-wide cap per rolling 24 hours. Every other message, and every
// message while no adapter delivers, is *held*: its delivery row says `held`
// with the reason, its encrypted body stays in mail_outbox, and no job is
// queued. The owner reads held mail in the admin (`mail.listHeld`, then
// `mail.openHeld`), which is where a held sign-in link can be followed.
// Customers and the public never see a held message: showing a link to the
// person who asked for it would defeat the email proof it exists for.
//
// Campaign and bulk mail are refused outright on a preview.
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { env, type Env } from "@/core/env";
import { mailDeliveries, mailOutbox } from "@/core/mail/schema";
import { decryptMailOutbox } from "@/core/mail/outbox-crypto";
import { previewEnabled } from "@/core/preview/private-preview";
import { defineService, ServiceError, type Tx } from "@/core/service";

export const PREVIEW_MAIL_DAILY_CAP_DEFAULT = 100;

export const PREVIEW_BULK_REFUSAL =
  "Campaign and bulk mail are off on a private preview. Publish the site before sending a campaign.";

export const HOLD_REASONS = ["recipient", "cap", "no_adapter"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

/** Whether this instance is a private preview, whose mail follows this policy. */
export function previewMailActive(environment: Pick<Env, "FREEHOLDER_PREVIEW_KEY"> = env()): boolean {
  return previewEnabled(environment.FREEHOLDER_PREVIEW_KEY);
}

/** The owner addresses that may receive preview mail, lower-cased. */
export function previewMailAllowList(
  environment: Pick<Env, "FREEHOLDER_PREVIEW_MAIL_ALLOW"> = env(),
): string[] {
  return [
    ...new Set(
      (environment.FREEHOLDER_PREVIEW_MAIL_ALLOW ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function previewMailDailyCap(
  environment: Pick<Env, "FREEHOLDER_PREVIEW_MAIL_DAILY_CAP"> = env(),
): number {
  return environment.FREEHOLDER_PREVIEW_MAIL_DAILY_CAP ?? PREVIEW_MAIL_DAILY_CAP_DEFAULT;
}

/**
 * Statuses that count against the cap: everything handed to (or on its way
 * to) a provider. Held and suppressed messages never left.
 */
const COUNTED = ["queued", "submitted", "delivered", "bounced", "complained", "failed"] as const;

async function sentInLastDay(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(mailDeliveries)
    .where(
      and(
        eq(mailDeliveries.purpose, "transactional"),
        inArray(mailDeliveries.status, [...COUNTED]),
        gt(mailDeliveries.createdAt, sql`now() - interval '24 hours'`),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Whether a preview must hold this transactional message, and why. Null means
 * deliver it. Runs inside the staging transaction; the advisory lock makes the
 * cap exact under concurrent senders, because the lock is held until the
 * caller's new delivery row commits.
 */
export async function previewMailHold(
  tx: Tx,
  recipient: string,
  routeDelivers: boolean,
): Promise<HoldReason | null> {
  if (!routeDelivers) return "no_adapter";
  if (!previewMailAllowList().includes(recipient)) {
    const [contact] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, recipient))
      .limit(1);
    if (!contact) return "recipient";
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mail-preview-cap'))`);
  if ((await sentInLastDay(tx)) >= previewMailDailyCap()) return "cap";
  return null;
}

/** The sentence an owner reads beside a held message. */
export const HOLD_REASON_TEXT: Record<HoldReason, string> = {
  recipient: "Held: the recipient is not on FREEHOLDER_PREVIEW_MAIL_ALLOW and is not a contact of this site.",
  cap: "Held: the preview's daily delivery cap was reached.",
  no_adapter: "Held: no delivering mail adapter is configured.",
};

const heldMailRow = z.object({
  id: uuid,
  recipient: z.string(),
  subject: z.string(),
  reason: z.enum(HOLD_REASONS),
  requestedBy: z.string(),
  createdAt: timestamp,
  /** False once the 30-day outbox expiry has removed the body. */
  readable: z.boolean(),
});

export const listHeldMail = defineService({
  name: "mail.listHeld",
  summary: "The private preview outbox: held transactional messages, newest first, without their bodies.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
  output: z.object({
    preview: z.boolean(),
    allowList: z.array(z.string()),
    dailyCap: z.number().int(),
    sentLast24Hours: z.number().int(),
    held: listed(heldMailRow),
  }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: mailDeliveries.id,
        recipient: mailDeliveries.recipient,
        subject: mailDeliveries.subject,
        reason: mailDeliveries.holdReason,
        requestedBy: mailDeliveries.requestedBy,
        createdAt: mailDeliveries.createdAt,
        body: mailOutbox.deliveryId,
      })
      .from(mailDeliveries)
      .leftJoin(mailOutbox, eq(mailOutbox.deliveryId, mailDeliveries.id))
      .where(eq(mailDeliveries.status, "held"))
      .orderBy(desc(mailDeliveries.createdAt))
      .limit(input.limit);
    return {
      preview: previewMailActive(),
      allowList: previewMailAllowList(),
      dailyCap: previewMailDailyCap(),
      sentLast24Hours: await sentInLastDay(ctx.tx),
      held: rows.map(({ body, reason, ...row }) => ({
        ...row,
        reason: reason ?? "recipient",
        readable: body !== null,
      })),
    };
  },
});

const heldBody = z.object({
  to: z.string(),
  subject: z.string(),
  text: z.string(),
}).loose();

/**
 * Read one held message, sign-in link included. A mutation so that every read
 * writes an audit row naming who opened which message; a person at the
 * controls only, never an API key, because the body can be a credential.
 */
export const openHeldMail = defineService({
  name: "mail.openHeld",
  summary: "Open one message held in the private preview outbox, including any sign-in link in it. Audited.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  agentCallable: false,
  input: z.object({ id: z.uuid() }),
  output: z.object({
    id: uuid,
    recipient: z.string(),
    subject: z.string(),
    reason: z.enum(HOLD_REASONS),
    text: z.string(),
    createdAt: timestamp,
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user" && ctx.actor.kind !== "system") {
      throw new ServiceError("permission", "Sign in to the admin to read held preview mail.");
    }
    const [held] = await ctx.tx
      .select({ delivery: mailDeliveries, encryptedMessage: mailOutbox.encryptedMessage })
      .from(mailDeliveries)
      .leftJoin(mailOutbox, eq(mailOutbox.deliveryId, mailDeliveries.id))
      .where(and(eq(mailDeliveries.id, input.id), eq(mailDeliveries.status, "held")))
      .limit(1);
    if (!held) throw new ServiceError("not_found", "No such held message.");
    if (!held.encryptedMessage) {
      throw new ServiceError("not_found", "This held message expired and its body was removed.");
    }
    let body: z.output<typeof heldBody>;
    try {
      body = heldBody.parse(JSON.parse(decryptMailOutbox(held.encryptedMessage, held.delivery.id)) as unknown);
    } catch {
      throw new ServiceError("conflict", "This held message could not be read safely.");
    }
    ctx.setSubject("mail_delivery", held.delivery.id);
    return {
      id: held.delivery.id,
      recipient: held.delivery.recipient,
      subject: held.delivery.subject,
      reason: held.delivery.holdReason ?? "recipient",
      text: body.text,
      createdAt: held.delivery.createdAt,
    };
  },
});

export const previewMailServices = [listHeldMail, openHeldMail];
