// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: explicit future consent, immutable original terms, one actual task.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { contacts } from "@/core/contacts/schema";
import { enqueueJob, retryJob } from "@/core/jobs";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { actorString, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { moduleSettings } from "@/core/settings/schema";
import { translator } from "@/core/i18n";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionTaxDestination } from "./merchant-scope-contract";
import { merchantTermsQuoteOutput, publicMerchantTermsQuote, quoteOriginalMerchantTerms } from "./merchant-terms-quote";
import { subscriptionCommercialAmendments } from "./commercial-amendment-schema";
import { subscriptionCommercialTerms, subscriptionMarketPolicies, subscriptionMerchantScopes, subscriptions } from "./schema";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { scheduleOperationDigest, scheduleQuiescenceCovers } from "./provider-schedule-proof";
import { verifiedPreparatoryPhaseProducts } from "./provider-phase-product-proof";
import { originalResumptionStamps, reviewedResumptionStart } from "./commercial-amendment-calendar";
import { subscriptionCommercialResumptions } from "./commercial-resumption-schema";
import { merchantAgreementScheduleState } from "./merchant-agreement-schedule-state";
import { invoices } from "@/modules/invoicing/schema";
import { originalQuiescenceMembers } from "./provider-quiescence-authority";
import { assertOriginalPhaseFinancials } from "./provider-phase-dispatch";
import { selfServePlans, planSeller } from "./service";

export const AMENDMENT_JOB = "subscriptions.activateMerchantAmendment";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const input = z.object({ id: z.uuid(), planId: z.uuid(), productVariantId: z.uuid().optional(), taxDestination: subscriptionTaxDestination, resumeAt: z.iso.datetime().optional(),
  locale: z.enum(["en", "es", "fr", "ar"]).default("en") });
const review = z.object({ subscriptionId: z.uuid(), previousTermsId: z.uuid(), effectivePeriodStart: z.iso.datetime(), quoteDigest: sha,
  quote: publicMerchantTermsQuote.unwrap(), notice: z.string().min(1) });
const acceptance = input.extend({ previousTermsId: z.uuid(), acceptedQuoteDigest: sha, confirm: z.literal(true) });
const result = z.object({ termsId: z.uuid(), state: z.enum(["pending_stop", "activated"]), effectivePeriodStart: z.iso.datetime() });
async function own(ctx: ServiceContext, id: string, planId?: string) {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in personally to review your amendment.");
  await lockContactIdentity(ctx.tx);
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  const [buyer] = await ctx.tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, ctx.actor.userId)).limit(1);
  if (!parent || buyer?.id !== parent.contactId) throw new ServiceError("not_found", "There is no such subscription.");
  const offered = planId ? await selfServePlans(ctx, await planSeller(ctx, parent.planId)) : null;
  if (offered && !offered.some(plan => plan.id === planId)) throw new ServiceError("conflict", "That plan is not offered for this original merchant.");
}
export type MerchantAmendmentReview = z.infer<typeof review>;
async function quote(ctx: ServiceContext, value: z.infer<typeof input>) {
  const [enabled] = await ctx.tx.select({ enabled: moduleSettings.enabled }).from(moduleSettings).where(eq(moduleSettings.module, "subscriptions")).limit(1);
  if (!enabled?.enabled) throw new ServiceError("conflict", "Enable subscriptions before reviewing a new commercial amendment.");
  await lockContactIdentity(ctx.tx);
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, value.id)).limit(1).for("update");
  const [scope] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, value.id)).limit(1).for("share");
  const [policy] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, value.id)).limit(1);
  const [previous] = await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.subscriptionId, value.id)).orderBy(desc(subscriptionCommercialTerms.revision)).limit(1).for("share");
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, value.id)).limit(1).for("update");
  if (!parent || !scope || !previous || !resource || policy?.model !== "seller_merchant" || !policy.merchantContactId || !policy.sellerUserId
    || parent.merchantScopeVersion !== 1 || !["active", "trialing"].includes(parent.status) || parent.signupPending || parent.cancelAtPeriodEnd || parent.cancelledAt) throw new ServiceError("conflict", "Resolve the original period or already accepted future amendment before reviewing another change.");
  const calendarStart = reviewedResumptionStart(value.resumeAt, parent.currentPeriodEnd, previous.effectivePeriodStart, new Date());
  const resuming = value.resumeAt !== undefined;
  if (resuming && !(await merchantAgreementScheduleState(ctx, { subscription: parent, scope, resource })).safe) throw new ServiceError("conflict", "Resolve every actual original caller, resource and financial obligation before reviewing a fresh billing calendar.");
  const resumptionStamp = resuming ? await originalResumptionStamps(ctx, parent.id) : null;
  const sourceDates = [...new Set([parent.currentPeriodEnd.toISOString(), ...(previous.effectivePeriodStart >= parent.currentPeriodEnd ? [previous.effectivePeriodStart.toISOString()] : []), calendarStart.toISOString()])];
  const [futureInvoice] = await ctx.tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.sourceType, "subscription"),
    inArray(invoices.sourceId, sourceDates.map(date => `${parent.id}:${date}`)), sql`(${invoices.status}<>'void' or ${invoices.paidMinor}<>0)`)).limit(1);
  if (futureInvoice) throw new ServiceError("conflict", "The next period already has its own frozen invoice; reconcile it before another amendment.");
  const people = [parent.contactId, policy.merchantContactId];
  const [erasure] = await ctx.tx.select({ id: dataRequests.id }).from(dataRequests).where(and(inArray(dataRequests.contactId, people), eq(dataRequests.kind, "erasure"),
    sql`${dataRequests.verifiedAt} is not null`, inArray(dataRequests.status, ["verified", "in_progress", "completed", "partially_completed"]))).limit(1);
  const [hold] = await ctx.tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions).innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(
    inArray(dataRequests.contactId, people), inArray(privacyRetentionExceptions.scope, ["commerce.money", "commerce.merchantTax", "subscriptions.agreements", "privacy.records"]),
    sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`)).limit(1);
  if (erasure || hold) throw new ServiceError("conflict", "Current buyer or merchant privacy work prevents a new commercial amendment.");
  await assertOriginalPhaseFinancials(ctx, parent.id);
  const economic = merchantTermsQuoteOutput.unwrap().parse(await ctx.callAsSystem(quoteOriginalMerchantTerms, { planId: value.planId, productVariantId: value.productVariantId, taxDestination: value.taxDestination, locale: value.locale, contactId: parent.contactId, currency: parent.currency,
    paymentMethodId: parent.paymentMethodId ?? undefined, amendmentFor: parent.id, calendarStart }));
  if (!resuming && previous.snapshot.proration !== "none") throw new ServiceError("conflict", "This plan requires its explicit mid-cycle proration review; a future-only acceptance cannot replace that promise.");
  const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, parent.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
  if (operations.length > 5000 || operations.length !== resource.operationRevision) throw new ServiceError("conflict", "Restore the complete original provider history before accepting another promise.");
  const notice = translator(value.locale)(resuming ? "subscriptions.resumption.notice" : "subscriptions.merchantAmendmentNotice");
  const noticeSnapshot = { locale: value.locale, text: `${economic.noticeSnapshot.text}\n${notice}` };
  const noticeDigest = merchantTaxDigest({ originalNoticeDigest: economic.noticeDigest, noticeSnapshot });
  const quoteDigest = merchantTaxDigest({ version: 1, kind: "original-commercial-amendment", subscriptionId: parent.id, previousTermsId: previous.id,
    effectivePeriodStart: calendarStart.toISOString(), resumption: resumptionStamp, economicQuoteDigest: economic.quoteDigest, noticeDigest,
    resourceRevision: resource.operationRevision, evidenceRevision: resource.evidenceRevision, journalDigest: scheduleOperationDigest(operations) });
  return { parent, scope, previous, resource, operations, economic, calendarStart, resumptionStamp, noticeSnapshot, noticeDigest, public: { subscriptionId: parent.id, previousTermsId: previous.id,
    effectivePeriodStart: calendarStart.toISOString(), quoteDigest, quote: publicMerchantTermsQuote.unwrap().parse(economic), notice } };
}
async function accept(ctx: ServiceContext, value: z.infer<typeof acceptance>) {
  await lockContactIdentity(ctx.tx);
  const [replay] = await ctx.tx.select({ amendment: subscriptionCommercialAmendments, terms: subscriptionCommercialTerms }).from(subscriptionCommercialAmendments)
    .innerJoin(subscriptionCommercialTerms, eq(subscriptionCommercialTerms.id, subscriptionCommercialAmendments.termsId)).where(and(
      eq(subscriptionCommercialAmendments.subscriptionId, value.id), eq(subscriptionCommercialAmendments.previousTermsId, value.previousTermsId),
      eq(subscriptionCommercialAmendments.acceptedQuoteDigest, value.acceptedQuoteDigest))).limit(1);
  if (replay) return { termsId: replay.terms.id, state: replay.amendment.state, effectivePeriodStart: replay.terms.effectivePeriodStart.toISOString() };
  const prepared = await quote(ctx, value);
  if (prepared.previous.id !== value.previousTermsId || prepared.public.quoteDigest !== value.acceptedQuoteDigest) throw new ServiceError("conflict", "The accepted original offer, period, tax or provider history changed. Review this amendment again.");
  const { parent, previous, resource, operations, economic, calendarStart, resumptionStamp } = prepared, termsId = randomUUID(), provider = parent.billingMode === "provider";
  const activated = !provider || scheduleQuiescenceCovers(resource, operations) || resource.operationRevision === 0 && resource.state === "uncreated" || verifiedPreparatoryPhaseProducts(resource, operations);
  const originalJobId = provider ? randomUUID() : null;
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_terms_v1','1',true),set_config('freeholder.subscription_amendment_v1','1',true)`);
  if (resumptionStamp) await ctx.tx.execute(sql`select set_config('freeholder.subscription_resumption_v1','1',true)`);
  await ctx.tx.insert(subscriptionCommercialTerms).values({ id: termsId, subscriptionId: parent.id, revision: previous.revision + 1, previousTermsId: previous.id,
    snapshot: economic.snapshot, profileId: economic.profile.profileId, profileVersion: economic.profile.profileVersion, taxLiability: economic.profile.liability, taxDestination: economic.taxDestination,
    acceptedQuoteDigest: value.acceptedQuoteDigest, initialTaxQuote: economic.initialTaxQuote, firstPeriodTaxQuote: economic.firstPeriodTaxQuote, renewalTaxQuote: economic.renewalTaxQuote,
    noticeDigest: prepared.noticeDigest, noticeSnapshot: prepared.noticeSnapshot, quoteOccurredAt: economic.quoteOccurredAt, effectivePeriodStart: calendarStart, acceptedAt: new Date(), acceptanceSource: "amendment" });
  if (resumptionStamp) await ctx.tx.insert(subscriptionCommercialResumptions).values({ termsId, subscriptionId: parent.id, previousTermsId: previous.id,
    originalPeriodEnd: parent.currentPeriodEnd, previousEffectiveStart: previous.effectivePeriodStart, acceptedPeriodStart: calendarStart,
    ...resumptionStamp, operationRevision: resource.operationRevision, evidenceRevision: resource.evidenceRevision });
  let jobClaimDigest: string | null = null;
  if (originalJobId) {
    const payload = { purpose: "amendment", amendmentId: termsId, subscriptionId: parent.id, profileId: prepared.scope.taxProfileId, originalJobId };
    const job = await enqueueJob(ctx.tx, AMENDMENT_JOB, payload, { id: originalJobId, idempotencyKey: `commercial-amendment:${termsId}` });
    const [claim] = await ctx.tx.select().from(jobIdempotencyKeys).where(and(eq(jobIdempotencyKeys.jobId, job.id), eq(jobIdempotencyKeys.jobName, AMENDMENT_JOB))).limit(1);
    if (job.id !== originalJobId || !claim) throw new ServiceError("conflict", "The actual original amendment task was not retained with its queue claim.");
    jobClaimDigest = claim.payloadHash;
  }
  await ctx.tx.insert(subscriptionCommercialAmendments).values({ termsId, subscriptionId: parent.id, planId: value.planId, previousTermsId: previous.id, acceptedBy: actorString(ctx.actor),
    acceptedQuoteDigest: value.acceptedQuoteDigest, state: activated ? "activated" : "pending_stop", originalJobId, jobClaimDigest, activatedAt: activated ? new Date() : null });
  await ctx.tx.update(subscriptions).set({ pendingPlanId: value.planId }).where(eq(subscriptions.id, parent.id));
  ctx.setSubject("subscription", parent.id); return { termsId, state: activated ? "activated" as const : "pending_stop" as const, effectivePeriodStart: calendarStart.toISOString() };
}
export const quoteMerchantAmendment = defineService({ name: "subscriptions.quoteAmendment", summary: "Review the original merchant's exact next-period offer before accepting an amendment.", kind: "query", permission: "scoped", input, output: review,
  handler: async (value, ctx) => (await quote(ctx, value)).public });
export const acceptMerchantAmendment = defineService({ name: "subscriptions.acceptAmendment", summary: "Explicitly accept a future amendment without replacing original promises or admitting unreconciled provider billing.", kind: "mutation", permission: "scoped", input: acceptance, output: result,
  auditInputFields: ["id", "previousTermsId", "acceptedQuoteDigest"], handler: accept });
export const quoteMyMerchantAmendment = defineService({ name: "subscriptions.quoteMyAmendment", summary: "Review your own exact merchant amendment before next-period consent.", kind: "query", permission: "authenticated", input, output: review,
  handler: async (value, ctx) => { await own(ctx, value.id, value.planId); return (await quote(ctx, value)).public; } });
export const acceptMyMerchantAmendment = defineService({ name: "subscriptions.acceptMyAmendment", summary: "Accept only your own reviewed future merchant amendment.", kind: "mutation", permission: "authenticated", input: acceptance, output: result,
  auditInputFields: ["id", "previousTermsId", "acceptedQuoteDigest"], handler: async (value, ctx) => { await own(ctx, value.id, value.planId); return accept(ctx, value); } });
const statusInput = z.object({ id: z.uuid() });
const amendmentStatus = z.object({ commercial: z.boolean(), recoveryPending: z.boolean(), needsReconsent: z.boolean(), accepted: z.object({ termsId: z.uuid(), name: z.string(),
  state: z.enum(["pending_stop", "activated"]), effectivePeriodStart: z.iso.datetime(), amountMinor: z.number().int().nonnegative(), currency: z.string(), canRetry: z.boolean() }).nullable() });
export type MerchantAmendmentStatus = z.infer<typeof amendmentStatus>;
async function status(ctx: ServiceContext, id: string) {
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  if (!parent) throw new ServiceError("not_found", "There is no such subscription.");
  const [policy] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, id)).limit(1);
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, id)).limit(1);
  const [accepted] = await ctx.tx.select({ amendment: subscriptionCommercialAmendments, terms: subscriptionCommercialTerms }).from(subscriptionCommercialAmendments)
    .innerJoin(subscriptionCommercialTerms, eq(subscriptionCommercialTerms.id, subscriptionCommercialAmendments.termsId))
    .where(eq(subscriptionCommercialAmendments.subscriptionId, id)).orderBy(desc(subscriptionCommercialTerms.revision)).limit(1);
  const [job] = accepted?.amendment.originalJobId ? await ctx.tx.execute<{ state: string }>(sql`select state::text from pgboss.job where id=${accepted.amendment.originalJobId}::uuid and name=${AMENDMENT_JOB}`) : [];
  return { commercial: parent.merchantScopeVersion === 1 && policy?.model === "seller_merchant", recoveryPending: resource?.recoveryPending ?? false,
    needsReconsent: parent.currentPeriodEnd.getTime() <= Date.now() && (!accepted || accepted.terms.effectivePeriodStart.getTime() <= Date.now()),
    accepted: accepted && parent.pendingPlanId === accepted.amendment.planId ? { termsId: accepted.terms.id, name: accepted.terms.snapshot.name, state: accepted.amendment.state,
      effectivePeriodStart: accepted.terms.effectivePeriodStart.toISOString(), amountMinor: accepted.terms.snapshot.periodAmountMinor,
      currency: accepted.terms.snapshot.currency, canRetry: !!job && ["failed", "cancelled"].includes(job.state) } : null };
}
async function retry(ctx: ServiceContext, id: string) {
  await lockContactIdentity(ctx.tx);
  const [amendment] = await ctx.tx.select().from(subscriptionCommercialAmendments).where(eq(subscriptionCommercialAmendments.subscriptionId, id)).orderBy(desc(subscriptionCommercialAmendments.createdAt)).limit(1).for("update");
  const [scope] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, id)).limit(1);
  if (!amendment?.originalJobId || !scope) throw new ServiceError("conflict", "There is no retained original provider amendment job to resume.");
  await originalQuiescenceMembers(ctx, { purpose: "amendment", amendmentId: amendment.termsId, subscriptionId: id, profileId: scope.taxProfileId, originalJobId: amendment.originalJobId });
  const queued = await retryJob(ctx.tx, AMENDMENT_JOB, amendment.originalJobId);
  ctx.setSubject("subscription", id); return { queued };
}
export const merchantAmendmentStatus = defineService({ name: "subscriptions.amendmentStatus", summary: "Read accepted commercial changes and original recovery status.", kind: "query", permission: "scoped", input: statusInput, output: amendmentStatus,
  handler: async ({ id }, ctx) => status(ctx, id) });
export const myMerchantAmendmentStatus = defineService({ name: "subscriptions.myAmendmentStatus", summary: "Read your own accepted next-period change and billing recovery status.", kind: "query", permission: "authenticated", input: statusInput, output: amendmentStatus,
  handler: async ({ id }, ctx) => { await own(ctx, id); return status(ctx, id); } });
export const retryMerchantAmendment = defineService({ name: "subscriptions.retryAmendment", summary: "Resume the exact retained failed amendment job without inventing another provider caller.", kind: "mutation", permission: "scoped", input: statusInput, output: z.object({ queued: z.boolean() }), auditInputFields: ["id"],
  handler: async ({ id }, ctx) => retry(ctx, id) });
export const retryMyMerchantAmendment = defineService({ name: "subscriptions.retryMyAmendment", summary: "Resume your own original accepted amendment's retained recovery job.", kind: "mutation", permission: "authenticated", input: statusInput, output: z.object({ queued: z.boolean() }), auditInputFields: ["id"],
  handler: async ({ id }, ctx) => { await own(ctx, id); return retry(ctx, id); } });
export default [quoteMerchantAmendment, acceptMerchantAmendment, quoteMyMerchantAmendment, acceptMyMerchantAmendment, merchantAmendmentStatus, myMerchantAmendmentStatus, retryMerchantAmendment, retryMyMerchantAmendment];
