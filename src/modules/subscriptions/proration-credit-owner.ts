// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: the shared credit ledger reads an actual causal acceptance, never caller amounts.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { creditNoteLines, creditNotes, invoiceLines, invoices, payments } from "@/modules/invoicing/schema";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReservations } from "@/modules/invoicing/credit-application-schema";
import { subscriptionProrationPrincipal, subscriptionProrations, subscriptionProrationCreditUses } from "./proration-schema";
import { feeCollectionState } from "@/modules/invoicing/credit-fee-origin";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const prorationCreditSource = defineService({ name: "subscriptions.prorationCreditSource", summary: "Prove the exact accepted original credit, invoice line and real principal allocation for the shared noncash ledger.",
  kind: "query", permission: "system", external: false, input: z.object({ prorationId: z.uuid(), creditNoteId: z.uuid() }),
  output: z.object({ prorationId: z.uuid(), creditNoteId: z.uuid(), sourceInvoiceId: z.uuid(), evidenceDigest: sha,
    lines: z.array(z.object({ creditNoteLineId: z.uuid(), sourcePaymentId: z.uuid(), sourceApplicationId: z.uuid().nullable(), amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      feeObligationMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), feeProvenCollectedMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), feeCollectionState, feeEvidenceDigest: sha, feeUnexpected: z.boolean() })).min(1).max(1000) }),
  handler: async (input, ctx) => {
    const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.id, input.prorationId)).limit(1);
    const [note] = await ctx.tx.select().from(creditNotes).where(eq(creditNotes.id, input.creditNoteId)).limit(1);
    if (!accepted || !note || note.id !== accepted.creditNoteId || note.invoiceId !== accepted.originalInvoiceId || note.status !== "issued" || accepted.state === "cancelled"
      || !accepted.originalInvoiceLineId || !accepted.originalInvoiceId || note.idempotencyKey !== `subscription-proration:${accepted.id}:credit`
      || BigInt(note.totalMinor) !== BigInt(accepted.creditNetMinor) + BigInt(accepted.creditTaxMinor)) throw new ServiceError("conflict", "Restore the exact original accepted proration and its issued credit; unrelated equal-value notes cannot supply its principal.");
    const [original] = await ctx.tx.select().from(invoices).where(eq(invoices.id, accepted.originalInvoiceId)).limit(1);
    const [sourceLine] = await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.id, accepted.originalInvoiceLineId)).limit(1);
    const lines = await ctx.tx.select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, note.id)).limit(2);
    if (!original || !sourceLine || sourceLine.invoiceId !== original.id || original.sourceType !== "subscription" || original.sourceId?.split(":")[0] !== accepted.subscriptionId
      || original.currency !== accepted.snapshot.currency || original.status !== "paid" || BigInt(original.paidMinor)+BigInt(original.creditedMinor)!==BigInt(original.totalMinor) || original.refundedMinor !== 0
      || lines.length !== 1 || lines[0]!.invoiceLineId !== sourceLine.id || lines[0]!.subtotalMinor !== accepted.creditNetMinor || lines[0]!.taxMinor !== accepted.creditTaxMinor
      || accepted.creditNetMinor>sourceLine.subtotalMinor-sourceLine.discountMinor || accepted.creditTaxMinor>sourceLine.taxMinor)
      throw new ServiceError("conflict", "The issued proration credit does not reproduce its exact originally paid principal and tax line.");
    const principal = await ctx.tx.select().from(subscriptionProrationPrincipal).where(eq(subscriptionProrationPrincipal.prorationId, accepted.id)).orderBy(subscriptionProrationPrincipal.id).limit(1001);
    if (!principal.length || principal.length > 1000 || principal.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(note.totalMinor)
      || principal.some(row => row.originalEvidenceDigest !== accepted.sourceRevision)) throw new ServiceError("conflict", "Restore the complete original accepted credit-principal allocation.");
    const money = await ctx.tx.select().from(payments).where(inArray(payments.id, principal.map(row => row.sourcePaymentId))).limit(1001);
    const inheritedIds = principal.flatMap(row => row.sourceApplicationId ? [row.sourceApplicationId] : []);
    const inherited = inheritedIds.length ? await ctx.tx.select({ application: invoiceCreditApplications, funding: invoiceCreditFunding }).from(invoiceCreditApplications)
      .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId)).innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId))
      .where(inArray(invoiceCreditApplications.reservationId, inheritedIds)).limit(1001) : [];
    if (money.length !== new Set(principal.map(row => row.sourcePaymentId)).size || principal.some(row => { const payment = money.find(value => value.id === row.sourcePaymentId), parent = row.sourceApplicationId ? inherited.find(value => value.application.reservationId === row.sourceApplicationId) : null;
      return !payment || payment.status !== "succeeded" || payment.currency !== original.currency || payment.refundedMinor !== 0 || payment.amountMinor < row.amountMinor
        || (row.sourceApplicationId ? !parent || parent.application.invoiceId !== original.id || parent.funding.sourcePaymentId !== payment.id : payment.invoiceId !== original.id); }))
      throw new ServiceError("conflict", "The original credit's actual successful payment principal changed.");
    return { prorationId: accepted.id, creditNoteId: note.id, sourceInvoiceId: original.id, evidenceDigest: accepted.sourceRevision,
      lines: principal.map(row => ({ creditNoteLineId: lines[0]!.id, sourcePaymentId: row.sourcePaymentId, sourceApplicationId: row.sourceApplicationId, amountMinor: row.amountMinor,
        feeObligationMinor: row.feeObligationMinor, feeProvenCollectedMinor: row.feeProvenCollectedMinor, feeCollectionState: row.feeCollectionState, feeEvidenceDigest: row.feeEvidenceDigest, feeUnexpected: row.feeUnexpected })) };
  },
});
export const prorationCreditReleaseAllowed = defineService({ name: "subscriptions.prorationCreditReleaseAllowed", summary: "Release only an unused original credit after its accepted local obligation is actually cancelled.",
  kind: "query", permission: "system", external: false, input: z.object({ prorationId: z.uuid(), reservationId: z.uuid() }), output: z.object({ allowed: z.boolean() }),
  handler: async (input, ctx) => {
    const [source] = await ctx.tx.select({ reservation: invoiceCreditReservations, funding: invoiceCreditFunding }).from(invoiceCreditReservations)
      .innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId)).where(eq(invoiceCreditReservations.id, input.reservationId)).limit(1);
    if (!source || source.funding.prorationId !== input.prorationId) return { allowed: false };
    const targets = await ctx.tx.select({ accepted: subscriptionProrations }).from(subscriptionProrationCreditUses).innerJoin(subscriptionProrations, eq(subscriptionProrations.id, subscriptionProrationCreditUses.prorationId))
      .where(eq(subscriptionProrationCreditUses.creditNoteId, source.funding.creditNoteId)).limit(1001);
    const target = targets.find(row => source.reservation.targetSourceId === `${row.accepted.subscriptionId}:proration:${row.accepted.id}`)?.accepted;
    if (!target || target.state !== "cancelled" || target.snapshot.billingMode === "provider" || target.operationRevision !== 0) return { allowed: false };
    const [applied] = await ctx.tx.select({ id: invoiceCreditApplications.reservationId }).from(invoiceCreditApplications).where(eq(invoiceCreditApplications.reservationId, input.reservationId)).limit(1);
    const [invoice] = target.debitInvoiceId ? await ctx.tx.select().from(invoices).where(eq(invoices.id, target.debitInvoiceId)).limit(1) : [];
    return { allowed: !applied && (!invoice || invoice.status === "void" && invoice.paidMinor === 0 && invoice.creditedMinor === 0) };
  },
});
export default [prorationCreditSource, prorationCreditReleaseAllowed];
