// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: explicit current human review of actual server-held bank receipt lineage.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError } from "@/core/service";
import { currentOriginalCashInventory, appendOriginalCashFact } from "./original-cash-recovery-service";
import { originalCashRecoveryCashWitness } from "./original-cash-recovery-store";
import { merchantRefundObservations, merchantRefundResourceBindings, merchantRefundRequests } from "./merchant-refund-schema";
import { ORIGINAL_UNASSIGNED_CASH_CONFIRMATION } from "./original-cash-partial-contract";
import { completeOriginalRefundInventory } from "./original-cash-partial-amounts";
import { merchantRefundObservationCaptures } from "./merchant-refund-current-schema";
export const reviewOriginalUnassignedCash = defineService({
  name: "invoicing.reviewOriginalUnassignedCash", summary: "Review an actual original cash refund's server receipt and current bank resource without assigning it to a missing request or inventing a payment.",
  kind: "mutation", permission: "scoped", stepUp: true, agentCallable: false, writeClass: "money", auditInputFields: ["recoveryId", "operationId", "rawFactId"],
  input: z.object({ recoveryId: z.uuid(), operationId: z.uuid(), rawFactId: z.uuid(), confirmation: z.literal(ORIGINAL_UNASSIGNED_CASH_CONFIRMATION) }).strict(),
  output: z.object({ reviewed: z.literal(true) }),
  handler: async ({ recoveryId, operationId, rawFactId }, ctx) => {
    if (ctx.actor.kind !== "user" || ctx.actor.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must review this actual original resource.");
    const current = await currentOriginalCashInventory(ctx, recoveryId, operationId), witness = await originalCashRecoveryCashWitness(ctx.tx, current.cash);
    const raw = witness.facts.find(fact => fact.id === rawFactId && fact.operationId === operationId && fact.kind === "refund");
    const actual = raw ? current.evidence.refunds.find(resource => resource.providerRef === raw.evidence.providerRef) : null;
    const rawStatus = raw && (Object.hasOwn(raw.evidence,"providerStatus") ? raw.evidence.providerStatus : raw.evidence.status);
    if (!raw || !actual || !current.history.creatorsQuiesced || !completeOriginalRefundInventory(current.evidence) || current.proof.debt.some(debt => !["customer_refund", "commission", "recipient"].includes(debt))
      || !["succeeded", "failed", "canceled"].includes(actual.status ?? "unknown") || actual.status !== rawStatus || actual.amountMinor === null || actual.amountMinor <= 0 || actual.currency !== current.cash.currency
      || actual.paymentProviderRef !== current.cash.providerRef || actual.chargeRef !== current.evidence.providerChargeRef || raw.evidence.paymentProviderRef !== current.cash.providerRef
      || raw.evidence.providerChargeRef !== actual.chargeRef || raw.evidence.amountMinor !== actual.amountMinor || raw.evidence.currency !== actual.currency) throw new ServiceError("conflict", "Review the actual retained server receipt and one fresh complete original bank inventory; equal amounts or a hosting stop cannot choose this resource.");
    const [binding] = await ctx.tx.select({ id: merchantRefundResourceBindings.id }).from(merchantRefundResourceBindings).innerJoin(merchantRefundRequests,eq(merchantRefundRequests.id,merchantRefundResourceBindings.requestId))
      .where(and(eq(merchantRefundResourceBindings.providerRef,actual.providerRef),eq(merchantRefundRequests.providerPlatformAccountId,current.cash.providerPlatformAccountId),sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${current.cash.chargeAccountId}`)).limit(1);
    const [claimed] = await ctx.tx.select({ id: merchantRefundObservations.id }).from(merchantRefundObservations).where(sql`${merchantRefundObservations.providerRef}=${actual.providerRef} and ${merchantRefundObservations.providerPlatformAccountId}=${current.cash.providerPlatformAccountId} and ${merchantRefundObservations.chargeAccountId} is not distinct from ${current.cash.chargeAccountId} and (${merchantRefundObservations.requestId} is not null or ${merchantRefundObservations.claimedRequestId} is not null)`).limit(1);
    if (binding || claimed) throw new ServiceError("conflict", "This resource already has an original request or claimed lineage. Restore that exact owner rather than relabeling it as unassigned.");
    const captures=await ctx.tx.select({id:merchantRefundObservationCaptures.id}).from(merchantRefundObservationCaptures).innerJoin(merchantRefundObservations,eq(merchantRefundObservations.id,merchantRefundObservationCaptures.observationId))
      .where(and(eq(merchantRefundObservations.providerRef,actual.providerRef),eq(merchantRefundObservations.providerPlatformAccountId,current.cash.providerPlatformAccountId),sql`${merchantRefundObservations.chargeAccountId} is not distinct from ${current.cash.chargeAccountId}`)).limit(5001);
    if(captures.length>5000)throw new ServiceError("conflict","Restore the complete original resource occurrence inventory before review.");
    await appendOriginalCashFact(ctx, recoveryId, null, "unassigned_refund_review", { protocol: "freeholder.original-unassigned-cash-review.v1", rawFactId, bankOperationId: operationId,
      providerRef: actual.providerRef, paymentProviderRef: current.cash.providerRef, providerChargeRef: actual.chargeRef, amountMinor: actual.amountMinor, currency: actual.currency, status: actual.status,
      providerPlatformAccountId: current.cash.providerPlatformAccountId, chargeAccountId: current.cash.chargeAccountId, providerApiVersion: current.cash.providerApiVersion,
      originalCreator: null, reviewedBy: actorString(ctx.actor),sourceCaptureIds:captures.map(capture=>capture.id).sort(),sourceFeedbackIds:witness.feedback.filter(entry=>entry.feedback.evidence.observedRefundRef===actual.providerRef).map(entry=>entry.feedback.id).sort() });
    return { reviewed: true as const };
  },
});
export default [reviewOriginalUnassignedCash];
