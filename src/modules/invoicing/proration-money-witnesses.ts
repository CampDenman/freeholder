// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C9.33/C12.38: additive original-invoice children for root-owned witnesses.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { subscriptionProrations } from "@/modules/subscriptions/proration-schema";
import { commercialFeeAttestations, commercialPaymentAttestations, commercialRefundAttestations } from "./commercial-attestation-schema";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReleases, invoiceCreditReservations } from "./credit-application-schema";
import { invoices } from "./schema";

/** Hash in PostgreSQL: private actor/evidence rows do not enter merge snapshots.
 * Invoice/profile ownership is inherited through real FKs, never equal money.
 * Both source and target invoices must call this when retaining credit children. */
export async function prorationMoneyWitnesses(tx: Tx, invoiceIds: string[]) {
  const empty = { recordedPayments: [], recordedRefunds: [], recordedFees: [], funding: [], reservations: [], applications: [], releases: [], incomplete: false };
  if (!invoiceIds.length) return empty;
  if (invoiceIds.length > 5000) return { ...empty, incomplete: true };
  const hash = (row: unknown) => sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
  const recordedPayments = await tx.select({ id: commercialPaymentAttestations.paymentId, invoiceId: commercialPaymentAttestations.invoiceId, fingerprint: hash(commercialPaymentAttestations) })
    .from(commercialPaymentAttestations).where(inArray(commercialPaymentAttestations.invoiceId, invoiceIds)).orderBy(commercialPaymentAttestations.paymentId).limit(5001);
  const paymentIds = recordedPayments.map(row => row.id);
  const recordedRefunds = paymentIds.length ? await tx.select({ id: commercialRefundAttestations.refundId, paymentId: commercialRefundAttestations.paymentId, fingerprint: hash(commercialRefundAttestations) })
    .from(commercialRefundAttestations).where(inArray(commercialRefundAttestations.paymentId, paymentIds)).orderBy(commercialRefundAttestations.refundId).limit(5001) : [];
  const recordedFees = paymentIds.length ? await tx.select({ id: commercialFeeAttestations.id, paymentId: commercialFeeAttestations.paymentId, fingerprint: hash(commercialFeeAttestations) })
    .from(commercialFeeAttestations).where(inArray(commercialFeeAttestations.paymentId, paymentIds)).orderBy(commercialFeeAttestations.id).limit(5001) : [];
  const targetApplications = await tx.select({ id: invoiceCreditApplications.reservationId }).from(invoiceCreditApplications).where(inArray(invoiceCreditApplications.invoiceId, invoiceIds)).limit(5001);
  // An accepted target still owns its reserved original credit before any
  // application. Require both the actual accepted debit FK and exact source;
  // a source prefix, equal amount or today's contact cannot adopt a promise.
  const targetReservations = await tx.select({ id: invoiceCreditReservations.id }).from(invoiceCreditReservations)
    .innerJoin(invoices, and(eq(invoices.sourceType, "subscription"), eq(invoices.sourceId, invoiceCreditReservations.targetSourceId)))
    .innerJoin(subscriptionProrations, and(eq(subscriptionProrations.debitInvoiceId, invoices.id),
      sql`${invoices.sourceId}=${subscriptionProrations.subscriptionId}::text||':proration:'||${subscriptionProrations.id}::text`))
    .where(inArray(invoices.id, invoiceIds)).orderBy(invoiceCreditReservations.id).limit(5001);
  const targetIds = [...new Set([...targetApplications, ...targetReservations].map(row => row.id))];
  if (targetApplications.length > 5000 || targetReservations.length > 5000 || targetIds.length > 5000) return { ...empty, incomplete: true };
  const funding = await tx.select({ id: invoiceCreditFunding.id, invoiceId: invoiceCreditFunding.sourceInvoiceId, fingerprint: hash(invoiceCreditFunding) })
    .from(invoiceCreditFunding).where(sql`${invoiceCreditFunding.sourceInvoiceId} in (${sql.join(invoiceIds.map(id => sql`${id}::uuid`), sql`,`)})
      or exists(select 1 from invoice_credit_reservations r where r.funding_id=${invoiceCreditFunding.id} and ${targetIds.length ? sql`r.id in (${sql.join(targetIds.map(id => sql`${id}::uuid`), sql`,`)})` : sql`false`})`)
    .orderBy(invoiceCreditFunding.id).limit(5001);
  const fundingIds = funding.map(row => row.id);
  const reservations = fundingIds.length ? await tx.select({ id: invoiceCreditReservations.id, fundingId: invoiceCreditReservations.fundingId, fingerprint: hash(invoiceCreditReservations) })
    .from(invoiceCreditReservations).where(inArray(invoiceCreditReservations.fundingId, fundingIds)).orderBy(invoiceCreditReservations.id).limit(5001) : [];
  const reservationIds = reservations.map(row => row.id);
  const applications = reservationIds.length ? await tx.select({ id: invoiceCreditApplications.reservationId, invoiceId: invoiceCreditApplications.invoiceId, fingerprint: hash(invoiceCreditApplications) })
    .from(invoiceCreditApplications).where(inArray(invoiceCreditApplications.reservationId, reservationIds)).orderBy(invoiceCreditApplications.reservationId).limit(5001) : [];
  const releases = reservationIds.length ? await tx.select({ id: invoiceCreditReleases.reservationId, fingerprint: hash(invoiceCreditReleases) }).from(invoiceCreditReleases)
    .where(inArray(invoiceCreditReleases.reservationId, reservationIds)).orderBy(invoiceCreditReleases.reservationId).limit(5001) : [];
  const incomplete = recordedPayments.length + recordedRefunds.length + recordedFees.length + funding.length + reservations.length + applications.length + releases.length > 5000;
  return { recordedPayments, recordedRefunds, recordedFees, funding, reservations, applications, releases, incomplete };
}
