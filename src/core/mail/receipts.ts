// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: private, portable keyed receipt identities; never an API authority.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { env } from "@/core/env";
import { ServiceError, type Tx } from "@/core/service";
import { mailReceiptKeys } from "./schema";
import { decryptMailOutbox, encryptMailOutbox } from "./outbox-crypto";

const KEY_CONTEXT = "00000000-0000-4000-8000-000000000071";
const CAPABILITY = "freeholder.mail_receipts_v1";
const SEAL_LOCK = "freeholder-mail-receipt-seal-v1";
export type MailReceiptKind = "address" | "send" | `event:${string}` | `provider:${string}`;
export type MailReceipts = { digest(kind: MailReceiptKind, value: string): string };

function wrappingFingerprint(): string {
  const key = env().CREDENTIAL_KEY ?? env().CREDENTIAL_KEY_PREVIOUS ?? env().SESSION_SECRET;
  if (!key) throw new ServiceError("conflict", "The mail receipt wrapping key is unavailable. Restore the original private configuration.");
  return createHash("sha256").update("freeholder:mail-receipt-wrapping:v1\0").update(key).digest("hex");
}

/** Short transactions only. Provider work must not use this context. */
export async function mailReceipts(tx: Tx): Promise<MailReceipts> {
  await tx.execute(sql`select set_config(${CAPABILITY}, '1', true)`);
  const fingerprint = wrappingFingerprint();
  let [stored] = await tx.select().from(mailReceiptKeys).where(eq(mailReceiptKeys.id, 1)).limit(1);
  if (!stored) {
    const [existing] = await tx.execute<{ present: boolean }>(sql`select exists(
      select 1 from mail_deliveries where recipient_digest is not null or idempotency_digest is not null or provider_ref_digest is not null
      union all select 1 from mail_provider_events where recipient_digest is not null or external_event_digest is not null or provider_ref_digest is not null
      union all select 1 from mail_suppressions where email_digest is not null
    ) as present`);
    if (existing?.present) throw new ServiceError("conflict", "The original mail receipt key is missing. Restore its exact database backup before retrying.");
    await tx.insert(mailReceiptKeys).values({ id: 1, encryptedKey: encryptMailOutbox(randomBytes(32).toString("base64url"), KEY_CONTEXT), wrappingFingerprint: fingerprint }).onConflictDoNothing();
    [stored] = await tx.select().from(mailReceiptKeys).where(eq(mailReceiptKeys.id, 1)).limit(1);
  }
  if (!stored) throw new ServiceError("conflict", "The original mail receipt key is unavailable.");
  let key: Buffer;
  try { key = Buffer.from(decryptMailOutbox(stored.encryptedKey, KEY_CONTEXT), "base64url"); }
  catch { throw new ServiceError("conflict", "The original mail receipt key cannot be read. Restore the matching private configuration or backup."); }
  if (key.length !== 32) throw new ServiceError("conflict", "The original mail receipt key is malformed. Restore its exact backup.");
  if (stored.wrappingFingerprint !== fingerprint) {
    await tx.update(mailReceiptKeys).set({ encryptedKey: encryptMailOutbox(key.toString("base64url"), KEY_CONTEXT), wrappingFingerprint: fingerprint }).where(eq(mailReceiptKeys.id, 1));
  }
  return { digest(kind, value) {
    const text = kind === "address" ? value.trim().toLowerCase() : value;
    return createHmac("sha256", key).update(`freeholder:mail-receipt:v1\0${kind}\0`).update(text).digest("hex");
  } };
}

/** Serialize first redaction against legacy SQL writers before raw keys vanish. */
export async function sealMailReceipts(tx: Tx): Promise<MailReceipts> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${SEAL_LOCK}))`);
  const receipts = await mailReceipts(tx);
  await tx.update(mailReceiptKeys).set({ sealedAt: sql`coalesce(${mailReceiptKeys.sealedAt}, clock_timestamp())` }).where(eq(mailReceiptKeys.id, 1));
  return receipts;
}
