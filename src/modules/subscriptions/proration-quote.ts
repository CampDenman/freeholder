// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C9.38/C12.38: explicit gross old-tax credit/new dated debit consent.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/core/contacts/schema";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { translator } from "@/core/i18n";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { moduleSettings } from "@/core/settings/schema";
import { previewMerchantTax, merchantTaxPreviewOutput } from "@/modules/invoicing/merchant-tax-preview";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { requireAgreementFeeSchema } from "@/modules/invoicing/agreement-fee-store";
import { marketFeeMinor } from "@/modules/invoicing/market-policy";
import { compareCreditSources, proportionalFeeCarry, remainingCashFeeBudget } from "@/modules/invoicing/credit-fee-amounts";
import { feeCollectionState } from "@/modules/invoicing/credit-fee-origin";
import { subscriptionTaxDestination } from "./merchant-scope-contract";
import { merchantTermsQuoteOutput, publicMerchantTermsQuote, quoteOriginalMerchantTerms } from "./merchant-terms-quote";
import { subscriptionInitialTaxQuote } from "./merchant-terms-contract";
import { subscriptionCommercialTerms, subscriptionMarketPolicies, subscriptionMerchantScopes, subscriptions } from "./schema";
import { subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionProrations } from "./proration-schema";
import { paidProrationBasis } from "./proration-basis";
import { proratedAmounts } from "./proration-amounts";
import { reviewedProrationCalendar } from "./proration-contract";
const sha = z.string().regex(/^[a-f0-9]{64}$/), minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const grossProrationInput = z.object({ id: z.uuid(), planId: z.uuid(), productVariantId: z.uuid().optional(), effectiveAt: z.iso.datetime(),
  taxDestination: subscriptionTaxDestination, locale: z.enum(["en", "fr", "es", "ar"]).default("en") }).strict();
export const grossProrationReview = z.object({ subscriptionId: z.uuid(), previousTermsId: z.uuid(), quoteDigest: sha, sourceRevision: sha, effectiveAt: z.iso.datetime(),
  originalPeriodStart: z.iso.datetime(), originalPeriodEnd: z.iso.datetime(), originalTrialEndsAt: z.iso.datetime().nullable(),
  calendar: z.union([z.object({ kind: z.literal("preserve_trial"), trialEndsAt: z.iso.datetime(), chargeMinor: z.literal(0), oldPaidCreditMinor: z.literal(0), nextPeriodStart: z.iso.datetime(), nextPeriodEnd: z.iso.datetime() }),
    z.object({ kind: z.literal("original_calendar"), prorationAt: z.iso.datetime(), currentPeriodStart: z.iso.datetime(), currentPeriodEnd: z.iso.datetime(), nextPeriodStart: z.iso.datetime(), nextPeriodEnd: z.iso.datetime() })]),
  debitNetMinor: minor, debitTaxMinor: minor, creditNetMinor: minor, creditTaxMinor: minor, creditAppliedMinor: minor, cashDueMinor: minor,
  residualCreditMinor: minor, creditDisposition: z.literal("exclusive_until_paid_access_switch_no_automatic_cash_refund"),
  requiresMerchantReview: z.boolean(),
  feeReview: z.object({ debitFeeObligationMinor: minor, creditFeeObligationMinor: minor, appliedFeeObligationMinor: minor, appliedFeeProvenCollectedMinor: minor,
    remainingNewCashFeeMinor: minor, separateMerchantReceivableMinor: minor, originalOverTargetMinor: minor, originalSourceDebt: z.boolean(), sources: z.array(z.object({ sourcePaymentId: z.uuid(), sourceApplicationId: z.uuid().nullable(),
      amountMinor: minor, feeObligationMinor: minor, feeProvenCollectedMinor: minor, feeCollectionState, feeEvidenceDigest: sha, feeUnexpected: z.boolean() })).max(1000) }).nullable(),
  quote: publicMerchantTermsQuote.unwrap(), noticeSnapshot: z.object({ locale: z.enum(["en", "fr", "es", "ar"]), text: z.string().min(1) }) });

export async function requireGrossProrationSchema(ctx: ServiceContext) {
  const [ready] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=4 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
    ((to_regclass('subscription_prorations'),'subscription_prorations_guard'),(to_regclass('subscription_prorations'),'subscription_proration_complete'),(to_regclass('subscription_proration_principal'),'subscription_proration_principal_guard'),(to_regclass('subscription_proration_credit_uses'),'subscription_proration_credit_uses_guard'))`);
  if (!ready?.ready) throw new ServiceError("conflict", "Install the complete guarded original gross-proration lifecycle before accepting new money promises.");
}
export async function ownGrossProration(ctx: ServiceContext, id: string, planId?: string) {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in personally to review your own subscription change.");
  await lockContactIdentity(ctx.tx);
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  const [person] = await ctx.tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, ctx.actor.userId)).limit(1);
  if (!parent || parent.contactId !== person?.id) throw new ServiceError("not_found", "There is no such subscription.");
  if (planId) {
    const { selfServePlans, planSeller } = await import("./service");
    if (!(await selfServePlans(ctx, await planSeller(ctx, parent.planId))).some(plan => plan.id === planId)) throw new ServiceError("conflict", "That plan is not offered for this original merchant.");
  }
}
export async function prepareGrossProrationQuote(ctx: ServiceContext, input: z.infer<typeof grossProrationInput>) {
  await requireGrossProrationSchema(ctx); await requireAgreementFeeSchema(ctx); await lockContactIdentity(ctx.tx);
  const [enabled] = await ctx.tx.select({ enabled: moduleSettings.enabled }).from(moduleSettings).where(eq(moduleSettings.module, "subscriptions")).limit(1);
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, input.id)).limit(1).for("update");
  const [policy] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, input.id)).limit(1);
  const [scope] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, input.id)).limit(1);
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, input.id)).limit(1).for("update");
  const [previous] = await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.subscriptionId, input.id)).orderBy(desc(subscriptionCommercialTerms.revision)).limit(1).for("share");
  if (!enabled?.enabled || !parent || parent.merchantScopeVersion !== 1 || !policy?.merchantContactId || policy.model !== "seller_merchant" || !policy.sellerUserId || !scope || !resource || !previous
    || parent.signupPending || parent.pendingPlanId || parent.cancelAtPeriodEnd || parent.cancelledAt || !["active", "trialing"].includes(parent.status))
    throw new ServiceError("conflict", "Resolve the original period, existing accepted change or pending recovery before another gross-proration review.");
  if (parent.billingMode === "provider") throw new ServiceError("conflict", "Obtain the independently admitted actual provider preview and controlled draft-collection lineage before reviewing a provider proration.");
  if (resource.operationRevision !== 0 || resource.providerSubscriptionRef || resource.state !== "uncreated" || resource.recoveryPending)
    throw new ServiceError("conflict", "Resolve every original provider caller and resource before a local-calendar proration can promise another charge.");
  if (previous.snapshot.proration !== "create_prorations") throw new ServiceError("conflict", "This accepted plan defers changes to its original period end; use its future-amendment review.");
  const [pending] = await ctx.tx.select({ id: subscriptionProrations.id }).from(subscriptionProrations).where(and(eq(subscriptionProrations.subscriptionId, parent.id),
    inArray(subscriptionProrations.state, ["accepted", "preparing", "awaiting_invoice", "awaiting_payment", "awaiting_effective", "review"]))).limit(1);
  if (pending) throw new ServiceError("conflict", "Recover the existing whole accepted proration promise before another quote.");
  if (previous.effectivePeriodStart >= parent.currentPeriodEnd) {
    const [futureOwner] = await ctx.tx.select({ id: subscriptionProrations.id }).from(subscriptionProrations).where(and(eq(subscriptionProrations.termsId, previous.id), eq(subscriptionProrations.state, "applied"))).limit(1);
    if (!futureOwner) throw new ServiceError("conflict", "Finish the already accepted future amendment before replacing its offer.");
  }
  const people = [parent.contactId, policy.merchantContactId];
  const [erasure] = await ctx.tx.select({ id: dataRequests.id }).from(dataRequests).where(and(inArray(dataRequests.contactId, people), eq(dataRequests.kind, "erasure"), sql`${dataRequests.verifiedAt} is not null`,
    inArray(dataRequests.status, ["verified", "in_progress", "completed", "partially_completed"]))).limit(1);
  const [hold] = await ctx.tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions).innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(
    inArray(dataRequests.contactId, people), inArray(privacyRetentionExceptions.scope, ["commerce.money", "commerce.merchantTax", "subscriptions.agreements", "privacy.records"]),
    sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`)).limit(1);
  if (erasure || hold) throw new ServiceError("conflict", "Current buyer or merchant privacy work prevents another commercial money promise.");
  const effectiveAt = new Date(input.effectiveAt), basis = await paidProrationBasis(ctx, parent, effectiveAt);
  const economic = merchantTermsQuoteOutput.unwrap().parse(await ctx.callAsSystem(quoteOriginalMerchantTerms, { planId: input.planId, productVariantId: input.productVariantId, taxDestination: input.taxDestination,
    contactId: parent.contactId, currency: parent.currency, locale: input.locale, paymentMethodId: parent.paymentMethodId ?? undefined, amendmentFor: parent.id, calendarStart: parent.currentPeriodEnd }));
  const calendar = reviewedProrationCalendar({ billingMode: parent.billingMode, policy: "create_prorations", status: parent.status as "active" | "trialing", currentPeriodStart: parent.currentPeriodStart,
    currentPeriodEnd: parent.currentPeriodEnd, trialEndsAt: parent.trialEndsAt, at: effectiveAt, nextInterval: economic.snapshot.interval, nextIntervalCount: economic.snapshot.intervalCount });
  if (calendar.kind !== "preserve_trial" && calendar.kind !== "original_calendar") throw new ServiceError("conflict", "This backend requires its actual provider calendar preview.");
  const debitNetMinor = parent.status === "trialing" ? 0 : proratedAmounts(0, economic.snapshot.periodAmountMinor, parent.currentPeriodStart, parent.currentPeriodEnd, effectiveAt).newUnusedMinor;
  const actualTax = merchantTaxPreviewOutput.parse(await ctx.callAsSystem(previewMerchantTax, { profileId: economic.profile.profileId, profileVersion: economic.profile.profileVersion, contactId: parent.contactId,
    destination: economic.taxDestination, currency: parent.currency, items: [{ id: "line:0", quantityMicros: 1000000, unitAmountMinor: debitNetMinor, discountMinor: 0, category: economic.snapshot.taxCategoryCode, requiresShipping: economic.snapshot.requiresShipping }], shippingMinor: 0, occurredAt: effectiveAt }));
  const debitTaxQuote = subscriptionInitialTaxQuote.parse({ quoteDigest: actualTax.quoteDigest, subtotalMinor: actualTax.amounts.subtotalMinor, taxMinor: actualTax.amounts.taxMinor, totalMinor: actualTax.amounts.totalMinor });
  if (debitTaxQuote.subtotalMinor !== debitNetMinor || parent.status === "trialing" && debitTaxQuote.totalMinor !== 0) throw new ServiceError("conflict", "The actual dated quote cannot change the accepted unused principal or bill an uncharged trial window.");
  const totalCredit = BigInt(basis.creditNetMinor) + BigInt(basis.creditTaxMinor), totalDebit = BigInt(debitTaxQuote.totalMinor), applied = totalCredit < totalDebit ? totalCredit : totalDebit;
  let remainder = Number(applied), appliedFeeObligationMinor = 0, appliedFeeProvenCollectedMinor = 0;
  for (const source of [...basis.principal].sort(compareCreditSources)) {
    const takeMinor = Math.min(remainder, source.amountMinor); if (!takeMinor) break;
    appliedFeeObligationMinor += proportionalFeeCarry({ principalMinor: source.amountMinor, feeObligationMinor: source.feeObligationMinor, allocatedPrincipalMinor: 0, allocatedFeeMinor: 0, takeMinor });
    appliedFeeProvenCollectedMinor += proportionalFeeCarry({ principalMinor: source.amountMinor, feeObligationMinor: source.feeProvenCollectedMinor, allocatedPrincipalMinor: 0, allocatedFeeMinor: 0, takeMinor });
    remainder -= takeMinor;
  }
  const debitFeeObligationMinor = marketFeeMinor(debitNetMinor, policy.siteFeeBps), creditFeeObligationMinor = basis.principal.reduce((sum, source) => sum + source.feeObligationMinor, 0);
  const feeBudget = remainingCashFeeBudget(debitTaxQuote.totalMinor, debitFeeObligationMinor, Number(applied), appliedFeeObligationMinor);
  const feeReview = { debitFeeObligationMinor, creditFeeObligationMinor, appliedFeeObligationMinor, appliedFeeProvenCollectedMinor, remainingNewCashFeeMinor: Math.min(feeBudget.feeObligationMinor, feeBudget.principalMinor),
    separateMerchantReceivableMinor: Math.max(0, feeBudget.feeObligationMinor - feeBudget.principalMinor),
    originalOverTargetMinor: feeBudget.originalOverTargetMinor, originalSourceDebt: basis.principal.some(source => source.feeUnexpected || ["owed", "review"].includes(source.feeCollectionState)), sources: basis.principal };
  const noticeSnapshot = { locale: input.locale, text: `${economic.noticeSnapshot.text}\n${translator(input.locale)("subscriptions.grossProrationNotice")}\n${translator(input.locale)("subscriptions.proration.feeReceivableNotice")}` };
  const noticeDigest = merchantTaxDigest({ version: 1, noticeSnapshot, calendar, effectiveAt: input.effectiveAt, totalCredit: Number(totalCredit), totalDebit: Number(totalDebit), trialEndPreserved: parent.trialEndsAt?.toISOString() ?? null });
  const quoteDigest = merchantTaxDigest({ version: 1, kind: "gross-original-proration", subscriptionId: parent.id, previousTermsId: previous.id, effectiveAt: input.effectiveAt,
    sourceRevision: basis.sourceRevision, economicQuoteDigest: economic.quoteDigest, debitTaxQuote, calendar, noticeDigest, feeReview, originalScope: scope, originalPolicy: policy });
  const review = grossProrationReview.parse({ subscriptionId: parent.id, previousTermsId: previous.id, quoteDigest, sourceRevision: basis.sourceRevision, effectiveAt: input.effectiveAt,
    originalPeriodStart: parent.currentPeriodStart.toISOString(), originalPeriodEnd: parent.currentPeriodEnd.toISOString(), originalTrialEndsAt: parent.trialEndsAt?.toISOString() ?? null, calendar,
    debitNetMinor, debitTaxMinor: debitTaxQuote.taxMinor, creditNetMinor: basis.creditNetMinor, creditTaxMinor: basis.creditTaxMinor, creditAppliedMinor: Number(applied),
    cashDueMinor: Number(totalDebit - applied), residualCreditMinor: Number(totalCredit - applied), creditDisposition: "exclusive_until_paid_access_switch_no_automatic_cash_refund",
    quote: publicMerchantTermsQuote.unwrap().parse(economic), noticeSnapshot, feeReview, requiresMerchantReview: false });
  return { parent, previous, policy, scope, resource, effectiveAt, economic, basis, debitTaxQuote, noticeSnapshot, noticeDigest, feeReview, review };
}
export const quoteGrossProration = defineService({ name: "subscriptions.quoteProration", summary: "Review the exact original paid credit, dated new gross invoice, preserved calendar and locked credit before explicit plan-change consent.",
  kind: "query", permission: "scoped", input: grossProrationInput, output: grossProrationReview, handler: async (input, ctx) => (await prepareGrossProrationQuote(ctx, input)).review });
export const quoteMyGrossProration = defineService({ name: "subscriptions.quoteMyProration", summary: "Review only your own original paid subscription's gross proration and exact changed-price consent.",
  kind: "query", permission: "authenticated", input: grossProrationInput, output: grossProrationReview, handler: async (input, ctx) => { await ownGrossProration(ctx, input.id, input.planId); return { ...(await prepareGrossProrationQuote(ctx, input)).review, feeReview: null }; } });
export type GrossProrationReview = z.infer<typeof grossProrationReview>;
export default [quoteGrossProration, quoteMyGrossProration];
