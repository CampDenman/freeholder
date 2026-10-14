// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private voice and video calls between two members (MASTER.md §44.7, C12.07).
//
// One-to-one calls are peer to peer: WebRTC encrypts the media between the
// two devices (DTLS-SRTP), and the server only relays signalling — session
// descriptions and network candidates — which it deletes as soon as they are
// read and when the call ends. A TURN relay, when the site runs one, forwards
// encrypted packets it cannot decrypt. Nothing is recorded.
//
// A member can be called only by someone they follow, a friend, or someone
// whose message request they accepted. Group calls need a media server and are
// C12.24.
import { createHmac } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, inArray, lt, ne, or } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { env } from "@/core/env";
import { defineService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { relationBetween } from "./graph";
import { notifyMember } from "./notify";
import {
  memberCallSignals,
  memberCalls,
  memberConversationParticipants,
  memberConversations,
  memberProfiles,
} from "./schema";

const RING_SECONDS = 45;
const TURN_TTL_SECONDS = 3600;

function viewerOf(actor: Actor): string {
  if (actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  return actor.userId;
}

async function activeSelf(ctx: ServiceContext) {
  const userId = viewerOf(ctx.actor);
  const [found] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId));
  if (!found || found.status !== "active") throw new ServiceError("permission", "Your membership is not active.");
  return found;
}

/** Whether `callee` accepts calls from `caller`. */
export async function mayCall(ctx: ServiceContext, callerId: string, calleeId: string): Promise<boolean> {
  const relation = await relationBetween(ctx, calleeId, callerId);
  if (relation.blocked) return false;
  if (relation.following === "active" || relation.friend === "friends") return true;
  const directKey = [callerId, calleeId].sort().join(":");
  const [accepted] = await ctx.tx
    .select({ state: memberConversationParticipants.state })
    .from(memberConversations)
    .innerJoin(
      memberConversationParticipants,
      and(eq(memberConversationParticipants.conversationId, memberConversations.id), eq(memberConversationParticipants.userId, calleeId)),
    )
    .where(eq(memberConversations.directKey, directKey));
  return accepted?.state === "active";
}

/** Ringing that nobody answered becomes a missed call, and the callee hears about it. */
async function expireRinging(ctx: ServiceContext): Promise<void> {
  const missed = await ctx.tx
    .update(memberCalls)
    .set({ state: "missed", endedAt: new Date() })
    .where(and(eq(memberCalls.state, "ringing"), lt(memberCalls.createdAt, new Date(Date.now() - RING_SECONDS * 1000))))
    .returning();
  for (const call of missed) {
    await ctx.tx.delete(memberCallSignals).where(eq(memberCallSignals.callId, call.id));
    await notifyMember(ctx, {
      to: call.calleeId,
      from: call.callerId,
      topic: "members.call",
      key: "members.notify.missedCall",
      href: "/messages",
      idempotencyKey: `member-call-missed:${call.id}`,
    });
  }
}

async function ownCall(ctx: ServiceContext, id: string, userId: string) {
  const [call] = await ctx.tx
    .select()
    .from(memberCalls)
    .where(and(eq(memberCalls.id, id), or(eq(memberCalls.callerId, userId), eq(memberCalls.calleeId, userId))));
  if (!call) throw new ServiceError("not_found", "That call is not available.");
  return call;
}

const person = row({ userId: z.string(), handle: z.string(), displayName: z.string() });
const callShape = row({
  id: uuid,
  media: z.enum(["voice", "video"]),
  state: z.enum(["ringing", "active", "ended", "declined", "missed"]),
  role: z.enum(["caller", "callee"]),
  other: person,
  createdAt: timestamp,
});

async function shape(ctx: ServiceContext, call: typeof memberCalls.$inferSelect, userId: string) {
  const otherId = call.callerId === userId ? call.calleeId : call.callerId;
  const [other] = await ctx.tx
    .select({ userId: memberProfiles.userId, handle: memberProfiles.handle, displayName: memberProfiles.displayName })
    .from(memberProfiles)
    .where(eq(memberProfiles.userId, otherId));
  return {
    id: call.id,
    media: call.media,
    state: call.state,
    role: call.callerId === userId ? ("caller" as const) : ("callee" as const),
    other: other!,
    createdAt: call.createdAt,
  };
}

/** Short-lived TURN credentials in the coturn `use-auth-secret` scheme. */
export function relayCredentials(userId: string, now = Date.now()) {
  const secret = env().TURN_SECRET;
  const urls = (env().TURN_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const stun = (env().STUN_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const servers: { urls: string[]; username?: string; credential?: string }[] = [];
  if (stun.length) servers.push({ urls: stun });
  if (secret && urls.length) {
    const username = `${Math.floor(now / 1000) + TURN_TTL_SECONDS}:${userId}`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    servers.push({ urls, username, credential });
  }
  return { iceServers: servers, relayConfigured: Boolean(secret && urls.length) };
}

export const callSettings = defineService({
  name: "members.callConfig",
  summary: "The network servers your device should use for a call, with short-lived relay credentials.",
  kind: "query",
  permission: "authenticated",
  mcpExclude: true,
  input: z.object({}),
  output: z.object({
    iceServers: listed(z.object({ urls: z.array(z.string()), username: z.string().optional(), credential: z.string().optional() })),
    relayConfigured: z.boolean(),
  }),
  handler: async (_input, ctx) => relayCredentials(viewerOf(ctx.actor)),
});

export const startCall = defineService({
  name: "members.startCall",
  summary: "Ring a member for a private voice or video call.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 30, windowSeconds: 3600, message: "You are calling very often. Please slow down.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({ handle: z.string().trim().toLowerCase().max(60), media: z.enum(["voice", "video"]) }),
  output: callShape,
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await expireRinging(ctx);
    const [callee] = await ctx.tx
      .select()
      .from(memberProfiles)
      .where(and(eq(memberProfiles.handle, input.handle), eq(memberProfiles.status, "active")));
    if (!callee || callee.userId === me.userId || !(await mayCall(ctx, me.userId, callee.userId))) {
      throw new ServiceError("not_found", "You cannot call that member.");
    }
    const [busy] = await ctx.tx
      .select({ id: memberCalls.id })
      .from(memberCalls)
      .where(
        and(
          inArray(memberCalls.state, ["ringing", "active"]),
          or(
            eq(memberCalls.callerId, me.userId),
            eq(memberCalls.calleeId, me.userId),
            eq(memberCalls.callerId, callee.userId),
            eq(memberCalls.calleeId, callee.userId),
          ),
        ),
      );
    if (busy) throw new ServiceError("conflict", "One of you is already on a call.");
    const [call] = await ctx.tx
      .insert(memberCalls)
      .values({ callerId: me.userId, calleeId: callee.userId, media: input.media, state: "ringing" })
      .returning();
    ctx.setSubject("member_call", call!.id);
    ctx.queueEvent("member.callStarted", { callId: call!.id, callerId: me.userId, calleeId: callee.userId });
    return shape(ctx, call!, me.userId);
  },
});

export const incomingCalls = defineService({
  name: "members.incomingCalls",
  summary: "Calls ringing for you right now.",
  kind: "query",
  permission: "authenticated",
  mcpExclude: true,
  input: z.object({}),
  output: listed(callShape),
  handler: async (_input, ctx) => {
    const me = viewerOf(ctx.actor);
    await expireRinging(ctx);
    const rows = await ctx.tx
      .select()
      .from(memberCalls)
      .where(and(eq(memberCalls.calleeId, me), eq(memberCalls.state, "ringing")))
      .orderBy(asc(memberCalls.createdAt));
    const out = [];
    for (const call of rows) out.push(await shape(ctx, call, me));
    return out;
  },
});

export const callStatus = defineService({
  name: "members.callStatus",
  summary: "The state of a call you are part of.",
  kind: "query",
  permission: "authenticated",
  mcpExclude: true,
  input: z.object({ id: uuid }),
  output: callShape,
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    await expireRinging(ctx);
    return shape(ctx, await ownCall(ctx, input.id, me), me);
  },
});

export const answerCall = defineService({
  name: "members.answerCall",
  summary: "Answer or decline a call ringing for you.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  mcpExclude: true,
  input: z.object({ id: uuid, accept: z.boolean() }),
  output: callShape,
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    await expireRinging(ctx);
    const call = await ownCall(ctx, input.id, me);
    if (call.calleeId !== me || call.state !== "ringing") throw new ServiceError("conflict", "That call is no longer ringing.");
    const [updated] = await ctx.tx
      .update(memberCalls)
      .set(input.accept ? { state: "active", answeredAt: new Date() } : { state: "declined", endedAt: new Date() })
      .where(eq(memberCalls.id, call.id))
      .returning();
    if (!input.accept) await ctx.tx.delete(memberCallSignals).where(eq(memberCallSignals.callId, call.id));
    return shape(ctx, updated!, me);
  },
});

export const endCall = defineService({
  name: "members.endCall",
  summary: "Hang up, or cancel a call that is still ringing.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  mcpExclude: true,
  input: z.object({ id: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    const call = await ownCall(ctx, input.id, me);
    if (call.state === "ringing" || call.state === "active") {
      await ctx.tx.update(memberCalls).set({ state: "ended", endedAt: new Date() }).where(eq(memberCalls.id, call.id));
    }
    await ctx.tx.delete(memberCallSignals).where(eq(memberCallSignals.callId, call.id));
    return { ok: true as const };
  },
});

const signalPayload = z.union([
  z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().max(20_000) }),
  z.object({
    candidate: z.string().max(2000),
    sdpMid: z.string().max(100).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(100).nullable().optional(),
  }),
]);

export const sendSignal = defineService({
  name: "members.signal",
  summary: "Pass a WebRTC session description or network candidate to the other person on the call.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  mcpExclude: true,
  rateLimit: { limit: 600, windowSeconds: 600, message: "Too many call signals.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({ callId: uuid, kind: z.enum(["offer", "answer", "candidate"]), payload: signalPayload }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    const call = await ownCall(ctx, input.callId, me);
    if (call.state !== "ringing" && call.state !== "active") throw new ServiceError("conflict", "That call has ended.");
    await ctx.tx.insert(memberCallSignals).values({ callId: call.id, fromId: me, kind: input.kind, payload: input.payload });
    return { ok: true as const };
  },
});

export const takeSignals = defineService({
  name: "members.takeSignals",
  summary: "Collect, and remove, the call signals the other person sent you.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  mcpExclude: true,
  input: z.object({ callId: uuid }),
  output: z.object({
    state: z.enum(["ringing", "active", "ended", "declined", "missed"]),
    signals: listed(z.object({ kind: z.enum(["offer", "answer", "candidate"]), payload: z.unknown() })),
  }),
  handler: async (input, ctx) => {
    const me = viewerOf(ctx.actor);
    await expireRinging(ctx);
    const call = await ownCall(ctx, input.callId, me);
    const taken = await ctx.tx
      .delete(memberCallSignals)
      .where(and(eq(memberCallSignals.callId, call.id), ne(memberCallSignals.fromId, me)))
      .returning();
    taken.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return { state: call.state, signals: taken.map((s) => ({ kind: s.kind, payload: s.payload })) };
  },
});

export default [callSettings, startCall, incomingCalls, callStatus, answerCall, endCall, sendSignal, takeSignals];
