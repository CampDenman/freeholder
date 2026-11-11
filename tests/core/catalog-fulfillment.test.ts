// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19 split shipments, digital grants, restock and invoice refunds.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact } from "@/core/contacts/service";
import { createLocationService } from "@/core/locations/service";
import { productVariants } from "@/modules/catalog/schema";
import {
  addCartItem,
  applyVariantMatrix,
  availability,
  checkoutCart,
  createFulfillment,
  createPriceList,
  createProduct,
  createShippingMethod,
  createShippingZone,
  decideReturn,
  deliverFulfillment,
  enableInventory,
  failFulfillment,
  getOrCreateCart,
  getOrder,
  getProductVariants,
  listDigitalDeliveries,
  payOrder,
  receiveReturn,
  recordStockMovement,
  refundReturn,
  requestReturn,
  setPriceListEntry,
  shipFulfillment,
} from "@/modules/catalog/service";
import { createPayment, createRefund, getInvoice, settlePayment, settleRefund, startRefund } from "@/modules/invoicing/invoice-service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("catalog fulfillment", { timeout: 40_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function paidPhysical(split = false) {
    const studio = await createLocationService.call(
      { name: "Studio", slug: "ful-studio", city: "Courtenay", country: "CA" },
      OWNER,
    );
    const product = await createProduct.call({ name: "Print", slug: "ful-print", kind: "physical" }, OWNER);
    const updated = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const variant = (await getProductVariants.call({ productId: updated.id }, OWNER)).variants[0]!;
    const list = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "20.00" }, OWNER);
    const item = await enableInventory.call({ variantId: variant.id, locationId: studio.id }, OWNER);
    await recordStockMovement.call({ itemId: item.id, delta: 5, reason: "receipt" }, OWNER);
    const zone = await createShippingZone.call({ name: "World", countries: [], regions: [], postalPatterns: [] }, OWNER);
    await createShippingMethod.call({ zoneId: zone.id, name: "Parcel", kind: "flat", currency: "CAD", amount: "5.00" }, OWNER);
    const contact = await createContact.call({ name: "Hal", email: "hal@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 2, locationId: studio.id }, OWNER);
    const placed = await checkoutCart.call(
      {
        cartId: basket.cart.id,
        contactId: contact.id,
        idempotencyKey: `ful-${crypto.randomUUID()}`,
        acceptedTerms: true,
        shippingAddress: { country: "CA", city: "Courtenay" },
      },
      OWNER,
    );
    const payment = await createPayment.call(
      {
        invoiceId: placed.order.invoiceId!,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: split ? 1_000 : placed.order.totalMinor,
        idempotencyKey: `pay-${placed.order.id}`,
      },
      OWNER,
    );
    await settlePayment.call({ id: payment.id, providerRef: `manual:${placed.order.id}` }, OWNER);
    if (split) {
      const second = await createPayment.call({invoiceId:placed.order.invoiceId!,provider:"manual",method:"cash",amountMinor:placed.order.totalMinor-1_000,idempotencyKey:`pay-rest-${placed.order.id}`},OWNER);
      await settlePayment.call({id:second.id,providerRef:`manual:rest:${placed.order.id}`},OWNER);
    }
    const paid = await payOrder.call({ id: placed.order.id }, OWNER);
    return { studio, variant, contact, paid, item, payment };
  }

  async function receivedReturn(paid: Awaited<ReturnType<typeof paidPhysical>>["paid"]) {
    const requested=await requestReturn.call({orderId:paid.order.id,reason:"Damaged in transit",restock:false,items:[{orderItemId:paid.lines[0]!.id,quantity:2}]},OWNER);
    await decideReturn.call({id:requested.return.id,decision:"approved"},OWNER);
    return receiveReturn.call({id:requested.return.id},OWNER);
  }

  it("does not invent a hosted-provider refund when recording a returned item", async () => {
    const {paid,payment}=await paidPhysical();
    const {payments}=await import("@/modules/invoicing/schema");
    await db().update(payments).set({provider:"stripe",providerRef:"pi_real_return_payment"}).where(eq(payments.id,payment.id));
    const received=await receivedReturn(paid);
    const before=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    await expect(refundReturn.call({id:received.return.id,idempotencyKey:`rma-provider-${received.return.id}`,offlineRefundConfirmed:true},OWNER)).rejects.toMatchObject({code:"conflict"});
    const after=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(after.invoice.refundedMinor).toBe(before.invoice.refundedMinor);
    expect(after.creditNotes).toHaveLength(before.creditNotes.length);
    expect(after.refunds).toHaveLength(before.refunds.length);
  });

  it.each(["created","processing","succeeded"] as const)("refuses an incomplete refund instead of closing the whole return with a %s reservation", async status => {
    const {paid,payment}=await paidPhysical();
    const received=await receivedReturn(paid);
    const previous=await createRefund.call({paymentId:payment.id,amountMinor:3_500,reason:"Previous offline refund",idempotencyKey:`prior-${payment.id}`},OWNER);
    if(status==="processing") await startRefund.call({id:previous.id,providerRef:`manual:prior:${payment.id}`},OWNER);
    if(status==="succeeded") await settleRefund.call({id:previous.id,providerRef:`manual:prior:${payment.id}`},OWNER);
    const before=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    await expect(refundReturn.call({id:received.return.id,idempotencyKey:`rma-short-${received.return.id}`,offlineRefundConfirmed:true},OWNER)).rejects.toMatchObject({code:"conflict"});
    const after=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(after.invoice.refundedMinor).toBe(status==="succeeded" ? 3_500 : 0);
    expect(after.creditNotes).toHaveLength(before.creditNotes.length);
    expect(after.refunds).toHaveLength(before.refunds.length);
  });

  it("records the full attested offline amount across original installments exactly once", async () => {
    const {paid}=await paidPhysical(true);
    const received=await receivedReturn(paid);
    const input={id:received.return.id,idempotencyKey:`rma-split-${received.return.id}`,offlineRefundConfirmed:true};
    expect((await refundReturn.call(input,OWNER)).return.status).toBe("refunded");
    const invoice=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(invoice.invoice.refundedMinor).toBe(4_000);
    expect(invoice.refunds.map(refund=>refund.amountMinor).sort((a,b)=>a-b)).toEqual([1_000,3_000]);
    expect(invoice.refunds.every(refund=>refund.status==="succeeded" && refund.provider==="manual")).toBe(true);
    expect((await refundReturn.call({...input,idempotencyKey:`retry-${received.return.id}`},OWNER)).return.status).toBe("refunded");
    expect((await getInvoice.call({id:paid.order.invoiceId!},OWNER)).refunds).toHaveLength(2);
  });

  it("requires fresh human offline attestation and refuses keys or plugins", async () => {
    const input={id:crypto.randomUUID(),idempotencyKey:"return-actor-boundary",offlineRefundConfirmed:true};
    for(const actor of [
      {kind:"agent" as const,keyName:"Return bot",scopes:["catalog.*"]},
      {...OWNER,keyScopes:["catalog.*"]},
      {kind:"plugin" as const,name:"returns",grants:[{module:"catalog",access:"manage" as const}]},
    ]) await expect(refundReturn.call(input,actor)).rejects.toMatchObject({code:"permission"});
    await expect(refundReturn.call(input,{...OWNER,security:{twoFactorRequired:true,twoFactorEnrolled:true,twoFactorVerified:true,stepUpValid:false}})).rejects.toMatchObject({code:"step_up_required"});
    await expect(refundReturn.call({...input,offlineRefundConfirmed:undefined},OWNER)).rejects.toMatchObject({code:"validation"});
  });

  it("bounds requested quantities across duplicate lines and earlier returns", async () => {
    const {paid}=await paidPhysical();
    const line={orderItemId:paid.lines[0]!.id,quantity:2};
    await expect(requestReturn.call({orderId:paid.order.id,reason:"Duplicate lines",items:[line,line]},OWNER)).rejects.toMatchObject({code:"validation"});
    const attempts=await Promise.allSettled([
      requestReturn.call({orderId:paid.order.id,reason:"First whole return",items:[line]},OWNER),
      requestReturn.call({orderId:paid.order.id,reason:"Concurrent whole return",items:[line]},OWNER),
    ]);
    expect(attempts.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(attempts.filter(result=>result.status==="rejected")).toHaveLength(1);
    await expect(requestReturn.call({orderId:paid.order.id,reason:"Second whole return",items:[line]},OWNER)).rejects.toMatchObject({code:"validation"});
  });

  it("ships a split carton, writes the sale on ship, and grants digital lines on pay", async () => {
    const { studio, variant, paid } = await paidPhysical();
    const [line] = paid.lines;
    const first = await createFulfillment.call(
      { orderId: paid.order.id, locationId: studio.id, items: [{ orderItemId: line!.id, quantity: 1 }] },
      OWNER,
    );
    expect(first.fulfillment.status).toBe("pending");
    expect((await getOrder.call({ id: paid.order.id }, OWNER)).order.status).toBe("fulfilling");
    await shipFulfillment.call({ id: first.fulfillment.id, trackingNumber: "1Z999", carrier: "manual" }, OWNER);
    const mid = await availability.call({ variantId: variant.id, locationId: studio.id, quantity: 1 }, OWNER);
    expect(mid).toMatchObject({ tracked: true, onHand: 4, reserved: 1, available: true });

    const second = await createFulfillment.call(
      { orderId: paid.order.id, locationId: studio.id, items: [{ orderItemId: line!.id, quantity: 1 }] },
      OWNER,
    );
    await shipFulfillment.call({ id: second.fulfillment.id, trackingNumber: "1Z998" }, OWNER);
    const done = await getOrder.call({ id: paid.order.id }, OWNER);
    expect(done.order.status).toBe("fulfilled");
    const shelf = await availability.call({ variantId: variant.id, locationId: studio.id, quantity: 1 }, OWNER);
    expect(shelf).toMatchObject({ tracked: true, onHand: 3, reserved: 0 });

    const digital = await createProduct.call({ name: "Guide", slug: "ful-guide", kind: "digital" }, OWNER);
    const dUpdated = await applyVariantMatrix.call({ productId: digital.id, expectedVersion: digital.version }, OWNER);
    const dVariant = (await getProductVariants.call({ productId: dUpdated.id }, OWNER)).variants[0]!;
    await db().update(productVariants).set({ requiresShipping: false }).where(eq(productVariants.id, dVariant.id));
    const dList = await createPriceList.call({ name: "CAD digital", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: dList.id, variantId: dVariant.id, amount: "10.00" }, OWNER);
    const buyer = await createContact.call({ name: "Ivy", email: "ivy@example.test" }, OWNER);
    const cart = await getOrCreateCart.call({ contactId: buyer.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: cart.cart.id, variantId: dVariant.id, quantity: 1 }, OWNER);
    const dOrder = await checkoutCart.call(
      { cartId: cart.cart.id, contactId: buyer.id, idempotencyKey: `dig-${buyer.id}`, acceptedTerms: true },
      OWNER,
    );
    const dPay = await createPayment.call(
      {
        invoiceId: dOrder.order.invoiceId!,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: dOrder.order.totalMinor,
        idempotencyKey: `pay-dig-${dOrder.order.id}`,
      },
      OWNER,
    );
    await settlePayment.call({ id: dPay.id, providerRef: `manual:dig:${dOrder.order.id}` }, OWNER);
    const granted = await payOrder.call({ id: dOrder.order.id }, OWNER);
    expect(granted.order.status).toBe("fulfilled");
    expect(await listDigitalDeliveries.call({ orderId: granted.order.id }, OWNER)).toHaveLength(1);
  });

  it("restocks and refunds a received RMA through the original invoice", async () => {
    const { studio, variant, paid } = await paidPhysical();
    const [line] = paid.lines;
    const ship = await createFulfillment.call(
      { orderId: paid.order.id, locationId: studio.id, items: [{ orderItemId: line!.id, quantity: 2 }] },
      OWNER,
    );
    await shipFulfillment.call({ id: ship.fulfillment.id, trackingNumber: "RET1" }, OWNER);
    await deliverFulfillment.call({ id: ship.fulfillment.id }, OWNER);

    const requested = await requestReturn.call(
      {
        orderId: paid.order.id,
        reason: "Damaged in transit",
        items: [{ orderItemId: line!.id, quantity: 2 }],
      },
      OWNER,
    );
    await decideReturn.call({ id: requested.return.id, decision: "approved" }, OWNER);
    await receiveReturn.call({ id: requested.return.id, locationId: studio.id }, OWNER);
    const restocked = await availability.call({ variantId: variant.id, locationId: studio.id, quantity: 1 }, OWNER);
    expect(restocked).toMatchObject({ tracked: true, onHand: 5, reserved: 0 });

    const refunded = await refundReturn.call(
      { id: requested.return.id, idempotencyKey: `rma-${requested.return.id}`, offlineRefundConfirmed: true },
      OWNER,
    );
    expect(refunded.return.status).toBe("refunded");
    expect(refunded.return.creditNoteId).toBeTruthy();
    const invoice = await getInvoice.call({ id: paid.order.invoiceId! }, OWNER);
    expect(invoice.invoice.refundedMinor).toBeGreaterThan(0);
    expect((await getOrder.call({ id: paid.order.id }, OWNER)).order.status).toBe("fulfilled");
  });

  it("refuses to put a digital line on a carton and frees quantity when a shipment fails", async () => {
    const { paid } = await paidPhysical();
    expect(
      (await failure(
        createFulfillment.call({ orderId: paid.order.id, items: [] }, OWNER),
      )).code,
    ).toBe("validation");
    const [line] = paid.lines;
    const ship = await createFulfillment.call(
      { orderId: paid.order.id, items: [{ orderItemId: line!.id, quantity: 2 }] },
      OWNER,
    );
    await failFulfillment.call({ id: ship.fulfillment.id, note: "Address refused" }, OWNER);
    const again = await createFulfillment.call(
      { orderId: paid.order.id, items: [{ orderItemId: line!.id, quantity: 2 }] },
      OWNER,
    );
    expect(again.fulfillment.status).toBe("pending");
  });
});
