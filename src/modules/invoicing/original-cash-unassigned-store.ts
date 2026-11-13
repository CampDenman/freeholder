// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a new explicit review binds real server receipt lineage, not a refund intent.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ServiceContext } from "@/core/service";
import { cashNamespaceKey } from "./original-cash-recovery-proof";
import { originalCashRecoveries } from "./original-cash-recovery-schema";
import { originalCashRecoveryFinancialWitness } from "./original-cash-recovery-store";
import { merchantRefundObservationCaptures } from "./merchant-refund-current-schema";
import { merchantRefundObservations, type merchantRefundRequests } from "./merchant-refund-schema";
import type { MerchantRefundReviewedUnassignedResource } from "./merchant-refund-capacity";
const status = (value: Record<string, unknown>) => Object.hasOwn(value, "providerStatus") ? value.providerStatus : value.status;
export async function reviewedOriginalUnassignedCash(ctx: ServiceContext, request: typeof merchantRefundRequests.$inferSelect): Promise<MerchantRefundReviewedUnassignedResource[]> {
  if (request.purpose !== "unapplied_return") return [];
  const [owner] = await ctx.tx.select().from(originalCashRecoveries).where(eq(originalCashRecoveries.namespaceKey, cashNamespaceKey({ providerPlatformAccountId: request.providerPlatformAccountId, chargeAccountId: request.chargeAccountId, providerRef: request.originalPaymentRef })));
  if (!owner || owner.paymentId !== request.paymentId || owner.subscriptionChargeReceiptId !== request.subscriptionChargeReceiptId) return [];
  const witness = await originalCashRecoveryFinancialWitness(ctx.tx, owner.paymentId ? [owner.paymentId] : [], owner.subscriptionChargeReceiptId ? [owner.subscriptionChargeReceiptId] : []);
  const result: MerchantRefundReviewedUnassignedResource[] = [], visited = new Set<string>();
  for (const review of witness.facts.filter(fact => fact.recoveryId === owner.id && fact.kind === "unassigned_refund_review").sort((a,b) => b.sequence-a.sequence)) {
    const evidence = review.evidence, ref = evidence.providerRef;
    if (typeof ref !== "string" || visited.has(ref)) continue; visited.add(ref);
    const raw = witness.facts.find(fact => fact.id === evidence.rawFactId && fact.kind === "refund" && fact.operationId === evidence.bankOperationId);
    const read = witness.operations.find(operation => operation.id === evidence.bankOperationId && operation.recoveryId === owner.id && operation.kind === "inspection" && !operation.request.auxiliaryOperationId);
    if (!raw || !read || !witness.facts.some(fact => fact.operationId === read.id && fact.kind === "finish" && fact.evidence.outcome === "returned" && fact.evidence.callerInstanceId === read.caller.id)
      || evidence.protocol !== "freeholder.original-unassigned-cash-review.v1" || evidence.providerPlatformAccountId !== request.providerPlatformAccountId || evidence.chargeAccountId !== request.chargeAccountId
      || evidence.providerApiVersion !== request.providerApiVersion || evidence.paymentProviderRef !== request.originalPaymentRef || evidence.currency !== request.currency
      || typeof evidence.amountMinor !== "number" || !Number.isSafeInteger(evidence.amountMinor) || evidence.amountMinor <= 0
      || !["succeeded", "failed", "canceled"].includes(String(evidence.status)) || raw.evidence.providerRef !== ref || raw.evidence.amountMinor !== evidence.amountMinor || raw.evidence.currency !== evidence.currency
      || raw.evidence.providerChargeRef !== evidence.providerChargeRef || raw.evidence.paymentProviderRef !== request.originalPaymentRef || status(raw.evidence) !== evidence.status) continue;
    const observations = await ctx.tx.select().from(merchantRefundObservations).where(and(eq(merchantRefundObservations.providerPlatformAccountId, request.providerPlatformAccountId),
      sql`${merchantRefundObservations.chargeAccountId} is not distinct from ${request.chargeAccountId}`, eq(merchantRefundObservations.providerRef, ref))).limit(5001);
    if (observations.length > 5000 || observations.some(row => row.requestId !== null || row.claimedRequestId !== null || row.paymentProviderRef !== request.originalPaymentRef
      || row.amountMinor !== evidence.amountMinor || row.currency !== evidence.currency || row.providerApiVersion !== request.providerApiVersion)) continue;
    const observationIds = observations.map(row => row.id);
    const later = observationIds.length ? await ctx.tx.select({ id:merchantRefundObservationCaptures.id,observationId: merchantRefundObservationCaptures.observationId }).from(merchantRefundObservationCaptures)
      .where(inArray(merchantRefundObservationCaptures.observationId, observationIds)).limit(5001) : [];
    const originalCaptures=Array.isArray(evidence.sourceCaptureIds)?evidence.sourceCaptureIds:[],originalFeedback=Array.isArray(evidence.sourceFeedbackIds)?evidence.sourceFeedbackIds:[];
    if (later.length > 5000 || later.some(capture => !originalCaptures.includes(capture.id)&&observations.find(row => row.id === capture.observationId)?.status !== evidence.status)
      || witness.facts.some(fact => fact.recoveryId === owner.id && fact.sequence > review.sequence && fact.kind === "refund" && fact.evidence.providerRef === ref && (status(fact.evidence) !== evidence.status || fact.evidence.amountMinor !== evidence.amountMinor || fact.evidence.currency !== evidence.currency || fact.evidence.paymentProviderRef !== request.originalPaymentRef || fact.evidence.providerChargeRef !== evidence.providerChargeRef))
      || witness.feedback.some(entry=>!originalFeedback.includes(entry.feedback.id) && entry.feedback.evidence.observedRefundRef===ref && (entry.feedback.evidence.status!==evidence.status || entry.feedback.evidence.observedPaymentRef!==null&&entry.feedback.evidence.observedPaymentRef!==request.originalPaymentRef || entry.feedback.evidence.observedChargeRef!==null&&entry.feedback.evidence.observedChargeRef!==evidence.providerChargeRef || entry.feedback.evidence.amountMinor!==null && entry.feedback.evidence.amountMinor!==evidence.amountMinor || entry.feedback.evidence.currency!==null && entry.feedback.evidence.currency!==evidence.currency))) continue;
    result.push({ providerRef: ref, amountMinor: evidence.amountMinor, currency: request.currency, status: evidence.status as MerchantRefundReviewedUnassignedResource["status"] });
  }
  return result;
}
