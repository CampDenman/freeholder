// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sending one message to many people (MASTER.md §30, §4.14, C9.06).
//
// The send itself is `core/mail`'s `sendMail`, which already refuses a
// suppressed address and insists on a verified bulk sender. This file is the
// part around it: freezing an audience, sending in batches that can stop and
// resume, and counting what happened from rows rather than from hope.
//
// **Why the audience is frozen.** §30's segments are dynamic queries, so who
// is in one changes as customers do. A broadcast that re-read its segment
// mid-send would mail people who joined after it started, skip people who
// left, and never be able to answer "who did this go to". So the recipients
// are written once, up front, and the send walks that list.
//
// **Why sending is batched.** A campaign to ten thousand people is not one
// transaction. Each batch commits, so a crash costs the batch rather than the
// campaign, and the next call picks up exactly where it stopped — the same
// argument the automation runtime makes about a run being a row.
import { z } from "zod";
import { and, asc, count, eq, lte, or, sql } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import {
  defineService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { contacts } from "@/core/contacts/schema";
import { sendMail } from "@/core/mail/service";
import { segmentMembership } from "@/core/segments/service";
import {
  BROADCAST_STATUSES,
  RECIPIENT_STATES,
  broadcastRecipients,
  broadcasts,
} from "./broadcast-schema";
import { emailTemplates } from "./template-schema";
import { renderTemplate } from "./template-service";
import { canContact } from "@/core/privacy/service";

const broadcastRow = row({
  id: uuidSchema,
  name: z.string(),
  templateId: uuidSchema,
  segmentId: uuidSchema,
  subject: z.string().nullable(),
  status: z.enum(BROADCAST_STATUSES),
  scheduledAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  audienceCount: z.number().int(),
  updatedAt: z.date(),
});

/** How many to send per call. Small enough to commit often, large enough to move. */
const BATCH = 50;

export const saveBroadcast = defineService({
  name: "broadcasts.save",
  writeClass: "write",
  summary: "Create or change a broadcast before it is sent.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    name: z.string().trim().min(1).max(200),
    templateId: uuidSchema,
    segmentId: uuidSchema,
    subject: z.string().trim().max(300).nullish(),
    scheduledAt: z.coerce.date().nullish(),
  }),
  output: broadcastRow,
  handler: async (input, ctx) => {
    if (input.id) {
      const [existing] = await ctx.tx
        .select({ status: broadcasts.status })
        .from(broadcasts)
        .where(eq(broadcasts.id, input.id));
      if (!existing) throw new ServiceError("not_found", "There is no such broadcast.");
      // Editing something already going out would change the wording halfway
      // through the audience, so half the list gets one message and half
      // another — with nothing to say which.
      if (existing.status !== "draft" && existing.status !== "scheduled") {
        throw new ServiceError("conflict", "That broadcast has already started.");
      }
    }
    if (input.scheduledAt && input.scheduledAt.getTime() < Date.now()) {
      throw new ServiceError("validation", "That send time is already in the past.");
    }

    // Typed rather than asserted, so the column's own union is what checks it.
    const status: (typeof BROADCAST_STATUSES)[number] = input.scheduledAt
      ? "scheduled"
      : "draft";
    const values = {
      name: input.name,
      templateId: input.templateId,
      segmentId: input.segmentId,
      subject: input.subject ?? null,
      scheduledAt: input.scheduledAt ?? null,
      status,
    };

    if (input.id) {
      const [updated] = await ctx.tx
        .update(broadcasts)
        .set(values)
        .where(eq(broadcasts.id, input.id))
        .returning();
      ctx.setSubject("broadcast", updated!.id);
      return updated!;
    }
    const [created] = await ctx.tx.insert(broadcasts).values(values).returning();
    ctx.setSubject("broadcast", created!.id);
    ctx.queueEvent("broadcast.created", { broadcastId: created!.id });
    return created!;
  },
});

/**
 * Send one copy to one address, without touching the broadcast.
 *
 * §30 asks for "test-send-to-self on every editor screen", and the point is
 * that it proves the *rendering* — the template, the variables, the sender —
 * before an owner commits it to thousands of people. It deliberately writes no
 * recipient row: a test is not part of the campaign's history.
 */
export const testSend = defineService({
  name: "broadcasts.testSend",
  writeClass: "write",
  summary: "Send one copy to yourself before committing to the list.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    templateId: uuidSchema,
    to: z.string().trim().email(),
    subject: z.string().trim().max(300).nullish(),
    variables: z.record(z.string(), z.string()).default({}),
  }),
  output: row({ sent: z.boolean(), subject: z.string() }),
  handler: async (input, ctx) => {
    const rendered = await ctx.call(renderTemplate, {
      id: input.templateId,
      variables: input.variables,
    });
    const subject = input.subject ?? rendered.subject;
    await sendMail(
      ctx.tx,
      { to: input.to, subject, html: rendered.html, text: rendered.text },
      { purpose: "bulk" },
    );
    return { sent: true, subject };
  },
});

/**
 * Freeze the audience and begin.
 *
 * The freeze is the whole point: §30's segments are dynamic, and a send that
 * re-read one halfway through could never say who it reached.
 */
export const startBroadcast = defineService({
  name: "broadcasts.start",
  writeClass: "write",
  summary: "Freeze the audience and start sending.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: row({ broadcastId: uuidSchema, audience: z.number().int() }),
  handler: async (input, ctx) => {
    const [broadcast] = await ctx.tx
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.id, input.id));
    if (!broadcast) throw new ServiceError("not_found", "There is no such broadcast.");
    if (broadcast.status !== "draft" && broadcast.status !== "scheduled") {
      throw new ServiceError("conflict", "That broadcast has already started.");
    }

    const [template] = await ctx.tx
      .select({ status: emailTemplates.status })
      .from(emailTemplates)
      .where(eq(emailTemplates.id, broadcast.templateId));
    if (!template) throw new ServiceError("not_found", "That template has gone.");
    // Archived means "we do not use this wording any more" (C9.05). A draft is
    // fair game — an owner writes the campaign and sends it in one sitting —
    // but sending wording somebody deliberately retired is never what they
    // meant, and a list is not a mistake you can take back.
    if (template.status === "archived") {
      throw new ServiceError(
        "conflict",
        "That template is archived. Restore it, or choose another, before sending.",
      );
    }

    // The audience as the segment sees it right now. §30 calls a segment "the
    // unit of 'who'", so this is the same read a campaign report would make —
    // which is the drift C7.17 exists to prevent.
    const audience = (await ctx.call(segmentMembership, {
      id: broadcast.segmentId,
      limit: 10_000,
    })) as Array<{ id: string; email: string | null }>;
    const withEmail = audience.filter((each) => Boolean(each.email));
    if (withEmail.length === 0) {
      throw new ServiceError("conflict", "Nobody in that audience has an email address.");
    }

    // Written once, up front. `onConflictDoNothing` so a retried start after a
    // partial write adds the rest rather than failing on the first duplicate.
    await ctx.tx
      .insert(broadcastRecipients)
      .values(
        withEmail.map((each) => ({
          broadcastId: broadcast.id,
          contactId: each.id,
          email: each.email!,
        })),
      )
      .onConflictDoNothing();

    const [frozen] = await ctx.tx
      .select({ n: count() })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.broadcastId, broadcast.id));

    await ctx.tx
      .update(broadcasts)
      .set({
        status: "sending",
        startedAt: new Date(),
        audienceCount: frozen?.n ?? 0,
      })
      .where(eq(broadcasts.id, broadcast.id));

    ctx.setSubject("broadcast", broadcast.id);
    ctx.queueEvent("broadcast.started", {
      broadcastId: broadcast.id,
      audience: frozen?.n ?? 0,
    });
    return { broadcastId: broadcast.id, audience: frozen?.n ?? 0 };
  },
});

/**
 * Send the next batch.
 *
 * One batch per call, committing as it goes: a campaign to ten thousand people
 * is not one transaction, and a crash should cost a batch rather than the
 * campaign. Returns what is left so a caller knows whether to come back.
 */
export async function sendBatch(
  ctx: ServiceContext,
  broadcastId: string,
  size = BATCH,
): Promise<{ sent: number; failed: number; remaining: number }> {
  const [broadcast] = await ctx.tx
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.id, broadcastId));
  if (!broadcast) throw new ServiceError("not_found", "There is no such broadcast.");
  if (broadcast.status !== "sending") return { sent: 0, failed: 0, remaining: 0 };

  const batch = await ctx.tx
    .select()
    .from(broadcastRecipients)
    .where(
      and(
        eq(broadcastRecipients.broadcastId, broadcastId),
        eq(broadcastRecipients.state, "pending"),
      ),
    )
    .orderBy(asc(broadcastRecipients.createdAt))
    .limit(size);

  let sent = 0;
  let failed = 0;

  for (const recipient of batch) {
    const [person] = await ctx.tx
      .select({ name: contacts.name, preferredLocale: contacts.preferredLocale })
      .from(contacts)
      .where(eq(contacts.id, recipient.contactId));

    try {
      // Consent is asked, not assumed.
      //
      // The platform is consent-first by construction: `contacts.canContact`
      // reads recorded evidence and treats its absence as a refusal. §2096
      // makes the double opt-in that evidence, so a confirmed subscriber
      // passes and an unsubscribed one does not — and no segment definition
      // can talk over either.
      //
      // Asked here rather than when the audience was frozen, because consent
      // withdrawn between the two is still withdrawn, and the last word must
      // belong to the moment of sending.
      const consent = await ctx.call(canContact, {
        contactId: recipient.contactId,
        purpose: "marketing" as const,
        channel: "email" as const,
      });
      if (!consent.allowed) {
        await ctx.tx
          .update(broadcastRecipients)
          .set({
            state: "suppressed",
            detail: `Marketing consent is ${consent.reason.replaceAll("_", " ")}.`,
          })
          .where(eq(broadcastRecipients.id, recipient.id));
        failed += 1;
        continue;
      }

      const rendered = await ctx.call(renderTemplate, {
        id: broadcast.templateId,
        locale: person?.preferredLocale ?? null,
        variables: {
          "contact.first_name": (person?.name ?? "").split(" ")[0] ?? "",
          "contact.email": recipient.email,
        },
      });
      const delivery = await sendMail(
        ctx.tx,
        {
          to: recipient.email,
          subject: broadcast.subject ?? rendered.subject,
          html: rendered.html,
          text: rendered.text,
        },
        { purpose: "bulk" },
      );
      await ctx.tx
        .update(broadcastRecipients)
        // The delivery is kept so provider feedback can find its way back to
        // this exact copy rather than to this address in general.
        .set({ state: "sent", sentAt: new Date(), deliveryId: delivery.id })
        .where(eq(broadcastRecipients.id, recipient.id));
      sent += 1;
    } catch (error) {
      // A refusal is a recorded outcome, not an exception that stops the
      // campaign. `sendMail` throws on a suppressed address, and one
      // unsubscribed customer must not halt a send to nine thousand others.
      const message = error instanceof ServiceError ? error.message : "Sending failed.";
      const suppressed = message.toLowerCase().includes("suppressed");
      await ctx.tx
        .update(broadcastRecipients)
        .set({ state: suppressed ? "suppressed" : "failed", detail: message })
        .where(eq(broadcastRecipients.id, recipient.id));
      failed += 1;
    }
  }

  const [left] = await ctx.tx
    .select({ n: count() })
    .from(broadcastRecipients)
    .where(
      and(
        eq(broadcastRecipients.broadcastId, broadcastId),
        eq(broadcastRecipients.state, "pending"),
      ),
    );
  const remaining = left?.n ?? 0;

  if (remaining === 0) {
    await ctx.tx
      .update(broadcasts)
      .set({ status: "sent", finishedAt: new Date() })
      .where(eq(broadcasts.id, broadcastId));
    ctx.queueEvent("broadcast.finished", { broadcastId });
  }

  return { sent, failed, remaining };
}

export const sendNext = defineService({
  name: "broadcasts.sendNext",
  writeClass: "write",
  summary: "Send the next batch of a broadcast that is going out.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    id: uuidSchema,
    size: z.number().int().min(1).max(500).default(BATCH),
  }),
  output: row({
    sent: z.number().int(),
    failed: z.number().int(),
    remaining: z.number().int(),
  }),
  handler: (input, ctx) => sendBatch(ctx, input.id, input.size),
});

/**
 * Start whatever is due, and push every send along.
 *
 * A sweep rather than a timer per broadcast: the scheduler asks one indexed
 * question, and missing a window makes a campaign late rather than lost.
 */
export const tick = defineService({
  name: "broadcasts.tick",
  writeClass: "write",
  summary: "Start scheduled broadcasts and advance the ones already sending.",
  kind: "mutation",
  permission: "system",
  input: z.object({}),
  output: row({ started: z.number().int(), sent: z.number().int() }),
  handler: async (_input, ctx) => {
    const due = await ctx.tx
      .select({ id: broadcasts.id })
      .from(broadcasts)
      .where(
        and(eq(broadcasts.status, "scheduled"), lte(broadcasts.scheduledAt, new Date())),
      )
      .limit(10);
    for (const each of due) {
      await ctx.call(startBroadcast, { id: each.id });
    }

    const going = await ctx.tx
      .select({ id: broadcasts.id })
      .from(broadcasts)
      .where(eq(broadcasts.status, "sending"))
      .limit(10);
    let sent = 0;
    for (const each of going) {
      const result = await sendBatch(ctx, each.id);
      sent += result.sent;
    }
    return { started: due.length, sent };
  },
});

export const pauseBroadcast = defineService({
  name: "broadcasts.pause",
  writeClass: "write",
  summary: "Stop a broadcast part-way. What is sent is sent.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema, cancel: z.boolean().default(false) }),
  output: row({ broadcastId: uuidSchema, status: z.enum(BROADCAST_STATUSES) }),
  handler: async (input, ctx) => {
    const [stopped] = await ctx.tx
      .update(broadcasts)
      .set({ status: input.cancel ? "cancelled" : "paused" })
      .where(
        and(
          eq(broadcasts.id, input.id),
          or(eq(broadcasts.status, "sending"), eq(broadcasts.status, "scheduled")),
        ),
      )
      .returning({ id: broadcasts.id, status: broadcasts.status });
    if (!stopped) throw new ServiceError("conflict", "That broadcast is not going out.");
    ctx.setSubject("broadcast", stopped.id);
    ctx.queueEvent("broadcast.paused", { broadcastId: stopped.id, status: stopped.status });
    return { broadcastId: stopped.id, status: stopped.status };
  },
});

export const resumeBroadcast = defineService({
  name: "broadcasts.resume",
  writeClass: "write",
  summary: "Carry on a paused broadcast from where it stopped.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: row({ broadcastId: uuidSchema, remaining: z.number().int() }),
  handler: async (input, ctx) => {
    const [resumed] = await ctx.tx
      .update(broadcasts)
      .set({ status: "sending" })
      .where(and(eq(broadcasts.id, input.id), eq(broadcasts.status, "paused")))
      .returning({ id: broadcasts.id });
    if (!resumed) throw new ServiceError("conflict", "That broadcast is not paused.");
    const [left] = await ctx.tx
      .select({ n: count() })
      .from(broadcastRecipients)
      .where(
        and(
          eq(broadcastRecipients.broadcastId, resumed.id),
          eq(broadcastRecipients.state, "pending"),
        ),
      );
    return { broadcastId: resumed.id, remaining: left?.n ?? 0 };
  },
});

export const listBroadcasts = defineService({
  name: "broadcasts.list",
  summary: "Broadcasts, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(BROADCAST_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(broadcastRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(broadcasts)
      .where(input.status ? eq(broadcasts.status, input.status) : undefined)
      .orderBy(sql`${broadcasts.createdAt} desc`)
      .limit(input.limit),
});

/**
 * What actually happened, counted from rows.
 *
 * §30 asks for honest local analytics, and honest means counted rather than
 * reported: a provider that loses a webhook should make a number stop rising,
 * not make it wrong. Every figure here is a `count(*)` over recipients whose
 * state something wrote down.
 */
export const broadcastStats = defineService({
  name: "broadcasts.stats",
  summary: "How a broadcast actually went, counted from what was recorded.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: row({
    audience: z.number().int(),
    pending: z.number().int(),
    sent: z.number().int(),
    failed: z.number().int(),
    suppressed: z.number().int(),
    bounced: z.number().int(),
    complained: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({ state: broadcastRecipients.state, n: count() })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.broadcastId, input.id))
      .groupBy(broadcastRecipients.state);
    const byState = new Map(rows.map((each) => [each.state, each.n]));
    const at = (state: (typeof RECIPIENT_STATES)[number]) => byState.get(state) ?? 0;
    return {
      audience: rows.reduce((sum, each) => sum + each.n, 0),
      pending: at("pending"),
      sent: at("sent"),
      failed: at("failed"),
      suppressed: at("suppressed"),
      bounced: at("bounced"),
      complained: at("complained"),
    };
  },
});

export const broadcastRecipientList = defineService({
  name: "broadcasts.recipients",
  summary: "Who a broadcast went to, and what became of each copy.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    id: uuidSchema,
    state: z.enum(RECIPIENT_STATES).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  output: listed(
    row({
      contactId: uuidSchema,
      email: z.string(),
      state: z.enum(RECIPIENT_STATES),
      detail: z.string().nullable(),
      sentAt: z.date().nullable(),
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        contactId: broadcastRecipients.contactId,
        email: broadcastRecipients.email,
        state: broadcastRecipients.state,
        detail: broadcastRecipients.detail,
        sentAt: broadcastRecipients.sentAt,
      })
      .from(broadcastRecipients)
      .where(
        and(
          eq(broadcastRecipients.broadcastId, input.id),
          input.state ? eq(broadcastRecipients.state, input.state) : undefined,
        ),
      )
      .orderBy(asc(broadcastRecipients.createdAt))
      .limit(input.limit),
});

/* ------------------------------------------------------------ the spine */

registerContactReference({
  table: "broadcast_recipients",
  // One row per person per broadcast, so merging two people who both received
  // one would collide. The survivor's row stands and the duplicate's goes: two
  // rows saying the same message reached the same person would double every
  // count on the stats screen.
  repoint: async (tx, duplicateId, survivingId) => {
    const mine = await tx
      .select()
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.contactId, duplicateId));
    for (const each of mine) {
      const [survivor] = await tx
        .select({ id: broadcastRecipients.id })
        .from(broadcastRecipients)
        .where(
          and(
            eq(broadcastRecipients.broadcastId, each.broadcastId),
            eq(broadcastRecipients.contactId, survivingId),
          ),
        );
      if (survivor) {
        await tx.delete(broadcastRecipients).where(eq(broadcastRecipients.id, each.id));
        continue;
      }
      await tx
        .update(broadcastRecipients)
        .set({ contactId: survivingId })
        .where(eq(broadcastRecipients.id, each.id));
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const mine = await tx
      .select({ id: broadcastRecipients.id, broadcastId: broadcastRecipients.broadcastId })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.contactId, duplicateId));
    let collides = false;
    for (const each of mine) {
      const [clash] = await tx
        .select({ id: broadcastRecipients.id })
        .from(broadcastRecipients)
        .where(
          and(
            eq(broadcastRecipients.broadcastId, each.broadcastId),
            eq(broadcastRecipients.contactId, survivingId),
          ),
        );
      if (clash) {
        collides = true;
        break;
      }
    }
    return {
      state: mine,
      undoable: !collides,
      ...(collides
        ? {
            blocker:
              "Both people were on the same broadcast, and merging dropped one of the two records.",
          }
        : {}),
    };
  },
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z.array(z.object({ id: z.string().uuid() })).parse(beforeState);
    for (const each of rows) {
      await tx
        .update(broadcastRecipients)
        .set({ contactId: duplicateId })
        .where(eq(broadcastRecipients.id, each.id));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.broadcasts",
  tables: ["broadcast_recipients"],
  exportData: async (tx, contactId) => ({
    broadcasts: await tx
      .select({
        broadcastId: broadcastRecipients.broadcastId,
        email: broadcastRecipients.email,
        state: broadcastRecipients.state,
        sentAt: broadcastRecipients.sentAt,
      })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // The row survives with the address removed, the way an attribution touch
    // does. That a campaign went to nine thousand people on the 4th is the
    // business's own record — and a count that changed when somebody exercised
    // their rights would be a count nobody could reconcile. The address is the
    // part that belongs to the person.
    const cleared = await tx
      .update(broadcastRecipients)
      .set({ email: "", detail: null })
      .where(eq(broadcastRecipients.contactId, contactId))
      .returning({ id: broadcastRecipients.id });
    return { affected: cleared.length };
  },
});

/**
 * Provider feedback, applied to the copy it belongs to (C9.06).
 *
 * A bounce or a spam complaint arrives hours or weeks after the send, over a
 * webhook, naming an address. `core/mail` has already suppressed that address
 * by the time this runs — that part is the platform's business and happens
 * whether campaigns exist or not. What is left is the campaign's own record:
 * §30 wants a broadcast to be able to say what became of each copy, and
 * "bounced" is one of the things that becomes of one.
 *
 * A plain function rather than a service, deliberately. Every mutation writes
 * an `audit_log` row, and a webhook arriving at 3am is not something the owner
 * did — a listener that registered as a mutation would put provider traffic at
 * the top of the activity feed (the mistake C9.10 made and paid for).
 *
 * Safe to run twice: the outbox retries, and setting a state to the value it
 * already holds costs nothing.
 */
export async function onMailDeliveryUpdated(payload: unknown): Promise<void> {
  const event = payload as {
    deliveryId?: string | null;
    type?: string;
    recipient?: string;
  };
  const state =
    event.type === "hard_bounce" || event.type === "soft_bounce"
      ? ("bounced" as const)
      : event.type === "complaint"
        ? ("complained" as const)
        : null;
  if (!state) return;

  // Only ever the delivery this event names. Falling back to the address would
  // mark whichever campaign mailed that person most recently, which is a wrong
  // number rather than a missing one — and §30 would rather have the second.
  if (!event.deliveryId) return;

  const { db } = await import("@/core/db");
  await db()
    .update(broadcastRecipients)
    .set({ state, detail: event.type ?? null })
    .where(
      and(
        eq(broadcastRecipients.deliveryId, event.deliveryId),
        // Only a copy that actually went out. A recipient still pending, or
        // one already refused before the provider saw it, did not bounce.
        eq(broadcastRecipients.state, "sent"),
      ),
    );
}

export default [
  saveBroadcast,
  testSend,
  startBroadcast,
  sendNext,
  tick,
  pauseBroadcast,
  resumeBroadcast,
  listBroadcasts,
  broadcastStats,
  broadcastRecipientList,
];
