// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual legacy refund lineage, never an invented merchant request.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
export const LEGACY_REPLACEMENT_PROTOCOL = "freeholder.legacy-bank-replacement.v1";
export const LEGACY_REPLACEMENT_REASON = "Original legacy bank refund replacement authorized";
export const LEGACY_REPLACEMENT_STATE = "legacy_bank_replacement_authorized";
export const LEGACY_REPLACEMENT_CONFIRMATION = "REPLACE ORIGINAL LEGACY RETURNED REFUND";
export const legacyReplacementKey = (parentId: string) => `legacy-bank-replacement:v1:${parentId}`;
export const legacyReplacementReason = (parentId: string) => `Replace original legacy bank-returned refund ${parentId}`;
const uuid = z.uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const legacyReplacementBody = z.object({
  protocol: z.literal(LEGACY_REPLACEMENT_PROTOCOL), evidenceId: uuid, rootRefundId: uuid, rootOriginalDigest: digest,
  parentRefundId: uuid, parentOriginalDigest: digest, replacementRefundId: uuid, replacementRequestHash: digest,
  paymentId: uuid, invoiceId: uuid, originalPaymentRef: z.string().regex(/^pi_[A-Za-z0-9_]+$/), originalChargeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable(),
  originalCreatePlatformAccountId: z.null(), originalCreateProtocolVersion: z.null(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/),
  terminalReads: z.array(z.object({ refundId: uuid, receiptId: uuid, resolvedRevision: digest }).strict()).min(1).max(5000),
  authorizedBy: z.string().regex(/^user:[0-9a-f-]{36}$/), authorizedAt: z.iso.datetime(),
}).strict();
export type LegacyReplacementBody = z.infer<typeof legacyReplacementBody>;
const signed = legacyReplacementBody.extend({ authentication: digest }).strict();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function authentication(body: LegacyReplacementBody, key: string) {
  const purpose = createHmac("sha256", key).update("freeholder/legacy-bank-replacement/signing-key/v1").digest();
  return createHmac("sha256", purpose).update(`${LEGACY_REPLACEMENT_PROTOCOL}\0${canonical(body)}`).digest();
}
export function signLegacyReplacement(value: LegacyReplacementBody, key: string) {
  const body = legacyReplacementBody.parse(value);
  if (!key) throw Error("Restore the original legacy replacement evidence key before authorizing money.");
  return { ...body, authentication: authentication(body, key).toString("hex") };
}
export function verifyLegacyReplacement(row: { id: string; subjectType: string; subjectId: string; fromState: string | null; toState: string; reason: string | null; actor: string; occurredAt: Date; metadata: unknown }, keys: readonly string[]): LegacyReplacementBody | null {
  const parsed = signed.safeParse(row.metadata); if (!parsed.success) return null;
  const { authentication: signature, ...body } = parsed.data;
  if (row.id !== body.evidenceId || row.subjectType !== "refund" || row.subjectId !== body.parentRefundId || row.fromState !== null
    || row.toState !== LEGACY_REPLACEMENT_STATE || row.reason !== LEGACY_REPLACEMENT_REASON || row.actor !== body.authorizedBy
    || !Number.isFinite(row.occurredAt.getTime()) || row.occurredAt.toISOString() !== body.authorizedAt) return null;
  return keys.filter(Boolean).some(key => timingSafeEqual(Buffer.from(signature, "hex"), authentication(body, key))) ? body : null;
}
