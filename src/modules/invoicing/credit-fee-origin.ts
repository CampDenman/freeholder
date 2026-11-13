// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: a carried obligation is never evidence of a collected commission.
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { ServiceContext } from "@/core/service";
import { ServiceError } from "@/core/service";
import { payments } from "./schema";
import { commercialFeeAttestations } from "./commercial-attestation-schema";
import { commercialPaymentRecorded, commercialPrincipalState } from "./commercial-attestations";
import { merchantFeeRefunds, merchantPaymentObservations } from "./merchant-collection-schema";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReservations } from "./credit-application-schema";
import { routingForPayment } from "./merchant-charge";
import { merchantTaxDigest } from "./merchant-tax-store";
import { proportionalFeeCarry } from "./credit-fee-amounts";
export const feeCollectionState = z.enum(["not_due", "owed", "recorded_remitted", "verified_collected", "review"]);
export type FeeCollectionState = z.infer<typeof feeCollectionState>;
export const creditFeeAllocation = z.object({ feeObligationMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), provenCollectedMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  collectionState: feeCollectionState, unexpectedFee: z.boolean(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/) });

/** The caller already holds original payment locks before committing a new
 * allocation. Reads retain actual immutable original resource/receipt IDs. */
export async function originalCreditFeeAllocation(ctx: ServiceContext, paymentId: string, sourceApplicationId: string | null, takeMinor: number) {
  const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment || payment.status !== "succeeded" || payment.refundedMinor !== 0) throw new ServiceError("conflict", "Restore the exact unreturned original principal before assigning its fee obligation.");
  const routing = await routingForPayment(ctx, paymentId);
  let originalFeeMinor: number, state: z.infer<typeof feeCollectionState>, proof: unknown, unexpectedFee = false, sourceRows = 0;
  if (routing.moneyOrigin === "recorded_external") {
    const receipt = await commercialPaymentRecorded(ctx, paymentId), current = await ctx.callAsSystem(commercialPrincipalState, { paymentId });
    const actual = await ctx.tx.select().from(commercialFeeAttestations).where(eq(commercialFeeAttestations.paymentId, paymentId)).orderBy(commercialFeeAttestations.id).limit(5001);
    if (!receipt || !current.principalSafe || actual.length > 5000) throw new ServiceError("conflict", "Restore this exact recorded external fee duty and real remittance/return receipts.");
    originalFeeMinor = receipt.feeOwedMinor;
    sourceRows = actual.length;
    unexpectedFee = current.feeRecordedMinor > current.feeOwedMinor || current.feeRecordedMinor < 0;
    state = current.reviewRequired ? "review" : originalFeeMinor === 0 ? "not_due" : current.feeRecordedMinor === originalFeeMinor ? "recorded_remitted" : "owed";
    proof = { origin: "recorded_external", receipt, actual, current };
  } else {
    if (!routing.providerPlatformAccountId || routing.applicationFeeMinor === undefined) throw new ServiceError("conflict", "Restore the exact original provider fee contract; an amount match or today's fee rate is not its owner.");
    originalFeeMinor = routing.applicationFeeMinor;
    const [observation] = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, paymentId), eq(merchantPaymentObservations.providerRef, payment.providerRef ?? ""), eq(merchantPaymentObservations.status, "succeeded")))
      .orderBy(desc(merchantPaymentObservations.observedAt), desc(merchantPaymentObservations.id)).limit(1);
    const operations = await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId, paymentId)).orderBy(merchantFeeRefunds.id).limit(5001);
    sourceRows = operations.length + (observation ? 1 : 0);
    const unsettled = operations.length > 5000 || operations.some(row => ["reserved", "dispatching", "unknown"].includes(row.status));
    const feeKnown = observation?.customerChargeVerified === true && observation.routeVerified && observation.providerPlatformAccountId === routing.providerPlatformAccountId
      && observation.chargeAccountId === (routing.providerAccountId ?? null) && observation.recipientAccountId === (routing.destinationAccountId ?? routing.providerAccountId ?? null)
      && observation.settlementMerchantAccountId === (routing.settlementMerchantAccountId ?? routing.providerAccountId ?? null) && observation.amountMinor === payment.amountMinor && observation.currency === payment.currency && observation.applicationFeeCurrency === payment.currency
      && observation.observedApplicationFeeMinor !== null && observation.observedFeeRefundedMinor !== null;
    state = "review";
    if (!unsettled && feeKnown && observation.observedApplicationFeeMinor === originalFeeMinor && observation.observedFeeRefundedMinor === 0
      && (originalFeeMinor === 0 ? !observation.applicationFeeRef : Boolean(observation.applicationFeeRef))) state = originalFeeMinor === 0 ? "not_due" : "verified_collected";
    else if (!unsettled && feeKnown && Boolean(observation.applicationFeeRef) && observation.observedApplicationFeeMinor! >= 0 && observation.observedApplicationFeeMinor! < originalFeeMinor && observation.observedFeeRefundedMinor === 0) state = "owed";
    unexpectedFee = Boolean(observation && (observation.observedApplicationFeeMinor !== null && observation.observedApplicationFeeMinor > originalFeeMinor
      || observation.observedFeeRefundedMinor !== null && observation.observedFeeRefundedMinor > 0 || observation.applicationFeeCurrency !== null && observation.applicationFeeCurrency !== payment.currency));
    proof = { origin: "provider", routing, observation, operations };
  }
  let principalMinor = payment.amountMinor, feeObligationMinor = originalFeeMinor, parentProof: unknown = null;
  if (sourceApplicationId) {
    const [parent] = await ctx.tx.select({ application: invoiceCreditApplications, reservation: invoiceCreditReservations, funding: invoiceCreditFunding }).from(invoiceCreditApplications)
      .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId))
      .innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId)).where(eq(invoiceCreditApplications.reservationId, sourceApplicationId)).limit(1);
    if (!parent || parent.funding.sourcePaymentId !== paymentId || !parent.application.feeEvidenceDigest) throw new ServiceError("conflict", "Restore the exact inherited application fee ownership receipt before carrying its obligation forward.");
    principalMinor = parent.reservation.amountMinor; feeObligationMinor = parent.application.feeObligationMinor; parentProof = parent;
  }
  const allocated = await ctx.tx.select({ row: invoiceCreditFunding }).from(invoiceCreditFunding).where(and(eq(invoiceCreditFunding.sourcePaymentId, paymentId),
    sourceApplicationId ? eq(invoiceCreditFunding.sourceApplicationId, sourceApplicationId) : isNull(invoiceCreditFunding.sourceApplicationId))).orderBy(invoiceCreditFunding.id).limit(5001);
  if (allocated.length + sourceRows > 5000 || allocated.some(row => !row.row.feeEvidenceDigest)) throw new ServiceError("conflict", "Restore every original principal/fee allocation; historical missing fee evidence is debt, never an inferred zero fee.");
  const allocatedPrincipalMinor = allocated.reduce((sum, row) => sum + row.row.amountMinor, 0), allocatedFeeMinor = allocated.reduce((sum, row) => sum + row.row.feeObligationMinor, 0);
  const carried = proportionalFeeCarry({ principalMinor, feeObligationMinor, allocatedPrincipalMinor, allocatedFeeMinor, takeMinor });
  return creditFeeAllocation.parse({ feeObligationMinor: carried, provenCollectedMinor: ["recorded_remitted", "verified_collected"].includes(state) ? carried : 0,
    collectionState: state, unexpectedFee, evidenceDigest: merchantTaxDigest({ paymentId, sourceApplicationId, principalMinor, feeObligationMinor,
      allocated: allocated.map(row => row.row), takeMinor, carried, originalProof: proof, parentProof }) });
}
