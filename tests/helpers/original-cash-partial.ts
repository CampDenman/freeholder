// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: prepared actual-service fixture, synthetic provider edges only.
import {createHash,createHmac,randomUUID} from "node:crypto";
import {expect,vi} from "vitest";
import {eq} from "drizzle-orm";
import type {InvoiceForCharge,MerchantRefundObservation} from "@/adapters/payments";
import {createStripePayments} from "@/adapters/payments/stripe";
import {db} from "@/core/db";
import {env} from "@/core/env";
import {beginPaymentCheckout,completePaymentCheckout,retainPaymentProviderEvidence} from "@/modules/invoicing/payment-provider-service";
import {merchantPaymentObservations} from "@/modules/invoicing/merchant-collection-schema";
import {cartItems} from "@/modules/catalog/schema";
import {setCartItemQuantity} from "@/modules/catalog/cart";
import {payOrder,requestReturn,decideReturn,receiveReturn,prepareReturnRefund,submitReturnProviderRefund} from "@/modules/catalog/service";
import {returnOriginalCash} from "@/modules/invoicing/original-cash-recovery";
import {ORIGINAL_CASH_RETURN_CONFIRMATION} from "@/modules/invoicing/original-cash-recovery-proof";
import {reconcileOriginalPartialCashReturn} from "@/modules/invoicing/original-cash-partial";
import {ORIGINAL_PARTIAL_CASH_CONFIRMATION} from "@/modules/invoicing/original-cash-partial-contract";
import {seedMerchantCheckout80} from "./merchant-checkout80";
import {ANONYMOUS,OWNER} from "./spine";
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
export async function partialCashFixture(options: { unapplied?: boolean; unreadableFee?: boolean; pauseRecipient?: boolean; unreadableSecondRecipient?: boolean } = {}) {
  const base = await seedMerchantCheckout80("destination");
  try {
  const [cartLine]=await db().select().from(cartItems).where(eq(cartItems.cartId,base.cart.id));
  if(!cartLine)throw Error("The actual original cart line is missing.");
  await setCartItemQuantity.call({cartId:base.cart.id,cartToken:base.cart.token,variantId:cartLine.variantId,lineId:cartLine.id,quantity:3},ANONYMOUS);
  const placed = await base.checkout(), originals = new Map<string, InvoiceForCharge>();
  const nonce = randomUUID().replaceAll("-", ""), intent = `pi_Cash${nonce}`, charge = `ch_Cash${nonce}`, fee = `fee_Cash${nonce}`, transfer = `tr_Cash${nonce}`;
  let money = 0, commission = 0, amount = 0, currency = "CAD", feeReturned = 0, transferReturned = 0, customerReturned = 0;
  const posts: string[] = [], feeResources: Array<Record<string, unknown>> = [], transferResources: Array<Record<string, unknown>> = [], customerResources: MerchantRefundObservation[] = [];
  const requestIds=new Map<string,string>();
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
    posts.push("customer"); const providerRef = `re_Cash${nonce}_${customerResources.length+1}`; await request.onRefundResourceAcknowledged(providerRef);
    const evidence: MerchantRefundObservation = { providerRef, paymentProviderRef: intent, providerChargeRef: charge, providerPlatformAccountId: "acct_fixturePlatform",
      providerApiVersion: "2026-02-25.clover", amountMinor: request.amountMinor, currency, status: "succeeded", providerStatus: "succeeded", bindingVerified: true };
    requestIds.set(providerRef,request.refundAttemptId); customerResources.push(evidence); customerReturned += evidence.amountMinor; await request.onRefundObserved(evidence); return evidence;
  };
  base.stripe.recoverMerchantRefund = async request => {
    const resource = customerResources.find(row => request.originalRefundRef ? row.providerRef === request.originalRefundRef : requestIds.get(row.providerRef)===request.refundAttemptId);
    if (!resource) return { state: "unresolved" }; await request.onRefundObserved(resource); return { state: "observed", evidence: resource };
  };
  const paid=options.unapplied?null:await payOrder.call({id:placed.order.id},OWNER);
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
      const resource = { id: `${isFee ? "fr" : "trr"}_Cash${nonce}_${list.length+1}`, [isFee ? "fee" : "transfer"]: isFee ? fee : transfer, amount: returned, currency: currency.toLowerCase(), metadata: { freeholder_cash_auxiliary_id: form.get("metadata[freeholder_cash_auxiliary_id]") } };
      list.push(resource); if (isFee) feeReturned += returned; else { transferReturned += returned; entered.resolve(); if (options.pauseRecipient) await release.promise; }
      if(!isFee&&options.unreadableSecondRecipient&&transferResources.length===2&&posts.filter(kind=>kind==="recipient").length===2)return new Response("{",{headers:{"content-type":"application/json"}});
      if (isFee && unreadable) { unreadable = false; return new Response("{", { headers: { "content-type": "application/json" } }); }
      return Response.json(resource);
    }
    if (url.pathname.endsWith("refunds") || url.pathname.endsWith("reversals")) return Response.json({ data: list, has_more: false });
    const resource = list.find(row => url.pathname.endsWith(String(row.id))); if (resource) return Response.json(resource);
    throw Error(`Unexpected original cash transport ${init.method} ${url.pathname}`);
  });
  const secret="whsec_cash_partial_fixture_only",actual = createStripePayments({ secretKey: "sk_cash_fixture_only", webhookSecrets:[secret],fetch: fetcher });
  base.stripe.inspectMerchantReturnedCash = request => actual.inspectMerchantReturnedCash!(request); base.stripe.createMerchantCashAuxiliary = request => actual.createMerchantCashAuxiliary!(request); base.stripe.recoverMerchantCashAuxiliary = request => actual.recoverMerchantCashAuxiliary!(request);
  async function returnOne() {
    if(!paid)throw Error("Unapplied cash has no actual paid order to return.");
    const returned=await requestReturn.call({orderId:paid.order.id,reason:"Return one actual original unit",restock:false,items:[{orderItemId:paid.lines[0]!.id,quantity:1}]},OWNER);
    await decideReturn.call({id:returned.return.id,decision:"approved"},OWNER);await receiveReturn.call({id:returned.return.id},OWNER);
    await prepareReturnRefund.call({id:returned.return.id,idempotencyKey:randomUUID()},OWNER);
    return submitReturnProviderRefund.call({id:returned.return.id,idempotencyKey:randomUUID()},OWNER);
  }
  function dashboardRefund(amountMinor:number) {
    const resource:MerchantRefundObservation={providerRef:`re_Dashboard${nonce}_${customerResources.length+1}`,paymentProviderRef:intent,providerChargeRef:charge,providerPlatformAccountId:"acct_fixturePlatform",providerApiVersion:"2026-02-25.clover",amountMinor,currency,status:"succeeded",providerStatus:"succeeded",bindingVerified:false};
    customerResources.push(resource);customerReturned+=amountMinor;return resource;
  }
  async function signedDashboard(resource:MerchantRefundObservation) {
    const timestamp=Math.floor(Date.now()/1000),receivedAt=new Date(timestamp*1000).toISOString();
    const body=Buffer.from(JSON.stringify({id:`evt_Cash${randomUUID()}`,type:"refund.updated",api_version:"2026-02-25.clover",created:timestamp,data:{object:{id:resource.providerRef,payment_intent:intent,charge,amount:resource.amountMinor,currency:currency.toLowerCase(),status:resource.providerStatus}}}));
    const signature=createHmac("sha256",secret).update(`${timestamp}.`).update(body).digest("hex");
    const events=await actual.verifyWebhook({body,headers:{"stripe-signature":`t=${timestamp},v1=${signature}`},receivedAt});
    await retainPaymentProviderEvidence("stripe",events,{rawBodySha256:createHash("sha256").update(body).digest("hex"),receivedAt});
  }
  return { base,source,posts,entered,release,amount,paymentId:begun.payment.id,invoiceId:placed.order.invoiceId!,returnOne,dashboardRefund,signedDashboard,
    run:()=>returnOriginalCash.call({source,confirmation:ORIGINAL_CASH_RETURN_CONFIRMATION},OWNER),
    partial:()=>reconcileOriginalPartialCashReturn.call({paymentId:begun.payment.id,confirmation:ORIGINAL_PARTIAL_CASH_CONFIRMATION},OWNER) };

  } catch (error) { base.cleanup(); throw error; }
}
