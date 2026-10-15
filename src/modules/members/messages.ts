// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Direct messages between members (MASTER.md §44.6, C12.06).
//
// A conversation lands in someone's inbox only if they follow the sender or
// are friends with them; anyone else's message waits in their requests until
// they accept it. A block ends the conversation between the two people in
// both directions. Read receipts are opt-in, and a member only sees other
// people's receipts while sharing their own.
//
// Bodies are encrypted at rest (message-crypto.ts). End-to-end encryption is
// C12.23; nothing here claims it.
import { attachFiles, attachmentInput, attachmentsFor, attachmentShape } from "./attachment-store";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { relationBetween } from "./graph";
import { notifyMember } from "./notify";
import { openMessage, sealMessage } from "./message-crypto";
import { memberConversationParticipants, memberConversations, memberMessages, memberProfiles } from "./schema";

const MAX_GROUP = 50;
const PAGE = 50;

function viewerOf(actor: Actor): string {
  if (actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  return actor.userId;
}

async function activeSelf(ctx: ServiceContext) {
  const userId = viewerOf(ctx.actor);
  const [found] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId));
  if (!found) throw new ServiceError("permission", "Join the site first.");
  if (found.status !== "active") throw new ServiceError("permission", "Your membership is not active.");
  return found;
}

/** The recipient's inbox state for a message from `senderId`. */
async function arrival(ctx: ServiceContext, recipientId: string, senderId: string): Promise<"active" | "requested"> {
  const relation = await relationBetween(ctx, recipientId, senderId);
  return relation.following === "active" || relation.friend === "friends" ? "active" : "requested";
}

async function participant(ctx: ServiceContext, conversationId: string, userId: string) {
  const [found] = await ctx.tx
    .select()
    .from(memberConversationParticipants)
    .where(and(eq(memberConversationParticipants.conversationId, conversationId), eq(memberConversationParticipants.userId, userId)));
  if (!found || found.state === "left") throw new ServiceError("not_found", "That conversation is not available.");
  return found;
}

/** A direct conversation is closed when either side blocked the other or left the site. */
async function directBlocked(ctx: ServiceContext, conversationId: string, userId: string): Promise<boolean> {
  const others = await ctx.tx
    .select({ userId: memberConversationParticipants.userId, status: memberProfiles.status })
    .from(memberConversationParticipants)
    .innerJoin(memberProfiles, eq(memberProfiles.userId, memberConversationParticipants.userId))
    .where(and(eq(memberConversationParticipants.conversationId, conversationId), ne(memberConversationParticipants.userId, userId)));
  for (const other of others) {
    if (other.status !== "active") return true;
    if ((await relationBetween(ctx, userId, other.userId)).blocked) return true;
  }
  return false;
}

async function send(ctx: ServiceContext, conversationId: string, senderId: string, body: string, files: z.infer<typeof attachmentInput> = []) {
  const id = randomUUID();
  await ctx.tx.insert(memberMessages).values({ id, conversationId, senderId, bodySealed: sealMessage(body, id) });
  await attachFiles(ctx, senderId, "message", id, files);
  await ctx.tx.update(memberConversations).set({ lastMessageAt: new Date() }).where(eq(memberConversations.id, conversationId));
  await ctx.tx
    .update(memberConversationParticipants)
    .set({ lastReadAt: new Date() })
    .where(and(eq(memberConversationParticipants.conversationId, conversationId), eq(memberConversationParticipants.userId, senderId)));
  const recipients = await ctx.tx
    .select()
    .from(memberConversationParticipants)
    .where(and(eq(memberConversationParticipants.conversationId, conversationId), ne(memberConversationParticipants.userId, senderId)));
  for (const r of recipients) {
    // Requests and muted conversations stay quiet; a request is seen when the person looks.
    if (r.state !== "active" || r.muted) continue;
    await notifyMember(ctx, {
      to: r.userId,
      from: senderId,
      topic: "members.message",
      key: "members.notify.message",
      href: `/messages/${conversationId}`,
      idempotencyKey: `member-message:${id}:${r.userId}`,
      dedupeKey: `member-message:${conversationId}`,
    });
  }
  ctx.queueEvent("member.messaged", { conversationId, messageId: id, senderId });
  return id;
}

const person = row({ userId: z.string(), handle: z.string(), displayName: z.string() });
const conversationSummary = row({
  id: uuid,
  kind: z.enum(["direct", "group"]),
  title: z.string().nullable(),
  people: listed(person),
  state: z.enum(["active", "requested"]),
  muted: z.boolean(),
  lastMessageAt: timestamp,
  unread: z.boolean(),
});

export const startConversation = defineService({
  name: "members.startConversation",
  summary: "Message one member, or start a group with several. Non-connections receive it as a request.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 30, windowSeconds: 3600, message: "You are starting conversations very quickly. Please slow down.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({
    handles: z.array(z.string().trim().toLowerCase().max(60)).min(1).max(MAX_GROUP),
    title: z.string().trim().min(1).max(80).optional(),
    body: z.string().trim().min(1).max(10_000),
  }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const handles = [...new Set(input.handles)].filter((h) => h !== me.handle);
    if (handles.length === 0) throw new ServiceError("validation", "Choose someone to message.");
    const people = await ctx.tx
      .select()
      .from(memberProfiles)
      .where(and(inArray(memberProfiles.handle, handles), eq(memberProfiles.status, "active")));
    const reachable = [];
    for (const p of people) if (!(await relationBetween(ctx, me.userId, p.userId)).blocked) reachable.push(p);
    if (reachable.length !== handles.length) throw new ServiceError("not_found", "One of those members is not available.");

    if (reachable.length === 1 && !input.title) {
      const other = reachable[0]!;
      const directKey = [me.userId, other.userId].sort().join(":");
      const [existing] = await ctx.tx.select().from(memberConversations).where(eq(memberConversations.directKey, directKey));
      if (existing) {
        await ctx.tx
          .update(memberConversationParticipants)
          .set({ state: "active" })
          .where(and(eq(memberConversationParticipants.conversationId, existing.id), eq(memberConversationParticipants.userId, me.userId)));
        await ctx.tx
          .update(memberConversationParticipants)
          .set({ state: sql`case when ${memberConversationParticipants.state} = 'left' then ${await arrival(ctx, other.userId, me.userId)} else ${memberConversationParticipants.state} end` })
          .where(and(eq(memberConversationParticipants.conversationId, existing.id), eq(memberConversationParticipants.userId, other.userId)));
        await send(ctx, existing.id, me.userId, input.body);
        return { id: existing.id };
      }
      const [created] = await ctx.tx.insert(memberConversations).values({ kind: "direct", directKey, createdBy: me.userId }).returning();
      await ctx.tx.insert(memberConversationParticipants).values([
        { conversationId: created!.id, userId: me.userId, state: "active" },
        { conversationId: created!.id, userId: other.userId, state: await arrival(ctx, other.userId, me.userId) },
      ]);
      await send(ctx, created!.id, me.userId, input.body);
      ctx.setSubject("member_conversation", created!.id);
      return { id: created!.id };
    }

    const [created] = await ctx.tx
      .insert(memberConversations)
      .values({ kind: "group", title: input.title ?? reachable.map((p) => p.displayName).join(", ").slice(0, 80), createdBy: me.userId })
      .returning();
    const rows = [{ conversationId: created!.id, userId: me.userId, state: "active" as const }];
    for (const p of reachable) rows.push({ conversationId: created!.id, userId: p.userId, state: (await arrival(ctx, p.userId, me.userId)) as "active" });
    await ctx.tx.insert(memberConversationParticipants).values(rows);
    await send(ctx, created!.id, me.userId, input.body);
    ctx.setSubject("member_conversation", created!.id);
    return { id: created!.id };
  },
});

export const listConversations = defineService({
  name: "members.conversations",
  summary: "Your conversations, newest first: the inbox, or message requests waiting for you.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ box: z.enum(["inbox", "requests"]).default("inbox") }),
  output: listed(conversationSummary),
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    const mine = await ctx.tx
      .select({ conversation: memberConversations, part: memberConversationParticipants })
      .from(memberConversationParticipants)
      .innerJoin(memberConversations, eq(memberConversations.id, memberConversationParticipants.conversationId))
      .where(and(eq(memberConversationParticipants.userId, me), eq(memberConversationParticipants.state, input.box === "inbox" ? "active" : "requested")))
      .orderBy(desc(memberConversations.lastMessageAt))
      .limit(200);
    if (mine.length === 0) return [];
    const ids = mine.map((m) => m.conversation.id);
    const everyone = await ctx.tx
      .select({ conversationId: memberConversationParticipants.conversationId, userId: memberProfiles.userId, handle: memberProfiles.handle, displayName: memberProfiles.displayName, state: memberConversationParticipants.state })
      .from(memberConversationParticipants)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, memberConversationParticipants.userId))
      .where(inArray(memberConversationParticipants.conversationId, ids));
    const out = [];
    for (const m of mine) {
      if (m.conversation.kind === "direct" && (await directBlocked(ctx, m.conversation.id, me))) continue;
      out.push({
        id: m.conversation.id,
        kind: m.conversation.kind,
        title: m.conversation.title,
        people: everyone
          .filter((p) => p.conversationId === m.conversation.id && p.userId !== me && p.state !== "left")
          .map(({ userId, handle, displayName }) => ({ userId, handle, displayName })),
        state: m.part.state as "active" | "requested",
        muted: m.part.muted,
        lastMessageAt: m.conversation.lastMessageAt,
        unread: !m.part.lastReadAt || m.part.lastReadAt < m.conversation.lastMessageAt,
      });
    }
    return out;
  },
});

export const viewConversation = defineService({
  name: "members.conversation",
  summary: "Read a conversation you are in, newest messages last, and mark it read.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ id: uuid, before: z.coerce.date().optional() }),
  output: z.object({
    conversation: conversationSummary,
    closed: z.boolean(),
    messages: listed(row({ id: uuid, sender: person.nullable(), body: z.string().nullable(), createdAt: timestamp, mine: z.boolean(), attachments: listed(attachmentShape) })),
    /** Who has read up to the newest message — only if you share receipts too. */
    seenBy: listed(person),
    older: z.boolean(),
  }),
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    const part = await participant(ctx, input.id, me);
    const [conversation] = await ctx.tx.select().from(memberConversations).where(eq(memberConversations.id, input.id));
    const closed = conversation!.kind === "direct" && (await directBlocked(ctx, input.id, me));
    const page = await ctx.tx
      .select()
      .from(memberMessages)
      .where(and(eq(memberMessages.conversationId, input.id), input.before ? lt(memberMessages.createdAt, input.before) : undefined))
      .orderBy(desc(memberMessages.createdAt))
      .limit(PAGE + 1);
    const older = page.length > PAGE;
    const rows = page.slice(0, PAGE).reverse();
    const people = await ctx.tx
      .select({ userId: memberProfiles.userId, handle: memberProfiles.handle, displayName: memberProfiles.displayName, readReceipts: memberProfiles.readReceipts, lastReadAt: memberConversationParticipants.lastReadAt, state: memberConversationParticipants.state })
      .from(memberConversationParticipants)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, memberConversationParticipants.userId))
      .where(eq(memberConversationParticipants.conversationId, input.id));
    const byId = new Map(people.map((p) => [p.userId, p]));
    // Reading marks the conversation read — but a request stays unread to the sender.
    if (!input.before) {
      await ctx.tx
        .update(memberConversationParticipants)
        .set({ lastReadAt: new Date() })
        .where(and(eq(memberConversationParticipants.conversationId, input.id), eq(memberConversationParticipants.userId, me)));
    }
    const shareReceipts = byId.get(me)?.readReceipts ?? false;
    const newest = rows.at(-1)?.createdAt;
    const seenBy = shareReceipts && newest
      ? people
          .filter((p) => p.userId !== me && p.readReceipts && p.state === "active" && p.lastReadAt && p.lastReadAt >= newest)
          .map(({ userId, handle, displayName }) => ({ userId, handle, displayName }))
      : [];
    const sender = (id: string | null) => {
      const p = id ? byId.get(id) : undefined;
      return p ? { userId: p.userId, handle: p.handle, displayName: p.displayName } : null;
    };
    const files = await attachmentsFor(ctx, "message", rows.map((m) => m.id));
    return {
      conversation: {
        id: conversation!.id,
        kind: conversation!.kind,
        title: conversation!.title,
        people: people.filter((p) => p.userId !== me && p.state !== "left").map(({ userId, handle, displayName }) => ({ userId, handle, displayName })),
        state: part.state as "active" | "requested",
        muted: part.muted,
        lastMessageAt: conversation!.lastMessageAt,
        unread: false,
      },
      closed,
      messages: rows.map((m) => ({
        id: m.id,
        sender: sender(m.senderId),
        body: m.deletedAt ? null : openMessage(m.bodySealed, m.id),
        createdAt: m.createdAt,
        mine: m.senderId === me,
        attachments: m.deletedAt ? [] : (files.get(m.id) ?? []),
      })),
      seenBy,
      older,
    };
  },
});

export const sendMessage = defineService({
  name: "members.sendMessage",
  summary: "Send a message in a conversation you are in.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 600, windowSeconds: 3600, message: "You are sending messages very quickly. Please slow down.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({ conversationId: uuid, body: z.string().trim().min(1).max(10_000), attachments: attachmentInput }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const part = await participant(ctx, input.conversationId, me.userId);
    if (part.state === "requested") throw new ServiceError("permission", "Accept this request before replying.");
    const [conversation] = await ctx.tx.select().from(memberConversations).where(eq(memberConversations.id, input.conversationId));
    if (conversation!.kind === "direct" && (await directBlocked(ctx, input.conversationId, me.userId))) {
      throw new ServiceError("permission", "You can no longer message this person.");
    }
    return { id: await send(ctx, input.conversationId, me.userId, input.body, input.attachments) };
  },
});

export const answerMessageRequest = defineService({
  name: "members.answerRequest",
  summary: "Accept a message request into your inbox, or decline it.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ conversationId: uuid, accept: z.boolean() }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    const part = await participant(ctx, input.conversationId, me);
    if (part.state !== "requested") throw new ServiceError("conflict", "That conversation is not a request.");
    await ctx.tx
      .update(memberConversationParticipants)
      .set({ state: input.accept ? "active" : "left" })
      .where(and(eq(memberConversationParticipants.conversationId, input.conversationId), eq(memberConversationParticipants.userId, me)));
    return { ok: true as const };
  },
});

export const leaveConversation = defineService({
  name: "members.leaveConversation",
  summary: "Leave a conversation. In a direct conversation a new message from the other person starts it again.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ conversationId: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    await participant(ctx, input.conversationId, me);
    await ctx.tx
      .update(memberConversationParticipants)
      .set({ state: "left" })
      .where(and(eq(memberConversationParticipants.conversationId, input.conversationId), eq(memberConversationParticipants.userId, me)));
    return { ok: true as const };
  },
});

export const muteConversation = defineService({
  name: "members.muteConversation",
  summary: "Stop or resume notifications for one conversation.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ conversationId: uuid, muted: z.boolean() }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    await participant(ctx, input.conversationId, me);
    await ctx.tx
      .update(memberConversationParticipants)
      .set({ muted: input.muted })
      .where(and(eq(memberConversationParticipants.conversationId, input.conversationId), eq(memberConversationParticipants.userId, me)));
    return { ok: true as const };
  },
});

export const unsendMessage = defineService({
  name: "members.unsendMessage",
  summary: "Remove a message you sent. Everyone sees that a message was removed, not what it said.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ id: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    const [gone] = await ctx.tx
      .update(memberMessages)
      // The sealed body is overwritten, not just hidden.
      .set({ deletedAt: new Date(), bodySealed: sealMessage("", input.id) })
      .where(and(eq(memberMessages.id, input.id), eq(memberMessages.senderId, me), isNull(memberMessages.deletedAt)))
      .returning({ id: memberMessages.id });
    if (!gone) throw new ServiceError("not_found", "That message is not available.");
    return { ok: true as const };
  },
});

export const unreadConversations = defineService({
  name: "members.unreadConversations",
  summary: "How many inbox conversations have messages you have not read, and how many requests wait.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({ unread: z.number().int(), requests: z.number().int() }),
  handler: async (_input, ctx) => {
    const me = viewerOf(ctx.actor);
    const [counts] = await ctx.tx
      .select({
        unread: sql<number>`count(*) filter (where ${memberConversationParticipants.state} = 'active' and (${memberConversationParticipants.lastReadAt} is null or ${memberConversationParticipants.lastReadAt} < ${memberConversations.lastMessageAt}))::int`,
        requests: sql<number>`count(*) filter (where ${memberConversationParticipants.state} = 'requested')::int`,
      })
      .from(memberConversationParticipants)
      .innerJoin(memberConversations, eq(memberConversations.id, memberConversationParticipants.conversationId))
      .where(eq(memberConversationParticipants.userId, me));
    return { unread: counts?.unread ?? 0, requests: counts?.requests ?? 0 };
  },
});

export default [
  startConversation,
  listConversations,
  viewConversation,
  sendMessage,
  answerMessageRequest,
  leaveConversation,
  muteConversation,
  unsendMessage,
  unreadConversations,
];
