// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Site live chat and assistant handoff (MASTER C7.15).
//
// A chat session is a bearer-scoped window onto one canonical conversation.
// The Contact and Conversation remain the source of truth, while the session
// id on each message prevents a public bearer from reading email, SMS, or an
// earlier chat that happens to share that thread.
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { conversations, messages, siteChatSessions } from "./schema";

const CHAT_LIFETIME_HOURS = 24;
const token = z.string().trim().min(32).max(200);
const messageBody = z.string().trim().min(1).max(4_000);
const locale = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  .default("en");

function hashToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const publicMessage = row({
  id: uuid,
  direction: z.enum(["inbound", "outbound"]),
  channel: z.enum(["chat", "assistant"]),
  body: z.string(),
  occurredAt: timestamp,
});

const transcript = row({
  state: z.enum(["open", "closed"]),
  escalated: z.boolean(),
  messages: listed(publicMessage),
  expiresAt: timestamp,
});

type ActiveSession = typeof siteChatSessions.$inferSelect;

async function sessionForToken(
  tx: Tx,
  rawToken: string,
  options: { allowClosed?: boolean } = {},
): Promise<ActiveSession> {
  const [session] = await tx
    .select()
    .from(siteChatSessions)
    .where(eq(siteChatSessions.tokenHash, hashToken(rawToken)))
    .limit(1);
  if (!session) throw new ServiceError("not_found", "That chat is no longer available.");
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new ServiceError("not_found", "That chat has ended.");
  }
  if (!options.allowClosed && session.closedAt) {
    throw new ServiceError("not_found", "That chat has ended.");
  }
  return session;
}

/** The single browser session an owner/assistant can presently answer. */
export async function activeSiteChatSession(
  tx: Tx,
  conversationId: string,
): Promise<ActiveSession | undefined> {
  const [session] = await tx
    .select()
    .from(siteChatSessions)
    .where(
      and(
        eq(siteChatSessions.conversationId, conversationId),
        isNull(siteChatSessions.closedAt),
        gt(siteChatSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(siteChatSessions.createdAt))
    .limit(1);
  return session;
}

export async function closeSiteChatSessions(tx: Tx, conversationId: string): Promise<void> {
  await tx
    .update(siteChatSessions)
    .set({ closedAt: sql`coalesce(${siteChatSessions.closedAt}, now())`, updatedAt: sql`now()` })
    .where(
      and(
        eq(siteChatSessions.conversationId, conversationId),
        isNull(siteChatSessions.closedAt),
      ),
    );
}

async function transcriptFor(ctx: ServiceContext, session: ActiveSession) {
  const [thread, said] = await Promise.all([
    ctx.tx
      .select({
        escalatedAt: conversations.assistantEscalatedAt,
        escalationResolvedAt: conversations.assistantEscalationResolvedAt,
      })
      .from(conversations)
      .where(eq(conversations.id, session.conversationId))
      .limit(1)
      .then((rows) => rows[0]),
    ctx.tx
      .select({
        id: messages.id,
        direction: messages.direction,
        channel: messages.channel,
        body: messages.body,
        occurredAt: messages.occurredAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.chatSessionId, session.id),
          inArray(messages.channel, ["chat", "assistant"]),
        ),
      )
      .orderBy(asc(messages.occurredAt)),
  ]);
  return {
    state:
      session.closedAt || session.expiresAt.getTime() <= Date.now()
        ? ("closed" as const)
        : ("open" as const),
    escalated: Boolean(thread?.escalatedAt && !thread.escalationResolvedAt),
    messages: said as Array<z.output<typeof publicMessage>>,
    expiresAt: session.expiresAt,
  };
}

export const startSiteChat = defineService({
  name: "messaging.startSiteChat",
  summary: "Start a bearer-scoped site chat on the Contact's canonical thread.",
  kind: "mutation",
  permission: "public",
  writeClass: "message",
  input: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().toLowerCase().max(320),
    message: messageBody,
    locale,
  }),
  rateLimit: {
    limit: 5,
    windowSeconds: 60 * 60,
    subject: (input) => hashToken(input.email),
    message: "Wait before starting another chat with this email address.",
  },
  output: row({ ok: z.literal(true), token: z.string(), conversationId: uuid, contactId: uuid }),
  handler: async (input, ctx) => {
    const recorded = (await ctx.callAsSystem(getService("conversations.record"), {
      name: input.name,
      email: input.email,
      direction: "inbound",
      channel: "chat",
      subject: "Website chat",
      body: input.message,
      sentBy: "contact",
    })) as { conversation: { id: string; contactId: string }; message: { id: string } };

    // A second browser opening the same recent Contact thread replaces the old
    // bearer. There is one place replies can be delivered, never two tokens
    // silently watching the same customer history.
    await closeSiteChatSessions(ctx.tx, recorded.conversation.id);
    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + CHAT_LIFETIME_HOURS * 60 * 60 * 1_000);
    const [session] = await ctx.tx
      .insert(siteChatSessions)
      .values({
        contactId: recorded.conversation.contactId,
        conversationId: recorded.conversation.id,
        tokenHash: hashToken(rawToken),
        locale: input.locale,
        expiresAt,
      })
      .returning();
    await ctx.tx
      .update(messages)
      .set({ chatSessionId: session!.id })
      .where(eq(messages.id, recorded.message.id));

    ctx.setSubject("conversation", recorded.conversation.id);
    ctx.queueEvent("messaging.siteChatStarted", {
      conversationId: recorded.conversation.id,
      contactId: recorded.conversation.contactId,
    });
    return {
      ok: true as const,
      token: rawToken,
      conversationId: recorded.conversation.id,
      contactId: recorded.conversation.contactId,
    };
  },
});

export const getSiteChat = defineService({
  name: "messaging.getSiteChat",
  summary: "Read only the messages belonging to one site-chat bearer.",
  kind: "query",
  permission: "public",
  input: z.object({ token }),
  output: transcript,
  handler: async (input, ctx) =>
    transcriptFor(ctx, await sessionForToken(ctx.tx, input.token, { allowClosed: true })),
});

export const postSiteChat = defineService({
  name: "messaging.postSiteChat",
  summary: "Add a visitor message to its bearer-scoped site chat.",
  kind: "mutation",
  permission: "public",
  writeClass: "message",
  input: z.object({ token, message: messageBody }),
  rateLimit: {
    limit: 60,
    windowSeconds: 10 * 60,
    subject: (input) => hashToken(input.token),
    message: "Too many chat messages were sent. Wait a few minutes and try again.",
  },
  output: transcript,
  handler: async (input, ctx) => {
    const session = await sessionForToken(ctx.tx, input.token);
    await ctx.callAsSystem(getService("conversations.record"), {
      conversationId: session.conversationId,
      contactId: session.contactId,
      direction: "inbound",
      channel: "chat",
      body: input.message,
      sentBy: "contact",
      chatSessionId: session.id,
    });
    await ctx.tx
      .update(siteChatSessions)
      .set({ lastMessageAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(siteChatSessions.id, session.id));
    ctx.setSubject("conversation", session.conversationId);
    return transcriptFor(ctx, session);
  },
});

export const endSiteChat = defineService({
  name: "messaging.endSiteChat",
  summary: "End one browser's site-chat session without rewriting its thread.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: z.object({ token }),
  output: okResult,
  handler: async (input, ctx) => {
    const session = await sessionForToken(ctx.tx, input.token, { allowClosed: true });
    await ctx.tx
      .update(siteChatSessions)
      .set({ closedAt: sql`coalesce(${siteChatSessions.closedAt}, now())`, updatedAt: sql`now()` })
      .where(eq(siteChatSessions.id, session.id));
    ctx.setSubject("conversation", session.conversationId);
    ctx.queueEvent("messaging.siteChatEnded", { conversationId: session.conversationId });
    return { ok: true as const };
  },
});

function requireAssistant(actor: Actor): void {
  if (actor.kind !== "agent" && actor.kind !== "system") {
    throw new ServiceError("permission", "Only the connected assistant can speak as the assistant.");
  }
}

export const sendAssistantChatMessage = defineService({
  name: "messaging.sendAssistantChatMessage",
  summary: "Let a connected assistant answer an active site chat, with authorship preserved.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  input: z.object({ conversationId: uuid, message: messageBody }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requireAssistant(ctx.actor);
    const session = await activeSiteChatSession(ctx.tx, input.conversationId);
    if (!session) throw new ServiceError("conflict", "That site chat is no longer active.");
    const recorded = (await ctx.callAsSystem(getService("conversations.record"), {
      conversationId: session.conversationId,
      contactId: session.contactId,
      direction: "outbound",
      channel: "assistant",
      body: input.message,
      sentBy: ctx.actor.kind === "agent" ? "agent" : "automation",
      chatSessionId: session.id,
    })) as { message: { id: string } };
    await ctx.tx
      .update(siteChatSessions)
      .set({ lastMessageAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(siteChatSessions.id, session.id));
    ctx.setSubject("conversation", session.conversationId);
    return { id: recorded.message.id };
  },
});

export const escalateAssistantChat = defineService({
  name: "messaging.escalateAssistantChat",
  summary: "Flag an assistant chat for a person without inventing consent or a second thread.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  input: z.object({
    conversationId: uuid,
    reason: z.string().trim().min(1).max(1_000),
    message: messageBody.optional(),
  }),
  output: row({ conversationId: uuid, escalatedAt: timestamp }),
  handler: async (input, ctx) => {
    requireAssistant(ctx.actor);
    const session = await activeSiteChatSession(ctx.tx, input.conversationId);
    if (!session) throw new ServiceError("conflict", "That site chat is no longer active.");
    if (input.message) {
      await ctx.call(getService("messaging.sendAssistantChatMessage"), {
        conversationId: input.conversationId,
        message: input.message,
      });
    }
    const [updated] = await ctx.tx
      .update(conversations)
      .set({
        status: "open",
        snoozedUntil: null,
        unread: true,
        assistantEscalatedAt: sql`now()`,
        assistantEscalationReason: input.reason,
        assistantEscalationResolvedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, input.conversationId))
      .returning({ id: conversations.id, escalatedAt: conversations.assistantEscalatedAt });
    if (!updated?.escalatedAt) throw new ServiceError("not_found", "That conversation is not here.");
    ctx.setSubject("conversation", updated.id);
    ctx.queueEvent("conversation.assistantEscalated", {
      id: updated.id,
      contactId: session.contactId,
      reason: input.reason,
    });
    return { conversationId: updated.id, escalatedAt: updated.escalatedAt };
  },
});

registerContactReference({
  table: "site_chat_sessions",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(siteChatSessions)
      .set({ contactId: survivingId })
      .where(eq(siteChatSessions.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: siteChatSessions.id, contactId: siteChatSessions.contactId })
      .from(siteChatSessions)
      .where(inArray(siteChatSessions.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: uuid, contactId: uuid }))
      .parse(beforeState)
      .filter((session) => session.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(siteChatSessions)
        .set({ contactId: duplicateId })
        .where(inArray(siteChatSessions.id, moved.map((session) => session.id)));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.siteChatSessions",
  tables: ["site_chat_sessions"],
  exportData: (tx, contactId) =>
    tx
      .select({
        id: siteChatSessions.id,
        conversationId: siteChatSessions.conversationId,
        locale: siteChatSessions.locale,
        expiresAt: siteChatSessions.expiresAt,
        closedAt: siteChatSessions.closedAt,
        createdAt: siteChatSessions.createdAt,
      })
      .from(siteChatSessions)
      .where(eq(siteChatSessions.contactId, contactId)),
  erase: async (tx, contactId) => {
    const removed = await tx
      .delete(siteChatSessions)
      .where(eq(siteChatSessions.contactId, contactId))
      .returning({ id: siteChatSessions.id });
    return { affected: removed.length };
  },
});

export default [
  startSiteChat,
  getSiteChat,
  postSiteChat,
  endSiteChat,
  sendAssistantChatMessage,
  escalateAssistantChat,
];
