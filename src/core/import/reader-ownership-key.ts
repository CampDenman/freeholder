// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29: portable keyed source receipts are evidence, never credentials.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { env } from "@/core/env";
import { decryptMailOutbox, encryptMailOutbox } from "@/core/mail/outbox-crypto";
import { ServiceError, type Tx } from "@/core/service";
import { readerOwnershipKeys, readerOwnershipReceipts } from "./reader-ownership-schema";

const CONTEXT = "freeholder:import-reader-ownership-key:v1";
const marked = new WeakSet<object>();
export async function markReaderOwnershipWriter(tx: Tx) {
  if (marked.has(tx)) return;
  await tx.execute(sql`select set_config('freeholder.import_reader_owner_v1', '1', true)`);
  marked.add(tx);
}
function fingerprint() {
  const material = env().CREDENTIAL_KEY ?? env().CREDENTIAL_KEY_PREVIOUS ?? env().SESSION_SECRET;
  if (!material) throw new ServiceError("conflict", "Restore the original private reader-receipt configuration before continuing.");
  return createHash("sha256").update(`${CONTEXT}\0`).update(material).digest("hex");
}
export async function readerOwnershipKey(tx: Tx, options: { readOnly?: boolean } = {}) {
  if (!options.readOnly) await markReaderOwnershipWriter(tx);
  let [stored] = await tx.select().from(readerOwnershipKeys).where(eq(readerOwnershipKeys.id, 1)).limit(1);
  if (!stored) {
    if (options.readOnly) throw new ServiceError("conflict", "The original reader receipt key is unavailable. Restore its matching backup.");
    if ((await tx.select({ id: readerOwnershipReceipts.id }).from(readerOwnershipReceipts).limit(1)).length) throw new ServiceError("conflict", "The original reader receipt key is missing. Restore its matching backup.");
    await tx.insert(readerOwnershipKeys).values({ id: 1, encryptedKey: encryptMailOutbox(randomBytes(32).toString("base64url"), CONTEXT), wrappingFingerprint: fingerprint() }).onConflictDoNothing();
    [stored] = await tx.select().from(readerOwnershipKeys).where(eq(readerOwnershipKeys.id, 1)).limit(1);
  }
  if (!stored) throw new ServiceError("internal", "The source-reader receipt key could not be reserved.");
  let key: Buffer;
  try { key = Buffer.from(decryptMailOutbox(stored.encryptedKey, CONTEXT), "base64url"); }
  catch { throw new ServiceError("conflict", "The original reader receipt key cannot be read. Restore its matching private configuration."); }
  if (key.length !== 32) throw new ServiceError("conflict", "The original reader receipt key is invalid. Restore its matching backup.");
  if (!options.readOnly && stored.wrappingFingerprint !== fingerprint()) await tx.update(readerOwnershipKeys).set({ encryptedKey: encryptMailOutbox(key.toString("base64url"), CONTEXT), wrappingFingerprint: fingerprint() }).where(eq(readerOwnershipKeys.id, 1));
  return { digest(kind: "source" | "address", value: string) { return createHmac("sha256", key).update(`${CONTEXT}\0${kind}\0`).update(value).digest("hex"); } };
}

/** Rotation uses the existing human-only credential service and preserves
 * unreadable ciphertext for recovery instead of replacing a receipt key.
 */
export async function rotateReaderOwnershipKey(tx: Tx) {
  const [stored] = await tx.select().from(readerOwnershipKeys).where(eq(readerOwnershipKeys.id, 1)).limit(1);
  if (!stored) return { examined: 0, rotated: 0, failed: 0 };
  try {
    await readerOwnershipKey(tx);
    return { examined: 1, rotated: stored.wrappingFingerprint === fingerprint() ? 0 : 1, failed: 0 };
  } catch {
    return { examined: 1, rotated: 0, failed: 1 };
  }
}
