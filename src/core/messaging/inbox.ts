// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The inbox, without reimplementing a mail client (MASTER.md §4.14, C7.09).
//
// That last clause is the whole design brief, and it is a constraint rather
// than a caveat. A mail client's job is to hold everything you have ever
// received; a business inbox's job is to make sure nothing waiting on a person
// is forgotten. So there are no folders, no labels, no threading UI to learn,
// no rich compose — four verbs and a search:
//
//   * **assign** — whose is it
//   * **snooze** — when should it come back
//   * **close** — is it done
//   * **reply** — say something, on the channel they used
//
// Everything else people expect from an inbox is either already true (C7.08
// threads by contact) or deliberately absent.
//
// Three rules the service holds.
//
// **Snoozing is a promise to be interrupted later.** A snoozed thread that
// never comes back is a closed thread with extra steps, so the wake-up is a job
// and the thread returns *unread* — the state it would have been in had it
// never been snoozed.
//
// **A reply goes out on the channel the thread says.** That is C7.09's "reply
// context": the person who texted gets a text back, without anybody choosing.
// A channel with nothing able to send on it is refused outright rather than
// recorded and silently never delivered — a message in the thread that never
// left is worse than an error.
//
// **Bulk is the same services in a loop, not a second implementation.** A bulk
// close that skipped the rules a single close applies is how an inbox ends up
// with threads in states nothing else expects.
import { z } from "zod";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { sendMail } from "@/core/mail/service";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type Tx,
} from "@/core/service";
import { CONVERSATION_STATUSES, MESSAGE_CHANNELS, conversations } from "./schema";

const id = z.string().uuid();

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to work the inbox.");
  }
}

const threadRow = row({
  id: uuid,
  contactId: uuid,
  subject: z.string().nullable(),
  replyChannel: z.enum(MESSAGE_CHANNELS),
  status: z.enum(CONVERSATION_STATUSES),
  snoozedUntil: timestamp.nullable(),
  assigneeUserId: uuid.nullable(),
  unread: z.boolean(),
  messageCount: z.number().int(),
  lastInboundAt: timestamp.nullable(),
  lastOutboundAt: timestamp.nullable(),
  updatedAt: timestamp,
});

async function load(tx: Tx, threadId: string) {
  const [thread] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, threadId))
    .limit(1);
  if (!thread) throw new ServiceError("not_found", "That conversation is not here.");
  return thread;
}

export const assignConversation = defineService({
  name: "conversations.assign",
  summary: "Say whose conversation this is, or that it is nobody's.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id, userId: id.nullish() }),
  output: threadRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    if (input.userId) {
      // Checked rather than left to the foreign key, so an owner gets a
      // sentence instead of a constraint name.
      const [person] = await ctx.tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!person) throw new ServiceError("not_found", "That person is not here.");
    }
    const [updated] = await ctx.tx
      .update(conversations)
      .set({ assigneeUserId: input.userId ?? null, updatedAt: sql`now()` })
      .where(eq(conversations.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That conversation is not here.");
    ctx.setSubject("conversation", updated.id);
    ctx.queueEvent("conversation.assigned", {
      id: updated.id,
      userId: input.userId ?? null,
      contactId: updated.contactId,
    });
    return updated;
  },
});

/**
 * Put it away until a date.
 *
 * Snoozing into the past is refused: it would come back on the next sweep,
 * which is not what anybody means by "later", and the failure is silent.
 */
export const snoozeConversation = defineService({
  name: "conversations.snooze",
  summary: "Put a conversation away until a date, then bring it back.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id, until: z.iso.datetime() }),
  output: threadRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const until = new Date(input.until);
    if (until.getTime() <= Date.now()) {
      throw new ServiceError("validation", "Choose a time in the future to bring it back.");
    }
    const [updated] = await ctx.tx
      .update(conversations)
      .set({
        status: "snoozed",
        snoozedUntil: until,
        // Out of the way now: the whole point is not seeing it until then.
        unread: false,
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That conversation is not here.");
    ctx.setSubject("conversation", updated.id);
    return updated;
  },
});

export const setConversationStatus = defineService({
  name: "conversations.setStatus",
  summary: "Close a conversation, or open it again.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id, status: z.enum(["open", "closed"]) }),
  output: threadRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(conversations)
      .set({
        status: input.status,
        // A thread leaving the snoozed state stops having a return date, and a
        // closed one is read by definition — somebody looked at it to close it.
        snoozedUntil: null,
        ...(input.status === "closed" ? { unread: false } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That conversation is not here.");
    ctx.setSubject("conversation", updated.id);
    ctx.queueEvent(input.status === "closed" ? "conversation.closed" : "conversation.reopened", {
      id: updated.id,
      contactId: updated.contactId,
    });
    return updated;
  },
});

/**
 * Say something back, on the channel they used (C7.09's reply context).
 *
 * The reply channel comes from the thread rather than from a picker, so the
 * person who texted gets a text. A channel with nothing able to send on it is
 * refused: recording a message that never leaves would put words in the thread
 * the customer never saw, which is worse than an error an owner can act on.
 */
export const replyToConversation = defineService({
  name: "conversations.reply",
  summary: "Reply on whatever channel the conversation is on.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  input: z.object({
    id,
    body: z.string().trim().min(1).max(50_000),
    /** Close it in the same breath, which is what most replies mean. */
    close: z.boolean().default(false),
  }),
  output: row({ id: uuid, channel: z.enum(MESSAGE_CHANNELS) }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const thread = await load(ctx.tx, input.id);
    const [person] = await ctx.tx
      .select({ email: contacts.email, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, thread.contactId))
      .limit(1);

    if (thread.replyChannel === "email" || thread.replyChannel === "form") {
      // A form submission is answered by email: it is the only address the
      // person left, and "reply on the form" means nothing.
      if (!person?.email || person.email.endsWith("@sms.invalid")) {
        throw new ServiceError(
          "validation",
          "There is no email address for this person, so there is nowhere to send a reply.",
        );
      }
      await sendMail(ctx.tx, {
        to: person.email,
        subject: thread.subject ?? "Re: your message",
        text: input.body,
      });
    } else {
      // C7.10 brings the SMS adapter, C7.15 chat and social. Until then the
      // honest answer is that this cannot be sent from here.
      throw new ServiceError(
        "validation",
        `Replying by ${thread.replyChannel} is not connected yet, so nothing would reach them.`,
      );
    }

    const recorded = (await ctx.call(getService("conversations.record"), {
      conversationId: thread.id,
      contactId: thread.contactId,
      direction: "outbound",
      channel: thread.replyChannel === "form" ? "email" : thread.replyChannel,
      body: input.body,
      sentBy: "user",
    })) as { message: { id: string } };

    if (input.close) {
      await ctx.call(getService("conversations.setStatus"), { id: thread.id, status: "closed" });
    }
    ctx.setSubject("conversation", thread.id);
    return {
      id: recorded.message.id,
      channel: (thread.replyChannel === "form" ? "email" : thread.replyChannel) as
        (typeof MESSAGE_CHANNELS)[number],
    };
  },
});

const BULK_ACTIONS = ["assign", "close", "reopen", "markRead", "markUnread", "snooze"] as const;

/**
 * The same four verbs, over a selection.
 *
 * Every action goes through the single-thread service rather than a batched
 * UPDATE, because a bulk close that skipped the rules a single close applies is
 * how an inbox ends up with threads in states nothing else expects. Capped, so
 * a selection nobody meant does not become an hour of writes.
 */
export const bulkConversations = defineService({
  name: "conversations.bulk",
  summary: "Do one thing to several conversations at once.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    ids: z.array(id).min(1).max(200),
    action: z.enum(BULK_ACTIONS),
    userId: id.nullish(),
    until: z.iso.datetime().optional(),
  }),
  output: row({ affected: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    if (input.action === "snooze" && !input.until) {
      throw new ServiceError("validation", "Say when they should come back.");
    }
    let affected = 0;
    for (const threadId of input.ids) {
      switch (input.action) {
        case "assign":
          await ctx.call(getService("conversations.assign"), {
            id: threadId,
            userId: input.userId ?? null,
          });
          break;
        case "close":
          await ctx.call(getService("conversations.setStatus"), { id: threadId, status: "closed" });
          break;
        case "reopen":
          await ctx.call(getService("conversations.setStatus"), { id: threadId, status: "open" });
          break;
        case "snooze":
          await ctx.call(getService("conversations.snooze"), {
            id: threadId,
            until: input.until!,
          });
          break;
        default:
          await ctx.call(getService("conversations.markRead"), {
            id: threadId,
            read: input.action === "markRead",
          });
      }
      affected += 1;
    }
    ctx.queueEvent("conversation.bulk", { action: input.action, count: affected });
    return { affected };
  },
});

/**
 * The one unified inbox (C7.09).
 *
 * Search is over what was actually said and who said it, because those are the
 * two things anybody remembers: a phrase from the message, or the person's
 * name. Not a mail client's field-by-field query builder — that is the thing
 * this item says not to build.
 */
export const searchInbox = defineService({
  name: "conversations.search",
  summary: "The inbox: filter by state, whose it is, and what was said.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(CONVERSATION_STATUSES).optional(),
    /** Everything not finished, which is what an inbox means. */
    openOnly: z.boolean().default(false),
    assigneeUserId: id.optional(),
    unassigned: z.boolean().default(false),
    channel: z.enum(MESSAGE_CHANNELS).optional(),
    unreadOnly: z.boolean().default(false),
    q: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(
    threadRow.extend({
      contactName: z.string().nullable(),
      contactEmail: z.string().nullable(),
      assigneeEmail: z.string().nullable(),
      preview: z.string().nullable(),
    }),
  ),
  handler: async (input, ctx) => {
    const where = [
      ...(input.status ? [eq(conversations.status, input.status)] : []),
      ...(input.openOnly ? [inArray(conversations.status, ["open", "snoozed"])] : []),
      ...(input.assigneeUserId ? [eq(conversations.assigneeUserId, input.assigneeUserId)] : []),
      ...(input.unassigned ? [isNull(conversations.assigneeUserId)] : []),
      ...(input.channel ? [eq(conversations.replyChannel, input.channel)] : []),
      ...(input.unreadOnly ? [eq(conversations.unread, true)] : []),
      ...(input.q
        ? [
            or(
              // What was said, and who said it: the two things anybody
              // remembers about a conversation.
              sql`exists (select 1 from messages m where m.conversation_id = ${conversations.id} and m.body ilike ${`%${input.q}%`})`,
              sql`${contacts.name} ilike ${`%${input.q}%`}`,
              sql`${contacts.email} ilike ${`%${input.q}%`}`,
              sql`${conversations.subject} ilike ${`%${input.q}%`}`,
            ),
          ]
        : []),
    ];

    const rows = await ctx.tx
      .select({
        thread: conversations,
        contactName: contacts.name,
        contactEmail: contacts.email,
        assigneeEmail: users.email,
        // The last thing said, so a list of threads reads as a list of things
        // rather than a list of names.
        preview: sql<string | null>`(
          select left(m.body, 140) from messages m
          where m.conversation_id = ${conversations.id}
          order by m.occurred_at desc limit 1
        )`,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(users, eq(users.id, conversations.assigneeUserId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(conversations.updatedAt))
      .limit(input.limit);

    return rows.map(({ thread, contactName, contactEmail, assigneeEmail, preview }) => ({
      ...thread,
      contactName,
      contactEmail,
      assigneeEmail,
      preview,
    }));
  },
});

/** What is waiting, for the badge and the briefing. */
export const inboxCounts = defineService({
  name: "conversations.counts",
  summary: "How much is waiting, and how much of it is nobody's.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: row({
    open: z.number().int(),
    unread: z.number().int(),
    unassigned: z.number().int(),
    mine: z.number().int(),
  }),
  handler: async (_input, ctx) => {
    const userId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const [counted] = await ctx.tx
      .select({
        open: sql<number>`count(*) filter (where status = 'open')::int`,
        unread: sql<number>`count(*) filter (where unread)::int`,
        unassigned: sql<number>`count(*) filter (where status = 'open' and assignee_user_id is null)::int`,
        mine: userId
          ? sql<number>`count(*) filter (where status = 'open' and assignee_user_id = ${userId})::int`
          : sql<number>`0::int`,
      })
      .from(conversations);
    return counted ?? { open: 0, unread: 0, unassigned: 0, mine: 0 };
  },
});

/**
 * Bring back everything whose snooze has run out.
 *
 * A snoozed thread that never returns is a closed thread with extra steps, and
 * the return is the only thing snoozing promises. It comes back **unread**,
 * which is the state it would have been in had nobody snoozed it.
 */
export async function wakeSnoozedConversations(): Promise<{ woken: number }> {
  const woken = await db()
    .update(conversations)
    .set({ status: "open", snoozedUntil: null, unread: true, updatedAt: sql`now()` })
    .where(
      and(
        eq(conversations.status, "snoozed"),
        lte(conversations.snoozedUntil, sql`now()`),
      ),
    )
    .returning({ id: conversations.id });
  return { woken: woken.length };
}

export default [
  assignConversation,
  snoozeConversation,
  setConversationStatus,
  replyToConversation,
  bulkConversations,
  searchInbox,
  inboxCounts,
];
