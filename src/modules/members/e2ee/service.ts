// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23 (MASTER.md §44.6): the server's side of end-to-end encrypted
// messages — an MLS delivery service and a directory of devices.
//
// The server never holds a key that opens a message. It records each device's
// public signature key, hands out the key packages devices publish, and keeps
// one ordered log per conversation: commits, welcomes and application
// messages, all ciphertext. It orders the group by epoch (a commit applies only
// to the epoch it was made in, so two devices cannot fork the group), and it
// refuses an encrypted message unless the group holds exactly the devices that
// should read it: every current device of everyone still in the conversation,
// and nobody else. A device that sees the group drift — someone added a
// device, revoked one, or left — repairs it with a commit before sending.
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { attachmentInput } from "../attachment-store";
import { activeSelf, directBlocked, participant, send } from "../messages";
import { memberConversationParticipants, memberConversations, memberDevices, memberGroupCalls, memberKeyPackages, memberMessages, memberMlsGroups, memberMlsLog, memberMlsRoster } from "../schema";
import { b64, readKeyPackage, unb64 } from "./wire";

const MAX_DEVICES = 20;
const MAX_UNCLAIMED = 200;
const LOG_PAGE = 100;
const base64 = z.string().max(200_000).regex(/^[A-Za-z0-9+/]*={0,2}$/);
const keyPackageInput = z.object({ id: uuid, keyPackage: base64 });

const membershipChanged = () => new ServiceError("conflict", "Who is in this conversation changed. Your device will catch up and try again.");

/** A device of the signed-in member that is still in use. */
async function myDevice(ctx: ServiceContext, userId: string, deviceId: string) {
  const [device] = await ctx.tx.select().from(memberDevices).where(and(eq(memberDevices.id, deviceId), eq(memberDevices.userId, userId)));
  if (!device) throw new ServiceError("not_found", "That device is not registered.");
  if (device.revokedAt) throw new ServiceError("permission", "This device was removed. Sign in again to set it up.");
  return device;
}

async function checkKeyPackages(userId: string, deviceId: string, signatureKey: string, packages: { id: string; keyPackage: string }[]) {
  for (const p of packages) {
    const read = await readKeyPackage(p.keyPackage);
    if (!read || read.identity?.userId !== userId || read.identity.deviceId !== deviceId || b64(read.signatureKey) !== signatureKey) {
      throw new ServiceError("validation", "A key package does not belong to this device.");
    }
  }
}

/**
 * The devices that should be in a conversation's group: every unrevoked
 * device of everyone who has not left. `missing` is who has no device yet.
 */
async function entitledDevices(ctx: ServiceContext, conversationId: string) {
  const people = await ctx.tx
    .select({ userId: memberConversationParticipants.userId })
    .from(memberConversationParticipants)
    .where(and(eq(memberConversationParticipants.conversationId, conversationId), ne(memberConversationParticipants.state, "left")));
  const ids = people.map((p) => p.userId);
  const devices = ids.length
    ? await ctx.tx.select().from(memberDevices).where(and(inArray(memberDevices.userId, ids), isNull(memberDevices.revokedAt)))
    : [];
  const covered = new Set(devices.map((d) => d.userId));
  return { devices, missing: ids.filter((id) => !covered.has(id)) };
}

async function rosterOf(ctx: ServiceContext, conversationId: string) {
  return ctx.tx.select().from(memberMlsRoster).where(eq(memberMlsRoster.conversationId, conversationId));
}

const deviceShape = row({ deviceId: uuid, userId: uuid, signatureKey: z.string() });

export const registerDevice = defineService({
  name: "members.registerDevice",
  summary: "Register this browser as one of your devices for end-to-end encrypted messages, with the key packages it made.",
  kind: "mutation",
  permission: "authenticated",
  // Devices hold keys; an agent acting by key never can (C12.14), so it cannot add one either.
  agentCallable: false,
  writeClass: "write",
  rateLimit: { limit: 20, windowSeconds: 3600, message: "You are adding devices very quickly. Please wait a little.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({
    deviceId: uuid,
    label: z.string().trim().min(1).max(80),
    signatureKey: base64.max(100),
    keyPackages: z.array(keyPackageInput).min(1).max(100),
    lastResort: keyPackageInput,
  }),
  output: z.object({ deviceId: uuid }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    if (unb64(input.signatureKey).length !== 32) throw new ServiceError("validation", "That is not a device key.");
    const [taken] = await ctx.tx.select().from(memberDevices).where(eq(memberDevices.id, input.deviceId));
    // A device retrying after its confirmation was lost is already here.
    if (taken?.userId === me.userId && taken.signatureKey === input.signatureKey && !taken.revokedAt) return { deviceId: taken.id };
    if (taken) throw new ServiceError("conflict", "That device is already registered.");
    const [{ count } = { count: 0 }] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(memberDevices)
      .where(and(eq(memberDevices.userId, me.userId), isNull(memberDevices.revokedAt)));
    if (count >= MAX_DEVICES) throw new ServiceError("validation", `Remove one of your ${MAX_DEVICES} devices before adding another.`);
    await checkKeyPackages(me.userId, input.deviceId, input.signatureKey, [...input.keyPackages, input.lastResort]);
    await ctx.tx.insert(memberDevices).values({ id: input.deviceId, userId: me.userId, label: input.label, signatureKey: input.signatureKey });
    await ctx.tx.insert(memberKeyPackages).values([
      ...input.keyPackages.map((p) => ({ id: p.id, deviceId: input.deviceId, keyPackage: p.keyPackage })),
      { id: input.lastResort.id, deviceId: input.deviceId, keyPackage: input.lastResort.keyPackage, lastResort: true },
    ]);
    ctx.setSubject("member_device", input.deviceId);
    return { deviceId: input.deviceId };
  },
});

export const publishKeyPackages = defineService({
  name: "members.publishKeyPackages",
  summary: "Publish more key packages for one of your devices, so people can keep adding it to conversations.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ deviceId: uuid, keyPackages: z.array(keyPackageInput).min(1).max(100) }),
  output: z.object({ unclaimed: z.number().int() }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const device = await myDevice(ctx, me.userId, input.deviceId);
    await checkKeyPackages(me.userId, device.id, device.signatureKey, input.keyPackages);
    const [{ count } = { count: 0 }] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(memberKeyPackages)
      .where(and(eq(memberKeyPackages.deviceId, device.id), isNull(memberKeyPackages.claimedAt), eq(memberKeyPackages.lastResort, false)));
    const room = Math.max(0, MAX_UNCLAIMED - count);
    const accepted = input.keyPackages.slice(0, room);
    if (accepted.length) await ctx.tx.insert(memberKeyPackages).values(accepted.map((p) => ({ id: p.id, deviceId: device.id, keyPackage: p.keyPackage }))).onConflictDoNothing();
    await ctx.tx.update(memberDevices).set({ lastSeenAt: new Date() }).where(eq(memberDevices.id, device.id));
    return { unclaimed: count + accepted.length };
  },
});

export const myDevices = defineService({
  name: "members.devices",
  summary: "Your devices for end-to-end encrypted messages, and how many key packages each has left.",
  kind: "query",
  permission: "authenticated",
  agentCallable: false,
  input: z.object({}),
  output: z.object({ devices: listed(row({ id: uuid, label: z.string(), createdAt: timestamp, lastSeenAt: timestamp, unclaimed: z.number().int() })) }),
  handler: async (_input, ctx) => {
    const me = await activeSelf(ctx);
    const devices = await ctx.tx
      .select({
        id: memberDevices.id,
        label: memberDevices.label,
        createdAt: memberDevices.createdAt,
        lastSeenAt: memberDevices.lastSeenAt,
        unclaimed: sql<number>`(select count(*)::int from ${memberKeyPackages} where ${memberKeyPackages.deviceId} = ${memberDevices.id} and ${memberKeyPackages.claimedAt} is null and not ${memberKeyPackages.lastResort})`,
      })
      .from(memberDevices)
      .where(and(eq(memberDevices.userId, me.userId), isNull(memberDevices.revokedAt)))
      .orderBy(asc(memberDevices.createdAt));
    return { devices };
  },
});

export const revokeDevice = defineService({
  name: "members.revokeDevice",
  summary: "Remove one of your devices. It is taken out of every encrypted conversation before anyone sends there again.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ deviceId: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await myDevice(ctx, me.userId, input.deviceId);
    await ctx.tx.update(memberDevices).set({ revokedAt: new Date() }).where(eq(memberDevices.id, input.deviceId));
    await ctx.tx.delete(memberKeyPackages).where(eq(memberKeyPackages.deviceId, input.deviceId));
    ctx.setSubject("member_device", input.deviceId);
    return { ok: true as const };
  },
});

export const e2eeSync = defineService({
  name: "members.e2eeSync",
  summary: "What one of your devices needs to read and write an encrypted conversation: the group, who should be in it, and the log since its cursor.",
  kind: "query",
  permission: "authenticated",
  agentCallable: false,
  input: z.object({ conversationId: uuid, deviceId: uuid, after: z.number().int().min(0).default(0) }),
  output: z.object({
    /** Everyone still in the conversation has a device, so it can be encrypted. */
    available: z.boolean(),
    missing: listed(uuid),
    epoch: z.number().int().nullable(),
    inGroup: z.boolean(),
    roster: listed(uuid),
    entitled: listed(deviceShape),
    /**
     * Every device this one may meet — in the group, entitled to be, or the
     * sender of something in `log` — with the key its credential and payloads
     * must carry. A device the directory does not vouch for is never accepted.
     */
    directory: listed(deviceShape),
    log: listed(row({ seq: z.number().int(), epoch: z.number().int(), kind: z.enum(["commit", "welcome", "application", "control"]), senderDeviceId: uuid.nullable(), keyPackageId: uuid.nullable(), messageId: uuid.nullable(), callId: uuid.nullable(), frankTag: z.string().nullable(), payload: z.string() })),
    more: z.boolean(),
    /** One-time key packages this device still has published. */
    unclaimed: z.number().int(),
    /**
     * C12.24: calls going on here. `needsKey` is true when a device in the
     * group joined after the call's key was last sent, so whoever holds it
     * should send it again.
     */
    calls: listed(row({ callId: uuid, needsKey: z.boolean() })),
  }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await participant(ctx, input.conversationId, me.userId);
    await myDevice(ctx, me.userId, input.deviceId);
    const [group] = await ctx.tx.select().from(memberMlsGroups).where(eq(memberMlsGroups.conversationId, input.conversationId));
    const roster = await rosterOf(ctx, input.conversationId);
    const mine = roster.find((r) => r.deviceId === input.deviceId);
    const { devices, missing } = await entitledDevices(ctx, input.conversationId);
    const entries = await ctx.tx
      .select({ entry: memberMlsLog, frankTag: memberMessages.frankTag })
      .from(memberMlsLog)
      .leftJoin(memberMessages, eq(memberMessages.id, memberMlsLog.messageId))
      .where(
        and(
          eq(memberMlsLog.conversationId, input.conversationId),
          gt(memberMlsLog.seq, input.after),
          or(
            and(eq(memberMlsLog.kind, "welcome"), eq(memberMlsLog.targetDeviceId, input.deviceId)),
            mine ? and(ne(memberMlsLog.kind, "welcome"), gt(memberMlsLog.seq, mine.joinedSeq)) : sql`false`,
          ),
        ),
      )
      .orderBy(asc(memberMlsLog.seq))
      .limit(LOG_PAGE + 1);
    const page = entries.slice(0, LOG_PAGE);
    const known = new Set(devices.map((d) => d.id));
    const others = [...new Set([...roster.map((r) => r.deviceId), ...page.map((e) => e.entry.senderDeviceId).filter((id): id is string => Boolean(id))])].filter((id) => !known.has(id));
    const extra = others.length ? await ctx.tx.select().from(memberDevices).where(inArray(memberDevices.id, others)) : [];
    const shape = (d: typeof memberDevices.$inferSelect) => ({ deviceId: d.id, userId: d.userId, signatureKey: d.signatureKey });
    const [{ unclaimed } = { unclaimed: 0 }] = await ctx.tx
      .select({ unclaimed: sql<number>`count(*)::int` })
      .from(memberKeyPackages)
      .where(and(eq(memberKeyPackages.deviceId, input.deviceId), isNull(memberKeyPackages.claimedAt), eq(memberKeyPackages.lastResort, false)));
    return {
      available: missing.length === 0,
      missing,
      epoch: group?.epoch ?? null,
      inGroup: Boolean(mine),
      roster: roster.map((r) => r.deviceId),
      entitled: devices.map(shape),
      directory: [...devices, ...extra].map(shape),
      log: page.map(({ entry: e, frankTag }) => ({ seq: e.seq, epoch: e.epoch, kind: e.kind, senderDeviceId: e.senderDeviceId, keyPackageId: e.keyPackageId, messageId: e.messageId, callId: e.callId, frankTag, payload: e.payload })),
      more: entries.length > LOG_PAGE,
      unclaimed,
      calls: await callsNeedingKeys(ctx, input.conversationId, roster),
    };
  },
});

async function callsNeedingKeys(ctx: ServiceContext, conversationId: string, roster: { deviceId: string; joinedSeq: number }[]) {
  const calls = await ctx.tx.select({ id: memberGroupCalls.id }).from(memberGroupCalls).where(and(eq(memberGroupCalls.conversationId, conversationId), eq(memberGroupCalls.state, "active")));
  const result = [];
  for (const call of calls) {
    const [last] = await ctx.tx
      .select({ seq: sql<number>`max(${memberMlsLog.seq})::int` })
      .from(memberMlsLog)
      .where(and(eq(memberMlsLog.conversationId, conversationId), eq(memberMlsLog.kind, "control"), eq(memberMlsLog.callId, call.id)));
    const keySeq = last?.seq ?? 0;
    result.push({ callId: call.id, needsKey: keySeq === 0 || roster.some((r) => r.joinedSeq > keySeq) });
  }
  return result;
}

export const claimKeyPackages = defineService({
  name: "members.claimKeyPackages",
  summary: "Take one key package for each device you are about to add to an encrypted conversation.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ conversationId: uuid, deviceId: uuid, devices: z.array(uuid).min(1).max(200) }),
  output: z.object({ packages: listed(row({ deviceId: uuid, keyPackageId: uuid, keyPackage: z.string() })) }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await participant(ctx, input.conversationId, me.userId);
    await myDevice(ctx, me.userId, input.deviceId);
    const { devices } = await entitledDevices(ctx, input.conversationId);
    const allowed = new Set(devices.map((d) => d.id));
    const packages = [];
    for (const deviceId of new Set(input.devices)) {
      if (!allowed.has(deviceId) || deviceId === input.deviceId) throw new ServiceError("validation", "That device is not in this conversation.");
      const [oneTime] = await ctx.tx
        .select()
        .from(memberKeyPackages)
        .where(and(eq(memberKeyPackages.deviceId, deviceId), isNull(memberKeyPackages.claimedAt), eq(memberKeyPackages.lastResort, false)))
        .orderBy(asc(memberKeyPackages.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      const [chosen] = oneTime
        ? [oneTime]
        : await ctx.tx.select().from(memberKeyPackages).where(and(eq(memberKeyPackages.deviceId, deviceId), eq(memberKeyPackages.lastResort, true))).limit(1);
      if (!chosen) throw new ServiceError("not_found", "One of those devices has no key packages left.");
      await ctx.tx.update(memberKeyPackages).set({ claimedAt: new Date(), claimedBy: input.deviceId }).where(eq(memberKeyPackages.id, chosen.id));
      packages.push({ deviceId, keyPackageId: chosen.id, keyPackage: chosen.keyPackage });
    }
    return { packages };
  },
});

export const e2eeCommit = defineService({
  name: "members.e2eeCommit",
  summary: "Create a conversation's encrypted group, or change who is in it, from one of your devices.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    conversationId: uuid,
    deviceId: uuid,
    /** True when this device just created the group; `fromEpoch` is then 0. */
    create: z.boolean().default(false),
    fromEpoch: z.number().int().min(0),
    commit: base64,
    welcome: base64.optional(),
    added: z.array(z.object({ deviceId: uuid, keyPackageId: uuid })).max(200).default([]),
    removed: z.array(uuid).max(200).default([]),
  }),
  output: z.object({ epoch: z.number().int() }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    await participant(ctx, input.conversationId, me.userId);
    await myDevice(ctx, me.userId, input.deviceId);
    // Serialise every change to this conversation's group.
    await ctx.tx.select({ id: memberConversations.id }).from(memberConversations).where(eq(memberConversations.id, input.conversationId)).for("update");
    const [group] = await ctx.tx.select().from(memberMlsGroups).where(eq(memberMlsGroups.conversationId, input.conversationId));
    const { devices, missing } = await entitledDevices(ctx, input.conversationId);
    const entitled = new Set(devices.map((d) => d.id));
    const roster = new Set((await rosterOf(ctx, input.conversationId)).map((r) => r.deviceId));
    if (input.create) {
      if (group) throw membershipChanged();
      if (missing.length) throw new ServiceError("validation", "Everyone needs a device before this conversation can be encrypted.");
      if (input.fromEpoch !== 0 || input.removed.length) throw new ServiceError("validation", "A new group starts at epoch 0 and removes no one.");
    } else {
      if (!group || group.epoch !== input.fromEpoch) throw membershipChanged();
      if (!roster.has(input.deviceId)) throw new ServiceError("permission", "This device is not in the conversation's group yet.");
    }
    if (input.added.length + input.removed.length === 0) throw new ServiceError("validation", "A commit must add or remove a device.");
    if (input.added.length && !input.welcome) throw new ServiceError("validation", "Adding a device needs a welcome.");
    for (const a of input.added) {
      if (!entitled.has(a.deviceId) || roster.has(a.deviceId) || a.deviceId === input.deviceId) throw membershipChanged();
      const [claimed] = await ctx.tx
        .select({ id: memberKeyPackages.id })
        .from(memberKeyPackages)
        .where(and(eq(memberKeyPackages.id, a.keyPackageId), eq(memberKeyPackages.deviceId, a.deviceId), eq(memberKeyPackages.claimedBy, input.deviceId)));
      if (!claimed) throw new ServiceError("validation", "Claim a key package for each device you add.");
    }
    // Only devices that should no longer read may be removed: revoked ones and
    // those of people who left. Nobody can push someone else's device out.
    for (const id of input.removed) if (!roster.has(id) || entitled.has(id)) throw membershipChanged();

    const epoch = input.fromEpoch + 1;
    if (input.create) {
      await ctx.tx.insert(memberMlsGroups).values({ conversationId: input.conversationId, epoch });
      await ctx.tx.insert(memberMlsRoster).values({ conversationId: input.conversationId, deviceId: input.deviceId, joinedSeq: 0 });
    } else {
      await ctx.tx.insert(memberMlsLog).values({ conversationId: input.conversationId, epoch: input.fromEpoch, kind: "commit", senderDeviceId: input.deviceId, payload: input.commit });
      await ctx.tx.update(memberMlsGroups).set({ epoch, updatedAt: new Date() }).where(eq(memberMlsGroups.conversationId, input.conversationId));
    }
    for (const a of input.added) {
      const [welcome] = await ctx.tx
        .insert(memberMlsLog)
        .values({ conversationId: input.conversationId, epoch, kind: "welcome", senderDeviceId: input.deviceId, targetDeviceId: a.deviceId, keyPackageId: a.keyPackageId, payload: input.welcome! })
        .returning({ seq: memberMlsLog.seq });
      await ctx.tx.insert(memberMlsRoster).values({ conversationId: input.conversationId, deviceId: a.deviceId, joinedSeq: welcome!.seq });
    }
    if (input.removed.length) {
      await ctx.tx.delete(memberMlsRoster).where(and(eq(memberMlsRoster.conversationId, input.conversationId), inArray(memberMlsRoster.deviceId, input.removed)));
    }
    await ctx.tx.update(memberDevices).set({ lastSeenAt: new Date() }).where(eq(memberDevices.id, input.deviceId));
    return { epoch };
  },
});

export const sendEncrypted = defineService({
  name: "members.sendEncrypted",
  summary: "Send an end-to-end encrypted message from one of your devices. The server stores the ciphertext and a franking tag.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  rateLimit: { limit: 600, windowSeconds: 3600, message: "You are sending messages very quickly. Please slow down.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({
    conversationId: uuid,
    deviceId: uuid,
    epoch: z.number().int().min(1),
    ciphertext: base64.max(120_000),
    frankTag: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
    attachments: attachmentInput,
  }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const part = await participant(ctx, input.conversationId, me.userId);
    if (part.state === "requested") throw new ServiceError("permission", "Accept this request before replying.");
    await myDevice(ctx, me.userId, input.deviceId);
    const [conversation] = await ctx.tx.select().from(memberConversations).where(eq(memberConversations.id, input.conversationId)).for("update");
    if (conversation!.kind === "direct" && (await directBlocked(ctx, input.conversationId, me.userId))) {
      throw new ServiceError("permission", "You can no longer message this person.");
    }
    const [group] = await ctx.tx.select().from(memberMlsGroups).where(eq(memberMlsGroups.conversationId, input.conversationId));
    if (!group || group.epoch !== input.epoch) throw membershipChanged();
    const roster = new Set((await rosterOf(ctx, input.conversationId)).map((r) => r.deviceId));
    const { devices } = await entitledDevices(ctx, input.conversationId);
    if (!roster.has(input.deviceId) || roster.size !== devices.length || devices.some((d) => !roster.has(d.id))) throw membershipChanged();
    const id = await send(ctx, input.conversationId, me.userId, "", input.attachments, { frankTag: input.frankTag });
    await ctx.tx.insert(memberMlsLog).values({ conversationId: input.conversationId, epoch: input.epoch, kind: "application", senderDeviceId: input.deviceId, messageId: id, payload: input.ciphertext });
    await ctx.tx.update(memberDevices).set({ lastSeenAt: new Date() }).where(eq(memberDevices.id, input.deviceId));
    return { id };
  },
});

export const sendCallKey = defineService({
  name: "members.sendCallKey",
  summary: "Send a group call's media key, encrypted, to every device in the conversation's group.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ conversationId: uuid, deviceId: uuid, epoch: z.number().int().min(1), callId: uuid, ciphertext: base64.max(20_000) }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const seat = await participant(ctx, input.conversationId, me.userId);
    if (seat.state !== "active") throw new ServiceError("permission", "Accept this conversation before joining its calls.");
    await myDevice(ctx, me.userId, input.deviceId);
    await ctx.tx.select({ id: memberConversations.id }).from(memberConversations).where(eq(memberConversations.id, input.conversationId)).for("update");
    const [call] = await ctx.tx.select().from(memberGroupCalls).where(and(eq(memberGroupCalls.id, input.callId), eq(memberGroupCalls.conversationId, input.conversationId), eq(memberGroupCalls.state, "active")));
    if (!call) throw new ServiceError("not_found", "That call has ended.");
    const [group] = await ctx.tx.select().from(memberMlsGroups).where(eq(memberMlsGroups.conversationId, input.conversationId));
    if (!group || group.epoch !== input.epoch) throw membershipChanged();
    // The same rule as messages: the key reaches exactly the devices that should have it.
    const roster = new Set((await rosterOf(ctx, input.conversationId)).map((r) => r.deviceId));
    const { devices } = await entitledDevices(ctx, input.conversationId);
    if (!roster.has(input.deviceId) || roster.size !== devices.length || devices.some((d) => !roster.has(d.id))) throw membershipChanged();
    await ctx.tx.insert(memberMlsLog).values({ conversationId: input.conversationId, epoch: input.epoch, kind: "control", senderDeviceId: input.deviceId, callId: input.callId, payload: input.ciphertext });
    return { ok: true as const };
  },
});

export default [registerDevice, publishKeyPackages, myDevices, revokeDevice, e2eeSync, claimKeyPackages, e2eeCommit, sendEncrypted, sendCallKey];
