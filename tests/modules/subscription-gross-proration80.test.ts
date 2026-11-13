// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C9.38/C12.38 PREPARED/UNRUN native controls. Every money row is produced
// by actual shared services. Fictional identity/bank attachment and the initial
// application clock are explicit fixtures, never independently verified money.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { setModuleEnabled } from "@/core/settings/service";
import { entitlementGrants, entitlements } from "@/core/entitlements/schema";
import { cartItems, productVariants } from "@/modules/catalog/schema";
import { createListing } from "@/modules/members/listings";
import { getProductVariants } from "@/modules/catalog/variants";
import { creditNotes, invoiceLines, invoices, payments } from "@/modules/invoicing/schema";
import { recordOfflinePayment, recordOfflineRefund } from "@/modules/invoicing/payment-provider-service";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReservations } from "@/modules/invoicing/credit-application-schema";
import { recordCommercialFee, reviewCommercialPayment } from "@/modules/invoicing/commercial-attestations";
import { recordAgreementFeeRemittance, reviewAgreementFee } from "@/modules/invoicing/agreement-fee-service";
import { agreementFeeDuties, agreementFeeEligibility, agreementFeeRemittances } from "@/modules/invoicing/agreement-fee-schema";
import { creditNoteDisposition } from "@/modules/invoicing/credit-disposition";
import { commercialPaymentAttestations } from "@/modules/invoicing/commercial-attestation-schema";
import { merchantAgreementPaymentRoutes } from "@/modules/invoicing/merchant-agreement-schema";
import { quoteNewAgreement } from "@/modules/subscriptions/merchant-terms-quote";
import { subscriptionCommercialTerms, subscriptions } from "@/modules/subscriptions/schema";
import { savePlan, subscribe } from "@/modules/subscriptions/service";
import { quoteGrossProration } from "@/modules/subscriptions/proration-quote";
import { acceptGrossProration, applyGrossProrationTask, completePaidGrossProration } from "@/modules/subscriptions/proration-service";
import { subscriptionProrations } from "@/modules/subscriptions/proration-schema";
import { subscriptionProrationWitnesses } from "@/modules/subscriptions/proration-witnesses";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("actual original gross proration, attested cash and exclusive canonical credit", { timeout: 90000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { vi.useRealTimers(); fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function original(trial = false) {
    // Make an actual paid one-day period halfway through its producer-created
    // calendar. The effective instant is genuinely in the near future for PG.
    // Restoring Date does not advance PostgreSQL or fake an effect receipt.
    const effectiveAt = new Date(Date.now() + 45000);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(effectiveAt.getTime() - 43200000);
    fixture = await seedMerchantCheckout80("destination", 1);
    await setModuleEnabled.call({ module: "subscriptions", enabled: true }, OWNER);
    const [item] = await db().select({ variant: productVariants }).from(cartItems).innerJoin(productVariants, eq(productVariants.id, cartItems.variantId)).where(eq(cartItems.cartId, fixture.cart.id)).limit(1);
    if (!item) throw new Error("The real original merchant listing has no variant.");
    const plan = await savePlan.call({ productId: item.variant.productId, name: "Original actual gross paid day", interval: "day", trialDays: trial ? 1 : 0,
      trialRequiresCard: false, billingMode: "manual", proration: "create_prorations", status: "active" }, OWNER);
    const input = { planId: plan.id, productVariantId: item.variant.id, contactId: fixture.buyer.id, currency: "CAD", taxDestination: { country: "CA", region: "BC" } };
    const quote = await quoteNewAgreement.call(input, OWNER); if (!quote) throw new Error("Missing actual original seller terms.");
    const accepted = await subscribe.call({ ...input, commercialTerms: { quoteDigest: quote.quoteDigest, locale: "en", source: "owner_subscription" } }, OWNER);
    if (!trial) {
      if (!accepted.invoiceId) throw new Error("The actual original manual period must have an issued invoice.");
      const [invoice] = await db().select().from(invoices).where(eq(invoices.id, accepted.invoiceId));
      expect(invoice).toMatchObject({ subtotalMinor: 4000, taxMinor: 200, totalMinor: 4200 });
      await recordOfflinePayment.call({ invoiceId: invoice!.id, method: "bank_transfer", amountMinor: 4200, reference: "fictional-original-gross-principal",
        evidence: "Synthetic original external receipt attestation, not bank verification", idempotencyKey: "original-gross-principal" }, OWNER);
    }
    const [terms] = await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.subscriptionId, accepted.subscription.id));
    const originalInvoice = accepted.invoiceId ? (await db().select().from(invoices).where(eq(invoices.id, accepted.invoiceId)))[0] : null;
    vi.useRealTimers();
    if (effectiveAt.getTime() - Date.now() < 10000) throw new Error("The real producer setup consumed the finite review window; rerun with a fresh actual instant, never backdate it.");
    return { accepted, plan, input, terms, originalInvoice, effectiveAt };
  }
  async function target(price: string) {
    const listing = await createListing.call({ title: `Actual gross target ${price}`, kind: "digital", price, acceptPolicy: true }, fixture!.sellers[0]);
    const variant = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!;
    const plan = await savePlan.call({ productId: listing.productId, name: `Actual gross target ${price}`, interval: "day", intervalCount: 2,
      billingMode: "manual", proration: "create_prorations", status: "active" }, OWNER);
    return { plan, variant };
  }
  async function effect(prorationId: string) {
    const [receipt] = await db().select().from(subscriptionProrations).where(eq(subscriptionProrations.id, prorationId));
    if (!receipt?.originalTask) throw new Error("The actual immutable enqueue body is required, never reconstruct an original task.");
    const waitMs = receipt.effectiveAt.getTime() - Date.now() + 30;
    if (waitMs > 45030) throw new Error("The actual effect wait exceeded this finite native control.");
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    return applyGrossProrationTask.call(receipt.originalTask, { kind: "system" });
  }
  const parent = async (id: string) => (await db().select().from(subscriptions).where(eq(subscriptions.id, id)))[0]!;
  const access = (id: string) => db().select({ planId: entitlements.grantorId, startsAt: entitlementGrants.startsAt, endsAt: entitlementGrants.endsAt })
    .from(entitlementGrants).innerJoin(entitlements, eq(entitlements.id, entitlementGrants.entitlementId)).where(eq(entitlementGrants.sourceSubscriptionId, id));

  it("retains old paid access through exact gross debit, old-tax credit and partial real external payment; only actual fully paid effect switches plan without changing the original calendar", async () => {
    const old = await original(), next = await target("100");
    const input = { id: old.accepted.subscription.id, planId: next.plan.id, productVariantId: next.variant.id, effectiveAt: old.effectiveAt.toISOString(), taxDestination: old.input.taxDestination, locale: "en" as const };
    const quote = await quoteGrossProration.call(input, OWNER);
    expect(quote).toMatchObject({ debitNetMinor: 5000, debitTaxMinor: 250, creditNetMinor: 2000, creditTaxMinor: 100, creditAppliedMinor: 2100, cashDueMinor: 3150,
      residualCreditMinor: 0, requiresMerchantReview: false, feeReview: { debitFeeObligationMinor: 500, creditFeeObligationMinor: 200, appliedFeeObligationMinor: 200, appliedFeeProvenCollectedMinor: 0, remainingNewCashFeeMinor: 300, originalSourceDebt: true } });
    const consent = { ...input, previousTermsId: quote.previousTermsId, acceptedQuoteDigest: quote.quoteDigest, confirm: true as const };
    const accepted = await acceptGrossProration.call(consent, OWNER);
    expect((await acceptGrossProration.call(consent, OWNER)).prorationId).toBe(accepted.prorationId);
    if (!accepted.invoiceId || !accepted.creditNoteId) throw new Error("Actual canonical debit and old credit are required.");
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, accepted.invoiceId));
    expect(invoice).toMatchObject({ totalMinor: 5250, paidMinor: 0, creditedMinor: 2100 });
    expect((await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, accepted.invoiceId)))[0]).toMatchObject({ subtotalMinor: 5000, taxMinor: 250 });
    expect((await db().select().from(creditNotes).where(eq(creditNotes.id, accepted.creditNoteId)))[0]).toMatchObject({ totalMinor: 2100, status: "issued" });
    const funding = await db().select().from(invoiceCreditFunding), reservations = await db().select().from(invoiceCreditReservations), applications = await db().select().from(invoiceCreditApplications);
    expect(funding).toHaveLength(1); expect(reservations).toHaveLength(1); expect(applications).toHaveLength(1);
    expect(funding[0]).toMatchObject({ amountMinor: 2100, feeObligationMinor: 200, feeProvenCollectedMinor: 0, feeCollectionState: "owed" });
    expect(applications[0]).toMatchObject({ invoiceId: invoice!.id, feeObligationMinor: 200, feeProvenCollectedMinor: 0 });
    const beforeAccess = await access(input.id);
    const partial = await recordOfflinePayment.call({ invoiceId: invoice!.id, method: "bank_transfer", amountMinor: 1, reference: "fictional-gross-partial",
      evidence: "Synthetic partial external principal attestation", idempotencyKey: "gross-partial" }, OWNER);
    expect(await completePaidGrossProration.call({ invoiceId: invoice!.id }, { kind: "system" })).toEqual({ applied: false, reviewRequired: false });
    expect((await parent(input.id)).planId).toBe(old.plan.id); expect(await access(input.id)).toEqual(beforeAccess);
    expect(partial.amountMinor).toBe(1);
    await recordOfflinePayment.call({ invoiceId: invoice!.id, method: "bank_transfer", amountMinor: 3149, reference: "fictional-gross-final",
      evidence: "Synthetic remaining external principal attestation", idempotencyKey: "gross-final" }, OWNER);
    expect((await parent(input.id)).planId).toBe(old.plan.id);
    expect(await effect(accepted.prorationId)).toEqual({ applied: true, reviewRequired: false });
    expect(await parent(input.id)).toMatchObject({ planId: next.plan.id, currentPeriodStart: old.accepted.subscription.currentPeriodStart, currentPeriodEnd: old.accepted.subscription.currentPeriodEnd });
    expect((await access(input.id)).every(row => row.planId !== next.plan.id || row.startsAt >= old.effectiveAt)).toBe(true);
    expect((await db().select().from(invoices).where(eq(invoices.id, old.originalInvoice!.id)))[0]).toEqual(old.originalInvoice);
    expect((await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, old.terms!.id)))[0]).toEqual(old.terms);
    expect(await db().select().from(payments)).toHaveLength(3); expect(await db().select().from(commercialPaymentAttestations)).toHaveLength(3);
    expect(await db().select().from(merchantAgreementPaymentRoutes)).toHaveLength(0);
    const witness = await db().transaction(tx => subscriptionProrationWitnesses(tx, [input.id]));
    expect(witness.incomplete).toBe(false); expect(witness.prorations).toHaveLength(1); expect(witness.principal).toHaveLength(1); expect(witness.creditUses).toHaveLength(1);
    expect(witness.prorations[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("locks a downgrade remainder while old access remains and releases its genuine noncash residual only after the actual paid-credit effect", async () => {
    const old = await original(), next = await target("10");
    const input = { id: old.accepted.subscription.id, planId: next.plan.id, productVariantId: next.variant.id, effectiveAt: old.effectiveAt.toISOString(), taxDestination: old.input.taxDestination, locale: "en" as const };
    const quote = await quoteGrossProration.call(input, OWNER);
    expect(quote).toMatchObject({ debitNetMinor: 500, debitTaxMinor: 25, creditNetMinor: 2000, creditTaxMinor: 100, creditAppliedMinor: 525, cashDueMinor: 0, residualCreditMinor: 1575 });
    const accepted = await acceptGrossProration.call({ ...input, previousTermsId: quote.previousTermsId, acceptedQuoteDigest: quote.quoteDigest, confirm: true }, OWNER);
    if (!accepted.creditNoteId) throw new Error("The real original issued credit is required.");
    expect(await db().transaction(tx => creditNoteDisposition(tx, accepted.creditNoteId!))).toMatchObject({ appliedMinor: 525, lockedMinor: 1575, availableMinor: 0 });
    expect((await parent(input.id)).planId).toBe(old.plan.id);
    expect(await effect(accepted.prorationId)).toEqual({ applied: true, reviewRequired: false });
    expect(await db().transaction(tx => creditNoteDisposition(tx, accepted.creditNoteId!))).toMatchObject({ appliedMinor: 525, lockedMinor: 0, availableMinor: 1575 });
    expect(await db().select().from(payments)).toHaveLength(1);
    expect((await parent(input.id)).currentPeriodEnd).toEqual(old.accepted.subscription.currentPeriodEnd);
  });

  it("retains a separate dated-tax fee receivable through actual settlement, remittance and a refund of the last cash unit while original credit remains valid", async () => {
    const old = await original(), next = await target("42.02");
    // The actual shared tax engine reviews the new destination separately:
    // original Canadian tax stays in the old credit, new destination is untaxed.
    const input = { id: old.accepted.subscription.id, planId: next.plan.id, productVariantId: next.variant.id, effectiveAt: old.effectiveAt.toISOString(), taxDestination: { country: "US", region: "OR" }, locale: "en" as const };
    const quote = await quoteGrossProration.call(input, OWNER);
    expect(quote).toMatchObject({ debitNetMinor: 2101, debitTaxMinor: 0, creditAppliedMinor: 2100, cashDueMinor: 1, requiresMerchantReview: false,
      feeReview: { debitFeeObligationMinor: 210, appliedFeeObligationMinor: 200, remainingNewCashFeeMinor: 1, separateMerchantReceivableMinor: 9 } });
    expect(quote.noticeSnapshot.text).toContain("all retained cash and applied original credit");
    const accepted = await acceptGrossProration.call({ ...input, previousTermsId: quote.previousTermsId, acceptedQuoteDigest: quote.quoteDigest, confirm: true }, OWNER);
    if (!accepted.invoiceId) throw new Error("The actual separate commission duty requires its canonical target.");
    expect((await db().select().from(agreementFeeDuties).where(eq(agreementFeeDuties.invoiceId, accepted.invoiceId)))[0])
      .toMatchObject({ totalMinor: 2101, targetFeeMinor: 210, carriedFeeMinor: 200, cashPrincipalMinor: 1, cashFeeTargetMinor: 1, expectedReceivableMinor: 9 });
    expect(await reviewAgreementFee.call({ invoiceId: accepted.invoiceId }, OWNER)).toMatchObject({ eligible: false, owedMinor: 0, recordedMinor: 0, pending: true });
    const paid = await recordOfflinePayment.call({ invoiceId: accepted.invoiceId, method: "bank_transfer", amountMinor: 1, reference: "fictional-cash-one",
      evidence: "Synthetic actual external principal receipt", idempotencyKey: "dated-tax-cash-one" }, OWNER);
    await completePaidGrossProration.call({ invoiceId: accepted.invoiceId }, { kind: "system" });
    expect(await reviewAgreementFee.call({ invoiceId: accepted.invoiceId }, OWNER)).toMatchObject({ eligible: true, owedMinor: 9, recordedMinor: 0 });
    expect(await db().select().from(agreementFeeEligibility)).toHaveLength(1);
    const remittance = { invoiceId: accepted.invoiceId, amountMinor: 9, reference: "fictional-receivable-remittance", evidence: "Synthetic attested external commission remittance", idempotencyKey: "dated-tax-fee-remittance" };
    await recordAgreementFeeRemittance.call(remittance, OWNER); await recordAgreementFeeRemittance.call(remittance, OWNER);
    expect(await db().select().from(agreementFeeRemittances)).toHaveLength(1);
    await recordCommercialFee.call({ paymentId: paid.id, amountMinor: 1, reference: "fictional-original-cash-fee", evidence: "Synthetic actual external cash fee remittance", idempotencyKey: "dated-tax-physical-fee" }, OWNER);
    expect(await effect(accepted.prorationId)).toEqual({ applied: true, reviewRequired: false });
    // A real authorized customer-principal refund remains available even while
    // the merchant has a separate original fee duty; there is no fake fee cash.
    await recordOfflineRefund.call({ paymentId: paid.id, amountMinor: 1, reference: "fictional-refunded-cash-one", reason: "Synthetic legitimate actual external principal return", idempotencyKey: "dated-tax-refund-one" }, OWNER);
    const cashFee = (await reviewCommercialPayment.call({ paymentId: paid.id }, OWNER)).receipts.find(row => row.direction === "remitted")!;
    await recordCommercialFee.call({ paymentId: paid.id, direction: "returned", originalRemittanceId: cashFee.id, amountMinor: 1, reference: "fictional-returned-cash-fee", evidence: "Synthetic actual original fee return", idempotencyKey: "dated-tax-cash-fee-return" }, OWNER);
    expect(await reviewAgreementFee.call({ invoiceId: accepted.invoiceId }, OWNER)).toMatchObject({ eligible: true, owedMinor: 9, recordedMinor: 9, returnDueMinor: 0, reviewRequired: false });
    expect((await db().select().from(invoices).where(eq(invoices.id, accepted.invoiceId)))[0]).toMatchObject({ paidMinor: 1, refundedMinor: 1, creditedMinor: 2100 });
    expect(await db().select().from(payments)).toHaveLength(2); expect(await db().select().from(merchantAgreementPaymentRoutes)).toHaveLength(0);
  });

  it("preserves an uncharged trial's accepted end and records neither old paid credit nor a trial-window invoice or payment", async () => {
    const old = await original(true), next = await target("100");
    const input = { id: old.accepted.subscription.id, planId: next.plan.id, productVariantId: next.variant.id, effectiveAt: old.effectiveAt.toISOString(), taxDestination: old.input.taxDestination, locale: "en" as const };
    const quote = await quoteGrossProration.call(input, OWNER);
    expect(quote).toMatchObject({ calendar: { kind: "preserve_trial", trialEndsAt: old.accepted.subscription.trialEndsAt!.toISOString(), chargeMinor: 0, oldPaidCreditMinor: 0 },
      debitNetMinor: 0, debitTaxMinor: 0, creditNetMinor: 0, creditTaxMinor: 0, cashDueMinor: 0 });
    const accepted = await acceptGrossProration.call({ ...input, previousTermsId: quote.previousTermsId, acceptedQuoteDigest: quote.quoteDigest, confirm: true }, OWNER);
    expect(accepted).toMatchObject({ invoiceId: null, creditNoteId: null });
    expect(await effect(accepted.prorationId)).toEqual({ applied: true, reviewRequired: false });
    expect(await parent(input.id)).toMatchObject({ status: "trialing", planId: next.plan.id, trialEndsAt: old.accepted.subscription.trialEndsAt, currentPeriodEnd: old.accepted.subscription.currentPeriodEnd });
    expect(await db().select().from(invoices)).toHaveLength(0); expect(await db().select().from(creditNotes)).toHaveLength(0); expect(await db().select().from(payments)).toHaveLength(0);
  });
});
