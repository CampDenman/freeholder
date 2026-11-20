// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: separately authenticated original admissions and actual fact occurrences.
import { createHmac, timingSafeEqual } from "node:crypto";
import { merchantTaxDigest } from "./merchant-tax-store";
export const ORIGINAL_CASH_RETURN_CONFIRMATION = "RETURN ONLY THIS ORIGINAL CASH";
export const ORIGINAL_CASH_STOP_CONFIRMATION = "THE ORIGINAL CASH CALLER HAS STOPPED";
export const cashNamespaceKey = (cash: { providerPlatformAccountId: string; chargeAccountId: string | null; providerRef: string }) => merchantTaxDigest({ platform: cash.providerPlatformAccountId, account: cash.chargeAccountId, intent: cash.providerRef });
type Signed = { id: string; digest: string; authentication: string; createdAt: Date };
function mac(kind: string, row: Omit<Signed, "authentication">, key: string) {
  return createHmac("sha256", createHmac("sha256", key).update("freeholder/original-cash-recovery/signing-key/v1").digest())
    .update(`${kind}\0${merchantTaxDigest({ id: row.id, digest: row.digest, retainedAt: row.createdAt.toISOString() })}`).digest();
}
export function signOriginalCashRecovery(kind: string, row: Omit<Signed, "authentication">, key: string) {
  if (!key) throw Error("Restore the original financial evidence key before retaining cash-return facts.");
  return mac(kind, row, key).toString("hex");
}
export function verifyOriginalCashRecovery(kind: string, row: Signed, body: unknown, keys: readonly string[]) {
  if (!/^[a-f0-9]{64}$/.test(row.authentication) || !Number.isFinite(row.createdAt.getTime()) || merchantTaxDigest(body) !== row.digest) return false;
  return keys.filter(Boolean).some(key => timingSafeEqual(Buffer.from(row.authentication, "hex"), mac(kind, row, key)));
}
export function remainingOriginalCashAuxiliary(original: number | null, returned: number | null) {
  if (original === null || returned === null || !Number.isSafeInteger(original) || !Number.isSafeInteger(returned) || original < 0 || returned < 0 || returned > original) return null;
  return Number(BigInt(original) - BigInt(returned));
}
export function exactCashResourceRefs(facts: readonly { kind: string; evidence: Record<string, unknown> }[]) {
  const refs = [...new Set(facts.filter(fact => fact.kind === "ack").map(fact => fact.evidence.providerRef))];
  return refs.every(ref => typeof ref === "string") ? refs : null;
}
