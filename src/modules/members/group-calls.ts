// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Group voice and video calls (MASTER.md §44.7, C12.24).
//
// A group call happens in an end-to-end encrypted conversation and runs
// through the site's own SFU (sfu.ts). The caller's device makes a random
// media key and sends it to the conversation's MLS group as a control
// message (e2ee/service.ts), so every device in the conversation — and only
// those — can encrypt and decrypt the frames; the SFU forwards ciphertext.
//
// The who-may-call rule is the conversation's own: only people who are in it
// and have accepted it can start, be rung, or join. Someone whose request is
// still waiting is not rung. Nothing is recorded.
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { activeSelf, participant } from "./messages";
import { notifyMember } from "./notify";
import { memberConversationParticipants, memberConversations, memberDevices, memberGroupCallParticipants, memberGroupCalls, memberMlsGroups, memberMlsRoster, memberProfiles } from "./schema";
import { sfu } from "./sfu";

const TOKEN_SECONDS = 2 * 3600;
const STALE_MS = 12 * 3600 * 1000;

async function accepted(ctx: ServiceContext, conversationId: string, userId: string) {
  const seat = await participant(ctx, conversationId, userId);
  if (seat.state !== "active") throw new ServiceError("permission", "Accept this conversation before joining its calls.");
  return seat;
}

/** Calls nobody ended, from long ago, are over. */
async function endStale(ctx: ServiceContext, conversationId: string) {
  await ctx.tx
    .update(memberGroupCalls)
    .set({ state: "ended", endedAt: new Date() })
    .where(and(eq(memberGroupCalls.conversationId, conversationId), eq(memberGroupCalls.state, "active"), lt(memberGroupCalls.createdAt, new Date(Date.now() - STALE_MS))));
}

async function liveCall(ctx: ServiceContext, callId: string) {
  const [call] = await ctx.tx.select().from(memberGroupCalls).where(eq(memberGroupCalls.id, callId));
  if (!call || call.state !== "active") throw new ServiceError("not_found", "That call has ended.");
  return call;
}

const roomOf = (callId: string) => `freeholder-${callId}`;

export const groupCallConfig = defineService({
  name: "members.groupCallConfig",
  summary: "Whether this site can host group calls.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({ available: z.boolean() }),
  handler: async () => ({ available: Boolean(sfu()) }),
});

export const startGroupCall = defineService({
  name: "members.startGroupCall",
  summary: "Start a voice or video call in an end-to-end encrypted conversation, or get the one already going.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  // Joining needs a device's media key; an agent has none.
  agentCallable: false,
  rateLimit: { limit: 30, windowSeconds: 3600, message: "You are starting calls very quickly. Please wait a little.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({ conversationId: uuid, media: z.enum(["voice", "video"]) }),
  output: z.object({ id: uuid, started: z.boolean() }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await accepted(ctx, input.conversationId, me.userId);
    if (!sfu()) throw new ServiceError("validation", "This site does not host group calls.");
    const [group] = await ctx.tx.select().from(memberMlsGroups).where(eq(memberMlsGroups.conversationId, input.conversationId));
    if (!group) throw new ServiceError("validation", "Group calls need an end-to-end encrypted conversation: everyone here needs a device first.");
    await ctx.tx.select({ id: memberConversations.id }).from(memberConversations).where(eq(memberConversations.id, input.conversationId)).for("update");
    await endStale(ctx, input.conversationId);
    const [running] = await ctx.tx.select().from(memberGroupCalls).where(and(eq(memberGroupCalls.conversationId, input.conversationId), eq(memberGroupCalls.state, "active")));
    if (running) return { id: running.id, started: false };
    const [call] = await ctx.tx.insert(memberGroupCalls).values({ conversationId: input.conversationId, startedBy: me.userId, media: input.media }).returning();
    const others = await ctx.tx
      .select()
      .from(memberConversationParticipants)
      .where(and(eq(memberConversationParticipants.conversationId, input.conversationId), ne(memberConversationParticipants.userId, me.userId), eq(memberConversationParticipants.state, "active")));
    for (const seat of others) {
      if (seat.muted) continue;
      await notifyMember(ctx, {
        to: seat.userId,
        from: me.userId,
        topic: "members.call",
        key: "members.notify.groupCall",
        href: `/call/group/${call!.id}`,
        idempotencyKey: `member-group-call:${call!.id}:${seat.userId}`,
      });
    }
    ctx.setSubject("member_group_call", call!.id);
    return { id: call!.id, started: true };
  },
});

const person = row({ userId: uuid, handle: z.string(), displayName: z.string() });

export const viewGroupCall = defineService({
  name: "members.groupCall",
  summary: "A group call you can join: its conversation, media, and who is in it now.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ id: uuid }),
  output: z.object({ id: uuid, conversationId: uuid, media: z.enum(["voice", "video"]), state: z.enum(["active", "ended"]), title: z.string(), inCall: listed(person) }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const [call] = await ctx.tx.select().from(memberGroupCalls).where(eq(memberGroupCalls.id, input.id));
    if (!call) throw new ServiceError("not_found", "That call is not available.");
    await accepted(ctx, call.conversationId, me.userId);
    const [conversation] = await ctx.tx.select().from(memberConversations).where(eq(memberConversations.id, call.conversationId));
    const inCall = await ctx.tx
      .select({ userId: memberProfiles.userId, handle: memberProfiles.handle, displayName: memberProfiles.displayName })
      .from(memberGroupCallParticipants)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, memberGroupCallParticipants.userId))
      .where(and(eq(memberGroupCallParticipants.callId, call.id), isNull(memberGroupCallParticipants.leftAt)));
    return { id: call.id, conversationId: call.conversationId, media: call.media, state: call.state, title: conversation?.title ?? "", inCall };
  },
});

export const activeGroupCall = defineService({
  name: "members.activeGroupCall",
  summary: "The call going on in a conversation you are in, if any.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ conversationId: uuid }),
  output: z.object({ call: row({ id: uuid, media: z.enum(["voice", "video"]) }).nullable(), available: z.boolean() }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await participant(ctx, input.conversationId, me.userId);
    const [call] = await ctx.tx
      .select({ id: memberGroupCalls.id, media: memberGroupCalls.media, createdAt: memberGroupCalls.createdAt })
      .from(memberGroupCalls)
      .where(and(eq(memberGroupCalls.conversationId, input.conversationId), eq(memberGroupCalls.state, "active")));
    const fresh = call && call.createdAt.getTime() > Date.now() - STALE_MS ? { id: call.id, media: call.media } : null;
    return { call: fresh, available: Boolean(sfu()) };
  },
});

export const joinGroupCall = defineService({
  name: "members.joinGroupCall",
  summary: "Get a short-lived credential for the site's SFU to join a group call from one of your devices.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  agentCallable: false,
  input: z.object({ id: uuid, deviceId: uuid }),
  output: z.object({ url: z.string(), token: z.string(), room: z.string(), media: z.enum(["voice", "video"]), conversationId: uuid }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const call = await liveCall(ctx, input.id);
    await accepted(ctx, call.conversationId, me.userId);
    const adapter = sfu();
    if (!adapter) throw new ServiceError("validation", "This site does not host group calls.");
    // Only a device in the conversation's group can hold the media key.
    const [seat] = await ctx.tx
      .select({ deviceId: memberMlsRoster.deviceId })
      .from(memberMlsRoster)
      .innerJoin(memberDevices, eq(memberDevices.id, memberMlsRoster.deviceId))
      .where(and(eq(memberMlsRoster.conversationId, call.conversationId), eq(memberMlsRoster.deviceId, input.deviceId), eq(memberDevices.userId, me.userId), isNull(memberDevices.revokedAt)));
    if (!seat) throw new ServiceError("permission", "Open the conversation on this device first, so it can join the call.");
    await ctx.tx
      .insert(memberGroupCallParticipants)
      .values({ callId: call.id, userId: me.userId })
      .onConflictDoUpdate({ target: [memberGroupCallParticipants.callId, memberGroupCallParticipants.userId], set: { joinedAt: new Date(), leftAt: null } });
    const room = roomOf(call.id);
    const token = adapter.issue({ room, identity: `${me.userId}:${input.deviceId}`, name: me.displayName, ttlSeconds: TOKEN_SECONDS });
    return { url: adapter.url, token, room, media: call.media, conversationId: call.conversationId };
  },
});

export const leaveGroupCall = defineService({
  name: "members.leaveGroupCall",
  summary: "Leave a group call. It ends when the last person leaves.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ id: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const [call] = await ctx.tx.select().from(memberGroupCalls).where(eq(memberGroupCalls.id, input.id)).for("update");
    if (!call) throw new ServiceError("not_found", "That call is not available.");
    await participant(ctx, call.conversationId, me.userId);
    await ctx.tx
      .update(memberGroupCallParticipants)
      .set({ leftAt: new Date() })
      .where(and(eq(memberGroupCallParticipants.callId, call.id), eq(memberGroupCallParticipants.userId, me.userId)));
    const [still] = await ctx.tx
      .select({ userId: memberGroupCallParticipants.userId })
      .from(memberGroupCallParticipants)
      .where(and(eq(memberGroupCallParticipants.callId, call.id), isNull(memberGroupCallParticipants.leftAt)))
      .limit(1);
    if (!still && call.state === "active") await ctx.tx.update(memberGroupCalls).set({ state: "ended", endedAt: new Date() }).where(eq(memberGroupCalls.id, call.id));
    return { ok: true as const };
  },
});

export default [groupCallConfig, startGroupCall, viewGroupCall, activeGroupCall, joinGroupCall, leaveGroupCall];
