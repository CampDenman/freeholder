// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.32: one instance's entire storage namespace, including derived objects.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, isUniqueViolation } from "@/core/db";
import { StorageQuotaError, type StorageQuotaLedger } from "@/adapters/storage/quota";

export function storageNamespace(identity: { id: string; endpoint?: string; bucket?: string; root?: string }): string {
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function storageInventorySha256(inventory: readonly { key: string; bytes: number }[]): string {
  return createHash("sha256").update(JSON.stringify([...inventory].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0))).digest("hex");
}

export function postgresStorageQuota(namespace: string, maxBytes: number): StorageQuotaLedger {
  if (!/^[a-f0-9]{64}$/.test(namespace) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new StorageQuotaError("storage_quota_invalid_config");
  }
  return {
    async reserve(key, bytes, token) {
      await db().transaction(async tx => {
        await (await import("./transfer-requests")).bindOriginalMediaQuotaReservation(tx,{namespace,key,bytes,token});
        // The one namespace row serializes reservations across processes. No
        // provider call occurs while this row lock or transaction is open.
        const state = await tx.execute<{ max_bytes: string }>(sql`SELECT max_bytes::text FROM storage_quota_state WHERE namespace=${namespace} FOR UPDATE`);
        if (!state[0] || Number(state[0].max_bytes) !== maxBytes) throw new StorageQuotaError("storage_quota_inventory_required");
        const object = await tx.execute<{ bytes: string; pending_token: string | null }>(sql`SELECT bytes::text,pending_token FROM storage_quota_objects WHERE namespace=${namespace} AND object_key=${key}`);
        if (object[0]?.pending_token) throw new StorageQuotaError("storage_quota_object_unresolved");
        const before = Number(object[0]?.bytes ?? 0), held = Math.max(before, bytes);
        const usage = await tx.execute<{ used: string }>(sql`SELECT coalesce(sum(bytes),0)::text AS used FROM storage_quota_objects WHERE namespace=${namespace}`);
        if (BigInt(usage[0]!.used) - BigInt(before) + BigInt(held) > BigInt(maxBytes)) throw new StorageQuotaError("storage_quota_exceeded");
        await tx.execute(sql`INSERT INTO storage_quota_objects(namespace,object_key,bytes,pending_token) VALUES(${namespace},${key},${held},${token}) ON CONFLICT(namespace,object_key) DO UPDATE SET bytes=excluded.bytes,pending_token=excluded.pending_token`);
      });
    },
    async settle(key, bytes, token) {
      await db().transaction(async tx => {
        // Same lock order as reserve; token binds the single accepted operation.
        await tx.execute(sql`SELECT namespace FROM storage_quota_state WHERE namespace=${namespace} FOR UPDATE`);
        const changed = await tx.execute(sql`UPDATE storage_quota_objects SET bytes=${bytes},pending_token=NULL WHERE namespace=${namespace} AND object_key=${key} AND pending_token=${token} AND bytes>=${bytes} RETURNING object_key`);
        if (changed.length !== 1) throw new StorageQuotaError("storage_quota_operation_changed");
      });
    },
  };
}

/** Operator-only initialization after a complete provider inventory has been
 * checked (including orphan/derived/staging keys) and all other writers stopped.
 * No API/MCP endpoint, auto-empty initialization or rebasing an existing ledger.
 */
export async function initializeStorageQuota(namespace: string, maxBytes: number, inventory: readonly { key: string; bytes: number }[], inventorySha256: string): Promise<void> {
  postgresStorageQuota(namespace, maxBytes); // exact config validation
  if (!/^[a-f0-9]{64}$/.test(inventorySha256) || inventorySha256 !== storageInventorySha256(inventory)) throw new StorageQuotaError("storage_quota_inventory_required");
  const keys = new Set<string>(); let used = 0n;
  for (const object of inventory) {
    if (!object.key || object.key.length > 2048 || object.key.includes("\0") || keys.has(object.key) || !Number.isSafeInteger(object.bytes) || object.bytes < 0) throw new StorageQuotaError("storage_quota_invalid_inventory");
    keys.add(object.key); used += BigInt(object.bytes);
  }
  if (used > BigInt(maxBytes)) throw new StorageQuotaError("storage_quota_exceeded");
  await db().transaction(async tx => {
    await tx.execute(sql`INSERT INTO storage_quota_state(namespace,max_bytes,inventory_sha256) VALUES(${namespace},${maxBytes},${inventorySha256})`);
    for (const object of inventory) await tx.execute(sql`INSERT INTO storage_quota_objects(namespace,object_key,bytes) VALUES(${namespace},${object.key},${object.bytes})`);
  });
}

/** Optional one-time initialization for an explicitly designated fresh bucket.
 * The verifier does provider I/O before the initialization transaction. If two
 * new processes race, only the unique namespace row wins; neither resets it.
 */
export function withVerifiedEmptyInitialization(namespace: string, maxBytes: number, verify: () => Promise<void>): StorageQuotaLedger {
  const ledger = postgresStorageQuota(namespace, maxBytes); let ready: Promise<void> | undefined;
  async function prepare() {
    const state = await db().execute<{ max_bytes: string }>(sql`SELECT max_bytes::text FROM storage_quota_state WHERE namespace=${namespace}`);
    if (state[0]) {
      if (Number(state[0].max_bytes) !== maxBytes) throw new StorageQuotaError("storage_quota_inventory_required");
      return;
    }
    await verify();
    try { await initializeStorageQuota(namespace, maxBytes, [], storageInventorySha256([])); }
    catch (error) {
      if (!isUniqueViolation(error, "storage_quota_state_pkey")) throw error;
      const current = await db().execute<{ max_bytes: string }>(sql`SELECT max_bytes::text FROM storage_quota_state WHERE namespace=${namespace}`);
      if (!current[0] || Number(current[0].max_bytes) !== maxBytes) throw new StorageQuotaError("storage_quota_inventory_required");
    }
  }
  return {
    async reserve(key, bytes, token) {
      ready ??= prepare();
      try { await ready; } catch (error) { ready = undefined; throw error; }
      await ledger.reserve(key,bytes,token);
    },
    settle: (key,bytes,token) => ledger.settle(key,bytes,token),
  };
}
