// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: no positive economic item can be born before actual draft-pause readback.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { applyDestinationCharge, assertMerchantIntent, validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { PaymentAccountScope } from "./types";
import type { MerchantControlledBootstrapRequest, MerchantControlledSubscriptionReadRequest, MerchantControlledSubscriptionPauseRequest,
  MerchantControlledSubscriptionAcknowledgment, MerchantControlledBootstrapInventory, MerchantControlledSubscriptionScope } from "./merchant-controlled-subscription-types";
type Api = (path: string, init: RequestInit, scope: PaymentAccountScope) => Promise<Record<string, unknown>>;
const ref = (value: unknown) => text(value) ?? text(object(value)?.id);
const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
function unproven(): never { throw new AdapterError("payments", "stripe", "provider_failure", "Restore the actual original zero-only preparation, accepted calendar and independent draft-pause readback before admitting positive phases.", true); }
function epoch(value: unknown): string {
  const parsed = number(value);
  if (parsed === undefined || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > 8640000000000) unproven();
  return new Date(parsed*1000).toISOString();
}
function validate(request: MerchantControlledSubscriptionScope) {
  validateMerchantChargeScope(request);
  if (request.providerApiVersion !== "2026-10-28.endive" || !request.providerPlatformAccountId || !uuid(request.subscriptionId) || !uuid(request.termsId)
    || !Number.isSafeInteger(request.generation) || request.generation<1 || !/^cus_[A-Za-z0-9_]{1,195}$/.test(request.providerCustomerRef)
    || !/^pm_[A-Za-z0-9_]{1,195}$/.test(request.providerMethodRef) || !/^prod_[A-Za-z0-9_]{1,195}$/.test(request.providerProductRef)
    || !/^[A-Z]{3}$/.test(request.currency) || !["day","week","month","year"].includes(request.interval) || !Number.isSafeInteger(request.intervalCount) || request.intervalCount<1
    || !Number.isFinite(Date.parse(request.acceptedPeriodEnd)) || request.acceptedTrialEnd !== null && !Number.isFinite(Date.parse(request.acceptedTrialEnd))) unproven();
}
function metadata(request: MerchantControlledSubscriptionScope, operationId: string, requestDigest: string) {
  if (!uuid(operationId) || !hash(requestDigest)) unproven();
  return { freeholder_controlled_subscription_version:"1", freeholder_controlled_transport:"zero_only_preparation", freeholder_subscription_id:request.subscriptionId,
    freeholder_subscription_terms_id:request.termsId, freeholder_controlled_generation:String(request.generation), freeholder_bootstrap_operation_id:operationId,
    freeholder_bootstrap_request_digest:requestDigest, freeholder_platform_account_id:request.providerPlatformAccountId };
}
function original(request: MerchantControlledSubscriptionReadRequest, value: Record<string,unknown>) {
  const expected=metadata(request,request.bootstrapOperationId,request.bootstrapRequestDigest), actual=object(value.metadata);
  if (ref(value.id)!==request.providerSubscriptionRef || ref(value.customer)!==request.providerCustomerRef
    || Object.entries(expected).some(([key,item])=>actual?.[key]!==item) || value.collection_method!=="charge_automatically"
    || ref(value.default_payment_method)!==request.providerMethodRef || value.currency!==request.currency.toLowerCase()) unproven();
}
function acknowledgment(value:Record<string,unknown>):MerchantControlledSubscriptionAcknowledgment {
  const providerSubscriptionRef=ref(value.id), providerInvoiceRef=ref(value.latest_invoice) ?? null;
  if (!providerSubscriptionRef || !/^sub_[A-Za-z0-9_]{1,195}$/.test(providerSubscriptionRef) || providerInvoiceRef && !/^in_[A-Za-z0-9_]{1,196}$/.test(providerInvoiceRef)) unproven();
  return {providerSubscriptionRef,providerInvoiceRef};
}
function zeroInventory(request:MerchantControlledSubscriptionReadRequest,value:Record<string,unknown>):MerchantControlledBootstrapInventory {
  original(request,value);
  assertMerchantIntent(request,value);
  const items=object(value.items),pause=object(value.pause_collection),paused=pause?.behavior==="keep_as_draft" && pause.resumes_at===null;
  if (!["active","incomplete"].includes(String(value.status)) || items?.has_more!==false || !Array.isArray(items.data) || items.data.length!==1
    || value.trial_end!==null || value.trial_start!==null || value.pending_update!==null || value.schedule!==null || value.cancel_at!==null || value.cancel_at_period_end!==false
    || object(value.automatic_tax)?.enabled!==false || !Array.isArray(value.default_tax_rates) || value.default_tax_rates.length!==0
    || value.discounts!==null && (!Array.isArray(value.discounts)||value.discounts.length!==0) || value.pause_collection!==null && !paused
    || value.pending_invoice_item_interval!==null || value.next_pending_invoice_item_invoice!==null) unproven();
  const components:MerchantControlledBootstrapInventory["components"]=[];
  for(const raw of items.data){const item=object(raw),price=object(item?.price),recurring=object(price?.recurring),kind=ref(price?.product)===request.providerProductRef?"principal":null;
    if(!item||kind!=="principal"||components.some(row=>row.kind===kind)||item.quantity!==1||!text(item.id)?.startsWith("si_")
      ||!price||!text(price.id)?.startsWith("price_")||price.unit_amount!==0||price.unit_amount_decimal!==undefined&&price.unit_amount_decimal!=="0"
      ||price.billing_scheme!=="per_unit"||price.type!=="recurring"||price.transform_quantity!==null||price.tax_behavior!=="exclusive"
      ||price.currency!==request.currency.toLowerCase()||ref(price.product)!==request.providerProductRef
      ||recurring?.interval!==request.interval||recurring.interval_count!==request.intervalCount||recurring.usage_type!=="licensed"
      ||!Array.isArray(item.tax_rates)||item.tax_rates.length!==0||item.discounts!==undefined&&item.discounts!==null&&(!Array.isArray(item.discounts)||item.discounts.length!==0))unproven();
    components.push({kind:"principal",subscriptionItemRef:text(item.id)!,providerPriceRef:text(price.id)!,providerProductRef:ref(price.product)!,amountMinor:0,
      actualPeriodStart:epoch(item.current_period_start),actualPeriodEnd:epoch(item.current_period_end)});
  }
  if(components.length!==1)unproven();
  return { ...acknowledgment(value),providerApiVersion:request.providerApiVersion,providerPlatformAccountId:request.providerPlatformAccountId,chargeAccountId:request.providerAccountId??null,
    status:value.status as "active"|"incomplete",collectionPausedAsDraft:paused,financiallyQuiesced:false,positiveCollectionAdmissible:false,
    components,merchantTaxAuthority:"canonical_merchant_tax_ledger",fixedTaxRequiredBeforeCollection:true,actualAnchor:epoch(value.billing_cycle_anchor),actualPeriodStart:components[0]!.actualPeriodStart,actualPeriodEnd:components[0]!.actualPeriodEnd,
    actualTrialEnd:null,originalAcceptedTrialEnd:request.acceptedTrialEnd,completeZeroRecurringItem:true,firstInvoiceFinancialState:"unverified" };
}
export function stripeControlledSubscriptions(api:Api) {
  return {
    async createMerchantControlledBootstrap(request:MerchantControlledBootstrapRequest):Promise<MerchantControlledSubscriptionAcknowledgment> {
      validate(request);
      if (!request.idempotencyKey || request.idempotencyKey.length>200) unproven();
      const originalMetadata=metadata(request,request.operationId,request.requestDigest);
      // default_incomplete atomically prevents a positive first-invoice attempt,
      // even if unexpected original customer pending items require payment. The
      // recurring collection components stay permanently zero until a separate admitted update.
      // No trial/anchor/backdate field changes accepted application economics.
      const form=new URLSearchParams({ customer:request.providerCustomerRef,default_payment_method:request.providerMethodRef,collection_method:"charge_automatically",
        payment_behavior:"default_incomplete","billing_mode[type]":"flexible","automatic_tax[enabled]":"false","proration_behavior":"none",
        "items[0][price_data][currency]":request.currency.toLowerCase(),"items[0][price_data][product]":request.providerProductRef,"items[0][price_data][unit_amount]":"0",
        "items[0][price_data][tax_behavior]":"exclusive","items[0][price_data][recurring][interval]":request.interval,"items[0][price_data][recurring][interval_count]":String(request.intervalCount),"items[0][quantity]":"1",
        "payment_settings[save_default_payment_method]":"off" });
      applyDestinationCharge(form,false,request);
      for(const[key,value]of Object.entries(originalMetadata))form.set(`metadata[${key}]`,value);
      const actual=await api("/v1/subscriptions",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","idempotency-key":request.idempotencyKey},body:form},request);
      await request.onObserved({kind:"bootstrap_subscription",raw:actual});
      // A real ACK is retained even if later ownership/zero proof needs review.
      return acknowledgment(actual);
    },
    async pauseMerchantControlledBootstrap(request:MerchantControlledSubscriptionPauseRequest):Promise<MerchantControlledSubscriptionAcknowledgment> {
      validate(request);metadata(request,request.bootstrapOperationId,request.bootstrapRequestDigest);
      if (!uuid(request.operationId)||!hash(request.requestDigest)||!/^sub_[A-Za-z0-9_]{1,195}$/.test(request.providerSubscriptionRef)||!request.idempotencyKey||request.idempotencyKey.length>200)unproven();
      const actual=await api(`/v1/subscriptions/${encodeURIComponent(request.providerSubscriptionRef)}`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","idempotency-key":request.idempotencyKey},
        body:new URLSearchParams({"pause_collection[behavior]":"keep_as_draft"})},request);
      await request.onObserved({kind:"pause_subscription",raw:actual});original(request,actual);
      return acknowledgment(actual); // An ACK is deliberately not readback proof.
    },
    async inspectMerchantControlledBootstrap(request:MerchantControlledSubscriptionReadRequest):Promise<MerchantControlledBootstrapInventory> {
      validate(request);metadata(request,request.bootstrapOperationId,request.bootstrapRequestDigest);
      if(!/^sub_[A-Za-z0-9_]{1,195}$/.test(request.providerSubscriptionRef))unproven();
      const actual=await api(`/v1/subscriptions/${encodeURIComponent(request.providerSubscriptionRef)}?expand%5B%5D=items.data.price`,{method:"GET"},request);
      await request.onObserved({kind:"subscription_read",raw:actual});
      return zeroInventory(request,actual);
    },
  };
}
