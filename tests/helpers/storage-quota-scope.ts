// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { actorString } from "@/core/service";
import { lockContactIdentityForPhysicalWrite } from "@/core/contacts/identity-lock";
import { actualStorageCallerRuntimeIdentity, mediaWriterRuntimeId } from "@/core/media/physical-caller-runtime";
import { admitOriginalMediaCaller } from "@/core/media/provider-callers";
import { mediaObjects } from "@/core/media/schema";
import { mediaStorageTransferCalls } from "@/core/media/transfer-schema";
import { allowMediaReceiptWrites, objectKeyDigest } from "@/core/media/write-ledger";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { withTransferRequestScope } from "@/core/media/transfer-requests";
import { OWNER } from "./spine";

const local = new AsyncLocalStorage<{ namespace: string; key: string; bytes: number }>();
const callers = new Map<string, { callId: string; token: string; runtimeIdentity: Awaited<ReturnType<typeof actualStorageCallerRuntimeIdentity>> }>();
const storageLocations = new Map<string, { endpoint: string; bucket: string }>();
export function resetQuotaCallers(): void { callers.clear(); }
export function registerQuotaStorage(namespace: string, location: { endpoint: string; bucket: string }): void { storageLocations.set(namespace, location); }
export function quotaStorageLocation(namespace: string): { endpoint: string; bucket: string } {
  const location = storageLocations.get(namespace);
  if (!location) throw new Error("The quota fixture needs its synthetic storage location.");
  return location;
}

/** Run a quota operation with a real started media intent and original caller.
 * No accepted provider result is asserted by this fixture. */
export async function withQuotaCaller<T>(input: { namespace: string; key: string; bytes: number; sha256?: string }, operation: () => Promise<T>): Promise<T> {
  const current = local.getStore();
  if (current && current.namespace === input.namespace && current.key === input.key && current.bytes === input.bytes) return operation();
  const cacheKey = JSON.stringify(input);
  const existing = callers.get(cacheKey);
  if (existing) {
    const [admitted] = await db().select({ quotaToken: mediaStorageTransferCalls.quotaToken }).from(mediaStorageTransferCalls).where(eq(mediaStorageTransferCalls.id, existing.callId));
    if (!admitted) throw new Error("The original quota caller is missing.");
    if (!admitted.quotaToken) return withTransferRequestScope({ ...existing, actor: OWNER }, () => local.run(input, operation));
  }
  const token = randomUUID() + randomUUID();
  const runtimeIdentity = await actualStorageCallerRuntimeIdentity();
  const caller = await db().transaction(async tx => {
    await lockContactIdentityForPhysicalWrite(tx);
    await allowMediaReceiptWrites(tx);
    const [pointer] = await tx.insert(mediaObjects).values({
      key: input.key, role: "original", state: "pending", bytes: input.bytes, contentType: "text/plain",
    }).onConflictDoUpdate({ target: mediaObjects.key, set: { role: "original", bytes: input.bytes, contentType: "text/plain", updatedAt: new Date() } }).returning();
    const receiptId = randomUUID();
    await tx.insert(mediaObjectWrites).values({
      id: receiptId,
      originalReservationId: pointer!.reservationId,
      operation: "put",
      key: input.key,
      keyDigest: objectKeyDigest(input.key),
      namespace: input.namespace,
      storageKind: "s3",
      storageLocation: quotaStorageLocation(input.namespace),
      sha256: input.sha256 ?? createHash("sha256").update(new Uint8Array(input.bytes)).digest("hex"),
      bytes: input.bytes,
      contentType: "text/plain",
      actor: actorString(OWNER),
      state: "started",
      writerRuntimeId: mediaWriterRuntimeId,
      writerProtocol: "single-put-v1",
    });
    return admitOriginalMediaCaller(tx, { kind: "ordinary_put", objectReceiptId: receiptId, token, runtimeIdentity }, OWNER);
  });
  callers.set(cacheKey, { callId: caller.id, token, runtimeIdentity });
  return withTransferRequestScope({ callId: caller.id, token, runtimeIdentity, actor: OWNER }, () => local.run(input, operation));
}
