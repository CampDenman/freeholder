// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: PREPARED/UNRUN actual service journeys; only provider edges synthetic.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { InvoiceForCharge, MerchantRefundObservation } from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { env } from "@/core/env";
import { stopJobs, reconcileJobDeploymentAdmission } from "@/core/jobs";
import { beginPaymentCheckout, completePaymentCheckout, submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { merchantPaymentObservations } from "@/modules/invoicing/merchant-collection-schema";
import { invoices, payments, creditNotes, refunds } from "@/modules/invoicing/schema";
import { originalCashRecoveries, originalCashRecoveryOperations, originalCashRecoveryFacts, originalCashRecoveryClosures } from "@/modules/invoicing/original-cash-recovery-schema";
import { merchantUnappliedChargeResolutions } from "@/modules/invoicing/merchant-refund-schema";
import { returnOriginalCash } from "@/modules/invoicing/original-cash-recovery";
import { ORIGINAL_CASH_RETURN_CONFIRMATION } from "@/modules/invoicing/original-cash-recovery-proof";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
async function fixture(options: { unapplied?: boolean; unreadableFee?: boolean; pauseRecipient?: boolean } = {}) {
  const base = await seedMerchantCheckout80("destination"), placed = await base.checkout(), originals = new Map<string, InvoiceForCharge>();
  try {
  const nonce = randomUUID().replaceAll("-", ""), intent = `pi_Cash${nonce}`, charge = `ch_Cash${nonce}`, fee = `fee_Cash${nonce}`, transfer = `tr_Cash${nonce}`;
  let money = 0, commission = 0, amount = 0, currency = "CAD", feeReturned = 0, transferReturned = 0, customerReturned = 0;
  const posts: string[] = [], feeResources: Array<Record<string, unknown>> = [], transferResources: Array<Record<string, unknown>> = [], customerResources: MerchantRefundObservation[] = [];
  const entered = signal(), release = signal(); let unreadable = options.unreadableFee === true;
  base.stripe.createCheckout = async request => { originals.set(`cs_Cash${nonce}`, request); return { ...request, providerRef: `cs_Cash${nonce}`, paymentRef: intent, url: `https://checkout.example.test/cs_Cash${nonce}` }; };
  base.stripe.captureCheckout = async request => {
    const original = originals.get(request.checkoutRef)!; amount = original.amountMinor; money = original.amountMinor; commission = original.applicationFeeMinor ?? 0;
    // A real positive provider result with a later invoice-currency rejection
    // creates actual unapplied cash through normal capture/persistence phases.
    currency = options.unapplied ? "USD" : original.currency;
    return { ...original, providerApiVersion: "2026-02-25.clover", providerRef: intent, status: "succeeded", amountMinor: amount, currency, customerChargeVerified: true, merchantRouteVerified: true, merchantSettlementVerified: true,
      providerChargeRef: charge, applicationFeeRef: fee, transferRef: transfer, observedApplicationFeeMinor: commission, applicationFeeCurrency: currency, observedFeeRefundedMinor: 0 };
  };
  const begun = await beginPaymentCheckout.call({ invoiceId: placed.order.invoiceId!, provider: "stripe", successUrl: env().APP_URL, cancelUrl: env().APP_URL, idempotencyKey: randomUUID() }, OWNER);
  if (options.unapplied) await expect(completePaymentCheckout.call({ paymentId: begun.payment.id, idempotencyKey: randomUUID() }, OWNER)).rejects.toThrow();
  else await completePaymentCheckout.call({ paymentId: begun.payment.id, idempotencyKey: randomUUID() }, OWNER);
  const observations = await db().select().from(merchantPaymentObservations).where(eq(merchantPaymentObservations.paymentId, begun.payment.id));
  const observed = observations.find(row => row.status === "succeeded" && row.providerRef === intent && row.currency === currency);
  if (!observed) throw Error("The actual positive capture did not commit its original financial receipt.");
  const source = { kind: "payment" as const, paymentId: begun.payment.id, ...(options.unapplied ? { observationId: observed.id } : {}) };
  // Synthetic payment edge implements the real callback contract; no local
  // payment/refund/history row or ServiceContext is fabricated by this fixture.
  base.stripe.createMerchantRefund = async request => {
    posts.push("customer"); const providerRef = `re_Cash${nonce}`; await request.onRefundResourceAcknowledged(providerRef);
    const evidence: MerchantRefundObservation = { providerRef, paymentProviderRef: intent, providerChargeRef: charge, providerPlatformAccountId: "acct_fixturePlatform",
      providerApiVersion: "2026-02-25.clover", amountMinor: request.amountMinor, currency, status: "succeeded", providerStatus: "succeeded", bindingVerified: true };
    customerResources.push(evidence); customerReturned += evidence.amountMinor; await request.onRefundObserved(evidence); return evidence;
  };
  base.stripe.recoverMerchantRefund = async request => {
    const resource = customerResources.find(row => row.providerRef === request.originalRefundRef) ?? customerResources[0];
    if (!resource) return { state: "unresolved" }; await request.onRefundObserved(resource); return { state: "observed", evidence: resource };
  };
  if (!options.unapplied) await submitProviderRefund.call({ paymentId: begun.payment.id, amountMinor: amount, reason: "Return this actual full original payment", idempotencyKey: `full-cash-${nonce}` }, OWNER);
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    expect(url.origin).toBe("https://api.stripe.com"); expect(new Headers(init.headers).get("stripe-account")).toBeNull();
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_fixturePlatform" });
    if (url.pathname === `/v1/payment_intents/${intent}`) return Response.json({ id: intent, status: "succeeded", amount_received: money, currency: currency.toLowerCase(), latest_charge: charge, amount_capturable: 0 });
    if (url.pathname === `/v1/charges/${charge}`) return Response.json({ id: charge, payment_intent: intent, amount_captured: money, amount_refunded: customerReturned,
      currency: currency.toLowerCase(), paid: true, captured: true, refunded: customerReturned === money, application_fee: fee, transfer });
    if (url.pathname === "/v1/refunds") return Response.json({ data: customerResources.map(resource => ({ id: resource.providerRef, payment_intent: intent, charge, amount: resource.amountMinor, currency: currency.toLowerCase(), status: "succeeded" })), has_more: false });
    if (url.pathname === "/v1/disputes") return Response.json({ data: [], has_more: false });
    if (url.pathname === `/v1/application_fees/${fee}`) return Response.json({ id: fee, account: "acct_fixtureSeller0", originating_transaction: charge, amount: commission, amount_refunded: feeReturned, currency: currency.toLowerCase() });
    if (url.pathname === `/v1/transfers/${transfer}`) return Response.json({ id: transfer, source_transaction: charge, destination: "acct_fixtureSeller0", amount: money, amount_reversed: transferReturned,
      reversed: transferReturned === money, currency: currency.toLowerCase() });
    const isFee = url.pathname.includes("application_fees"), list = isFee ? feeResources : transferResources;
    if (init.method === "POST") {
      const form = typeof init.body === "string" ? new URLSearchParams(init.body) : init.body instanceof URLSearchParams ? init.body : null;
      if (!form) throw Error("The actual auxiliary POST must carry its original frozen form.");
      const returned = Number(form.get("amount")); posts.push(isFee ? "fee" : "recipient");
      const resource = { id: `${isFee ? "fr" : "trr"}_Cash${nonce}`, [isFee ? "fee" : "transfer"]: isFee ? fee : transfer, amount: returned, currency: currency.toLowerCase(), metadata: { freeholder_cash_auxiliary_id: form.get("metadata[freeholder_cash_auxiliary_id]") } };
      list.push(resource); if (isFee) feeReturned += returned; else { transferReturned += returned; entered.resolve(); if (options.pauseRecipient) await release.promise; }
      if (isFee && unreadable) { unreadable = false; return new Response("{", { headers: { "content-type": "application/json" } }); }
      return Response.json(resource);
    }
    if (url.pathname.endsWith("refunds") || url.pathname.endsWith("reversals")) return Response.json({ data: list, has_more: false });
    const resource = list.find(row => url.pathname.endsWith(String(row.id))); if (resource) return Response.json(resource);
    throw Error(`Unexpected original cash transport ${init.method} ${url.pathname}`);
  });
  const actual = createStripePayments({ secretKey: "sk_cash_fixture_only", fetch: fetcher });
  base.stripe.inspectMerchantReturnedCash = actual.inspectMerchantReturnedCash; base.stripe.createMerchantCashAuxiliary = actual.createMerchantCashAuxiliary; base.stripe.recoverMerchantCashAuxiliary = actual.recoverMerchantCashAuxiliary;
  return { base, source, posts, entered, release, amount, paymentId: begun.payment.id, invoiceId: placed.order.invoiceId!, run: () => returnOriginalCash.call({ source, confirmation: ORIGINAL_CASH_RETURN_CONFIRMATION }, OWNER) };
  } catch (error) { base.cleanup(); throw error; }
}
describe.runIf(hasDatabase)("original cash full-return checkpoint81", { timeout: 60000 }, () => {
  let active: Awaited<ReturnType<typeof fixture>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(async () => { active?.release.resolve(); active?.base.cleanup(); active = undefined; vi.restoreAllMocks(); await stopJobs(); await reconcileJobDeploymentAdmission(); await closeDb(); }); afterAll(closeDb);
  it("completes actual destination customer, fee and recipient return while retaining the same paid invoice, payment and credits", async () => {
    active = await fixture(); const beforeCredits = await db().select().from(creditNotes), beforeRefunds = await db().select().from(refunds);
    const result = await active.run(); expect(result.closureId).toBeTruthy(); expect(active.posts).toEqual(["customer", "fee", "recipient"]);
    await active.run(); expect(active.posts).toEqual(["customer", "fee", "recipient"]);
    expect(await db().select().from(creditNotes)).toEqual(beforeCredits); expect(await db().select().from(refunds)).toEqual(beforeRefunds);
    expect((await db().select().from(payments).where(eq(payments.id, active.paymentId)))[0]).toMatchObject({ status: "succeeded", refundedMinor: active.amount });
    expect((await db().select().from(invoices).where(eq(invoices.id, active.invoiceId)))[0]).toMatchObject({ paidMinor: active.amount, refundedMinor: active.amount });
  });
  it("returns actual positive unapplied capture cash without inventing a settled payment, logical refund or credit", async () => {
    active = await fixture({ unapplied: true }); const before = await db().select().from(payments), priorRefunds = await db().select().from(refunds);
    await active.run(); expect(active.posts).toEqual(["customer", "fee", "recipient"]);
    expect(await db().select().from(payments)).toEqual(before); expect(await db().select().from(refunds)).toEqual(priorRefunds); expect(await db().select().from(creditNotes)).toHaveLength(0);
    expect(await db().select().from(merchantUnappliedChargeResolutions)).toHaveLength(1); expect(await db().select().from(originalCashRecoveryClosures)).toHaveLength(1);
    expect((await db().select().from(originalCashRecoveries))[0]?.owner.cash.applied).toBe(false);
  });
  it("recovers a genuinely unreadable accepted original fee by GET without another physical fee key", async () => {
    active = await fixture({ unreadableFee: true }); await expect(active.run()).rejects.toThrow(); expect(active.posts).toEqual(["customer", "fee"]);
    expect((await db().select().from(originalCashRecoveryFacts)).some(row => row.kind === "finish" && row.evidence.outcome === "threw")).toBe(true);
    await active.run(); expect(active.posts).toEqual(["customer", "fee", "recipient"]); expect(await db().select().from(originalCashRecoveryClosures)).toHaveLength(1);
  });
  it("refuses a second POST while the actual original recipient caller is paused, then retains its actual finish", async () => {
    active = await fixture({ pauseRecipient: true }); const pending = active.run().then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      expect(await Promise.race([active.entered.promise.then(() => "entered"), pending.then(() => "ended")])).toBe("entered");
      await expect(active.run()).rejects.toMatchObject({ code: "conflict" }); expect(active.posts).toEqual(["customer", "fee", "recipient"]);
      active.release.resolve(); expect(await pending).toHaveProperty("value");
      const operations = await db().select().from(originalCashRecoveryOperations), facts = await db().select().from(originalCashRecoveryFacts);
      expect(operations.every(operation => facts.some(fact => fact.operationId === operation.id && fact.kind === "finish" && fact.evidence.callerInstanceId === operation.caller.id))).toBe(true);
    } finally { active.release.resolve(); await pending; }
  });
});
