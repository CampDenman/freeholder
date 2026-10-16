// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.34 (MASTER.md §44.6): bring a member's earlier encrypted messages to a
// device they just added, device to device.
//
// The new device makes an HPKE key pair, keeps the private half, and signs
// the public half with its device key. Another of the member's devices shows
// the request — with a code the member compares against the new device's
// screen — and only when the member approves does it seal each
// conversation's history to that public key. The server relays sealed bytes
// it cannot open, and only between one person's own devices; the approval is
// what stops a device the server added on its own from receiving anything.
import { and, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { activeSelf, participant } from "../messages";
import { memberDevices, memberHistoryRequests, memberHistoryTransfers } from "../schema";
import { historyStatement, suite, unb64 } from "./wire";

const OPEN_DAYS = 7;
const base64 = z.string().max(1_400_000).regex(/^[A-Za-z0-9+/]*={0,2}$/);

async function ownDevice(ctx: ServiceContext, userId: string, deviceId: string) {
  const [device] = await ctx.tx.select().from(memberDevices).where(and(eq(memberDevices.id, deviceId), eq(memberDevices.userId, userId), isNull(memberDevices.revokedAt)));
  if (!device) throw new ServiceError("not_found", "That device is not registered.");
  return device;
}

async function openRequest(ctx: ServiceContext, userId: string, requestId: string) {
  const [request] = await ctx.tx
    .select()
    .from(memberHistoryRequests)
    .where(and(eq(memberHistoryRequests.id, requestId), eq(memberHistoryRequests.userId, userId), eq(memberHistoryRequests.state, "open"), gt(memberHistoryRequests.createdAt, new Date(Date.now() - OPEN_DAYS * 86_400_000))));
  if (!request) throw new ServiceError("not_found", "That request is no longer open.");
  return request;
}

export const requestHistory = defineService({
  name: "members.requestHistory",
  summary: "Ask your other devices for your earlier encrypted messages, sealed to a key only this device holds.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  rateLimit: { limit: 10, windowSeconds: 3600, message: "You have asked for your history several times. Approve it on another device.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({ deviceId: uuid, publicKey: base64.max(200), sig: base64.max(200) }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const device = await ownDevice(ctx, me.userId, input.deviceId);
    const ok = await (await suite()).signature.verify(unb64(device.signatureKey), historyStatement(me.userId, device.id, input.publicKey), unb64(input.sig));
    if (!ok) throw new ServiceError("validation", "That request is not signed by this device.");
    await ctx.tx.update(memberHistoryRequests).set({ state: "closed" }).where(and(eq(memberHistoryRequests.deviceId, device.id), eq(memberHistoryRequests.state, "open")));
    const [created] = await ctx.tx.insert(memberHistoryRequests).values({ userId: me.userId, deviceId: device.id, publicKey: input.publicKey, sig: input.sig }).returning({ id: memberHistoryRequests.id });
    return { id: created!.id };
  },
});

export const historyRequests = defineService({
  name: "members.historyRequests",
  summary: "Your other devices asking for your earlier messages, for you to approve or ignore on this one.",
  kind: "query",
  permission: "authenticated",
  agentCallable: false,
  input: z.object({ deviceId: uuid }),
  output: z.object({ requests: listed(row({ id: uuid, deviceId: uuid, label: z.string(), signatureKey: z.string(), publicKey: z.string(), sig: z.string(), createdAt: timestamp })) }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await ownDevice(ctx, me.userId, input.deviceId);
    const requests = await ctx.tx
      .select({
        id: memberHistoryRequests.id,
        deviceId: memberHistoryRequests.deviceId,
        label: memberDevices.label,
        signatureKey: memberDevices.signatureKey,
        publicKey: memberHistoryRequests.publicKey,
        sig: memberHistoryRequests.sig,
        createdAt: memberHistoryRequests.createdAt,
      })
      .from(memberHistoryRequests)
      .innerJoin(memberDevices, eq(memberDevices.id, memberHistoryRequests.deviceId))
      .where(
        and(
          eq(memberHistoryRequests.userId, me.userId),
          eq(memberHistoryRequests.state, "open"),
          ne(memberHistoryRequests.deviceId, input.deviceId),
          isNull(memberDevices.revokedAt),
          gt(memberHistoryRequests.createdAt, new Date(Date.now() - OPEN_DAYS * 86_400_000)),
        ),
      );
    return { requests };
  },
});

export const sendHistory = defineService({
  name: "members.sendHistory",
  summary: "Send one conversation's history, sealed on this device, to your device that asked for it.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ requestId: uuid, deviceId: uuid, conversationId: uuid, enc: base64.max(400), ct: base64 }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await ownDevice(ctx, me.userId, input.deviceId);
    const request = await openRequest(ctx, me.userId, input.requestId);
    if (request.deviceId === input.deviceId) throw new ServiceError("validation", "A device cannot answer its own request.");
    await participant(ctx, input.conversationId, me.userId);
    await ctx.tx.insert(memberHistoryTransfers).values({ requestId: request.id, conversationId: input.conversationId, fromDeviceId: input.deviceId, enc: input.enc, ct: input.ct });
    return { ok: true as const };
  },
});

export const closeHistoryRequest = defineService({
  name: "members.closeHistoryRequest",
  summary: "Finish or ignore a request for your history.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ requestId: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await ctx.tx.update(memberHistoryRequests).set({ state: "closed" }).where(and(eq(memberHistoryRequests.id, input.requestId), eq(memberHistoryRequests.userId, me.userId)));
    return { ok: true as const };
  },
});

export const receivedHistory = defineService({
  name: "members.receivedHistory",
  summary: "History your other devices sealed to this one, waiting to be opened here.",
  kind: "query",
  permission: "authenticated",
  agentCallable: false,
  input: z.object({ deviceId: uuid }),
  output: z.object({ transfers: listed(row({ id: uuid, requestId: uuid, conversationId: uuid, fromDeviceId: uuid.nullable(), enc: z.string(), ct: z.string() })) }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await ownDevice(ctx, me.userId, input.deviceId);
    const transfers = await ctx.tx
      .select({ id: memberHistoryTransfers.id, requestId: memberHistoryTransfers.requestId, conversationId: memberHistoryTransfers.conversationId, fromDeviceId: memberHistoryTransfers.fromDeviceId, enc: memberHistoryTransfers.enc, ct: memberHistoryTransfers.ct })
      .from(memberHistoryTransfers)
      .innerJoin(memberHistoryRequests, eq(memberHistoryRequests.id, memberHistoryTransfers.requestId))
      .where(and(eq(memberHistoryRequests.deviceId, input.deviceId), eq(memberHistoryRequests.userId, me.userId)))
      .limit(20);
    return { transfers };
  },
});

export const ackHistory = defineService({
  name: "members.ackHistory",
  summary: "Delete history this device has opened and kept.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ deviceId: uuid, ids: z.array(uuid).max(50) }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await ownDevice(ctx, me.userId, input.deviceId);
    if (!input.ids.length) return { ok: true as const };
    const mine = await ctx.tx
      .select({ id: memberHistoryTransfers.id })
      .from(memberHistoryTransfers)
      .innerJoin(memberHistoryRequests, eq(memberHistoryRequests.id, memberHistoryTransfers.requestId))
      .where(and(inArray(memberHistoryTransfers.id, input.ids), eq(memberHistoryRequests.deviceId, input.deviceId)));
    if (mine.length) await ctx.tx.delete(memberHistoryTransfers).where(inArray(memberHistoryTransfers.id, mine.map((m) => m.id)));
    return { ok: true as const };
  },
});

export default [requestHistory, historyRequests, sendHistory, closeHistoryRequest, receivedHistory, ackHistory];
