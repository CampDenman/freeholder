// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: collect only the new duty not already assigned to exact credit.
import { eq } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import type { invoices } from "./schema";
import { agreementFeeDuties } from "./agreement-fee-schema";
import { isGrossAgreementInvoice } from "./agreement-fee-store";
import { invoiceCreditApplications, invoiceCreditReservations } from "./credit-application-schema";
import { proportionalFeeCarry, remainingCashFeeBudget } from "./credit-fee-amounts";

export async function invoiceCashFeeAllocation(ctx: ServiceContext, invoice: typeof invoices.$inferSelect, originalFeeMinor: number, input: { amountMinor: number; priorCashMinor: number; priorAllocatedFeeMinor: number }) {
  const applications = await ctx.tx.select({ application: invoiceCreditApplications, amountMinor: invoiceCreditReservations.amountMinor }).from(invoiceCreditApplications)
    .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId)).where(eq(invoiceCreditApplications.invoiceId, invoice.id)).limit(5001);
  if (applications.length > 5000 || applications.some(row => !row.application.feeEvidenceDigest)
    || applications.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(invoice.creditedMinor))
    throw new ServiceError("conflict", "Restore every original credit application and exact fee owner before allocating a new cash commission.");
  const carriedFeeMinor = applications.reduce((sum, row) => sum + row.application.feeObligationMinor, 0);
  const budget = remainingCashFeeBudget(invoice.totalMinor, originalFeeMinor, invoice.creditedMinor, carriedFeeMinor);
  let physicalFeeTargetMinor = budget.feeObligationMinor;
  if (isGrossAgreementInvoice(invoice)) {
    const [duty] = await ctx.tx.select().from(agreementFeeDuties).where(eq(agreementFeeDuties.invoiceId, invoice.id)).limit(1);
    if (!duty || duty.totalMinor !== invoice.totalMinor || duty.targetFeeMinor !== originalFeeMinor || duty.creditedMinor !== invoice.creditedMinor
      || duty.carriedFeeMinor !== carriedFeeMinor || duty.cashPrincipalMinor !== budget.principalMinor)
      throw new ServiceError("conflict", "Retain this exact accepted target's frozen cash and noncash commission assignments before another physical charge.");
    physicalFeeTargetMinor = duty.cashFeeTargetMinor;
  } else if (budget.feeObligationMinor > budget.principalMinor) throw new ServiceError("conflict", "The original fee duty requires its own bounded assignment before another collection.");
  return { feeMinor: proportionalFeeCarry({ principalMinor: budget.principalMinor, feeObligationMinor: physicalFeeTargetMinor,
    allocatedPrincipalMinor: input.priorCashMinor, allocatedFeeMinor: input.priorAllocatedFeeMinor, takeMinor: input.amountMinor }), carriedFeeMinor, ...budget };
}
