// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: the actual returned line owns its frozen merchandise commission.
// Real shared commerce services; payment/fee resources are synthetic edges.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { InvoiceForCharge, MerchantFeeObservation } from "@/adapters/payments";
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

describe.runIf(hasDatabase)("original returned-line fee budget80", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000);
  beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(closeDb);

  it("refunds the original credited line commission instead of its gross share across differently taxed lines", async () => {
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
    let actualFee: MerchantFeeObservation | undefined;
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
    fixture.stripe.refundMerchantFee = async request => {
      feePosts++; feeReturned = request.amountMinor;
      actualFee = { providerRef: "fr_lineFee", applicationFeeRef: request.applicationFeeRef, amountMinor: request.amountMinor, currency: request.currency, bindingVerified: true };
      await request.onFeeRefundObserved?.(actualFee); return actualFee;
    };
    fixture.stripe.recoverMerchantFeeRefund = async request => { if (!actualFee) return null; await request.onFeeRefundObserved?.(actualFee); return actualFee; };
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
    expect((await reconcileMerchantApplicationFee.call({ paymentId: begun.payment.id }, OWNER)).state).toBe("accepted");
    expect(customerPosts).toBe(1); expect(feePosts).toBe(1);
    const operations = await db().select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId, begun.payment.id));
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ status: "accepted", currency: "CAD", amountMinor: originalLine!.feeMinor });
    expect(actualFee?.amountMinor).toBe(originalLine!.feeMinor);
  });
});
