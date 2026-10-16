// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.36 (MASTER.md §44.6): files in end-to-end encrypted conversations.
//
// The sender's device encrypts each file with a fresh AES-256-GCM key and
// uploads only ciphertext; the key, nonce, name and type travel inside the
// MLS message. The server stores bytes it cannot open — so, unlike C12.21
// attachments, it cannot scan, resize or hash-match them; that is the price
// of end-to-end encryption, and it is stated in the plan. A file is served
// only to people still in its conversation, only once it is attached to a
// message that has not been removed.
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listed, okResult, row, uuid } from "@/core/contract";
import { defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { storage } from "@/adapters/storage";
import { activeSelf, participant } from "./messages";
import { memberMessages, memberMlsGroups, memberSealedBlobs } from "./schema";

export const MAX_SEALED_BYTES = 25 * 1024 * 1024;
const MAX_PENDING = 20;
const ABANDONED_MS = 24 * 3600 * 1000;

export const claimSealedBlob = defineService({
  name: "members.claimSealedBlob",
  summary: "Reserve a place for one encrypted file in an end-to-end encrypted conversation.",
  kind: "mutation",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  writeClass: "write",
  input: z.object({ conversationId: uuid, size: z.number().int().min(1).max(MAX_SEALED_BYTES) }),
  output: z.object({ id: uuid, storageKey: z.string() }),
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const seat = await participant(ctx, input.conversationId, me.userId);
    if (seat.state !== "active") throw new ServiceError("permission", "Accept this conversation before sending files.");
    const [group] = await ctx.tx.select().from(memberMlsGroups).where(eq(memberMlsGroups.conversationId, input.conversationId));
    if (!group) throw new ServiceError("validation", "Encrypted files need an end-to-end encrypted conversation.");
    const [{ pending } = { pending: 0 }] = await ctx.tx
      .select({ pending: sql<number>`count(*)::int` })
      .from(memberSealedBlobs)
      .where(and(eq(memberSealedBlobs.ownerId, me.userId), isNull(memberSealedBlobs.messageId), isNull(memberSealedBlobs.deletedAt)));
    if (pending >= MAX_PENDING) throw new ServiceError("validation", "Send or discard the files you already added first.");
    const id = randomUUID();
    const storageKey = `member-sealed/${input.conversationId}/${id}`;
    await ctx.tx.insert(memberSealedBlobs).values({ id, ownerId: me.userId, conversationId: input.conversationId, storageKey, size: input.size });
    return { id, storageKey };
  },
});

export const confirmSealedBlob = defineService({
  name: "members.confirmSealedBlob",
  summary: "Mark an encrypted file as stored.",
  kind: "mutation",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = await activeSelf(ctx);
    const [done] = await ctx.tx
      .update(memberSealedBlobs)
      .set({ state: "ready" })
      .where(and(eq(memberSealedBlobs.id, input.id), eq(memberSealedBlobs.ownerId, me.userId), eq(memberSealedBlobs.state, "pending")))
      .returning({ id: memberSealedBlobs.id });
    if (!done) throw new ServiceError("not_found", "That file is not available.");
    return { ok: true as const };
  },
});

/** Claim, store the ciphertext outside any transaction, then confirm. */
export const uploadSealedBlob = defineOrchestratedService({
  name: "members.uploadSealedBlob",
  summary: "Store one file your device encrypted for an end-to-end encrypted conversation.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  rateLimit: { limit: 200, windowSeconds: 3600, message: "You are sending files very quickly. Please slow down.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({ conversationId: uuid, bytes: z.instanceof(Uint8Array) }),
  output: z.object({ id: uuid }),
  handler: async (input, actor) => {
    if (input.bytes.length === 0 || input.bytes.length > MAX_SEALED_BYTES) throw new ServiceError("validation", "That file is empty or too large.");
    const claimed = await claimSealedBlob.call({ conversationId: input.conversationId, size: input.bytes.length }, actor);
    await storage().put(claimed.storageKey, new Uint8Array(input.bytes), "application/octet-stream");
    await confirmSealedBlob.call({ id: claimed.id }, actor);
    return { id: claimed.id };
  },
});

/** Attach the sender's own stored files to the message they just sent. */
export async function attachSealedBlobs(ctx: ServiceContext, ownerId: string, conversationId: string, messageId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const attached = await ctx.tx
    .update(memberSealedBlobs)
    .set({ messageId })
    .where(
      and(
        inArray(memberSealedBlobs.id, ids),
        eq(memberSealedBlobs.ownerId, ownerId),
        eq(memberSealedBlobs.conversationId, conversationId),
        eq(memberSealedBlobs.state, "ready"),
        isNull(memberSealedBlobs.messageId),
        isNull(memberSealedBlobs.deletedAt),
      ),
    )
    .returning({ id: memberSealedBlobs.id });
  if (attached.length !== new Set(ids).size) throw new ServiceError("validation", "Only your own uploaded files, each sent once, can be attached.");
}

export const sealedBlobAccess = defineService({
  name: "members.sealedBlobAccess",
  summary: "Where an encrypted file is stored, if you may fetch it now.",
  kind: "query",
  permission: "authenticated",
  external: false,
  input: z.object({ id: uuid }),
  output: z.object({ storageKey: z.string() }).nullable(),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") return null;
    const me = ctx.actor.userId;
    const [blob] = await ctx.tx
      .select({ storageKey: memberSealedBlobs.storageKey, conversationId: memberSealedBlobs.conversationId, removed: memberMessages.deletedAt })
      .from(memberSealedBlobs)
      .innerJoin(memberMessages, eq(memberMessages.id, memberSealedBlobs.messageId))
      .where(and(eq(memberSealedBlobs.id, input.id), eq(memberSealedBlobs.state, "ready"), isNull(memberSealedBlobs.deletedAt)));
    if (!blob || blob.removed) return null;
    try {
      await participant(ctx, blob.conversationId, me);
    } catch {
      return null;
    }
    return { storageKey: blob.storageKey };
  },
});

export const dueSealedBlobs = defineService({
  name: "members.dueSealedBlobs",
  summary: "Encrypted files to delete: removed, or uploaded and never sent.",
  kind: "query",
  permission: "system",
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  output: z.object({ blobs: listed(row({ id: uuid, storageKey: z.string() })) }),
  handler: async (input, ctx) => {
    const blobs = await ctx.tx
      .select({ id: memberSealedBlobs.id, storageKey: memberSealedBlobs.storageKey })
      .from(memberSealedBlobs)
      .where(or(isNotNull(memberSealedBlobs.deletedAt), and(isNull(memberSealedBlobs.messageId), lt(memberSealedBlobs.createdAt, new Date(Date.now() - ABANDONED_MS)))))
      .limit(input.limit);
    return { blobs };
  },
});

export const forgetSealedBlobs = defineService({
  name: "members.forgetSealedBlobs",
  summary: "Drop the records of encrypted files whose bytes are gone.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({ ids: z.array(uuid).max(500) }),
  output: okResult,
  handler: async (input, ctx) => {
    if (input.ids.length) await ctx.tx.delete(memberSealedBlobs).where(inArray(memberSealedBlobs.id, input.ids));
    return { ok: true as const };
  },
});

/** The purge job: storage deletes happen between two short transactions. */
export async function purgeSealedBlobs(): Promise<{ purged: number }> {
  const { blobs } = await dueSealedBlobs.call({ limit: 100 }, { kind: "system" });
  const gone: string[] = [];
  for (const blob of blobs) {
    try {
      await storage().delete(blob.storageKey);
      gone.push(blob.id);
    } catch {
      // Tried again on the next run.
    }
  }
  await forgetSealedBlobs.call({ ids: gone }, { kind: "system" });
  return { purged: gone.length };
}

export default [claimSealedBlob, confirmSealedBlob, uploadSealedBlob, sealedBlobAccess, dueSealedBlobs, forgetSealedBlobs];
