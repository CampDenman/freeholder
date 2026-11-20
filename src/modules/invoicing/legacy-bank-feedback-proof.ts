// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38/C1.08: authentic observed feedback never invents original birth scope.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { merchantTaxDigest } from "./merchant-tax-store";
export const LEGACY_BANK_FEEDBACK_PROTOCOL = "freeholder.legacy-bank-feedback.v1";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const legacyBankFeedbackEvidence = z.object({
  protocol: z.literal(LEGACY_BANK_FEEDBACK_PROTOCOL), provider: z.literal("stripe"), providerEventId: z.string().min(1).max(500),
  kind: z.enum(["refund_processing", "refund_succeeded", "refund_failed"]), observedRefundRef: z.string().min(1).max(500),
  observedPaymentRef: z.string().max(500).nullable(), observedChargeRef: z.string().max(500).nullable(),
  observedPlatformAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).nullable(), observedChargeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).nullable(),
  observedProtocolVersion: z.string().max(100).nullable(), rawProviderStatus: z.string().max(100).nullable(),
  status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]).nullable(),
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  failureReason: z.string().max(100).nullable(), failureBalanceTransactionRef: z.string().max(200).nullable(),
  occurredAt: z.string().datetime(), receivedAt: z.string().datetime().nullable(), rawBodySha256: digest.nullable(),
  verification: z.literal("stripe_exact_byte_hmac_verified_upstream"), originalCreatePlatformAccountId: z.null(), originalCreateProtocolVersion: z.null(),
}).strict();
export type LegacyBankFeedbackEvidence = z.infer<typeof legacyBankFeedbackEvidence>;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Feedback owns review before an ACK, but only an actual complete current
 * inventory can resolve its financial identity. Later statuses may change;
 * immutable resource, payment, account, charge and money cannot. */
export function legacyBankFeedbackMatchesInventory(observed: LegacyBankFeedbackEvidence, input: {
  originalPaymentRef: string; originalChargeAccountId: string | null; readPlatformAccountId: unknown; cash: unknown;
}): boolean {
  const cash = record(input.cash), rows = Array.isArray(cash.refunds) ? cash.refunds.map(record) : [];
  const resources = rows.filter(row => row.providerRef === observed.observedRefundRef);
  if (resources.length !== 1 || cash.refundsComplete !== true || cash.paymentProviderRef !== input.originalPaymentRef
    || cash.chargeAccountId !== input.originalChargeAccountId || typeof cash.providerChargeRef !== "string") return false;
  const resource = resources[0]!;
  return observed.observedChargeAccountId === input.originalChargeAccountId
    && (observed.observedPlatformAccountId === null || observed.observedPlatformAccountId === input.readPlatformAccountId)
    && (observed.observedPaymentRef === null || observed.observedPaymentRef === input.originalPaymentRef)
    && (observed.observedChargeRef === null || observed.observedChargeRef === cash.providerChargeRef)
    && resource.paymentProviderRef === input.originalPaymentRef && resource.chargeRef === cash.providerChargeRef
    && (observed.amountMinor === null || resource.amountMinor === observed.amountMinor)
    && (observed.currency === null || resource.currency === observed.currency);
}
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value : null;
export function normalizeLegacyBankFeedback(event: Record<string, unknown>, receipt: { rawBodySha256: string | null; receivedAt: string | null }): LegacyBankFeedbackEvidence {
  const known = new Set(["pending", "requires_action", "succeeded", "failed", "canceled"]), status = text(event.providerStatus, 100);
  const raw = Object.hasOwn(event, "rawProviderStatus") ? text(event.rawProviderStatus, 100) : status;
  const payment = Object.hasOwn(event, "observedPaymentIntentRef") ? text(event.observedPaymentIntentRef, 500) : text(event.paymentProviderRef, 500);
  const currency = text(event.currency, 3);
  return legacyBankFeedbackEvidence.parse({ protocol: LEGACY_BANK_FEEDBACK_PROTOCOL, provider: "stripe", providerEventId: event.id, kind: event.kind,
    observedRefundRef: event.providerRef, observedPaymentRef: payment?.startsWith("pi_") ? payment : null, observedChargeRef: text(event.providerChargeRef, 500),
    observedPlatformAccountId: text(event.providerPlatformAccountId, 200), observedChargeAccountId: text(event.providerAccountId, 200) || null,
    observedProtocolVersion: text(event.observedProviderApiVersion, 100), rawProviderStatus: raw,
    status: status && known.has(status) ? status : null, amountMinor: typeof event.amountMinor === "number" && Number.isSafeInteger(event.amountMinor) && event.amountMinor >= 0 ? event.amountMinor : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null, failureReason: text(event.failureReason, 100), failureBalanceTransactionRef: text(event.failureBalanceTransactionRef, 200),
    occurredAt: event.occurredAt, ...receipt, verification: "stripe_exact_byte_hmac_verified_upstream", originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null });
}
function authentication(row: { id: string; captureKey: string; evidenceDigest: string; createdAt: Date }, key: string) {
  const purpose = createHmac("sha256", key).update("freeholder/legacy-bank-feedback/signing-key/v1").digest();
  return createHmac("sha256", purpose).update(`${LEGACY_BANK_FEEDBACK_PROTOCOL}\0${merchantTaxDigest({ id: row.id, captureKey: row.captureKey, evidenceDigest: row.evidenceDigest, retainedAt: row.createdAt.toISOString() })}`).digest();
}
export function signLegacyBankFeedback(row: { id: string; captureKey: string; evidenceDigest: string; createdAt: Date }, key: string) {
  if (!key) throw Error("Restore the original legacy bank-feedback evidence key before retaining facts."); return authentication(row, key).toString("hex");
}
export function verifyLegacyBankFeedback(row: { id: string; captureKey: string; evidenceDigest: string; authentication: string; createdAt: Date; evidence: unknown }, keys: readonly string[]): LegacyBankFeedbackEvidence | null {
  const evidence = legacyBankFeedbackEvidence.safeParse(row.evidence);
  if (!evidence.success || !digest.safeParse(row.captureKey).success || !digest.safeParse(row.authentication).success || !Number.isFinite(row.createdAt.getTime()) || merchantTaxDigest(evidence.data) !== row.evidenceDigest) return null;
  return keys.filter(Boolean).some(key => timingSafeEqual(Buffer.from(row.authentication, "hex"), authentication(row, key))) ? evidence.data : null;
}
