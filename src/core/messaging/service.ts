// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recording a conversation (MASTER.md §4.14, C7.08).
//
// This is the canonical model every channel writes into. C7.09 builds the
// workflows over it (assign, snooze, close, search, bulk), C7.10 the SMS
// adapter, C7.12 consent — all of them on these three tables, which is the
// whole point of building the shape first.
//
// Four rules the service holds.
//
// **An inbound message resolves to a Contact, always.** §4.14 states it
// outright, and the reason is that a thread with nobody attached is a thread
// nobody can act on: no history, no consent record, no way to answer "who is
// this". Resolution goes through `contacts.resolve` and never `create`, so a
// text from an unknown number produces a real person rather than a duplicate of
// somebody the business already knows.
//
// **Threading is by contact first, provider thread id second.** §4.14's promise
// is that a form submission, the email reply to it and a text about the same
// job are one conversation. So an incoming message joins the person's most
// recent open thread unless it names a different one, rather than starting a
// new thread per channel.
//
// **Ingest is idempotent.** Every provider retries its webhooks. `provider_ref`
// is unique, so the second delivery of the same message is a no-op that returns
// the row the first one wrote — not a duplicate in the inbox and on the bill.
//
// **Delivery is observed, not assumed.** Carrier status is a table of events
// with the provider's own codes kept verbatim, because "undelivered, code 30003"
// is what support asks for and a boolean is not.
import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { isUniqueViolation } from "@/core/db";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";
import {
  CONVERSATION_STATUSES,
  DELIVERY_STATUSES,
  MESSAGE_AUTHORS,
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTIONS,
  conversations,
  messageDeliveries,
  messages,
} from "./schema";

export {
  CONVERSATION_STATUSES,
  DELIVERY_STATUSES,
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTIONS,
} from "./schema";

const id = z.string().uuid();

function requirePerson(actor: Actor): void {
  // System passes: a form submission and a carrier webhook both arrive on
  // anonymous paths and reach here through `ctx.callAsSystem`.
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to read conversations.");
  }
}

const conversationRow = row({
  id: uuid,
  contactId: uuid,
  subject: z.string().nullable(),
  replyChannel: z.enum(MESSAGE_CHANNELS),
  numberId: uuid.nullable(),
  status: z.enum(CONVERSATION_STATUSES),
  snoozedUntil: timestamp.nullable(),
  assigneeUserId: uuid.nullable(),
  threadKey: z.string().nullable(),
  lastInboundAt: timestamp.nullable(),
  lastOutboundAt: timestamp.nullable(),
  unread: z.boolean(),
  messageCount: z.number().int(),
  updatedAt: timestamp,
});

const messageRow = row({
  id: uuid,
  conversationId: uuid,
  contactId: uuid,
  direction: z.enum(MESSAGE_DIRECTIONS),
  channel: z.enum(MESSAGE_CHANNELS),
  body: z.string(),
  mediaAssetIds: z.array(uuid),
  sentBy: z.enum(MESSAGE_AUTHORS),
  sentByUserId: uuid.nullable(),
  providerRef: z.string().nullable(),
  segments: z.number().int().nullable(),
  costMinor: z.number().int().nullable(),
  costCurrency: z.string().nullable(),
  occurredAt: timestamp,
});

/**
 * How long a thread stays the thread.
 *
 * A reply three days after the last message is the same conversation; one three
 * months later is a new subject even from the same person. Fourteen days is a
 * judgement, not a law — long enough for "sorry, been away", short enough that
 * a customer's spring enquiry does not land under their autumn one.
 */
const SAME_THREAD_DAYS = 14;

/**
 * The one door every channel writes through.
 *
 * Taking the person's address rather than their id, because that is what an
 * inbound message actually has — and resolving it here is what keeps §4.14's
 * "always a Contact" rule in one place instead of in every adapter.
 */
export const recordMessage = defineService({
  name: "conversations.record",
  summary: "Record one message, threading it onto the right conversation.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  input: z
    .object({
      /** Who it is with, if the caller already knows. */
      contactId: id.optional(),
      /** Or how to find them. Either is enough; neither is not. */
      email: z.string().trim().toLowerCase().email().max(320).optional(),
      phone: z.string().trim().max(40).optional(),
      name: z.string().trim().max(200).optional(),
      direction: z.enum(MESSAGE_DIRECTIONS),
      channel: z.enum(MESSAGE_CHANNELS),
      body: z.string().trim().min(1).max(100_000),
      subject: z.string().trim().max(500).optional(),
      mediaAssetIds: z.array(id).max(20).default([]),
      sentBy: z.enum(MESSAGE_AUTHORS).optional(),
      sentByUserId: id.optional(),
      /** The provider's id, which makes a retried webhook a no-op. */
      providerRef: z.string().trim().max(300).optional(),
      /** The provider's name for the thread, if it has one. */
      threadKey: z.string().trim().max(300).optional(),
      /** Put it in this thread rather than working one out. */
      conversationId: id.optional(),
      numberId: id.optional(),
      segments: z.number().int().min(0).max(1_000).optional(),
      costMinor: z.number().int().min(0).optional(),
      costCurrency: z.string().trim().toUpperCase().length(3).optional(),
      occurredAt: z.iso.datetime().optional(),
    })
    .refine(
      (input) => Boolean(input.contactId ?? input.email ?? input.phone),
      "Say who the message is with.",
    ),
  output: row({ conversation: conversationRow, message: messageRow, duplicate: z.boolean() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);

    // Idempotency first, before anything is resolved or opened: a retried
    // webhook must not create a contact, a thread, or a second row.
    if (input.providerRef) {
      const [seen] = await ctx.tx
        .select()
        .from(messages)
        .where(eq(messages.providerRef, input.providerRef))
        .limit(1);
      if (seen) {
        const [thread] = await ctx.tx
          .select()
          .from(conversations)
          .where(eq(conversations.id, seen.conversationId))
          .limit(1);
        return { conversation: thread!, message: seen, duplicate: true };
      }
    }

    const contactId = input.contactId ?? (await resolveThem(ctx, input));
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const conversation = await threadFor(ctx, {
      contactId,
      conversationId: input.conversationId,
      threadKey: input.threadKey,
      channel: input.channel,
      subject: input.subject,
      numberId: input.numberId,
      occurredAt,
    });

    const inbound = input.direction === "inbound";
    const write = async () => {
      const [row] = await ctx.tx
        .insert(messages)
        .values({
          conversationId: conversation.id,
          contactId,
          direction: input.direction,
          channel: input.channel,
          body: input.body,
          mediaAssetIds: input.mediaAssetIds,
          sentBy: input.sentBy ?? (inbound ? "contact" : "user"),
          sentByUserId:
            input.sentByUserId ?? (ctx.actor.kind === "user" && !inbound ? ctx.actor.userId : null),
          providerRef: input.providerRef ?? null,
          segments: input.segments ?? null,
          costMinor: input.costMinor ?? null,
          costCurrency: input.costCurrency ?? null,
          occurredAt,
        })
        .returning();
      return row!;
    };

    let created;
    try {
      created = await write();
    } catch (error) {
      // Two deliveries of the same webhook arriving at once: the index is the
      // guard, and losing the race is a success, not a failure.
      if (!isUniqueViolation(error, "messages_provider_ref_idx")) throw error;
      const [seen] = await ctx.tx
        .select()
        .from(messages)
        .where(eq(messages.providerRef, input.providerRef!))
        .limit(1);
      return { conversation, message: seen!, duplicate: true };
    }

    const [updated] = await ctx.tx
      .update(conversations)
      .set({
        messageCount: conversation.messageCount + 1,
        ...(inbound
          ? {
              lastInboundAt: occurredAt,
              // Something arrived and nobody has read it. An outbound message
              // deliberately does not clear this: replying to one of three
              // waiting messages does not mean the other two were read.
              unread: true,
              // A closed thread somebody replies to is open again, because the
              // alternative is a customer talking to a closed door.
              ...(conversation.status === "closed" || conversation.status === "snoozed"
                ? { status: "open" as const, snoozedUntil: null }
                : {}),
            }
          : { lastOutboundAt: occurredAt }),
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, conversation.id))
      .returning();

    // The spine's promise made visible: a message about somebody shows on their
    // timeline whatever door it came through.
    await ctx.emitTimeline({
      contactId,
      eventType: inbound ? "message.received" : "message.sent",
      subjectType: "conversation",
      subjectId: conversation.id,
      payload: { channel: input.channel, messageId: created.id },
    });
    ctx.setSubject("conversation", conversation.id);
    ctx.queueEvent(inbound ? "message.received" : "message.sent", {
      id: created.id,
      conversationId: conversation.id,
      contactId,
      channel: input.channel,
    });

    return { conversation: updated!, message: created, duplicate: false };
  },
});

/**
 * Who this is with.
 *
 * `contacts.resolve`, never `create`, and elevated because the caller is often
 * an anonymous door — a form, a carrier webhook. §4.14 applies the spine rule to
 * a new channel; this is the line that does it.
 */
async function resolveThem(
  ctx: ServiceContext,
  input: { email?: string; phone?: string; name?: string; channel: string },
): Promise<string> {
  if (input.email) {
    const resolved = (await ctx.callAsSystem(getService("contacts.resolve"), {
      email: input.email,
      name: input.name ?? input.email,
      phone: input.phone,
      source: input.channel,
    })) as { contact: { id: string } };
    return resolved.contact.id;
  }

  // A phone number with no address. `contacts.resolve` identifies people by
  // email — that is the spine's unique key — so a text from an unknown number
  // has to be matched on the number first, and only then handed to resolve with
  // a placeholder address it can key on.
  const phone = input.phone!;
  const [known] = await ctx.tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.phone, phone))
    .limit(1);
  if (known) return known.id;

  // Deliberately a reserved, non-routable domain: this is a placeholder that
  // must never be mistaken for a deliverable address, and an owner who sees it
  // should read it as "we only have their number".
  const placeholder = `${phone.replace(/[^0-9]/g, "")}@sms.invalid`;
  const resolved = (await ctx.callAsSystem(getService("contacts.resolve"), {
    email: placeholder,
    name: input.name ?? phone,
    phone,
    source: input.channel,
  })) as { contact: { id: string } };
  return resolved.contact.id;
}

/**
 * The thread this message belongs to.
 *
 * In order: the one the caller named; the one the provider named; the person's
 * most recent live thread; a new one. That order is §4.14's rule — threading by
 * contact rather than by channel — with the two explicit signals allowed to win
 * when they exist.
 */
async function threadFor(
  ctx: ServiceContext,
  input: {
    contactId: string;
    conversationId?: string;
    threadKey?: string;
    channel: (typeof MESSAGE_CHANNELS)[number];
    subject?: string;
    numberId?: string;
    occurredAt: Date;
  },
) {
  if (input.conversationId) {
    const [named] = await ctx.tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);
    if (!named) throw new ServiceError("not_found", "That conversation is not here.");
    if (named.contactId !== input.contactId) {
      // Moving a message between people would rewrite two histories at once.
      throw new ServiceError("conflict", "That conversation is with somebody else.");
    }
    return named;
  }

  if (input.threadKey) {
    const [byKey] = await ctx.tx
      .select()
      .from(conversations)
      .where(eq(conversations.threadKey, input.threadKey))
      .limit(1);
    if (byKey) return byKey;
  }

  const cutoff = new Date(input.occurredAt.getTime() - SAME_THREAD_DAYS * 86_400_000);
  const [recent] = await ctx.tx
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, input.contactId),
        inArray(conversations.status, ["open", "snoozed"]),
        // A thread with no provider key, or the same one. A conversation that
        // belongs to a specific email thread must not swallow a text.
        input.threadKey
          ? or(isNull(conversations.threadKey), eq(conversations.threadKey, input.threadKey))
          : isNull(conversations.threadKey),
        // `gt` rather than a template placeholder: a raw Date inside `sql`
        // reaches the driver unencoded.
        gt(conversations.updatedAt, cutoff),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (recent) {
    // The reply channel follows the last thing that happened: somebody who
    // emailed and then texted expects the next answer by text.
    if (recent.replyChannel !== input.channel || (input.threadKey && !recent.threadKey)) {
      const [moved] = await ctx.tx
        .update(conversations)
        .set({
          replyChannel: input.channel,
          ...(input.threadKey && !recent.threadKey ? { threadKey: input.threadKey } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(conversations.id, recent.id))
        .returning();
      return moved!;
    }
    return recent;
  }

  const [opened] = await ctx.tx
    .insert(conversations)
    .values({
      contactId: input.contactId,
      subject: input.subject ?? null,
      replyChannel: input.channel,
      threadKey: input.threadKey ?? null,
      numberId: input.numberId ?? null,
    })
    .returning();
  ctx.queueEvent("conversation.opened", {
    id: opened!.id,
    contactId: input.contactId,
    channel: input.channel,
  });
  return opened!;
}

/**
 * What the carrier said (§4.14, C7.08).
 *
 * Idempotent per message and status, because every provider resends its
 * callbacks and a doubled "delivered" turns a history into noise.
 */
export const recordDelivery = defineService({
  name: "conversations.recordDelivery",
  summary: "Record what the carrier said happened to one message.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    messageId: id,
    status: z.enum(DELIVERY_STATUSES),
    errorCode: z.string().trim().max(50).nullish(),
    errorText: z.string().trim().max(500).nullish(),
    occurredAt: z.iso.datetime().optional(),
  }),
  output: row({ id: uuid, duplicate: z.boolean() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [message] = await ctx.tx
      .select({ id: messages.id, contactId: messages.contactId })
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .limit(1);
    if (!message) throw new ServiceError("not_found", "That message is not here.");

    const [recorded] = await ctx.tx
      .insert(messageDeliveries)
      .values({
        messageId: input.messageId,
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorText: input.errorText ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: messageDeliveries.id });
    if (!recorded) {
      const [existing] = await ctx.tx
        .select({ id: messageDeliveries.id })
        .from(messageDeliveries)
        .where(
          and(
            eq(messageDeliveries.messageId, input.messageId),
            eq(messageDeliveries.status, input.status),
          ),
        )
        .limit(1);
      return { id: existing!.id, duplicate: true };
    }

    ctx.setSubject("message", input.messageId);
    // A hard failure is the one an owner has to hear about: C7.10's adapter
    // marks the number invalid on the contact so the next send does not repeat
    // it, and it listens for this.
    if (input.status === "failed" || input.status === "undelivered") {
      ctx.queueEvent("message.undelivered", {
        messageId: input.messageId,
        contactId: message.contactId,
        errorCode: input.errorCode ?? null,
      });
    }
    return { id: recorded.id, duplicate: false };
  },
});

export const listConversations = defineService({
  name: "conversations.list",
  summary: "Threads, most recently active first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(CONVERSATION_STATUSES).optional(),
    contactId: id.optional(),
    channel: z.enum(MESSAGE_CHANNELS).optional(),
    unreadOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(
    conversationRow.extend({
      contactName: z.string().nullable(),
      contactEmail: z.string().nullable(),
    }),
  ),
  handler: async (input, ctx) => {
    const where = [
      ...(input.status ? [eq(conversations.status, input.status)] : []),
      ...(input.contactId ? [eq(conversations.contactId, input.contactId)] : []),
      ...(input.channel ? [eq(conversations.replyChannel, input.channel)] : []),
      ...(input.unreadOnly ? [eq(conversations.unread, true)] : []),
    ];
    const rows = await ctx.tx
      .select({ thread: conversations, contactName: contacts.name, contactEmail: contacts.email })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(conversations.updatedAt))
      .limit(input.limit);
    return rows.map(({ thread, contactName, contactEmail }) => ({
      ...thread,
      contactName,
      contactEmail,
    }));
  },
});

export const getConversation = defineService({
  name: "conversations.get",
  summary: "One thread and everything said in it.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id, limit: z.number().int().min(1).max(500).default(200) }),
  output: conversationRow
    .extend({
      contactName: z.string().nullable(),
      messages: listed(
        messageRow.extend({
          deliveries: listed(
            row({
              status: z.enum(DELIVERY_STATUSES),
              errorCode: z.string().nullable(),
              errorText: z.string().nullable(),
              occurredAt: timestamp,
            }),
          ),
        }),
      ),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select({ thread: conversations, contactName: contacts.name })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(conversations.id, input.id))
      .limit(1);
    if (!found) return null;

    const said = await ctx.tx
      .select()
      .from(messages)
      .where(eq(messages.conversationId, input.id))
      .orderBy(asc(messages.occurredAt))
      .limit(input.limit);
    const reports = said.length
      ? await ctx.tx
          .select()
          .from(messageDeliveries)
          .where(
            inArray(
              messageDeliveries.messageId,
              said.map((message) => message.id),
            ),
          )
          .orderBy(asc(messageDeliveries.occurredAt))
      : [];

    return {
      ...found.thread,
      contactName: found.contactName,
      messages: said.map((message) => ({
        ...message,
        deliveries: reports.filter((report) => report.messageId === message.id),
      })),
    };
  },
});

/**
 * Mark a thread read.
 *
 * Here rather than in C7.09 with the rest of the workflow, because `unread` is
 * set by this file when a message arrives and a flag nothing can clear is a bug
 * rather than a missing feature.
 */
export const markConversationRead = defineService({
  name: "conversations.markRead",
  summary: "Mark a thread as read, or put it back.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id, read: z.boolean().default(true) }),
  output: conversationRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(conversations)
      .set({ unread: !input.read, updatedAt: sql`now()` })
      .where(eq(conversations.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That conversation is not here.");
    ctx.setSubject("conversation", updated.id);
    return updated;
  },
});

/**
 * Merge brings both sides' conversations to the survivor (§4.1).
 *
 * Threads are not combined: two records of one person were two conversations
 * the business genuinely had, possibly on different channels, and splicing
 * their messages together by timestamp would invent an exchange that never
 * happened. They sit side by side under one person, which is the honest answer.
 */
registerContactReference({
  table: "conversations",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(conversations)
      .set({ contactId: survivingId })
      .where(eq(conversations.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: conversations.id, contactId: conversations.contactId })
      .from(conversations)
      .where(inArray(conversations.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }))
      .parse(beforeState)
      .filter((thread) => thread.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(conversations)
        .set({ contactId: duplicateId })
        .where(inArray(conversations.id, moved.map((thread) => thread.id)));
    }
  },
});

registerContactReference({
  table: "messages",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(messages).set({ contactId: survivingId }).where(eq(messages.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: messages.id, contactId: messages.contactId })
      .from(messages)
      .where(inArray(messages.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }))
      .parse(beforeState)
      .filter((message) => message.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(messages)
        .set({ contactId: duplicateId })
        .where(inArray(messages.id, moved.map((message) => message.id)));
    }
  },
});

/**
 * What a conversation means for the person's own data (§30).
 *
 * It goes. Correspondence is the most personal thing on the record — their
 * words, in their voice — and a business asked to forget somebody cannot keep
 * the transcript. The delivery reports cascade with the messages, because
 * "delivered to +1…" is the number as much as the message was.
 */
registerContactPrivacySource({
  scope: "contact.conversations",
  tables: ["conversations", "messages", "message_deliveries"],
  exportData: async (tx, contactId) =>
    tx
      .select()
      .from(messages)
      .where(eq(messages.contactId, contactId))
      .orderBy(asc(messages.occurredAt)),
  erase: async (tx, contactId) => {
    const removed = await tx
      .delete(conversations)
      .where(eq(conversations.contactId, contactId))
      .returning({ id: conversations.id });
    // Any message whose thread was already gone, so nothing is left behind by a
    // history the cascade could not reach.
    await tx.delete(messages).where(eq(messages.contactId, contactId));
    return { affected: removed.length };
  },
});

export default [
  recordMessage,
  recordDelivery,
  listConversations,
  getConversation,
  markConversationRead,
];
