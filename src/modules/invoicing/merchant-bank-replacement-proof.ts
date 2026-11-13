// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Signed causal evidence in the existing journal; not DB append-only storage.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
export const BANK_REPLACEMENT_PROTOCOL = "original-bank-refund-replacement-v1";
export const BANK_REPLACEMENT_REASON = "Original returned bank refund replacement authorized";
export const BANK_REPLACEMENT_STATE = "bank_replacement_authorized";
export const BANK_REPLACEMENT_CONFIRMATION = "REPLACE ORIGINAL RETURNED REFUND";
export const bankReplacementKey = (parentId: string) => `bank-replacement:v1:${parentId}`;
export const bankReplacementReason = (parentId: string) => `Replace original bank-returned refund ${parentId}`;
const uuid = z.uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const bankReplacementBody = z.object({
  protocol: z.literal(BANK_REPLACEMENT_PROTOCOL), evidenceId: uuid,
  rootRequestId: uuid, rootRequestDigest: digest,
  parentRequestId: uuid, parentRequestDigest: digest, parentRefundId: uuid,
  replacementRequestId: uuid, replacementRequestDigest: digest, replacementRefundId: uuid,
  paymentId: uuid, providerPlatformAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  chargeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).nullable(), originalPaymentRef: z.string().regex(/^pi_[A-Za-z0-9_]+$/),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/),
  terminalReads: z.array(z.object({ requestId: uuid, receiptId: uuid, resolvedRevision: digest }).strict()).min(1).max(5000),
  retiredRequestIds: z.array(uuid).max(5000), authorizedBy: z.string().regex(/^user:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i), authorizedAt: z.iso.datetime(),
}).strict();
export type BankReplacementBody = z.infer<typeof bankReplacementBody>;
const signed = bankReplacementBody.extend({ authentication: digest }).strict();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function authentication(body: BankReplacementBody, key: string): Buffer {
  const purposeKey = createHmac("sha256", key).update("freeholder/bank-refund-replacement/signing-key/v1").digest();
  return createHmac("sha256", purposeKey).update(`${BANK_REPLACEMENT_PROTOCOL}\0${canonical(body)}`).digest();
}
/** The production caller selects only its current key or mandatory SESSION
 * fallback. Previous keys are accepted exclusively by the verifier. */
export function signBankReplacement(value: BankReplacementBody, signingKey: string) {
  const body = bankReplacementBody.parse(value);
  if (!signingKey) throw new Error("The current bank-replacement evidence key is unavailable.");
  return { ...body, authentication: authentication(body, signingKey).toString("hex") };
}
export function verifyBankReplacement(row: {
  id: string; subjectType: string; subjectId: string; fromState: string | null; toState: string;
  reason: string | null; actor: string; occurredAt: Date; metadata: unknown;
}, verificationKeys: readonly string[]): BankReplacementBody | null {
  const parsed = signed.safeParse(row.metadata);
  if (!parsed.success) return null;
  const { authentication: signature, ...body } = parsed.data;
  if (row.id !== body.evidenceId || row.subjectType !== "refund" || row.subjectId !== body.parentRefundId || row.fromState !== null
    || row.toState !== BANK_REPLACEMENT_STATE || row.reason !== BANK_REPLACEMENT_REASON || row.actor !== body.authorizedBy
    || !Number.isFinite(row.occurredAt.getTime()) || row.occurredAt.toISOString() !== body.authorizedAt) return null;
  const actual = Buffer.from(signature, "hex");
  return verificationKeys.filter(Boolean).some(key => timingSafeEqual(actual, authentication(body, key))) ? body : null;
}
