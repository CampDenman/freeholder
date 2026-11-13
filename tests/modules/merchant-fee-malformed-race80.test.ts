// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: the actual returned line owns its frozen merchandise commission.
// Real shared commerce services; payment/fee resources are synthetic edges.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { InvoiceForCharge } from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { ready } from "@/core/runtime";
import { addCartItem } from "@/modules/catalog/cart";
import { requestReturn, decideReturn, receiveReturn } from "@/modules/catalog/fulfillment";
import { submitReturnProviderRefund } from "@/modules/catalog/return-refunds";
import { orderItems, products } from "@/modules/catalog/schema";
import { updateProduct } from "@/modules/catalog/service";
import { getProductVariants } from "@/modules/catalog/variants";
import { getInvoice } from "@/modules/invoicing/invoice-service";
import { merchantFeeRefunds } from "@/modules/invoicing/merchant-collection-schema";
import { reconcileMerchantApplicationFee } from "@/modules/invoicing/merchant-fee-service";
import { merchantTaxZoneConfiguration, saveMyMerchantTaxProfile } from "@/modules/invoicing/merchant-tax-profiles";
import { beginPaymentCheckout, completePaymentCheckout } from "@/modules/invoicing/payment-provider-service";
import { invoiceMerchantAllocationLines } from "@/modules/invoicing/schema";
import { addTaxRate, createTaxCategory } from "@/modules/invoicing/tax-service";
import { createListing } from "@/modules/members/listings";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { MERCHANT_FIXTURE_DESTINATION, seedMerchantCheckout80 } from "../helpers/merchant-checkout80";

describe.runIf(hasDatabase)("original fee malformed-success race80", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000);
  beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(closeDb);

  it("keeps an accepted fee effect reserved after unreadable success while an earlier inspection completes", async () => {
    fixture = await seedMerchantCheckout80("direct");
    const seller = fixture.sellers[0]!;
    const category = await createTaxCategory.call({ code: "fixture_different_rate", name: "Synthetic different-rate product" }, OWNER);
    const extraRate = await addTaxRate.call({ zoneId: fixture.zone.id, categoryId: category.id,
      name: "Synthetic category levy", jurisdiction: "Synthetic separate category jurisdiction", ratePpm: 150000 }, OWNER);
    const configuration = await merchantTaxZoneConfiguration.call({ zoneId: fixture.zone.id }, seller);
    await saveMyMerchantTaxProfile.call({ expectedVersion: fixture.profiles[0]!.profileVersion, idempotencyKey: randomUUID(),
      acceptPolicy: true, liability: "seller", origin: MERCHANT_FIXTURE_DESTINATION, collectionStatus: "registered",
      registrations: [{ zoneId: fixture.zone.id, number: "FIXTURE-LINE-TAX", rateIds: [fixture.rate.id, extraRate.id],
        configurationDigest: configuration.configurationDigest, status: "active" }] }, seller);
    const listing = await createListing.call({ title: "Synthetic original differently taxed line", kind: "digital", price: "10", acceptPolicy: true }, seller);
    const [product] = await db().select().from(products).where(eq(products.id, listing.productId));
    await updateProduct.call({ id: listing.productId, expectedVersion: product!.version, taxCategoryId: category.id }, OWNER);
    const variant = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!;
    await addCartItem.call({ cartId: fixture.cart.id, cartToken: fixture.cart.token, variantId: variant.id }, ANONYMOUS);
    const placed = await fixture.checkout(), invoiceId = placed.order.invoiceId!;
    const invoice = await getInvoice.call({ id: invoiceId }, OWNER);
    const line = invoice.lines.find(row => row.sourceType === "variant" && row.sourceId === variant.id)!;
    const other = invoice.lines.find(row => row.id !== line.id)!;
    expect(invoice.lines).toHaveLength(2);
    expect(BigInt(line.taxMinor) * BigInt(other.subtotalMinor - other.discountMinor))
      .not.toBe(BigInt(other.taxMinor) * BigInt(line.subtotalMinor - line.discountMinor));
    const [originalLine] = await db().select().from(invoiceMerchantAllocationLines).where(eq(invoiceMerchantAllocationLines.invoiceLineId, line.id));
    expect(originalLine).toMatchObject({ revenueMinor: 1000, feeMinor: 100 });

    let charge!: InvoiceForCharge, feeReturned = 0, customerPosts = 0, feePosts = 0;
    fixture.stripe.createCheckout = async request => { charge = request; return { ...request, providerRef: "cs_lineFee", paymentRef: "pi_lineFee", url: "https://checkout.example.test/lineFee" }; };
    const cash = () => ({ ...charge, providerRef: "pi_lineFee", status: "succeeded" as const, amountMinor: charge.amountMinor, currency: charge.currency,
      customerChargeVerified: true, merchantRouteVerified: true, merchantSettlementVerified: true, providerChargeRef: "ch_lineFee", applicationFeeRef: "fee_lineFee",
      observedApplicationFeeMinor: charge.applicationFeeMinor, applicationFeeCurrency: charge.currency, observedFeeRefundedMinor: feeReturned });
    fixture.stripe.captureCheckout = async () => cash();
    fixture.stripe.inspectMerchantPayment = async request => { const actual = cash(); await request.onPaymentObserved?.(actual); return actual; };
    fixture.stripe.createMerchantRefund = async request => {
      customerPosts++;
      const actual = { ...request, providerRef: "re_lineFee", paymentProviderRef: request.paymentProviderRef, status: "succeeded" as const, providerStatus: "succeeded" as const, bindingVerified: true };
      await request.onRefundResourceAcknowledged?.(actual.providerRef); await request.onRefundObserved?.(actual); return actual;
    };
    fixture.stripe.recoverMerchantRefund = async () => { throw Error("No second original customer refund is expected."); };
    const begun = await beginPaymentCheckout.call({ invoiceId, provider: "stripe", successUrl: env().APP_URL, cancelUrl: env().APP_URL, idempotencyKey: randomUUID() }, OWNER);
    expect((await completePaymentCheckout.call({ paymentId: begun.payment.id, idempotencyKey: randomUUID() }, OWNER)).status).toBe("succeeded");
    expect(charge.applicationFeeMinor).toBe(500);
    const grossRatioCredit = 500 - Number(500n * BigInt(charge.amountMinor - line.totalMinor) / BigInt(charge.amountMinor));
    expect(grossRatioCredit).not.toBe(originalLine!.feeMinor);
    const [ordered] = await db().select().from(orderItems).where(eq(orderItems.variantId, variant.id));
    const requested = await requestReturn.call({ orderId: placed.order.id, reason: "Return the actual differently taxed original line", restock: false,
      items: [{ orderItemId: ordered!.id, quantity: 1 }] }, OWNER);
    await decideReturn.call({ id: requested.return.id, decision: "approved" }, OWNER);
    await receiveReturn.call({ id: requested.return.id, restock: false }, OWNER);
    await submitReturnProviderRefund.call({ id: requested.return.id, idempotencyKey: randomUUID() }, OWNER);
    const returned = await getInvoice.call({ id: invoiceId }, OWNER);
    expect(returned.refunds.filter(row => row.status === "succeeded")).toMatchObject([{ paymentId: begun.payment.id, amountMinor: line.totalMinor }]);
    let releaseFirstPost!: () => void, releaseStaleRead!: () => void;
    let reachedFirstPost!: () => void, capturedStaleRead!: () => void;
    const firstPost = new Promise<void>(resolve => { reachedFirstPost = resolve; });
    const staleRead = new Promise<void>(resolve => { capturedStaleRead = resolve; });
    const allowFirstPost = new Promise<void>(resolve => { releaseFirstPost = resolve; });
    const allowStaleRead = new Promise<void>(resolve => { releaseStaleRead = resolve; });
    const accepted: { id: string; fee: string; amount: number; currency: string; metadata: { freeholder_fee_refund_id: string } }[] = [];
    const physicalKeys: string[] = [];
    let feeReads = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input).pathname, headers = new Headers(init?.headers);
      if (path === "/v1/account") return Response.json({ id: "acct_fixturePlatform" });
      expect(headers.get("stripe-version")).toBe("2026-02-25.clover");
      if (path === "/v1/payment_intents/pi_lineFee") {
        expect(headers.get("stripe-account")).toBe("acct_fixtureSeller0");
        return Response.json({ id: "pi_lineFee", status: "succeeded", amount_received: charge.amountMinor, currency: "cad", application_fee_amount: charge.applicationFeeMinor,
          latest_charge: "ch_lineFee", transfer_data: null, on_behalf_of: null,
          metadata: { freeholder_payment_id: begun.payment.id, freeholder_platform_account_id: "acct_fixturePlatform" } });
      }
      if (path === "/v1/charges/ch_lineFee") return Response.json({ id: "ch_lineFee", payment_intent: "pi_lineFee", paid: true, captured: true,
        status: "succeeded", amount_captured: charge.amountMinor, currency: "cad", application_fee: "fee_lineFee", transfer: null });
      expect(headers.has("stripe-account")).toBe(false);
      if (path === "/v1/application_fees/fee_lineFee") {
        const snapshot = { id: "fee_lineFee", account: "acct_fixtureSeller0", charge: "ch_lineFee", currency: "cad", amount: charge.applicationFeeMinor, amount_refunded: feeReturned };
        feeReads++;
        // A has inspected and prepared its POST; B takes a genuine earlier
        // provider snapshot before A's effect, then its response is delayed.
        if (feeReads === 3) { capturedStaleRead(); await allowStaleRead; }
        return Response.json(snapshot);
      }
      if (path === "/v1/application_fees/fee_lineFee/refunds" && init?.method === "POST") {
        if (!(init.body instanceof URLSearchParams)) throw Error("Expected the actual factory form.");
        const amount = Number(init.body.get("amount")), key = headers.get("idempotency-key")!;
        if (physicalKeys.includes(key)) throw Error("A duplicate key cannot create another resource.");
        if (feeReturned + amount > charge.applicationFeeMinor!) return Response.json({ error: { code: "fee_already_refunded" } }, { status: 400 });
        if (physicalKeys.length === 0) { reachedFirstPost(); await allowFirstPost; }
        physicalKeys.push(key); feePosts++; feeReturned += amount;
        const fact = { id: `fr_feeRace${physicalKeys.length}`, fee: "fee_lineFee", amount, currency: "cad", metadata: { freeholder_fee_refund_id: init.body.get("metadata[freeholder_fee_refund_id]")! } };
        accepted.push(fact);
        // The effect is accepted, but the completed HTTP200 body is unreadable.
        // No invented refusal or impossible second full-capacity effect.
        return physicalKeys.length === 1 ? new Response("{", { status: 200 }) : Response.json(fact);
      }
      if (path === "/v1/application_fees/fee_lineFee/refunds") return Response.json({ data: accepted, has_more: false });
      throw Error(`Unexpected physical request: ${path}`);
    };
    const actual = createStripePayments({ secretKey: "sk_fee_race_fixture", webhookSecrets: ["whsec_fee_race_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher });
    if (!actual.inspectMerchantPayment || !actual.refundMerchantFee || !actual.recoverMerchantFeeRefund) throw Error("The real factory must expose original fee methods.");
    fixture.stripe.inspectMerchantPayment = actual.inspectMerchantPayment.bind(actual);
    fixture.stripe.refundMerchantFee = actual.refundMerchantFee.bind(actual);
    fixture.stripe.recoverMerchantFeeRefund = actual.recoverMerchantFeeRefund.bind(actual);
    const pending: Promise<unknown>[] = [];
    try {
      const first = reconcileMerchantApplicationFee.call({ paymentId: begun.payment.id }, OWNER).then(value => ({ value }), (error: unknown) => ({ error })); pending.push(first);
      await Promise.race([firstPost, first.then(() => { throw Error("First fee call ended before reaching the physical POST barrier."); })]);
      const second = reconcileMerchantApplicationFee.call({ paymentId: begun.payment.id }, OWNER).then(value => ({ value }), (error: unknown) => ({ error })); pending.push(second);
      await Promise.race([staleRead, second.then(() => { throw Error("Second fee call ended before taking the earlier provider snapshot."); })]);
      releaseFirstPost(); await first;
      releaseStaleRead(); await second;
    } finally {
      releaseFirstPost(); releaseStaleRead(); await Promise.allSettled(pending);
    }
    expect(customerPosts).toBe(1);
    expect(accepted.map(row => row.amount)).toEqual([originalLine!.feeMinor]);
    expect(feePosts).toBe(1);
    expect(feeReturned).toBe(originalLine!.feeMinor);
    const operations = await db().select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId, begun.payment.id));
    expect(operations).toMatchObject([{ status: "accepted", amountMinor: originalLine!.feeMinor }]);
  });
});
