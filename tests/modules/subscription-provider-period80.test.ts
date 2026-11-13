// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: real producers and raw HMAC HTTP ingress; fictional provider responses.
// This proves application/lineage behavior, not external settlement acceptance.
import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { invoices, invoiceLines, invoiceMarketPolicies, payments } from "@/modules/invoicing/schema";
import { invoiceMerchantTaxQuotes } from "@/modules/invoicing/merchant-tax-schema";
import { originalReceiptPrincipalReview } from "@/modules/invoicing/principal-authority";
import { paymentWebhookRoute } from "@/modules/invoicing/payment-webhook-route";
import { subscriptionProviderInvoiceObservations, subscriptionProviderInvoiceLines } from "@/modules/subscriptions/provider-period-schema";
import { subscriptionProviderChargeReceipts, subscriptionProviderChargeObservations, subscriptions } from "@/modules/subscriptions/schema";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
const actualPhase = z.object({ start_date: z.number(), end_date: z.number(), metadata: z.record(z.string(), z.string()), items: z.array(z.object({ price: z.string() })).length(1) });
describe.runIf(hasDatabase)("actual future invoice binds admitted canonical net/tax/fee", { timeout: 60000 }, () => {
  let source: Awaited<ReturnType<typeof seedActualProviderSubscription80>> | undefined;
  let observed: { phase: z.infer<typeof actualPhase>; amount: number; fee: number; invoice: Record<string, unknown> } | undefined;
  let decimal = "1";
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { vi.useRealTimers(); source?.fixture.cleanup(); source = undefined; observed = undefined; decimal = "1"; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function original() {
    source = await seedActualProviderSubscription80({ extra: async url => {
      if (!observed) throw new Error("The fixture has no actual admitted period yet");
      const { phase, amount, fee, invoice } = observed;
      if (url.pathname === "/v1/invoices/in_future") return Response.json(invoice);
      if (url.pathname === "/v1/invoice_payments") return Response.json({ data: [{ id: "inpay_future", invoice: "in_future", status: "paid", amount_paid: amount, amount_requested: amount, currency: "cad", payment: { type: "payment_intent", payment_intent: "pi_future" } }], has_more: false });
      if (url.pathname === "/v1/payment_intents/pi_future") return Response.json({ id: "pi_future", object: "payment_intent", status: "succeeded", amount_received: amount, amount_capturable: 0, amount, currency: "cad", customer: "cus_actualProducer", latest_charge: "ch_future", application_fee_amount: fee, transfer_data: { destination: "acct_fixtureSeller0" }, on_behalf_of: "acct_fixtureSeller0" });
      if (url.pathname === "/v1/charges/ch_future") return Response.json({ id: "ch_future", payment_intent: "pi_future", status: "succeeded", paid: true, captured: true, amount_captured: amount, currency: "cad", application_fee: "fee_future", transfer: "tr_future" });
      if (url.pathname === "/v1/application_fees/fee_future") return Response.json({ id: "fee_future", account: "acct_fixtureSeller0", originating_transaction: "ch_future", amount: fee, currency: "cad", amount_refunded: 0 });
      if (url.pathname === "/v1/transfers/tr_future") return Response.json({ id: "tr_future", destination: "acct_fixtureSeller0", source_transaction: "ch_future", amount, currency: "cad", amount_reversed: 0, reversed: false });
      if (url.pathname === "/v1/invoices/in_future/lines") return Response.json({ data: [{ id: "il_future", invoice: "in_future", amount, currency: "cad", quantity: 1, quantity_decimal: decimal,
        parent: { type: "subscription_item_details", subscription_item_details: { proration: false } }, period: { start: phase.start_date, end: phase.end_date }, pricing: { price_details: { price: phase.items[0]!.price } }, discount_amounts: [], discounts: [], taxes: [], pretax_credit_amounts: [] }], has_more: false });
      return null;
    } });
    expect((await source.create()).verified).toBe(true);
    const phase = z.object({ phases: z.array(actualPhase).min(1) }).parse(source.remote.schedule()).phases[0]!;
    const actualPrice = z.object({ unit_amount: z.number() }).parse(source.remote.prices().get(phase.items[0]!.price));
    const operation = (await source.operations()).find(operation => operation.kind === "create"); if (!operation) throw new Error("Missing actual original physical operation");
    const admitted = z.object({ phases: z.array(z.object({ applicationFeeMinor: z.number() })).min(1) }).parse(operation.originalRequest).phases[0]!;
    const amount = actualPrice.unit_amount, fee = admitted.applicationFeeMinor;
    const invoice = { id: "in_future", object: "invoice", customer: "cus_actualProducer", status: "paid", paid_out_of_band: false, currency: "cad", subtotal: amount, total: amount,
      amount_paid: amount, amount_remaining: 0, collection_method: "charge_automatically", automatic_tax: { enabled: false }, starting_balance: 0, ending_balance: 0, amount_shipping: 0,
      pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0, discounts: [], total_discount_amounts: [], total_taxes: [],
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_actualProducer", metadata: phase.metadata } },
      lines: { has_more: false, data: [{ type: "subscription", period: { start: phase.start_date, end: phase.end_date } }] } };
    observed = { phase, amount, fee, invoice }; source.remote.activate();
  }
  async function ingress(eventId: string) {
    if (!observed) throw new Error("Create the actual original period before HTTP feedback");
    const timestamp = Math.floor(Date.now() / 1000), body = JSON.stringify({ id: eventId, type: "invoice.paid", created: timestamp, data: { object: observed.invoice } });
    const signature = createHmac("sha256", "whsec_actual_producer_fixture").update(`${timestamp}.${body}`).digest("hex");
    return paymentWebhookRoute("stripe")(new Request("https://freeholder.example.test/api/webhooks/payments/stripe", { method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}`, "content-type": "application/json" }, body }));
  }
  it("creates canonical original net/setup/tax/fee lines before applying actual cash and advances exactly one period", async () => {
    await original(); if (!source || !observed) throw new Error("Missing original period");
    expect((await ingress("evt_future_valid")).status).toBe(200);
    const [invoice] = await db().select().from(invoices).where(eq(invoices.sourceType, "subscription")); expect(invoice).toMatchObject({ totalMinor: 4725, taxMinor: 225, paidMinor: 4725, status: "paid" });
    const lines = await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice!.id)).orderBy(invoiceLines.position); expect(lines.map(line => line.unitAmountMinor)).toEqual([4000, 500]);
    const [tax] = await db().select().from(invoiceMerchantTaxQuotes).where(eq(invoiceMerchantTaxQuotes.invoiceId, invoice!.id)); expect(tax).toMatchObject({ profileId: source.fixture.profiles[0]!.profileId, taxMinor: 225 }); expect(tax?.occurredAt.toISOString()).toBe(new Date(observed.phase.start_date * 1000).toISOString());
    const [fee] = await db().select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoice!.id)); expect(fee?.feeMinor).toBe(450);
    expect(await db().select().from(subscriptionProviderChargeReceipts)).toHaveLength(1); expect(await db().select().from(payments)).toHaveLength(1);
    expect((await db().select().from(subscriptionProviderInvoiceObservations))[0]?.verified).toBe(true); expect(await db().select().from(subscriptionProviderInvoiceLines)).toHaveLength(1);
    const [parent] = await db().select().from(subscriptions).where(eq(subscriptions.id, source.accepted.subscription.id)); expect(parent?.currentPeriodEnd.toISOString()).toBe(new Date(observed.phase.end_date * 1000).toISOString());
    expect((await ingress("evt_future_valid")).status).toBe(200); expect(await db().select().from(payments)).toHaveLength(1);
  });
  it.each(["price", "precision"] as const)("retains actual cash but applies no invoice/access after contradictory actual %s", async mismatch => {
    await original(); if (!source) throw new Error("Missing original period");
    if (mismatch === "precision") decimal = "1.000000000001";
    else { const first = source.remote.prices().get("price_actualProducer1p0"); if (!first) throw new Error("The real producer did not create its first price"); source.remote.prices().set("price_actualProducer1p0", { ...first, unit_amount: 4500 }); }
    expect((await ingress(`evt_future_bad_${mismatch}`)).status).toBe(503);
    expect(await db().select().from(subscriptionProviderChargeReceipts)).toHaveLength(1);
    expect(await db().select().from(invoices)).toHaveLength(0); expect(await db().select().from(payments)).toHaveLength(0);
    const [receipt] = await db().select().from(subscriptionProviderChargeReceipts), [cash] = await db().select().from(subscriptionProviderChargeObservations);
    if (!receipt || !cash) throw new Error("The actual raw paid ingress must retain its exact receipt and positive observation before canonical failure.");
    expect(await originalReceiptPrincipalReview.call({ receiptId: receipt.id, observationId: cash.id }, { kind: "system" }))
      .toMatchObject({ receiptId: receipt.id, paymentId: null, principalSafe: false, currentPrincipalMinor: null, receiptOnly: true, reviewRequired: true });
    expect(await db().select().from(payments)).toHaveLength(0);
    expect((await db().select().from(subscriptionProviderInvoiceObservations))[0]?.verified).toBe(false);
    const [parent] = await db().select().from(subscriptions).where(eq(subscriptions.id, source.accepted.subscription.id)); expect(parent?.currentPeriodEnd).toEqual(source.accepted.subscription.currentPeriodEnd);
    // Even the guarded raw writer cannot rewrite a retained actual line.
    await expect(db().transaction(async tx => { await tx.execute(sql`select set_config('freeholder.subscription_period_v1','1',true)`); await tx.execute(sql`update subscription_provider_invoice_lines set quantity_decimal='1'`); })).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});
