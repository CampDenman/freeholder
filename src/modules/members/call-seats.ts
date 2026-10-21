// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.37 (MASTER.md §44.7): when someone must stop hearing a group call —
// they left the conversation, or removed the device they joined from — the
// call gets a new key generation and the SFU is told to drop them.
//
// Both halves matter. The SFU disconnect happens after the transaction
// commits (onCallSeatLost), because provider I/O never runs inside one. The
// new key is made by the first remaining device that notices; the person who
// left is no longer in the conversation's MLS group, so it never reaches them.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { memberGroupCallParticipants, memberGroupCalls } from "./schema";
import { sfu } from "./sfu";

export const roomOf = (callId: string) => `freeholder-${callId}`;

/** Bump the key of each running call in these conversations and queue the SFU disconnect. */
export async function dropFromCalls(ctx: ServiceContext, conversationIds: string[], userId: string, deviceId?: string): Promise<void> {
  if (!conversationIds.length) return;
  const calls = await ctx.tx
    .select({ id: memberGroupCalls.id, keyGeneration: memberGroupCalls.keyGeneration })
    .from(memberGroupCalls)
    .where(and(inArray(memberGroupCalls.conversationId, conversationIds), eq(memberGroupCalls.state, "active")));
  for (const call of calls) {
    await ctx.tx.update(memberGroupCalls).set({ keyGeneration: call.keyGeneration + 1 }).where(eq(memberGroupCalls.id, call.id));
    if (!deviceId) {
      await ctx.tx
        .update(memberGroupCallParticipants)
        .set({ leftAt: new Date() })
        .where(and(eq(memberGroupCallParticipants.callId, call.id), eq(memberGroupCallParticipants.userId, userId), isNull(memberGroupCallParticipants.leftAt)));
    }
    ctx.queueEvent("member.callSeatLost", { callId: call.id, userId, deviceId: deviceId ?? null });
  }
}

/** After commit: disconnect that person (every device) or that one device from the room. */
export async function onCallSeatLost(payload: unknown): Promise<void> {
  const { callId, userId, deviceId } = (payload ?? {}) as { callId?: string; userId?: string; deviceId?: string | null };
  const adapter = sfu();
  if (!adapter || !callId || !userId) return;
  const room = roomOf(callId);
  const targets = deviceId ? [`${userId}:${deviceId}`] : (await adapter.participants(room)).filter((identity) => identity.startsWith(`${userId}:`));
  for (const identity of targets) await adapter.remove(room, identity);
}

export function assertGeneration(call: { keyGeneration: number }, generation: number): void {
  if (call.keyGeneration !== generation) throw new ServiceError("conflict", "The call's key changed. Your device will catch up and try again.");
}
