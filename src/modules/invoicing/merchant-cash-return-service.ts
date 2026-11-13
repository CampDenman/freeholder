// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: independent cash evidence, real read completion and atomic disposition.
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
import { allowOriginalMerchantRefundWrites } from "./merchant-refund-store";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantPaymentEvidence } from "./merchant-payment-observations";
import { merchantPhysicalCaller } from "./merchant-physical-caller";
import { merchantRefundCashHistory } from "./merchant-refund-history";
import { lockMerchantRefundCash, merchantRefundSource, originalMerchantRefundCash, type MerchantRefundCashOrigin } from "./merchant-refund-origin";
import { merchantCashReturnInspectionFinishes, merchantCashReturnInspections, merchantCashReturnObservations, merchantCashReturnPrimaryObservations,
  merchantRefundObservations, merchantUnappliedChargeResolutions } from "./merchant-refund-schema";
import { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
import { merchantReturnedCashProof } from "./merchant-returned-cash-proof";
import { merchantTaxDigest } from "./merchant-tax-store";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const nonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const localSlot = Symbol.for("freeholder.merchant.cash-return-read-finishes.v1");
const processState = globalThis as typeof globalThis & { [localSlot]?: Map<string, { nonce: string; outcome: "returned" | "threw" }> };
const localFinishes = processState[localSlot] ??= new Map<string, { nonce: string; outcome: "returned" | "threw" }>();
async function originalInspection(ctx: ServiceContext, inspectionId: string) {
  const [row] = await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id, inspectionId));
  if (!row) throw new ServiceError("conflict", "Restore the actual original cash-return inspection before associating evidence.");
  return row;
}
function sourceForInspection(row: typeof merchantCashReturnInspections.$inferSelect): z.infer<typeof merchantRefundSource> {
  if (row.paymentId && row.originalObservationId) return { kind: "payment", paymentId: row.paymentId, observationId: row.originalObservationId };
  if (row.subscriptionChargeReceiptId && row.subscriptionChargeObservationId) return { kind: "subscription", receiptId: row.subscriptionChargeReceiptId, observationId: row.subscriptionChargeObservationId };
  throw new ServiceError("conflict", "The original cash source needs receipt restoration.");
}
async function ownEvidence(ctx: ServiceContext, inspectionId: string) {
  const primary = await ctx.tx.select().from(merchantCashReturnPrimaryObservations).where(eq(merchantCashReturnPrimaryObservations.inspectionId, inspectionId)).limit(5001);
  const observations = await ctx.tx.select().from(merchantCashReturnObservations).where(eq(merchantCashReturnObservations.inspectionId, inspectionId)).limit(5001);
  const refunds = await ctx.tx.select().from(merchantRefundObservations).where(eq(merchantRefundObservations.inspectionId, inspectionId)).limit(5001);
  if (primary.length > 5000 || observations.length > 5000 || refunds.length > 5000) throw new ServiceError("conflict", "Restore the complete original inspection evidence; no partial set proves a return.");
  return { primary, observations, refunds, digest: merchantTaxDigest({ primary: primary.map(row => merchantTaxDigest(row)).toSorted(), observations: observations.map(row => merchantTaxDigest(row)).toSorted(), refunds: refunds.map(row => merchantTaxDigest(row)).toSorted() }) };
}
async function callerForInspection(ctx: ServiceContext, inspectionId: string, completionNonce: string) {
  const row = await originalInspection(ctx, inspectionId), caller = merchantPhysicalCaller();
  if (row.caller.id !== caller.id || row.completionNonceHash !== hash(completionNonce)) throw new ServiceError("permission", "Only this exact original admitted inspection caller can submit its private physical evidence.");
  return row;
}
export const prepareMerchantCashReturnInspection = defineService({
  name: "invoicing.prepareMerchantCashReturnInspection", summary: "Snapshot actual original unapplied money and admitted callers before read-only return inspection.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ source: merchantRefundSource }),
  output: z.object({ inspectionId: z.uuid(), completionNonce: nonce, providerPlatformAccountId: z.string(), providerAccountId: z.string().nullable(),
    providerApiVersion: z.enum(["2026-02-25.clover", "2026-10-28.endive"]), paymentProviderRef: z.string() }),
  handler: async ({ source }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const initial = await originalMerchantRefundCash(ctx, source);
    await lockMerchantRefundCash(ctx, initial);
    const cash = await originalMerchantRefundCash(ctx, source);
    if (cash.applied) throw new ServiceError("conflict", "This cash already belongs to an invoice payment; use its ordinary refund flow.");
    const history = await merchantRefundCashHistory(ctx, cash);
    if (history.incomplete || !history.creatorsQuiesced) throw new ServiceError("conflict", "The complete original money/caller inventory must be restored and quiesced before final return inspection.");
    const completionNonce = randomBytes(32).toString("base64url");
    await allowOriginalMerchantRefundWrites(ctx.tx);
    const [saved] = await ctx.tx.insert(merchantCashReturnInspections).values({ paymentId: cash.paymentId, originalObservationId: cash.originalObservationId,
      subscriptionChargeReceiptId: cash.subscriptionChargeReceiptId, subscriptionChargeObservationId: cash.subscriptionChargeObservationId,
      providerPlatformAccountId: cash.providerPlatformAccountId, chargeAccountId: cash.chargeAccountId, providerApiVersion: cash.providerApiVersion,
      originalPaymentRef: cash.providerRef, originalCashAmountMinor: cash.amountMinor, currency: cash.currency, sourceHistoryDigest: history.digest,
      caller: merchantPhysicalCaller(), completionNonceHash: hash(completionNonce) }).returning();
    ctx.setSubject(cash.paymentId ? "payment" : "subscription_provider_charge", cash.paymentId ?? cash.subscriptionChargeReceiptId!);
    return { inspectionId: saved!.id, completionNonce, providerPlatformAccountId: cash.providerPlatformAccountId, providerAccountId: cash.chargeAccountId,
      providerApiVersion: cash.providerApiVersion, paymentProviderRef: cash.providerRef };
  },
});
export const recordCashReturnPrimaryObservation = defineService({
  name: "invoicing.recordCashReturnPrimaryObservation", summary: "Commit primary original cash before auxiliary return inspection can fail.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["inspectionId"],
  input: z.object({ inspectionId: z.uuid(), completionNonce: nonce, evidence: merchantPaymentEvidence.extend({ amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/) }) }),
  output: z.object({ observationId: z.uuid() }),
  handler: async ({ inspectionId, completionNonce, evidence }, ctx) => {
    const original = await callerForInspection(ctx, inspectionId, completionNonce);
    const evidenceDigest = merchantTaxDigest(evidence);
    await allowOriginalMerchantRefundWrites(ctx.tx);
    await ctx.tx.insert(merchantCashReturnPrimaryObservations).values({ inspectionId, evidence, evidenceDigest }).onConflictDoNothing();
    const [saved] = await ctx.tx.select({ id: merchantCashReturnPrimaryObservations.id }).from(merchantCashReturnPrimaryObservations)
      .where(and(eq(merchantCashReturnPrimaryObservations.inspectionId, inspectionId), eq(merchantCashReturnPrimaryObservations.evidenceDigest, evidenceDigest)));
    if (!saved) throw new ServiceError("conflict", "The original cash evidence needs recovery.");
    ctx.setSubject(original.paymentId ? "payment" : "subscription_provider_charge", original.paymentId ?? original.subscriptionChargeReceiptId!);
    queueOriginalMerchantRefundRepair(ctx, { kind: "cash_primary", id: saved.id });
    return { observationId: saved.id };
  },
});
export const recordCashReturnObservation = defineService({
  name: "invoicing.recordCashReturnObservation", summary: "Commit raw original refund, fee, recipient and dispute inventory without deciding completion.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["inspectionId"],
  input: z.object({ inspectionId: z.uuid(), completionNonce: nonce, evidence: merchantReturnedCashEvidenceSchema }), output: z.object({ observationId: z.uuid() }),
  handler: async ({ inspectionId, completionNonce, evidence }, ctx) => {
    const original = await callerForInspection(ctx, inspectionId, completionNonce);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-return-read:${inspectionId}`}))`);
    const evidenceDigest = merchantTaxDigest(evidence);
    const [last] = await ctx.tx.select({ sequence: merchantCashReturnObservations.sequence }).from(merchantCashReturnObservations)
      .where(eq(merchantCashReturnObservations.inspectionId, inspectionId)).orderBy(desc(merchantCashReturnObservations.sequence)).limit(1);
    await allowOriginalMerchantRefundWrites(ctx.tx);
    await ctx.tx.insert(merchantCashReturnObservations).values({ inspectionId, sequence: (last?.sequence ?? 0) + 1, evidence, evidenceDigest }).onConflictDoNothing();
    const [saved] = await ctx.tx.select({ id: merchantCashReturnObservations.id }).from(merchantCashReturnObservations)
      .where(and(eq(merchantCashReturnObservations.inspectionId, inspectionId), eq(merchantCashReturnObservations.evidenceDigest, evidenceDigest)));
    if (!saved) throw new ServiceError("conflict", "The actual original return evidence needs recovery.");
    ctx.setSubject(original.paymentId ? "payment" : "subscription_provider_charge", original.paymentId ?? original.subscriptionChargeReceiptId!);
    queueOriginalMerchantRefundRepair(ctx, { kind: "cash_state", id: saved.id });
    return { observationId: saved.id };
  },
});
export const finishMerchantCashReturnInspection = defineService({
  name: "invoicing.finishMerchantCashReturnInspection", summary: "Retain actual completion of this original read promise independently of its financial result.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["inspectionId"], input: z.object({ inspectionId: z.uuid(), completionNonce: nonce }), output: z.object({ finished: z.literal(true) }),
  handler: async ({ inspectionId, completionNonce }, ctx) => {
    const original = await callerForInspection(ctx, inspectionId, completionNonce), local = localFinishes.get(inspectionId);
    if (!local || local.nonce !== completionNonce) throw new ServiceError("permission", "Only an actually finished original read promise can record this finish receipt.");
    await allowOriginalMerchantRefundWrites(ctx.tx);
    await ctx.tx.insert(merchantCashReturnInspectionFinishes).values({ inspectionId, callerInstanceId: original.caller.id, outcome: local.outcome }).onConflictDoNothing();
    ctx.setSubject(original.paymentId ? "payment" : "subscription_provider_charge", original.paymentId ?? original.subscriptionChargeReceiptId!);
    queueOriginalMerchantRefundRepair(ctx, { kind: "cash_finish", id: inspectionId });
    return { finished: true as const };
  },
});
export async function performMerchantCashReturnInspection<T>(claim: { inspectionId: string; completionNonce: string }, work: () => Promise<T>): Promise<T> {
  let outcome: "returned" | "threw" = "threw";
  try { const result = await work(); outcome = "returned"; return result; }
  finally { localFinishes.set(claim.inspectionId, { nonce: claim.completionNonce, outcome });
    await finishMerchantCashReturnInspection.call(claim, { kind: "system" }); localFinishes.delete(claim.inspectionId); }
}
async function currentReturnProof(ctx: ServiceContext, inspection: typeof merchantCashReturnInspections.$inferSelect, observationId: string) {
  const cash = await originalMerchantRefundCash(ctx, sourceForInspection(inspection));
  const history = await merchantRefundCashHistory(ctx, cash, inspection.id), own = await ownEvidence(ctx, inspection.id);
  const [finish] = await ctx.tx.select().from(merchantCashReturnInspectionFinishes).where(eq(merchantCashReturnInspectionFinishes.inspectionId, inspection.id));
  const observation = own.observations.find(row => row.id === observationId);
  const latestSequence = own.observations.reduce((sequence, row) => Math.max(sequence, row.sequence), 0);
  const originalPrimary = own.primary.length > 0 && own.primary.every(({ evidence }) => evidence.providerRef === cash.providerRef && (evidence.status === "succeeded" || evidence.status === "failed" && observation?.evidence.paymentIntentStatus === "canceled")
    && evidence.providerApiVersion === cash.providerApiVersion && evidence.amountMinor === cash.amountMinor && evidence.currency === cash.currency && evidence.providerPlatformAccountId === cash.providerPlatformAccountId && (evidence.providerAccountId ?? null) === cash.chargeAccountId);
  if (cash.providerRef !== inspection.originalPaymentRef || cash.providerPlatformAccountId !== inspection.providerPlatformAccountId || cash.chargeAccountId !== inspection.chargeAccountId
    || cash.providerApiVersion !== inspection.providerApiVersion || cash.amountMinor !== inspection.originalCashAmountMinor || cash.currency !== inspection.currency
    || cash.applied || !originalPrimary || !finish || finish.callerInstanceId !== inspection.caller.id || finish.outcome !== "returned"
    || history.incomplete || history.feeDebt || history.digest !== inspection.sourceHistoryDigest || !observation || observation.sequence !== latestSequence) return null;
  const evidence = merchantReturnedCashEvidenceSchema.safeParse(observation.evidence);
  if (!evidence.success) return null;
  const unresolvedRefund = history.refundRequests.some(request => {
    if (!request.dispatched) return !request.retired;
    if (request.definitelyRefused) return false;
    if (request.resourceRefs.length !== 1) return true;
    const actual = evidence.data.refunds.find(row => row.providerRef === request.resourceRefs[0]);
    return !actual || actual.paymentProviderRef !== cash.providerRef || actual.amountMinor !== request.amountMinor || actual.currency !== request.currency
      || !["succeeded", "failed", "canceled"].includes(actual.status ?? "unknown");
  });
  if (unresolvedRefund) return null;
  const proof = merchantReturnedCashProof({ original: { ...cash, paymentProviderRef: cash.providerRef }, evidence: evidence.data, creatorsQuiesced: history.creatorsQuiesced, inventoryStable: true });
  return proof.settled ? { cash, own, observation } : null;
}
export const finalizeUnappliedCashReturn = defineService({
  name: "invoicing.finalizeUnappliedCashReturn", summary: "Atomically retain full original cash return only after actual callers, fees, recipient and dispute debt clear.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ inspectionId: z.uuid(), observationId: z.uuid() }), output: z.object({ returnReceiptId: z.uuid().nullable(), settled: z.boolean() }),
  handler: async ({ inspectionId, observationId }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const inspection = await originalInspection(ctx, inspectionId);
    await lockMerchantRefundCash(ctx, { ...inspection, providerRef: inspection.originalPaymentRef });
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-return-read:${inspectionId}`}))`);
    const current = await currentReturnProof(ctx, inspection, observationId);
    if (!current) return { returnReceiptId: null, settled: false };
    const cash: MerchantRefundCashOrigin = current.cash;
    const evidenceDigest = merchantTaxDigest({ inspectionId, observationId, ownEvidenceDigest: current.own.digest, sourceHistoryDigest: inspection.sourceHistoryDigest });
    await allowOriginalMerchantRefundWrites(ctx.tx);
    await ctx.tx.insert(merchantUnappliedChargeResolutions).values({ inspectionId, returnObservationId: observationId, paymentId: cash.paymentId, originalObservationId: cash.originalObservationId,
      subscriptionChargeReceiptId: cash.subscriptionChargeReceiptId, subscriptionChargeObservationId: cash.subscriptionChargeObservationId, providerPlatformAccountId: cash.providerPlatformAccountId,
      chargeAccountId: cash.chargeAccountId, originalPaymentRef: cash.providerRef, originalCashAmountMinor: cash.amountMinor, currency: cash.currency,
      ownEvidenceDigest: current.own.digest, disposition: "returned_to_original_payer", evidenceDigest }).onConflictDoNothing();
    const [saved] = await ctx.tx.select().from(merchantUnappliedChargeResolutions).where(eq(merchantUnappliedChargeResolutions.evidenceDigest, evidenceDigest));
    if (!saved) throw new ServiceError("conflict", "Restore this actual original cash return receipt.");
    ctx.setSubject(cash.paymentId ? "payment" : "subscription_provider_charge", cash.paymentId ?? cash.subscriptionChargeReceiptId!);
    queueOriginalMerchantRefundRepair(ctx, { kind: "cash_resolution", id: saved.id });
    return { returnReceiptId: saved.id, settled: true };
  },
});
export async function originalCashReturnedDisposition(ctx: ServiceContext, receiptId: string): Promise<{ returnReceiptId: string } | null> {
  const resolutions = await ctx.tx.select().from(merchantUnappliedChargeResolutions).where(eq(merchantUnappliedChargeResolutions.subscriptionChargeReceiptId, receiptId))
    .orderBy(desc(merchantUnappliedChargeResolutions.createdAt), desc(merchantUnappliedChargeResolutions.id)).limit(5001);
  if (resolutions.length > 5000) return null;
  const first = resolutions[0];
  if (first) await lockMerchantRefundCash(ctx, { ...first, providerRef: first.originalPaymentRef });
  for (const resolution of resolutions) {
    const inspection = await originalInspection(ctx, resolution.inspectionId);
    const current = await currentReturnProof(ctx, inspection, resolution.returnObservationId);
    if (current && current.own.digest === resolution.ownEvidenceDigest) return { returnReceiptId: resolution.id };
  }
  return null;
}
/** Exact source receipt and observation, including an unapplied alternate PI
 * of an existing payment. Never infer a canonical payment from equal money. */
export async function verifiedOriginalCashReturnReceipt(ctx: ServiceContext, returnReceiptId: string, source: z.infer<typeof merchantRefundSource>) {
  const cash = await originalMerchantRefundCash(ctx, source);
  await lockMerchantRefundCash(ctx, cash);
  const [resolution] = await ctx.tx.select().from(merchantUnappliedChargeResolutions).where(eq(merchantUnappliedChargeResolutions.id, returnReceiptId));
  if (!resolution || resolution.paymentId !== cash.paymentId || resolution.originalObservationId !== cash.originalObservationId
    || resolution.subscriptionChargeReceiptId !== cash.subscriptionChargeReceiptId || resolution.subscriptionChargeObservationId !== cash.subscriptionChargeObservationId
    || resolution.originalPaymentRef !== cash.providerRef || resolution.providerPlatformAccountId !== cash.providerPlatformAccountId
    || resolution.chargeAccountId !== cash.chargeAccountId) return false;
  const current = await currentReturnProof(ctx, await originalInspection(ctx, resolution.inspectionId), resolution.returnObservationId);
  return current !== null && current.own.digest === resolution.ownEvidenceDigest;
}
// Privately registered source prototype; still requires complete financial dispatch, alternate-writer SQL, privacy,
// live native races and UI/API/MCP qualification are integrated on fresh80.

export default [prepareMerchantCashReturnInspection, recordCashReturnPrimaryObservation, recordCashReturnObservation, finishMerchantCashReturnInspection, finalizeUnappliedCashReturn];
