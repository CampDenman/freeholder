// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C9.33/C12.38: customer-visible original consideration; no staff evidence or private bank namespaces.
import { inArray } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";
import { commercialFeeAttestations, commercialPaymentAttestations, commercialRefundAttestations } from "./commercial-attestation-schema";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReleases, invoiceCreditReservations } from "./credit-application-schema";
import { prorationMoneyWitnesses } from "./proration-money-witnesses";
export async function exportProrationMoney(tx: Tx, invoiceIds: string[]) {
  const original = await prorationMoneyWitnesses(tx, invoiceIds);
  if (original.incomplete) throw new ServiceError("conflict", "Restore the complete bounded original credit/external-money inventory before exporting its history.");
  const paymentIds = original.recordedPayments.map(row => row.id), refundIds = original.recordedRefunds.map(row => row.id), feeIds = original.recordedFees.map(row => row.id);
  const fundingIds = original.funding.map(row => row.id), reservationIds = original.reservations.map(row => row.id);
  return {
    externalPayments: paymentIds.length ? await tx.select({ paymentId: commercialPaymentAttestations.paymentId, invoiceId: commercialPaymentAttestations.invoiceId,
      amountMinor: commercialPaymentAttestations.amountMinor, currency: commercialPaymentAttestations.currency, recordedAt: commercialPaymentAttestations.createdAt })
      .from(commercialPaymentAttestations).where(inArray(commercialPaymentAttestations.paymentId, paymentIds)) : [],
    externalRefunds: refundIds.length ? await tx.select({ refundId: commercialRefundAttestations.refundId, paymentId: commercialRefundAttestations.paymentId,
      amountMinor: commercialRefundAttestations.amountMinor, currency: commercialRefundAttestations.currency, recordedAt: commercialRefundAttestations.createdAt })
      .from(commercialRefundAttestations).where(inArray(commercialRefundAttestations.refundId, refundIds)) : [],
    externalFees: feeIds.length ? await tx.select({ receiptId: commercialFeeAttestations.id, paymentId: commercialFeeAttestations.paymentId, originalRemittanceId: commercialFeeAttestations.originalRemittanceId,
      direction: commercialFeeAttestations.direction, recordedAt: commercialFeeAttestations.createdAt }).from(commercialFeeAttestations).where(inArray(commercialFeeAttestations.id, feeIds)) : [],
    creditFunding: fundingIds.length ? await tx.select({ id: invoiceCreditFunding.id, creditNoteId: invoiceCreditFunding.creditNoteId, creditNoteLineId: invoiceCreditFunding.creditNoteLineId,
      sourceInvoiceId: invoiceCreditFunding.sourceInvoiceId, sourcePaymentId: invoiceCreditFunding.sourcePaymentId, sourceApplicationId: invoiceCreditFunding.sourceApplicationId, amountMinor: invoiceCreditFunding.amountMinor,
      createdAt: invoiceCreditFunding.createdAt }).from(invoiceCreditFunding).where(inArray(invoiceCreditFunding.id, fundingIds)) : [],
    creditReservations: reservationIds.length ? await tx.select({ id: invoiceCreditReservations.id, fundingId: invoiceCreditReservations.fundingId, targetSourceId: invoiceCreditReservations.targetSourceId,
      amountMinor: invoiceCreditReservations.amountMinor, createdAt: invoiceCreditReservations.createdAt }).from(invoiceCreditReservations).where(inArray(invoiceCreditReservations.id, reservationIds)) : [],
    creditApplications: reservationIds.length ? await tx.select({ reservationId: invoiceCreditApplications.reservationId, invoiceId: invoiceCreditApplications.invoiceId, createdAt: invoiceCreditApplications.createdAt })
      .from(invoiceCreditApplications).where(inArray(invoiceCreditApplications.reservationId, reservationIds)) : [],
    creditReleases: reservationIds.length ? await tx.select({ reservationId: invoiceCreditReleases.reservationId, createdAt: invoiceCreditReleases.createdAt }).from(invoiceCreditReleases).where(inArray(invoiceCreditReleases.reservationId, reservationIds)) : [],
  };
}
