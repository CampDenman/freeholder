// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C9.38/C12.38: actual canonical gross consideration and future effective access.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { syncSubscriptionAccess } from "@/core/entitlements/service";
import { enqueueJob } from "@/core/jobs";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import { actorString, defineService, getService, ServiceError, type ServiceContext } from "@/core/service";
import { createCreditNote, createDraftInvoice, issueCreditNote, issueInvoice } from "@/modules/invoicing/invoice-service";
import { invoices, invoiceLines, payments } from "@/modules/invoicing/schema";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReservations } from "@/modules/invoicing/credit-application-schema";
import { creditNoteDisposition } from "@/modules/invoicing/credit-disposition";
import { invoiceSettled } from "@/modules/invoicing/invoice-balance";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { merchantTaxSourceParty, merchantTaxSourceRequest } from "@/modules/invoicing/merchant-tax-invoice";
import { subscriptionCommercialTerms, subscriptionEvents, subscriptionMarketPolicies, subscriptions } from "./schema";
import { subscriptionProrationPrincipal, subscriptionProrations, subscriptionProrationCreditUses } from "./proration-schema";
import { grossProrationInput, ownGrossProration, prepareGrossProrationQuote, requireGrossProrationSchema } from "./proration-quote";
import { safeProrationPrincipal } from "./proration-basis";
import { captureAgreementFeeDuty, retainAgreementFeeEligibility } from "@/modules/invoicing/agreement-fee-store";
import { originalCreditFeeAllocation } from "@/modules/invoicing/credit-fee-origin";
import { prorationBoundaryFunded } from "./proration-boundary";
import { originalMerchantTerms } from "./merchant-terms-read";

export const APPLY_GROSS_PRORATION_JOB = "subscriptions.applyGrossProration";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const grossProrationTask = z.object({ prorationId: z.uuid(), subscriptionId: z.uuid(), originalJobId: z.uuid(), acceptedQuoteDigest: sha }).strict();
const acceptance = grossProrationInput.extend({ previousTermsId: z.uuid(), acceptedQuoteDigest: sha, confirm: z.literal(true) });
const result = z.object({ prorationId: z.uuid(), invoiceId: z.uuid().nullable(), creditNoteId: z.uuid().nullable(), effectiveAt: z.iso.datetime(),
  state: z.enum(["accepted", "preparing", "awaiting_invoice", "awaiting_payment", "awaiting_effective", "applied", "cancelled", "review"]) });
function view(row: typeof subscriptionProrations.$inferSelect) { return { prorationId: row.id, invoiceId: row.debitInvoiceId, creditNoteId: row.creditNoteId, effectiveAt: row.effectiveAt.toISOString(), state: row.state }; }
async function command(ctx: ServiceContext, name: string, input: unknown) {
  const service = getService(name); if (!service) throw new ServiceError("conflict", "Restore the complete shared canonical credit disposition before creating this accepted money promise.");
  return ctx.callAsSystem(service, input);
}
async function write(ctx: ServiceContext) { await ctx.tx.execute(sql`select set_config('freeholder.subscription_proration_v1','1',true)`); }

async function accept(ctx: ServiceContext, input: z.infer<typeof acceptance>) {
  await requireGrossProrationSchema(ctx); await lockContactIdentity(ctx.tx);
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, input.id)).limit(1).for("update");
  if (!parent) throw new ServiceError("not_found", "There is no such subscription.");
  const [replay] = await ctx.tx.select().from(subscriptionProrations).where(and(eq(subscriptionProrations.subscriptionId, input.id), eq(subscriptionProrations.acceptedQuoteDigest, input.acceptedQuoteDigest))).limit(1);
  if (replay) return view(replay);
  const prepared = await prepareGrossProrationQuote(ctx, input);
  if (prepared.previous.id !== input.previousTermsId || prepared.review.quoteDigest !== input.acceptedQuoteDigest)
    throw new ServiceError("conflict", "The original principal, price, tax, calendar or exact credit capacity changed. Review a fresh explicit quote.");
  if (prepared.review.requiresMerchantReview) throw new ServiceError("conflict", "This change needs its original merchant fee review before accepting any payment or credit promise.");
  const { basis, economic, effectiveAt } = prepared;
  // Preserve shared lock order: original payments, invoices, then original notes.
  for (const id of [...new Set(basis.principal.map(row => row.sourcePaymentId))].sort()) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`);
  if (basis.invoice) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${basis.invoice.id}`}))`);
  const checked = await prepareGrossProrationQuote(ctx, input);
  if (checked.review.quoteDigest !== prepared.review.quoteDigest) throw new ServiceError("conflict", "The original current money or accepted offer changed while locking its exact principal. Review it again.");
  const id = randomUUID(), termsId = randomUUID(), originalJobId = randomUUID(), acceptedAt = new Date();
  if (acceptedAt >= effectiveAt) throw new ServiceError("conflict", "This effective instant expired before acceptance. Review a fresh future instant; access is never backdated.");
  await write(ctx);
  await ctx.tx.insert(subscriptionProrations).values({ id, subscriptionId: parent.id, planId: input.planId, previousTermsId: prepared.previous.id, termsId,
    snapshot: economic.snapshot, profileId: economic.profile.profileId, profileVersion: economic.profile.profileVersion, taxDestination: economic.taxDestination,
    debitTaxQuote: prepared.debitTaxQuote, noticeDigest: prepared.noticeDigest, noticeSnapshot: prepared.noticeSnapshot, quoteOccurredAt: economic.quoteOccurredAt,
    acceptedQuoteDigest: input.acceptedQuoteDigest, sourceRevision: basis.sourceRevision, acceptedBy: actorString(ctx.actor), effectiveAt,
    originalPeriodStart: parent.currentPeriodStart, originalPeriodEnd: parent.currentPeriodEnd, originalTrialEndsAt: parent.status === "trialing" ? parent.trialEndsAt : null,
    proposedPeriodStart: effectiveAt, proposedPeriodEnd: parent.currentPeriodEnd, basisPeriodStart: basis.periodStart, basisPeriodEnd: basis.periodEnd,
    originalInvoiceId: basis.invoice?.id ?? null, originalInvoiceLineId: basis.line?.id ?? null, debitNetMinor: prepared.review.debitNetMinor, debitTaxMinor: prepared.review.debitTaxMinor,
    creditNetMinor: basis.creditNetMinor, creditTaxMinor: basis.creditTaxMinor,
    debitFeeObligationMinor: prepared.feeReview.debitFeeObligationMinor, creditFeeObligationMinor: prepared.feeReview.creditFeeObligationMinor,
    appliedFeeObligationMinor: prepared.feeReview.appliedFeeObligationMinor, appliedFeeProvenCollectedMinor: prepared.feeReview.appliedFeeProvenCollectedMinor, state: "accepted" });
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_terms_v1','1',true),set_config('freeholder.subscription_amendment_v1','1',true)`);
  await ctx.tx.insert(subscriptionCommercialTerms).values({ id: termsId, subscriptionId: parent.id, revision: prepared.previous.revision + 1, previousTermsId: prepared.previous.id,
    snapshot: economic.snapshot, profileId: economic.profile.profileId, profileVersion: economic.profile.profileVersion, taxLiability: economic.profile.liability, taxDestination: economic.taxDestination,
    acceptedQuoteDigest: input.acceptedQuoteDigest, initialTaxQuote: economic.initialTaxQuote, firstPeriodTaxQuote: economic.firstPeriodTaxQuote, renewalTaxQuote: economic.renewalTaxQuote,
    noticeDigest: prepared.noticeDigest, noticeSnapshot: prepared.noticeSnapshot, quoteOccurredAt: economic.quoteOccurredAt, effectivePeriodStart: parent.currentPeriodEnd, acceptedAt, acceptanceSource: "amendment" });
  let invoiceId: string | null = null, creditNoteId: string | null = null;
  if (parent.status !== "trialing") {
    const sourceId = `${parent.id}:proration:${id}`;
    const draft = await ctx.callAsSystem(createDraftInvoice, { contactId: parent.contactId, currency: parent.currency, sourceType: "subscription", sourceId,
      idempotencyKey: `subscription-proration:${id}:debit`, dueAt: effectiveAt,
      lines: [{ sourceType: "subscription", sourceId: parent.id, description: economic.snapshot.name, quantityMicros: 1000000, unitAmountMinor: prepared.review.debitNetMinor,
        discountMinor: 0, taxCategoryCode: economic.snapshot.taxCategoryCode, requiresShipping: economic.snapshot.requiresShipping,
        snapshot: { subscriptionProrationId: id, subscriptionTermsId: termsId, subscriptionComponent: "proration_debit", subscriptionPeriodStart: effectiveAt.toISOString(), subscriptionPeriodEnd: parent.currentPeriodEnd.toISOString() } }],
      tax: { mode: "merchant", destination: economic.taxDestination, quoteDigest: prepared.debitTaxQuote.quoteDigest } });
    invoiceId = draft.invoice.id;
    if (draft.invoice.totalMinor !== prepared.debitTaxQuote.totalMinor || draft.invoice.taxMinor !== prepared.review.debitTaxMinor)
      throw new ServiceError("conflict", "The actual canonical debit differs from its explicit dated-tax consent.");
    await ctx.tx.update(subscriptionProrations).set({ debitInvoiceId: invoiceId }).where(eq(subscriptionProrations.id, id));
    await ctx.callAsSystem(issueInvoice, { id: invoiceId, dueAt: effectiveAt });
    if (prepared.review.creditNetMinor + prepared.review.creditTaxMinor > 0) {
      if (!basis.invoice || !basis.line) throw new ServiceError("conflict", "A trial or missing original paid line cannot mint unused cash credit.");
      const credit = await ctx.callAsSystem(createCreditNote, { invoiceId: basis.invoice.id, idempotencyKey: `subscription-proration:${id}:credit`, reason: "Explicit accepted gross subscription proration; original unused paid line and tax",
        lines: [{ invoiceLineId: basis.line.id, description: basis.line.description, quantityMicros: basis.line.quantityMicros, subtotalMinor: basis.creditNetMinor, taxMinor: basis.creditTaxMinor }] });
      creditNoteId = credit.id;
      await ctx.tx.update(subscriptionProrations).set({ creditNoteId }).where(eq(subscriptionProrations.id, id));
      await ctx.tx.insert(subscriptionProrationPrincipal).values(basis.principal.map(row => ({ id: randomUUID(), prorationId: id, ...row, originalEvidenceDigest: basis.sourceRevision })));
      await ctx.callAsSystem(issueCreditNote, { id: credit.id });
      await command(ctx, "invoicing.fundProrationCredit", { prorationId: id, creditNoteId });
      if (prepared.review.creditAppliedMinor > 0) {
        const disposition = await creditNoteDisposition(ctx.tx, credit.id);
        await ctx.tx.insert(subscriptionProrationCreditUses).values({ id: randomUUID(), prorationId: id, creditNoteId: credit.id, amountMinor: prepared.review.creditAppliedMinor, expectedRevision: disposition.revision });
        const reserved = z.object({ reservationIds: z.array(z.uuid()) }).passthrough().parse(await command(ctx, "invoicing.reserveInvoiceCredit", { creditNoteId: credit.id, targetSourceId: sourceId,
          amountMinor: prepared.review.creditAppliedMinor, expectedRevision: disposition.revision, idempotencyKey: `subscription-proration:${id}:apply-original` }));
        for (const reservationId of reserved.reservationIds) await command(ctx, "invoicing.applyInvoiceCredit", { reservationId, invoiceId });
      }
    }
  }
  if (invoiceId && prepared.debitTaxQuote.totalMinor > 0) await captureAgreementFeeDuty(ctx, id, invoiceId);
  const task = { prorationId: id, subscriptionId: parent.id, originalJobId, acceptedQuoteDigest: input.acceptedQuoteDigest };
  const job = await enqueueJob(ctx.tx, APPLY_GROSS_PRORATION_JOB, task, { id: originalJobId, idempotencyKey: `gross-proration:${id}`, startAfter: effectiveAt });
  const [claim] = await ctx.tx.select().from(jobIdempotencyKeys).where(and(eq(jobIdempotencyKeys.jobName, APPLY_GROSS_PRORATION_JOB), eq(jobIdempotencyKeys.jobId, job.id))).limit(1);
  if (!claim || job.id !== originalJobId) throw new ServiceError("conflict", "Retain this exact original accepted effect task and actual enqueue claim.");
  const [enqueued] = await ctx.tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${originalJobId}::uuid and name=${APPLY_GROSS_PRORATION_JOB} limit 1`);
  const originalTask = grossProrationTask.parse(enqueued?.data);
  if (merchantTaxDigest(originalTask) !== claim.payloadHash || merchantTaxDigest(task) !== claim.payloadHash) throw new ServiceError("conflict", "The retained actual enqueue body must match this exact accepted effect before its immutable receipt is saved.");
  const [invoice] = invoiceId ? await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1) : [];
  const state = !invoiceId || invoice?.status === "paid" && invoiceSettled(invoice) ? "awaiting_effective" as const : "awaiting_payment" as const;
  const [accepted] = await ctx.tx.update(subscriptionProrations).set({ originalJobId, jobClaimDigest: claim.payloadHash, originalTask, state }).where(eq(subscriptionProrations.id, id)).returning();
  await ctx.tx.update(subscriptions).set({ pendingPlanId: input.planId }).where(eq(subscriptions.id, parent.id));
  await ctx.emitTimeline({ contactId: parent.contactId, eventType: "subscription.prorationAccepted", subjectType: "subscription", subjectId: parent.id,
    payload: { prorationId: id, invoiceId, creditNoteId, effectiveAt: effectiveAt.toISOString(), debitMinor: prepared.debitTaxQuote.totalMinor,
      creditMinor: prepared.review.creditNetMinor + prepared.review.creditTaxMinor, originalPeriodEnd: parent.currentPeriodEnd.toISOString(), access: "original_until_paid_effect" } });
  ctx.setSubject("subscription", parent.id); return view(accepted!);
}
export const acceptGrossProration = defineService({ name: "subscriptions.acceptProration", summary: "Accept exact gross proration terms and atomically lock original unused credit to its actual canonical debit, preserving old access until fully paid effect.",
  kind: "mutation", permission: "scoped", writeClass: "money", input: acceptance, output: result, auditInputFields: ["id", "planId", "previousTermsId", "acceptedQuoteDigest", "effectiveAt"], handler: (input, ctx) => accept(ctx, input) });
export const acceptMyGrossProration = defineService({ name: "subscriptions.acceptMyProration", summary: "Accept only your own explicitly reviewed changed-price gross proration without early or unpaid access.",
  kind: "mutation", permission: "authenticated", writeClass: "money", input: acceptance, output: result, auditInputFields: ["id", "planId", "previousTermsId", "acceptedQuoteDigest", "effectiveAt"],
  handler: async (input, ctx) => { await ownGrossProration(ctx, input.id, input.planId); return accept(ctx, input); } });

export const resolveGrossProrationInvoice = defineService({ name: "subscriptions.resolveProrationInvoice", summary: "Prove this exact accepted unused-period debit and dated original tax owner before shared invoice creation.",
  kind: "query", permission: "system", external: false, input: merchantTaxSourceRequest, output: z.array(merchantTaxSourceParty).length(1),
  handler: async (input, ctx) => {
    const [subscriptionId, kind, prorationId] = input.sourceId?.split(":") ?? [];
    if (input.sourceType !== "subscription" || kind !== "proration" || !z.uuid().safeParse(subscriptionId).success || !z.uuid().safeParse(prorationId).success || input.sourceId !== `${subscriptionId}:proration:${prorationId}`)
      throw new ServiceError("conflict", "This is not an exact accepted gross-proration source.");
    const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.id, prorationId!)).limit(1);
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId!)).limit(1);
    const [policy] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, subscriptionId!)).limit(1);
    const line = input.lines[0];
    if (!accepted || !parent || accepted.subscriptionId !== parent.id || policy?.model !== "seller_merchant" || !policy.sellerUserId || !accepted.taxDestination || accepted.originalTrialEndsAt
      || accepted.state !== "accepted" || accepted.debitInvoiceId || parent.contactId !== input.contactId || parent.currency !== input.currency || input.currency !== accepted.snapshot.currency
      || input.shippingMinor !== 0 || merchantTaxDigest(input.destination) !== merchantTaxDigest(accepted.taxDestination) || input.expectedQuoteDigest !== accepted.debitTaxQuote.quoteDigest
      || input.lines.length !== 1 || !line || line.sourceType !== "subscription" || line.sourceId !== parent.id || line.quantityMicros !== 1000000 || line.discountMinor !== 0
      || line.unitAmountMinor !== accepted.debitNetMinor || line.taxCategoryCode !== accepted.snapshot.taxCategoryCode || line.requiresShipping !== accepted.snapshot.requiresShipping
      || line.snapshot.subscriptionProrationId !== accepted.id || line.snapshot.subscriptionTermsId !== accepted.termsId || line.snapshot.subscriptionComponent !== "proration_debit"
      || line.snapshot.subscriptionPeriodStart !== accepted.effectiveAt.toISOString() || line.snapshot.subscriptionPeriodEnd !== accepted.originalPeriodEnd.toISOString())
      throw new ServiceError("conflict", "The draft differs from its exact accepted original gross price, tax date, buyer, calendar or exclusive target.");
    return [{ sellerUserId: policy.sellerUserId, profileId: accepted.profileId, profileVersion: accepted.profileVersion, linePositions: [0], shippingMinor: 0, occurredAt: accepted.effectiveAt, expectedQuoteDigest: accepted.debitTaxQuote.quoteDigest }];
  },
});
export const grossProrationCollectionAuthority = defineService({ name: "subscriptions.prorationCollectionAuthority", summary: "Admit positive collection only for this actual accepted target before its exact effective instant, retaining unknown original principal as debt.",
  kind: "query", permission: "system", external: false, input: z.object({ invoiceId: z.uuid() }), output: z.object({ allowed: z.boolean(), revision: sha }),
  handler: async ({ invoiceId }, ctx) => {
    const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.debitInvoiceId, invoiceId)).limit(1);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    const [parent] = accepted ? await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, accepted.subscriptionId)).limit(1) : [];
    const states: unknown[] = [];
    let allowed = Boolean(accepted && invoice && parent && ["awaiting_payment", "awaiting_effective"].includes(accepted.state) && accepted.effectiveAt > new Date() && parent.pendingPlanId === accepted.planId
      && !parent.cancelledAt && !parent.cancelAtPeriodEnd && parent.status === "active" && parent.contactId === invoice.contactId && parent.currency === invoice.currency
      && invoice.sourceType === "subscription" && invoice.sourceId === `${parent.id}:proration:${accepted.id}` && ["sent", "viewed", "partially_paid", "overdue"].includes(invoice.status));
    if (allowed && accepted) {
      const sources = await ctx.tx.select().from(subscriptionProrationPrincipal).where(eq(subscriptionProrationPrincipal.prorationId, accepted.id)).limit(1001);
      if (sources.length > 1000) allowed = false;
      for (const paymentId of [...new Set(sources.map(row => row.sourcePaymentId))]) {
        try { states.push(await safeProrationPrincipal(ctx, paymentId)); }
        catch (error) { if (error instanceof ServiceError && error.code === "conflict") { allowed = false; states.push({ paymentId, debt: true }); } else throw error; }
      }
      for (const source of sources) {
        const fee = await originalCreditFeeAllocation(ctx, source.sourcePaymentId, source.sourceApplicationId, 0); states.push({ sourceId: source.id, fee });
        if (["not_due", "recorded_remitted", "verified_collected"].includes(source.feeCollectionState) && source.feeCollectionState !== fee.collectionState || fee.unexpectedFee && !source.feeUnexpected) allowed = false;
      }
      const ids = [...new Set(sources.map(row => row.sourcePaymentId))];
      const originals = ids.length ? await ctx.tx.select({ id: payments.id, returned: payments.refundedMinor }).from(payments).where(inArray(payments.id, ids)).limit(1001) : [];
      if (originals.length !== ids.length || originals.some(row => row.returned !== 0)) allowed = false;
    }
    return { allowed, revision: merchantTaxDigest({ accepted, invoice, parent, states, allowed }) };
  },
});

async function apply(ctx: ServiceContext, accepted: typeof subscriptionProrations.$inferSelect) {
  await write(ctx);
  if (accepted.state === "applied") return { applied: true, reviewRequired: false }; // Historical no-op needs no recreated expired queue row.
  const [originalClaim] = accepted.originalJobId ? await ctx.tx.select().from(jobIdempotencyKeys).where(and(eq(jobIdempotencyKeys.jobName, APPLY_GROSS_PRORATION_JOB), eq(jobIdempotencyKeys.jobId, accepted.originalJobId))).limit(1) : [];
  const [originalJob] = accepted.originalJobId ? await ctx.tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${accepted.originalJobId}::uuid and name=${APPLY_GROSS_PRORATION_JOB} limit 1`) : [];
  const originalTask = { prorationId: accepted.id, subscriptionId: accepted.subscriptionId, originalJobId: accepted.originalJobId, acceptedQuoteDigest: accepted.acceptedQuoteDigest };
  if (!originalClaim || originalClaim.payloadHash !== accepted.jobClaimDigest || merchantTaxDigest(originalJob?.data) !== originalClaim.payloadHash || merchantTaxDigest(originalTask) !== originalClaim.payloadHash || merchantTaxDigest(accepted.originalTask) !== originalClaim.payloadHash)
    throw new ServiceError("conflict", "Restore the exact original accepted effect job and its retained body before activating changed access.");
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, accepted.subscriptionId)).limit(1).for("update");
  if (!parent || !["awaiting_payment", "awaiting_effective"].includes(accepted.state) || parent.pendingPlanId !== accepted.planId || parent.cancelledAt || parent.cancelAtPeriodEnd || !["active", "trialing"].includes(parent.status)
    || parent.currentPeriodStart.getTime() !== accepted.originalPeriodStart.getTime() || parent.currentPeriodEnd.getTime() !== accepted.originalPeriodEnd.getTime()) return { applied: false, reviewRequired: true };
  if (accepted.debitInvoiceId) {
    const targetCash = await ctx.tx.select({ id: payments.id }).from(payments).where(eq(payments.invoiceId, accepted.debitInvoiceId)).limit(1001);
    const creditCash = await ctx.tx.select({ id: invoiceCreditFunding.sourcePaymentId }).from(invoiceCreditApplications)
      .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId))
      .innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId)).where(eq(invoiceCreditApplications.invoiceId, accepted.debitInvoiceId)).limit(1001);
    if (targetCash.length + creditCash.length > 1000) throw new ServiceError("conflict", "Restore the bounded complete actual target consideration before locking its access decision.");
    for (const id of [...new Set([...targetCash, ...creditCash].map(row => row.id))].sort()) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${accepted.debitInvoiceId}`}))`);
    for (const id of [...new Set(creditCash.map(row => row.id))]) await safeProrationPrincipal(ctx, id);
  }
  const [invoice] = accepted.debitInvoiceId ? await ctx.tx.select().from(invoices).where(eq(invoices.id, accepted.debitInvoiceId)).limit(1) : [];
  const trial = accepted.originalTrialEndsAt !== null;
  if (trial && (parent.status !== "trialing" || parent.trialEndsAt?.getTime() !== accepted.originalTrialEndsAt!.getTime() || accepted.debitNetMinor + accepted.debitTaxMinor + accepted.creditNetMinor + accepted.creditTaxMinor !== 0 || accepted.debitInvoiceId || accepted.creditNoteId))
    throw new ServiceError("conflict", "Preserve the accepted trial end with zero paid principal, credit and trial-window charge.");
  const boundary = await prorationBoundaryFunded(ctx, accepted);
  const fullyPaid = boundary.onTime && (trial || Boolean(invoice && invoice.sourceType === "subscription" && invoice.sourceId === `${parent.id}:proration:${accepted.id}` && invoice.contactId === parent.contactId && invoice.currency === parent.currency
    && invoice.issuedAt && invoice.status === "paid" && invoiceSettled(invoice) && invoice.refundedMinor === 0 && invoice.paidAt && invoice.paidAt <= accepted.effectiveAt
    && invoice.totalMinor === accepted.debitNetMinor + accepted.debitTaxMinor && invoice.taxMinor === accepted.debitTaxMinor));
  const now = new Date();
  if (!fullyPaid && now < accepted.effectiveAt) return { applied: false, reviewRequired: false };
  if (!fullyPaid || now >= accepted.originalPeriodEnd) {
    await ctx.tx.update(subscriptionProrations).set({ state: "review" }).where(eq(subscriptionProrations.id, accepted.id));
    return { applied: false, reviewRequired: true }; // Preserve partial cash, the entire locked issued credit and all fee duties.
  }
  const originalFeeSources = await ctx.tx.select().from(subscriptionProrationPrincipal).where(eq(subscriptionProrationPrincipal.prorationId, accepted.id)).limit(1001);
  if (originalFeeSources.length > 1000) throw new ServiceError("conflict", "Restore the bounded exact accepted fee-carry sources before changing access.");
  for (const source of originalFeeSources) {
    const fee = await originalCreditFeeAllocation(ctx, source.sourcePaymentId, source.sourceApplicationId, 0);
    if (["not_due", "recorded_remitted", "verified_collected"].includes(source.feeCollectionState) && source.feeCollectionState !== fee.collectionState || fee.unexpectedFee && !source.feeUnexpected) {
      await ctx.tx.update(subscriptionProrations).set({ state: "review" }).where(eq(subscriptionProrations.id, accepted.id));
      return { applied: false, reviewRequired: true };
    }
  }
  if (invoice) {
    const lines = await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)).limit(2), line = lines[0];
    const proof = line?.snapshot as Record<string, unknown> | undefined;
    if (lines.length !== 1 || !line || proof?.subscriptionProrationId !== accepted.id || proof.subscriptionTermsId !== accepted.termsId || line.unitAmountMinor !== accepted.debitNetMinor || line.taxMinor !== accepted.debitTaxMinor)
      throw new ServiceError("conflict", "Restore the exact fully paid accepted debit line before changing any access.");
    const money = await ctx.tx.select().from(payments).where(eq(payments.invoiceId, invoice.id)).limit(1001);
    if (money.length > 1000 || money.some(row => ["created", "processing"].includes(row.status)) || money.filter(row => row.status === "succeeded").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(invoice.paidMinor))
      throw new ServiceError("conflict", "Restore actual fully paid cash and quiesced original callers before activating the changed plan.");
    for (const payment of money.filter(row => row.status === "succeeded")) await safeProrationPrincipal(ctx, payment.id);
    const { assertInvoiceMerchantCreatorsQuiesced } = await import("@/modules/invoicing/merchant-payment-request");
    await assertInvoiceMerchantCreatorsQuiesced(ctx, invoice.id);
    const applications = await ctx.tx.select({ application: invoiceCreditApplications, reservation: invoiceCreditReservations }).from(invoiceCreditApplications)
      .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId)).where(eq(invoiceCreditApplications.invoiceId, invoice.id)).limit(1001);
    if (applications.length > 1000 || applications.some(row => row.reservation.targetSourceId !== invoice.sourceId) || applications.reduce((sum, row) => sum + BigInt(row.reservation.amountMinor), 0n) !== BigInt(invoice.creditedMinor))
      throw new ServiceError("conflict", "The target's credited balance needs every exact immutable original application before access can switch.");
    if (invoice.totalMinor > 0) await retainAgreementFeeEligibility(ctx, invoice, { acceptedId: accepted.id, originalTask: accepted.originalTask,
      originalFeeSources, money, applications });
  }
  if (now < accepted.effectiveAt) {
    if (accepted.state !== "awaiting_effective") await ctx.tx.update(subscriptionProrations).set({ state: "awaiting_effective" }).where(eq(subscriptionProrations.id, accepted.id));
    return { applied: false, reviewRequired: false };
  }
  await ctx.tx.update(subscriptions).set({ planId: accepted.planId, productVariantId: accepted.snapshot.productVariantId, pendingPlanId: null }).where(eq(subscriptions.id, parent.id));
  await ctx.tx.update(subscriptionProrations).set({ state: "applied", appliedAt: now }).where(eq(subscriptionProrations.id, accepted.id));
  await ctx.callAsSystem(syncSubscriptionAccess, { subscriptionId: parent.id, contactId: parent.contactId, planId: accepted.planId, planName: accepted.snapshot.name,
    startsAt: now, endsAt: parent.currentPeriodEnd, status: "active" });
  await ctx.tx.insert(subscriptionEvents).values({ subscriptionId: parent.id, kind: "plan_changed", fromPlanId: parent.planId, toPlanId: accepted.planId, invoiceId: accepted.debitInvoiceId,
    detail: `gross-proration:${accepted.id}:accepted:${accepted.effectiveAt.toISOString()}:actual:${now.toISOString()}` });
  ctx.queueEvent("subscription.prorationApplied", { subscriptionId: parent.id, prorationId: accepted.id, invoiceId: accepted.debitInvoiceId });
  ctx.setSubject("subscription", parent.id); return { applied: true, reviewRequired: false };
}
export const applyGrossProrationTask = defineService({ name: "subscriptions.applyProrationTask", summary: "Apply only this actual original accepted effect task and fully paid canonical gross consideration, never a late unpaid calendar.",
  kind: "mutation", permission: "system", external: false, input: grossProrationTask, output: z.object({ applied: z.boolean(), reviewRequired: z.boolean() }),
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.id, input.prorationId)).limit(1).for("update");
    const [claim] = await ctx.tx.select().from(jobIdempotencyKeys).where(and(eq(jobIdempotencyKeys.jobName, APPLY_GROSS_PRORATION_JOB), eq(jobIdempotencyKeys.jobId, input.originalJobId))).limit(1);
    const [job] = await ctx.tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${input.originalJobId}::uuid and name=${APPLY_GROSS_PRORATION_JOB} limit 1`);
    if (!accepted || accepted.subscriptionId !== input.subscriptionId || accepted.originalJobId !== input.originalJobId || accepted.acceptedQuoteDigest !== input.acceptedQuoteDigest
      || !claim || claim.payloadHash !== accepted.jobClaimDigest || merchantTaxDigest(job?.data) !== claim.payloadHash || merchantTaxDigest(input) !== claim.payloadHash)
      throw new ServiceError("permission", "Restore this exact original accepted proration enqueue, retained worker body and immutable receipt before application.");
    return apply(ctx, accepted);
  },
});
export const completePaidGrossProration = defineService({ name: "subscriptions.completePaidProration", summary: "Check one exact canonical invoice's original gross-proration promise without changing its accepted calendar or creating another charge.",
  kind: "mutation", permission: "system", external: false, input: z.object({ invoiceId: z.uuid() }), output: z.object({ applied: z.boolean(), reviewRequired: z.boolean() }),
  handler: async ({ invoiceId }, ctx) => { await lockContactIdentity(ctx.tx); const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.debitInvoiceId, invoiceId)).limit(1).for("update");
    return accepted ? apply(ctx, accepted) : { applied: false, reviewRequired: false }; },
});
const statusResult = z.object({ commercial: z.boolean(), prorating: z.boolean(), billingMode: z.enum(["manual", "platform", "provider"]),
  accepted: result.extend({ currency: z.string(), debitMinor: z.number().int().nonnegative(), creditMinor: z.number().int().nonnegative(), remainingMinor: z.number().int().nonnegative().nullable(), needsFreshConsent: z.boolean() }).nullable() });
async function status(ctx: ServiceContext, id: string) {
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  if (!parent) throw new ServiceError("not_found", "There is no such subscription.");
  const [policy] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, id)).limit(1);
  const commercial = parent.merchantScopeVersion === 1 && policy?.model === "seller_merchant";
  if (!commercial) return { commercial: false, prorating: false, billingMode: parent.billingMode, accepted: null };
  const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.subscriptionId, id)).orderBy(desc(subscriptionProrations.createdAt), desc(subscriptionProrations.id)).limit(1);
  const original = await originalMerchantTerms(ctx, parent);
  const activeSnapshot = accepted?.state === "applied" && accepted.planId === parent.planId ? accepted.snapshot : original?.snapshot;
  const [invoice] = accepted?.debitInvoiceId ? await ctx.tx.select().from(invoices).where(eq(invoices.id, accepted.debitInvoiceId)).limit(1) : [];
  const paidInTime = accepted && (await prorationBoundaryFunded(ctx, accepted)).onTime && invoice?.status === "paid" && invoiceSettled(invoice) && invoice.refundedMinor === 0 && invoice.paidAt && invoice.paidAt <= accepted!.effectiveAt;
  return { commercial, prorating: activeSnapshot?.proration === "create_prorations", billingMode: parent.billingMode,
    accepted: accepted ? { ...view(accepted), currency: accepted.snapshot.currency, debitMinor: accepted.debitNetMinor + accepted.debitTaxMinor,
      creditMinor: accepted.creditNetMinor + accepted.creditTaxMinor, remainingMinor: invoice ? Math.max(0, invoice.totalMinor - invoice.paidMinor - invoice.creditedMinor) : null,
      needsFreshConsent: accepted.state === "review" || !["applied", "cancelled"].includes(accepted.state) && !accepted.originalTrialEndsAt && !paidInTime && accepted.effectiveAt <= new Date() } : null };
}
export type GrossProrationStatus = z.infer<typeof statusResult>;
export const grossProrationStatus = defineService({ name: "subscriptions.prorationStatus", summary: "Review the actual original gross-proration target, paid effect and remaining recovery without starting another charge.",
  kind: "query", permission: "scoped", input: z.object({ id: z.uuid() }), output: statusResult, handler: (input, ctx) => status(ctx, input.id) });
export const myGrossProrationStatus = defineService({ name: "subscriptions.myProrationStatus", summary: "Review only your own accepted gross-proration and exact payment/access boundary.",
  kind: "query", permission: "authenticated", input: z.object({ id: z.uuid() }), output: statusResult, handler: async (input, ctx) => { await ownGrossProration(ctx, input.id); return status(ctx, input.id); } });
export default [acceptGrossProration, acceptMyGrossProration, resolveGrossProrationInvoice, grossProrationCollectionAuthority, applyGrossProrationTask, completePaidGrossProration, grossProrationStatus, myGrossProrationStatus];
