// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: one invoice's credited line draws three plus seven from actual original fees.
// All business services are real; each payment/refund/fee edge is synthetic.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { InvoiceForCharge, MerchantFeeObservation } from "@/adapters/payments";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { ready } from "@/core/runtime";
import { addCartItem, getCart, removeCartItem } from "@/modules/catalog/cart";
import { requestReturn, decideReturn, receiveReturn } from "@/modules/catalog/fulfillment";
import { submitReturnProviderRefund } from "@/modules/catalog/return-refunds";
import { orderItems, products } from "@/modules/catalog/schema";
import { updateProduct } from "@/modules/catalog/service";
import { getProductVariants } from "@/modules/catalog/variants";
import { getInvoice } from "@/modules/invoicing/invoice-service";
import { merchantFeeRefunds, merchantPaymentRoutes } from "@/modules/invoicing/merchant-collection-schema";
import { reconcileMerchantApplicationFee } from "@/modules/invoicing/merchant-fee-service";
import { merchantTaxZoneConfiguration, saveMyMerchantTaxProfile } from "@/modules/invoicing/merchant-tax-profiles";
import { beginPaymentCheckout, completePaymentCheckout } from "@/modules/invoicing/payment-provider-service";
import { invoiceMerchantAllocationLines } from "@/modules/invoicing/schema";
import { addTaxRate, createTaxCategory, createTaxZone } from "@/modules/invoicing/tax-service";
import { createListing } from "@/modules/members/listings";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { MERCHANT_FIXTURE_DESTINATION, seedMerchantCheckout80 } from "../helpers/merchant-checkout80";

describe.runIf(hasDatabase)("original line commission across actual installments80", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); }); afterAll(closeDb);
  it("returns a ten-cent line commission as three plus seven against original fifty and two-fifty captures", async () => {
    fixture = await seedMerchantCheckout80("direct");
    const cart = await getCart.call({ cartId: fixture.cart.id, token: fixture.cart.token }, ANONYMOUS);
    for (const line of cart.lines) await removeCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token!, variantId: line.variantId, lineId: line.id }, ANONYMOUS);
    const category = await createTaxCategory.call({ code: "fixture_installment_tax", name: "Synthetic installment tax contrast" }, OWNER);
    const zone = await createTaxZone.call({ name: "Synthetic installment jurisdiction", country: "CA", regions: ["BC"], basis: "destination", pricesIncludeTax: false, roundingScope: "line", roundingMode: "half_up" }, OWNER);
    const zero = await addTaxRate.call({ zoneId: zone.id, name: "Synthetic zero base", jurisdiction: "Synthetic zero-rate fixture", ratePpm: 0 }, OWNER);
    const taxed = await addTaxRate.call({ zoneId: zone.id, categoryId: category.id, name: "Synthetic one-hundred-percent contrast", jurisdiction: "Synthetic contrast only, no legal claim", ratePpm: 1000000 }, OWNER);
    const seller = fixture.sellers[0]!, configuration = await merchantTaxZoneConfiguration.call({ zoneId: zone.id }, seller);
    await saveMyMerchantTaxProfile.call({ expectedVersion: fixture.profiles[0]!.profileVersion, idempotencyKey: randomUUID(), acceptPolicy: true,
      liability: "seller", origin: MERCHANT_FIXTURE_DESTINATION, collectionStatus: "registered",
      registrations: [{ zoneId: zone.id, number: "FIXTURE-INSTALLMENT-TAX", rateIds: [zero.id, taxed.id], configurationDigest: configuration.configurationDigest, status: "active" }] }, seller);
    const variants: string[] = [];
    for (const taxable of [false, true]) {
      const listing = await createListing.call({ title: taxable ? "Synthetic taxed original unit" : "Synthetic zero-tax original unit", kind: "digital", price: "1", acceptPolicy: true }, seller);
      if (taxable) {
        const [product] = await db().select().from(products).where(eq(products.id, listing.productId));
        await updateProduct.call({ id: listing.productId, expectedVersion: product!.version, taxCategoryId: category.id }, OWNER);
      }
      const variant = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!; variants.push(variant.id);
      await addCartItem.call({ cartId: fixture.cart.id, cartToken: fixture.cart.token, variantId: variant.id }, ANONYMOUS);
    }
    const placed = await fixture.checkout(), invoiceId = placed.order.invoiceId!;
    const original = await getInvoice.call({ id: invoiceId }, OWNER);
    expect(original.invoice).toMatchObject({ subtotalMinor: 200, taxMinor: 100, totalMinor: 300 });
    const returnedLine = original.lines.find(line => line.sourceId === variants[0])!;
    expect(returnedLine).toMatchObject({ subtotalMinor: 100, taxMinor: 0, totalMinor: 100 });
    const [frozen] = await db().select().from(invoiceMerchantAllocationLines).where(eq(invoiceMerchantAllocationLines.invoiceLineId, returnedLine.id));
    expect(frozen).toMatchObject({ revenueMinor: 100, feeMinor: 10 });

    const requests = new Map<string, InvoiceForCharge>(), byPaymentIntent = new Map<string, InvoiceForCharge>();
    const feeReturned = new Map<string, number>(), refundsCreated: number[] = [], feesCreated: number[] = [];
    fixture.stripe.createCheckout = async request => {
      const ordinal = requests.size, session = `cs_installment${ordinal}`, intent = `pi_installment${ordinal}`;
      requests.set(session, request); byPaymentIntent.set(intent, request);
      return { ...request, providerRef: session, paymentRef: intent, url: `https://checkout.example.test/installment${ordinal}` };
    };
    const cash = (intent: string) => {
      const request = byPaymentIntent.get(intent)!; const ordinal = Number(intent.slice(-1));
      return { ...request, providerRef: intent, status: "succeeded" as const, amountMinor: request.amountMinor, currency: request.currency,
        customerChargeVerified: true, merchantRouteVerified: true, merchantSettlementVerified: true,
        providerChargeRef: `ch_installment${ordinal}`, applicationFeeRef: `fee_installment${ordinal}`,
        observedApplicationFeeMinor: request.applicationFeeMinor, applicationFeeCurrency: request.currency, observedFeeRefundedMinor: feeReturned.get(`fee_installment${ordinal}`) ?? 0 };
    };
    fixture.stripe.captureCheckout = async request => cash(`pi_installment${Number(request.checkoutRef.slice(-1))}`);
    fixture.stripe.inspectMerchantPayment = async request => { const actual = cash(request.providerRef); await request.onPaymentObserved?.(actual); return actual; };
    fixture.stripe.createMerchantRefund = async request => {
      refundsCreated.push(request.amountMinor);
      const actual = { ...request, providerRef: `re_installment${request.paymentProviderRef.slice(-1)}`, paymentProviderRef: request.paymentProviderRef,
        status: "succeeded" as const, providerStatus: "succeeded" as const, bindingVerified: true };
      await request.onRefundResourceAcknowledged?.(actual.providerRef); await request.onRefundObserved?.(actual); return actual;
    };
    fixture.stripe.recoverMerchantRefund = async () => { throw Error("No replacement original customer effect is expected."); };
    const actualFees = new Map<string, MerchantFeeObservation>();
    fixture.stripe.refundMerchantFee = async request => {
      const ordinal = Number(request.applicationFeeRef.slice(-1)), source = byPaymentIntent.get(`pi_installment${ordinal}`)!;
      const returned = feeReturned.get(request.applicationFeeRef) ?? 0;
      if (request.amountMinor + returned > source.applicationFeeMinor!) throw Error("The actual original fee resource has no such refund capacity.");
      feesCreated.push(request.amountMinor); feeReturned.set(request.applicationFeeRef, returned + request.amountMinor);
      const actual = { providerRef: `fr_installment${ordinal}`, applicationFeeRef: request.applicationFeeRef, amountMinor: request.amountMinor, currency: request.currency, bindingVerified: true };
      actualFees.set(request.applicationFeeRef, actual); await request.onFeeRefundObserved?.(actual); return actual;
    };
    fixture.stripe.recoverMerchantFeeRefund = async request => { const actual = actualFees.get(request.applicationFeeRef); if (!actual) return null; await request.onFeeRefundObserved?.(actual); return actual; };
    const captures: string[] = [];
    for (const amountMinor of [50, 250]) {
      const begun = await beginPaymentCheckout.call({ invoiceId, provider: "stripe", amountMinor, successUrl: env().APP_URL, cancelUrl: env().APP_URL, idempotencyKey: randomUUID() }, OWNER);
      expect((await completePaymentCheckout.call({ paymentId: begun.payment.id, idempotencyKey: randomUUID() }, OWNER)).status).toBe("succeeded"); captures.push(begun.payment.id);
    }
    const routes = await Promise.all(captures.map(paymentId => db().select().from(merchantPaymentRoutes).where(eq(merchantPaymentRoutes.paymentId, paymentId))));
    expect(routes.map(rows => rows[0]!.applicationFeeMinor)).toEqual([3, 17]);
    const [ordered] = await db().select().from(orderItems).where(eq(orderItems.variantId, variants[0]!));
    const requested = await requestReturn.call({ orderId: placed.order.id, reason: "Return the original zero-tax unit across its exact original captures", restock: false, items: [{ orderItemId: ordered!.id, quantity: 1 }] }, OWNER);
    await decideReturn.call({ id: requested.return.id, decision: "approved" }, OWNER); await receiveReturn.call({ id: requested.return.id, restock: false }, OWNER);
    await submitReturnProviderRefund.call({ id: requested.return.id, idempotencyKey: randomUUID() }, OWNER);
    expect(refundsCreated).toEqual([50, 50]);
    for (const paymentId of captures) expect((await reconcileMerchantApplicationFee.call({ paymentId }, OWNER)).state).toBe("accepted");
    expect(feesCreated).toEqual([3, 7]);
    const operations = await Promise.all(captures.map(paymentId => db().select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId, paymentId))));
    expect(operations.map(rows => ({ amount: rows[0]!.amountMinor, retained: rows[0]!.targetRetainedFeeMinor, status: rows[0]!.status })))
      .toEqual([{ amount: 3, retained: 0, status: "accepted" }, { amount: 7, retained: 10, status: "accepted" }]);
  });
});
