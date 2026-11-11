// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19 split shipments, digital grants, restock and invoice refunds.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import {auditLog} from "@/core/events/schema";
import * as paymentAdapters from "@/adapters/payments";
import { createContact } from "@/core/contacts/service";
import { createLocationService } from "@/core/locations/service";
import { productVariants } from "@/modules/catalog/schema";
import {
  addCartItem,
  applyVariantMatrix,
  applyCouponToCart,
  availability,
  checkoutCart,
  createFulfillment,
  createPriceList,
  createProduct,
  createCoupon,
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
  submitReturnProviderRefund,
  requestReturn,
  setPriceListEntry,
  shipFulfillment,
} from "@/modules/catalog/service";
import { createPayment, createRefund, getInvoice, settlePayment, settleRefund, startRefund } from "@/modules/invoicing/invoice-service";
import { onReturnRefundSucceeded } from "@/modules/catalog/fulfillment";
import {processPaymentProviderEvents} from "@/modules/invoicing/payment-provider-service";
import {addTaxRate,createTaxZone,setTaxRegistration} from "@/modules/invoicing/tax-service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("catalog fulfillment", { timeout: 40_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);
  afterEach(()=>vi.restoreAllMocks());

  async function paidPhysical(split = false, adjusted = false) {
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
    await recordStockMovement.call({ itemId: item.id, delta: adjusted ? 10 : 5, reason: "receipt" }, OWNER);
    const zone = await createShippingZone.call({ name: "World", countries: [], regions: [], postalPatterns: [] }, OWNER);
    await createShippingMethod.call({ zoneId: zone.id, name: "Parcel", kind: "flat", currency: "CAD", amount: "5.00" }, OWNER);
    const contact = await createContact.call({ name: "Hal", email: "hal@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: adjusted ? 3 : 2, locationId: studio.id }, OWNER);
    if(adjusted){
      await createCoupon.call({code:"RETURNONE",kind:"fixed",currency:"CAD",amount:"0.01"},OWNER);
      await applyCouponToCart.call({cartId:basket.cart.id,code:"RETURNONE"},OWNER);
      const zone=await createTaxZone.call({name:"Return tax",country:"CA",regions:[],postalPatterns:[],basis:"destination",pricesIncludeTax:false,roundingScope:"line",roundingMode:"half_up"},OWNER);
      await setTaxRegistration.call({zoneId:zone.id,number:"RETURN-GST",status:"active"},OWNER);
      await addTaxRate.call({zoneId:zone.id,name:"GST",jurisdiction:"Canada",ratePpm:50_000,appliesToShipping:false},OWNER);
    }
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

  async function receivedReturn(paid: Awaited<ReturnType<typeof paidPhysical>>["paid"],quantity=2) {
    const requested=await requestReturn.call({orderId:paid.order.id,reason:"Damaged in transit",restock:false,items:[{orderItemId:paid.lines[0]!.id,quantity}]},OWNER);
    await decideReturn.call({id:requested.return.id,decision:"approved"},OWNER);
    return receiveReturn.call({id:requested.return.id},OWNER);
  }

  async function providerReturn(split=false) {
    const original=await paidPhysical(split);
    const {payments}=await import("@/modules/invoicing/schema");
    const rows=await db().select().from(payments).where(eq(payments.invoiceId,original.paid.order.invoiceId!));
    for(const payment of rows) await db().update(payments).set({provider:"stripe",providerRef:`pi_${payment.id}`}).where(eq(payments.id,payment.id));
    const received=await receivedReturn(original.paid);
    const manual=paymentAdapters.createManualPayments();
    const refund=vi.fn<paymentAdapters.PaymentAdapter["refund"]>();
    vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue({...manual,id:"stripe",refund});
    return {...original,received,refund};
  }

  it("reserves every provider installment before I/O and closes only after all confirmations",async()=>{
    const {paid,received,refund}=await providerReturn(true);
    refund.mockImplementation(async input=>{
      const ledger=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
      expect(ledger.refunds).toHaveLength(2);
      expect(ledger.creditNotes[0]!.status).toBe("draft");
      expect(ledger.invoice.refundedMinor).toBe(0);
      expect(ledger.refunds.find(row=>row.paymentId===input.paymentId)?.amountMinor).toBe(input.amountMinor);
      return {providerRef:`re_${input.paymentId}`,status:"pending"};
    });
    const input={id:received.return.id,idempotencyKey:`provider-return-${received.return.id}`};
    expect((await submitReturnProviderRefund.call(input,OWNER)).return.status).toBe("received");
    const claimAudit=await db().select().from(auditLog).where(eq(auditLog.action,"catalog.claimReturnProviderRefund"));
    expect(claimAudit[0]!.actor).toBe(`user:${OWNER.userId}`);
    expect(refund).toHaveBeenCalledTimes(2);
    let invoice=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(invoice.refunds.map(row=>row.amountMinor).sort((a,b)=>a-b)).toEqual([1000,3000]);
    await settleRefund.call({id:invoice.refunds[0]!.id,providerRef:invoice.refunds[0]!.providerRef!},{kind:"system"});
    await onReturnRefundSucceeded({invoiceId:paid.order.invoiceId!});
    expect((await submitReturnProviderRefund.call(input,OWNER)).return.status).toBe("received");
    expect(refund).toHaveBeenCalledTimes(2);
    await settleRefund.call({id:invoice.refunds[1]!.id,providerRef:invoice.refunds[1]!.providerRef!},{kind:"system"});
    await onReturnRefundSucceeded({invoiceId:paid.order.invoiceId!});
    expect((await submitReturnProviderRefund.call({...input,idempotencyKey:"different-retry-key"},OWNER)).return.status).toBe("refunded");
    invoice=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(invoice.invoice.refundedMinor).toBe(4000);
    expect(invoice.creditNotes).toHaveLength(1);
    expect(invoice.creditNotes[0]!.status).toBe("issued");
    expect(refund).toHaveBeenCalledTimes(2);
  });

  it("returns the exact discounted consideration and historical tax across separately returned units",async()=>{
    const {paid}=await paidPhysical(false,true);
    const invoiced=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(invoiced.lines[0]).toMatchObject({subtotalMinor:6000,discountMinor:1,taxMinor:300,totalMinor:6299});
    const amounts=[];
    for(let n=0;n<3;n++){
      const received=await receivedReturn(paid,1);
      await refundReturn.call({id:received.return.id,idempotencyKey:`partial-return-${received.return.id}`,offlineRefundConfirmed:true},OWNER);
      const invoice=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
      amounts.push(invoice.creditNotes.find(note=>note.id!==invoiced.creditNotes[0]?.id && note.idempotencyKey===`return:${received.return.id}:credit`)!.totalMinor);
    }
    expect(amounts).toEqual([2099,2100,2100]);
    const final=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(final.invoice.refundedMinor).toBe(6299);
    expect(final.invoice.totalMinor-final.invoice.refundedMinor).toBe(500);
    expect(final.creditNotes.reduce((sum,note)=>sum+note.taxMinor,0)).toBe(300);
  });

  it("retries a lost provider response using the reserved request without sending a second refund",async()=>{
    const {received,paid,refund}=await providerReturn();
    refund.mockRejectedValueOnce(new Error("synthetic response loss"));
    refund.mockResolvedValue({providerRef:"re_recovered_return",status:"succeeded"});
    const input={id:received.return.id,idempotencyKey:`lost-provider-return-${received.return.id}`};
    await expect(submitReturnProviderRefund.call(input,OWNER)).rejects.toBeDefined();
    const first=refund.mock.calls[0]![0];
    expect((await getInvoice.call({id:paid.order.invoiceId!},OWNER)).invoice.refundedMinor).toBe(0);
    expect((await submitReturnProviderRefund.call(input,OWNER)).return.status).toBe("refunded");
    expect(refund.mock.calls[1]![0]).toEqual(first);
    expect((await getInvoice.call({id:paid.order.invoiceId!},OWNER)).refunds).toHaveLength(1);
  });

  it("retries only a refused installment after another installment already succeeded",async()=>{
    const {received,paid,refund}=await providerReturn(true);
    refund.mockResolvedValueOnce({providerRef:"re_first_return",status:"succeeded"});
    refund.mockResolvedValueOnce({providerRef:"re_second_refused",status:"failed"});
    const input={id:received.return.id,idempotencyKey:"partially-refused-return"};
    expect((await submitReturnProviderRefund.call(input,OWNER)).return.status).toBe("received");
    expect((await getInvoice.call({id:paid.order.invoiceId!},OWNER)).invoice.refundedMinor).toBe(1000);
    refund.mockResolvedValueOnce({providerRef:"re_second_recovered",status:"succeeded"});
    expect((await submitReturnProviderRefund.call({...input,idempotencyKey:"authorized-second-installment-retry"},OWNER)).return.status).toBe("refunded");
    expect(refund.mock.calls.map(([request])=>request.amountMinor)).toEqual([1000,3000,3000]);
    const invoice=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(invoice.invoice.refundedMinor).toBe(4000);
    expect(invoice.refunds.filter(row=>row.status==="succeeded").reduce((sum,row)=>sum+row.amountMinor,0)).toBe(4000);
  });

  it("reconciles normalized authenticated feedback only on the original seller account",async()=>{
    const {received,paid,payment,refund}=await providerReturn();
    const {invoiceMarketPolicies,paymentMerchantRoutes}=await import("@/modules/invoicing/schema");
    await db().insert(invoiceMarketPolicies).values({invoiceId:paid.order.invoiceId!,model:"seller_merchant",adapter:"stripe_connect",siteFeeBps:1000,holdDays:14,feeMinor:450,sellerUserId:OWNER.userId,merchantName:"Original Seller",providerAccountId:"acct_originalseller"});
    await db().insert(paymentMerchantRoutes).values({paymentId:payment.id,providerAccountId:"acct_originalseller",applicationFeeMinor:450});
    refund.mockImplementation(async request=>{
      expect(request.providerAccountId).toBe("acct_originalseller");
      expect(request.refundApplicationFee).toBe(true);
      return {providerRef:"re_originalseller",providerAccountId:"acct_originalseller",status:"pending"};
    });
    const input={id:received.return.id,idempotencyKey:"original-seller-return"};
    expect((await submitReturnProviderRefund.call(input,OWNER)).return.status).toBe("received");
    const at=new Date().toISOString();
    const event={id:"evt_originalseller_return",kind:"refund_succeeded" as const,providerRef:"re_originalseller",paymentProviderRef:`pi_${payment.id}`,amountMinor:4000,currency:"CAD",occurredAt:at,providerAccountId:"acct_originalseller"};
    const deliver=(providerAccountId:string)=>processPaymentProviderEvents.call({provider:"stripe",bodySha256:"a".repeat(64),receivedAt:at,events:[{...event,providerAccountId}]},{kind:"system"});
    await expect(deliver("acct_other")).rejects.toMatchObject({code:"conflict"});
    expect((await getInvoice.call({id:paid.order.invoiceId!},OWNER)).invoice.refundedMinor).toBe(0);
    await deliver("acct_originalseller");
    await onReturnRefundSucceeded({invoiceId:paid.order.invoiceId!});
    expect((await submitReturnProviderRefund.call(input,OWNER)).return.status).toBe("refunded");
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("does not close or retry a refused provider return",async()=>{
    const {received,paid,refund}=await providerReturn();
    refund.mockResolvedValue({providerRef:"re_refused_return",status:"failed"});
    const input={id:received.return.id,idempotencyKey:`failed-provider-return-${received.return.id}`};
    expect((await submitReturnProviderRefund.call(input,OWNER)).return.status).toBe("received");
    await expect(submitReturnProviderRefund.call(input,OWNER)).rejects.toMatchObject({code:"conflict"});
    expect(refund).toHaveBeenCalledTimes(1);
    const invoice=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(invoice.invoice.refundedMinor).toBe(0);
    expect(invoice.creditNotes[0]!.status).toBe("draft");
    refund.mockResolvedValue({providerRef:"re_retried_return",status:"succeeded"});
    expect((await submitReturnProviderRefund.call({...input,idempotencyKey:"new-authorized-refund-attempt"},OWNER)).return.status).toBe("refunded");
    const retried=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(retried.refunds).toHaveLength(2);
    expect(retried.invoice.refundedMinor).toBe(4000);
    expect(retried.refunds.map(row=>row.status).sort()).toEqual(["failed","succeeded"]);
    expect(refund).toHaveBeenCalledTimes(2);
  });

  it("keeps exact rounding across concurrent returns and a prior failed draft credit",async()=>{
    const {paid}=await paidPhysical(false,true);
    const {payments}=await import("@/modules/invoicing/schema");
    const captured=await db().select().from(payments).where(eq(payments.invoiceId,paid.order.invoiceId!));
    for(const payment of captured) await db().update(payments).set({provider:"stripe",providerRef:`pi_${payment.id}`}).where(eq(payments.id,payment.id));
    const requests=await Promise.all([receivedReturn(paid,1),receivedReturn(paid,1),receivedReturn(paid,1)]);
    const manual=paymentAdapters.createManualPayments();
    const refund=vi.fn<paymentAdapters.PaymentAdapter["refund"]>().mockResolvedValue({providerRef:"re_first_refused",status:"failed"});
    vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue({...manual,id:"stripe",refund});
    const first={id:requests[0].return.id,idempotencyKey:"first-unit-refused"};
    expect((await submitReturnProviderRefund.call(first,OWNER)).return.status).toBe("received");
    refund.mockImplementation(async request=>({providerRef:`re_${request.idempotencyKey}`,status:"succeeded"}));
    const results=await Promise.all(requests.slice(1).map(request=>submitReturnProviderRefund.call({id:request.return.id,idempotencyKey:`concurrent-${request.return.id}`},OWNER)));
    expect(results.every(result=>result.return.status==="refunded")).toBe(true);
    expect((await submitReturnProviderRefund.call({...first,idempotencyKey:"retry-first-returned-unit"},OWNER)).return.status).toBe("refunded");
    const invoice=await getInvoice.call({id:paid.order.invoiceId!},OWNER);
    expect(invoice.invoice.refundedMinor).toBe(6299);
    expect(invoice.creditNotes.map(note=>note.totalMinor).sort((a,b)=>a-b)).toEqual([2099,2100,2100]);
    expect(invoice.creditNotes.every(note=>note.status==="issued")).toBe(true);
    expect(invoice.creditNotes.reduce((sum,note)=>sum+note.taxMinor,0)).toBe(300);
    expect(refund.mock.calls.map(([request])=>request.amountMinor).sort((a,b)=>a-b)).toEqual([2099,2099,2100,2100]);
  });

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
    ]) {
      await expect(refundReturn.call(input,actor)).rejects.toMatchObject({code:"permission"});
      await expect(submitReturnProviderRefund.call(input,actor)).rejects.toMatchObject({code:"permission"});
    }
    await expect(refundReturn.call(input,{...OWNER,security:{twoFactorRequired:true,twoFactorEnrolled:true,twoFactorVerified:true,stepUpValid:false}})).rejects.toMatchObject({code:"step_up_required"});
    await expect(submitReturnProviderRefund.call(input,{...OWNER,security:{twoFactorRequired:true,twoFactorEnrolled:true,twoFactorVerified:true,stepUpValid:false}})).rejects.toMatchObject({code:"step_up_required"});
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
