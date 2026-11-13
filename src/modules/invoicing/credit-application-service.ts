// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: real noncash credit disposition; original cash remains cash.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, getService, ServiceError, type ServiceContext } from "@/core/service";
import { creditNoteLines, creditNotes, invoiceLines, invoiceMarketPolicies, invoices, payments } from "./schema";
import { invoiceMerchantTaxQuotes } from "./merchant-tax-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { assertInvoiceMerchantCreatorsQuiesced } from "./merchant-payment-request";
import { invoiceOutstanding, invoiceSettled } from "./invoice-balance";
import { creditNoteDisposition } from "./credit-disposition";
import { principalAuthorityResult } from "./principal-authority-contract";
import { feeCollectionState, originalCreditFeeAllocation } from "./credit-fee-origin";
import { compareCreditSources, proportionalFeeCarry } from "./credit-fee-amounts";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReleases, invoiceCreditReservations } from "./credit-application-schema";
const minor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER), sha = z.string().regex(/^[a-f0-9]{64}$/);
const originalFunding = z.object({ prorationId: z.uuid(), creditNoteId: z.uuid(), sourceInvoiceId: z.uuid(), evidenceDigest: sha,
  lines: z.array(z.object({ creditNoteLineId: z.uuid(), sourcePaymentId: z.uuid(), sourceApplicationId: z.uuid().nullable(), amountMinor: minor,
    feeObligationMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), feeProvenCollectedMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), feeCollectionState, feeEvidenceDigest: sha, feeUnexpected: z.boolean() })).min(1).max(1000) });
async function ready(ctx: ServiceContext) {
  const [result] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=15 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
    ((to_regclass('invoice_credit_funding'),'invoice_credit_funding_guard'),(to_regclass('invoice_credit_reservations'),'invoice_credit_reservations_guard'),
     (to_regclass('invoice_credit_applications'),'invoice_credit_applications_guard'),(to_regclass('invoice_credit_releases'),'invoice_credit_releases_guard'),
     (to_regclass('invoices'),'invoice_credit_projection_guard'),(to_regclass('credit_notes'),'credit_note_live_disposition_guard'),(to_regclass('refunds'),'refund_credit_principal_guard'),
     (to_regclass('return_requests'),'return_credit_reverse_owner_guard'),(to_regclass('invoice_credit_funding'),'invoice_credit_funding_complete'),
     (to_regclass('invoice_credit_applications'),'invoice_credit_application_projection'),
     (to_regclass('invoice_credit_funding'),'invoice_credit_fee_funding_guard'),(to_regclass('invoice_credit_reservations'),'invoice_credit_fee_reservations_guard'),
     (to_regclass('invoice_credit_applications'),'invoice_credit_fee_applications_guard'),(to_regclass('credit_notes'),'credit_fee_note_promise_guard'),(to_regclass('invoices'),'credit_invoice_void_guard'))`);
  if (!result?.ready) throw new ServiceError("conflict", "Install the complete guarded noncash credit application schema before reserving original money.");
}
/** Match the original payment -> invoice -> credit-note lock order used by RMA.
 * There is no provider I/O here and no note-first wait for a payment owner. */
async function lockOriginal(ctx: ServiceContext, creditNoteId: string, extraInvoiceId?: string) {
  const [note] = await ctx.tx.select().from(creditNotes).where(eq(creditNotes.id, creditNoteId)).limit(1);
  if (!note) throw new ServiceError("not_found", "The original issued credit note is unavailable.");
  const sourceMoney = await ctx.tx.select().from(payments).where(eq(payments.invoiceId, note.invoiceId)).orderBy(asc(payments.id)).limit(5001);
  if (sourceMoney.length > 5000) throw new ServiceError("conflict", "Restore the complete bounded original payment inventory before credit disposition.");
  for (const payment of sourceMoney) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${payment.id}`}))`);
  for (const id of [...new Set([note.invoiceId, ...(extraInvoiceId ? [extraInvoiceId] : [])])].sort()) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${id}`}))`);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit-note:${creditNoteId}`}))`);
  return note;
}
async function notReturn(ctx: ServiceContext, creditNoteId: string) {
  const [returned] = await ctx.tx.execute<{ owned: boolean }>(sql`select exists(select 1 from return_requests where credit_note_id=${creditNoteId}::uuid) as owned`);
  if (returned?.owned) throw new ServiceError("conflict", "This exact credit already backs an original return/refund promise. It cannot also be applied as another invoice's credit.");
}
async function originalSource(ctx: ServiceContext, prorationId: string, creditNoteId: string) {
  const resolver = getService("subscriptions.prorationCreditSource");
  if (!resolver) throw new ServiceError("conflict", "Restore the original accepted proration credit owner before funding its exact issued note.");
  return originalFunding.parse(await ctx.callAsSystem(resolver, { prorationId, creditNoteId }));
}
async function principalCurrent(ctx: ServiceContext, sourcePaymentIds: string[]) {
  const debt = getService("invoicing.originalPrincipalAuthority");
  if (!debt) throw new ServiceError("conflict", "Restore the shared original principal recovery authority before credit disposition.");
  for (const paymentId of [...new Set(sourcePaymentIds)].sort()) {
    const [source] = await ctx.tx.select({ payment: payments, policy: invoiceMarketPolicies }).from(payments).leftJoin(invoiceMarketPolicies, eq(invoiceMarketPolicies.invoiceId, payments.invoiceId)).where(eq(payments.id, paymentId)).limit(1);
    if (!source || source.payment.status !== "succeeded" || source.payment.refundedMinor !== 0) throw new ServiceError("conflict", "Restore the actual successful, unreturned principal before credit disposition.");
    if (source.payment.provider === "manual" && source.policy?.model !== "seller_merchant") continue; // Ordinary owner-recorded cash; never manufacture a Stripe namespace.
    if (!principalAuthorityResult.parse(await ctx.callAsSystem(debt, { paymentId })).principalSafe)
      throw new ServiceError("conflict", "The original credit principal has unresolved callers or current bank obligations; preserve the whole credit and recover its actual source first.");
  }
}
export const fundProrationCredit = defineService({ name: "invoicing.fundProrationCredit", summary: "Bind an original issued proration credit to its actual invoice lines and successful principal, without moving cash.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["prorationId", "creditNoteId"],
  input: z.object({ prorationId: z.uuid(), creditNoteId: z.uuid() }), output: z.object({ funded: z.literal(true), rows: z.number().int() }),
  handler: async (input, ctx) => {
    await ready(ctx); const proposed = await originalSource(ctx, input.prorationId, input.creditNoteId); await lockOriginal(ctx, input.creditNoteId); await notReturn(ctx, input.creditNoteId);
    const actual = await originalSource(ctx, input.prorationId, input.creditNoteId);
    if (merchantTaxDigest(actual) !== merchantTaxDigest(proposed)) throw new ServiceError("conflict", "The original accepted credit and its principal changed before funding.");
    const [note] = await ctx.tx.select().from(creditNotes).where(eq(creditNotes.id, input.creditNoteId)).limit(1);
    if (!note || note.status !== "issued" || note.invoiceId !== actual.sourceInvoiceId || actual.prorationId !== input.prorationId || actual.creditNoteId !== note.id) throw new ServiceError("conflict", "Restore this exact issued credit's original accepted proration owner.");
    const existing = await ctx.tx.select().from(invoiceCreditFunding).where(eq(invoiceCreditFunding.creditNoteId, note.id)).orderBy(invoiceCreditFunding.id).limit(1001);
    if (existing.length) {
      if (existing.length !== actual.lines.length || existing.some(row => row.prorationId !== actual.prorationId || row.originalEvidenceDigest !== actual.evidenceDigest || !row.feeEvidenceDigest || !actual.lines.some(source => source.sourcePaymentId === row.sourcePaymentId
        && source.sourceApplicationId === row.sourceApplicationId && source.amountMinor === row.amountMinor && source.feeObligationMinor === row.feeObligationMinor && source.feeProvenCollectedMinor === row.feeProvenCollectedMinor
        && source.feeCollectionState === row.feeCollectionState && source.feeEvidenceDigest === row.feeEvidenceDigest && source.feeUnexpected === row.feeUnexpected))
        || existing.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(note.totalMinor)) throw new ServiceError("conflict", "Preserve the complete original credit funding receipt.");
      return { funded: true as const, rows: existing.length };
    }
    if (actual.lines.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(note.totalMinor)) throw new ServiceError("conflict", "The exact original issued credit must be completely funded by its actual original principal.");
    const originalLines = await ctx.tx.select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, note.id)).orderBy(creditNoteLines.id).limit(1001);
    if (originalLines.length > 1000 || originalLines.some(line => actual.lines.filter(source => source.creditNoteLineId === line.id).reduce((sum, source) => sum + BigInt(source.amountMinor), 0n) !== BigInt(line.totalMinor))
      || actual.lines.some(source => !originalLines.some(line => line.id === source.creditNoteLineId))) throw new ServiceError("conflict", "Each exact original credit line needs its complete own principal; equal totals cannot borrow another line's credit.");
    for (const source of [...actual.lines].sort(compareCreditSources)) {
      const [line] = await ctx.tx.select({ credit: creditNoteLines, original: invoiceLines }).from(creditNoteLines).innerJoin(invoiceLines, eq(invoiceLines.id, creditNoteLines.invoiceLineId))
        .where(eq(creditNoteLines.id, source.creditNoteLineId)).limit(1);
      const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, source.sourcePaymentId)).limit(1);
      const [parent] = source.sourceApplicationId ? await ctx.tx.select({ application: invoiceCreditApplications, funding: invoiceCreditFunding }).from(invoiceCreditApplications)
        .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId)).innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId))
        .where(eq(invoiceCreditApplications.reservationId, source.sourceApplicationId)).limit(1) : [];
      if (!line || line.credit.creditNoteId !== note.id || line.original.invoiceId !== note.invoiceId || !payment || payment.status !== "succeeded" || payment.currency !== note.currency
        || (source.sourceApplicationId ? !parent || parent.application.invoiceId !== note.invoiceId || parent.funding.sourcePaymentId !== payment.id : payment.invoiceId !== note.invoiceId))
        throw new ServiceError("conflict", "This credit's actual original line, successful principal or currency changed.");
      await principalCurrent(ctx, [payment.id]);
      const fee = await originalCreditFeeAllocation(ctx, source.sourcePaymentId, source.sourceApplicationId, source.amountMinor);
      if (fee.feeObligationMinor !== source.feeObligationMinor || fee.provenCollectedMinor !== source.feeProvenCollectedMinor || fee.collectionState !== source.feeCollectionState || fee.evidenceDigest !== source.feeEvidenceDigest || fee.unexpectedFee !== source.feeUnexpected)
        throw new ServiceError("conflict", "The original fee duty or actual collection proof changed; review its exact source before freezing another credit promise.");
      await ctx.tx.execute(sql`select set_config('freeholder.invoice_credit_v1','1',true)`);
      await ctx.tx.insert(invoiceCreditFunding).values({ id: randomUUID(), creditNoteId: note.id, creditNoteLineId: line.credit.id, sourceInvoiceId: note.invoiceId, sourcePaymentId: payment.id,
        sourceApplicationId: source.sourceApplicationId, prorationId: actual.prorationId, amountMinor: source.amountMinor, originalEvidenceDigest: actual.evidenceDigest,
        feeObligationMinor: source.feeObligationMinor, feeProvenCollectedMinor: source.feeProvenCollectedMinor, feeCollectionState: source.feeCollectionState, feeEvidenceDigest: source.feeEvidenceDigest, feeUnexpected: source.feeUnexpected });
    }
    ctx.setSubject("creditNote", note.id); return { funded: true as const, rows: actual.lines.length };
  },
});
export const reserveInvoiceCredit = defineService({ name: "invoicing.reserveInvoiceCredit", summary: "Reserve an exact issued noncash credit for one accepted proration source, preserving original refund promises.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ creditNoteId: z.uuid(), targetSourceId: z.string().min(1).max(300), amountMinor: minor, idempotencyKey: z.string().min(1).max(200), expectedRevision: sha }),
  output: z.object({ reservationIds: z.array(z.uuid()).max(1000), reservedMinor: minor }),
  handler: async (input, ctx) => {
    await ready(ctx); await lockOriginal(ctx, input.creditNoteId); await notReturn(ctx, input.creditNoteId);
    const prefix = `invoice-credit:${merchantTaxDigest({ creditNoteId: input.creditNoteId, key: input.idempotencyKey })}`, requestDigest = merchantTaxDigest(input);
    const prior = await ctx.tx.select().from(invoiceCreditReservations).where(like(invoiceCreditReservations.idempotencyKey, `${prefix}:%`)).orderBy(invoiceCreditReservations.id).limit(1001);
    if (prior.length) {
      if (prior.length > 1000 || prior.some(row => row.requestDigest !== requestDigest) || prior.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(input.amountMinor)) throw new ServiceError("conflict", "Preserve the first original credit reservation; this request key has different money or ownership.");
      return { reservationIds: prior.map(row => row.id), reservedMinor: input.amountMinor };
    }
    const disposition = await creditNoteDisposition(ctx.tx, input.creditNoteId);
    const available = disposition.restrictedToSourceId === input.targetSourceId ? disposition.lockedMinor : disposition.availableMinor;
    if (disposition.reviewRequired || disposition.reservedForReturns || disposition.revision !== input.expectedRevision || available < input.amountMinor) throw new ServiceError("conflict", "Review this exact original credit's current available or exclusively bound principal before reserving it.");
    const funding = await ctx.tx.select().from(invoiceCreditFunding).where(eq(invoiceCreditFunding.creditNoteId, input.creditNoteId)).orderBy(invoiceCreditFunding.id).limit(1001);
    if (funding.length > 1000) throw new ServiceError("conflict", "Restore the bounded complete original credit funding inventory.");
    await principalCurrent(ctx, funding.map(row => row.sourcePaymentId));
    let remaining = input.amountMinor; const reservationIds: string[] = [];
    for (const source of [...funding].sort(compareCreditSources)) {
      const [budget] = await ctx.tx.execute<{ available: number; principal: number; fee: number; proven: number }>(sql`select (${source.amountMinor}::bigint-coalesce(sum(r.amount_minor) filter(where a.reservation_id is not null or l.reservation_id is null),0))::float8 available,
        coalesce(sum(r.amount_minor) filter(where a.reservation_id is not null or l.reservation_id is null),0)::float8 principal,
        coalesce(sum(r.fee_obligation_minor) filter(where a.reservation_id is not null or l.reservation_id is null),0)::float8 fee,
        coalesce(sum(r.fee_proven_collected_minor) filter(where a.reservation_id is not null or l.reservation_id is null),0)::float8 proven
        from invoice_credit_reservations r left join invoice_credit_applications a on a.reservation_id=r.id left join invoice_credit_releases l on l.reservation_id=r.id where r.funding_id=${source.id}::uuid`);
      const take = Math.min(remaining, budget?.available ?? 0); if (take <= 0) continue;
      const live = await originalCreditFeeAllocation(ctx, source.sourcePaymentId, source.sourceApplicationId, 0);
      if (!source.feeEvidenceDigest || ["verified_collected", "recorded_remitted", "not_due"].includes(source.feeCollectionState) && source.feeCollectionState !== live.collectionState || live.unexpectedFee && !source.feeUnexpected)
        throw new ServiceError("conflict", "New contrary original fee proof requires fresh review; preserve this whole original credit and target.");
      const feeObligationMinor = proportionalFeeCarry({ principalMinor: source.amountMinor, feeObligationMinor: source.feeObligationMinor, allocatedPrincipalMinor: budget?.principal ?? 0, allocatedFeeMinor: budget?.fee ?? 0, takeMinor: take });
      const feeProvenCollectedMinor = proportionalFeeCarry({ principalMinor: source.amountMinor, feeObligationMinor: source.feeProvenCollectedMinor, allocatedPrincipalMinor: budget?.principal ?? 0, allocatedFeeMinor: budget?.proven ?? 0, takeMinor: take });
      const id = randomUUID(); await ctx.tx.execute(sql`select set_config('freeholder.invoice_credit_v1','1',true)`);
      await ctx.tx.insert(invoiceCreditReservations).values({ id, fundingId: source.id, targetSourceId: input.targetSourceId, amountMinor: take, idempotencyKey: `${prefix}:${source.id}`, requestDigest,
        feeObligationMinor, feeProvenCollectedMinor, feeCollectionState: source.feeCollectionState, feeUnexpected: source.feeUnexpected,
        feeEvidenceDigest: merchantTaxDigest({ sourceFeeDigest: source.feeEvidenceDigest, fundingId: source.id, targetSourceId: input.targetSourceId, take, feeObligationMinor, feeProvenCollectedMinor, liveFeeProof: live.evidenceDigest }) });
      reservationIds.push(id); remaining -= take; if (!remaining) break;
    }
    if (remaining) throw new ServiceError("conflict", "Restore the actual unspent original credit principal before reserving this amount.");
    ctx.setSubject("creditNote", input.creditNoteId); return { reservationIds, reservedMinor: input.amountMinor };
  },
});
async function matchingParties(ctx: ServiceContext, sourceInvoiceId: string, target: typeof invoices.$inferSelect) {
  const [source] = await ctx.tx.select().from(invoices).where(eq(invoices.id, sourceInvoiceId)).limit(1);
  if (!source || source.contactId !== target.contactId || source.currency !== target.currency || source.refundedMinor !== 0) throw new ServiceError("conflict", "Original credit and target invoice must retain the same actual buyer/currency and unreturned principal.");
  const policies = await ctx.tx.select().from(invoiceMarketPolicies).where(inArray(invoiceMarketPolicies.invoiceId, [source.id, target.id]));
  const before = policies.find(row => row.invoiceId === source.id), after = policies.find(row => row.invoiceId === target.id);
  for (const field of ["model", "sellerUserId", "merchantContactId", "providerAccountId", "siteFeeBps"] as const) if ((before?.[field] ?? null) !== (after?.[field] ?? null)) throw new ServiceError("conflict", "Credit cannot move to another original merchant or fee contract.");
  const taxes = await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(inArray(invoiceMerchantTaxQuotes.invoiceId, [source.id, target.id]));
  const sourceParties = taxes.filter(row => row.invoiceId === source.id).map(row => [row.sellerKey, row.profileId, row.liability]).sort(), targetParties = taxes.filter(row => row.invoiceId === target.id).map(row => [row.sellerKey, row.profileId, row.liability]).sort();
  if (merchantTaxDigest(sourceParties) !== merchantTaxDigest(targetParties)) throw new ServiceError("conflict", "Credit must remain with its exact original declared tax merchant.");
  return { source, before, after, sourceParties };
}
export const applyInvoiceCredit = defineService({ name: "invoicing.applyInvoiceCredit", summary: "Apply an exact reserved original credit without creating a payment or changing paid cash.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ reservationId: z.uuid(), invoiceId: z.uuid() }), output: z.object({ applied: z.literal(true), creditedMinor: minor }),
  handler: async (input, ctx) => {
    await ready(ctx);
    const [identity] = await ctx.tx.select({ reservation: invoiceCreditReservations, funding: invoiceCreditFunding }).from(invoiceCreditReservations).innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId))
      .where(eq(invoiceCreditReservations.id, input.reservationId)).limit(1);
    if (!identity) throw new ServiceError("not_found", "The original credit reservation is unavailable.");
    await lockOriginal(ctx, identity.funding.creditNoteId, input.invoiceId); await notReturn(ctx, identity.funding.creditNoteId);
    await principalCurrent(ctx, [identity.funding.sourcePaymentId]);
    const [target] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1).for("update");
    const [release] = await ctx.tx.select().from(invoiceCreditReleases).where(eq(invoiceCreditReleases.reservationId, input.reservationId)).limit(1);
    const [prior] = await ctx.tx.select().from(invoiceCreditApplications).where(eq(invoiceCreditApplications.reservationId, input.reservationId)).limit(1);
    if (prior) { if (prior.invoiceId !== input.invoiceId) throw new ServiceError("conflict", "The original credit was already applied to another exact invoice."); return { applied: true as const, creditedMinor: identity.reservation.amountMinor }; }
    if (!target || release || target.sourceType !== "subscription" || target.sourceId !== identity.reservation.targetSourceId || !target.issuedAt || !["sent", "viewed", "partially_paid", "overdue"].includes(target.status)
      || invoiceOutstanding(target) < identity.reservation.amountMinor) throw new ServiceError("conflict", "Restore the exact issued target invoice and original unused credit reservation.");
    const [pending] = await ctx.tx.select({ id: payments.id }).from(payments).where(and(eq(payments.invoiceId, target.id), inArray(payments.status, ["created", "processing"]))).limit(1);
    if (pending) throw new ServiceError("conflict", "An original target payment caller remains unresolved. Finish or authentically recover it before applying credit.");
    await assertInvoiceMerchantCreatorsQuiesced(ctx, target.id);
    const owner = await matchingParties(ctx, identity.funding.sourceInvoiceId, target);
    const [note] = await ctx.tx.select().from(creditNotes).where(eq(creditNotes.id, identity.funding.creditNoteId)).limit(1);
    if (note?.status !== "issued") throw new ServiceError("conflict", "The original credit note must remain issued.");
    const creditedMinor = target.creditedMinor + identity.reservation.amountMinor, settled = invoiceSettled({ ...target, creditedMinor });
    const liveFee = await originalCreditFeeAllocation(ctx, identity.funding.sourcePaymentId, identity.funding.sourceApplicationId, 0);
    if (!identity.reservation.feeEvidenceDigest || ["verified_collected", "recorded_remitted", "not_due"].includes(identity.reservation.feeCollectionState) && identity.reservation.feeCollectionState !== liveFee.collectionState || liveFee.unexpectedFee && !identity.reservation.feeUnexpected)
      throw new ServiceError("conflict", "The original fee evidence changed after reservation; preserve its whole actual consideration and review fresh consent.");
    await ctx.tx.execute(sql`select set_config('freeholder.invoice_credit_v1','1',true)`);
    await ctx.tx.insert(invoiceCreditApplications).values({ reservationId: input.reservationId, invoiceId: target.id, originalOwnerDigest: merchantTaxDigest(owner),
      feeObligationMinor: identity.reservation.feeObligationMinor, feeProvenCollectedMinor: identity.reservation.feeProvenCollectedMinor, feeCollectionState: identity.reservation.feeCollectionState, feeUnexpected: identity.reservation.feeUnexpected,
      feeEvidenceDigest: merchantTaxDigest({ reservationId: identity.reservation.id, originalFeeProof: identity.reservation.feeEvidenceDigest, liveFeeProof: liveFee.evidenceDigest, owner }) });
    await ctx.tx.update(invoices).set({ creditedMinor, status: settled ? "paid" : "partially_paid", ...(settled ? { paidAt: new Date() } : {}) }).where(eq(invoices.id, target.id));
    ctx.queueEvent(settled ? "invoice.paid" : "invoice.partiallyPaid", { invoiceId: target.id, contactId: target.contactId, paidMinor: target.paidMinor, creditedMinor });
    ctx.setSubject("invoice", target.id); return { applied: true as const, creditedMinor: identity.reservation.amountMinor };
  },
});
export const releaseInvoiceCredit = defineService({ name: "invoicing.releaseInvoiceCredit", summary: "Release only an unused original noncash credit reservation, retaining its issued credit promise and history.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money", input: z.object({ reservationId: z.uuid(), reason: z.string().trim().min(3).max(1000) }), output: z.object({ released: z.literal(true) }),
  handler: async (input, ctx) => {
    await ready(ctx); const [identity] = await ctx.tx.select({ reservation: invoiceCreditReservations, funding: invoiceCreditFunding }).from(invoiceCreditReservations)
      .innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId)).where(eq(invoiceCreditReservations.id, input.reservationId)).limit(1);
    if (!identity) throw new ServiceError("not_found", "The original credit reservation is unavailable.");
    await lockOriginal(ctx, identity.funding.creditNoteId);
    const [applied] = await ctx.tx.select().from(invoiceCreditApplications).where(eq(invoiceCreditApplications.reservationId, input.reservationId)).limit(1);
    if (applied) throw new ServiceError("conflict", "Applied original credit cannot be released or spent twice.");
    const releaseAuthority = getService("subscriptions.prorationCreditReleaseAllowed");
    if (!releaseAuthority || !z.object({ allowed: z.boolean() }).parse(await ctx.callAsSystem(releaseAuthority, { prorationId: identity.funding.prorationId, reservationId: input.reservationId })).allowed)
      throw new ServiceError("conflict", "The original accepted proration still holds this credit for its actual provider/canonical obligation. Resolve that whole original promise before release.");
    await ctx.tx.execute(sql`select set_config('freeholder.invoice_credit_v1','1',true)`);
    await ctx.tx.insert(invoiceCreditReleases).values({ reservationId: input.reservationId, reviewedBy: actorString(ctx.actor), reasonDigest: merchantTaxDigest(input.reason) }).onConflictDoNothing();
    ctx.setSubject("creditNote", identity.funding.creditNoteId); return { released: true as const };
  },
});
export default [fundProrationCredit, reserveInvoiceCredit, applyInvoiceCredit, releaseInvoiceCredit];
