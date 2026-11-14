// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ordinary pure ownership checks, shared by writers and authenticated readers.
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { assertMerchantIntent } from "@/adapters/payments/stripe-merchant-scope";
import { originalSubscriptionInvoiceMetadata } from "@/adapters/payments/stripe-subscription-cash";
import { controlledCollectionPayload } from "./controlled-provider-adapter-contract";
import type { controlledProviderJournal } from "./controlled-provider-proof";
import type { subscriptionControlledResources,subscriptionControlledOperations } from "./controlled-provider-schema";
import type { subscriptionControlledComponents,subscriptionControlledInvoiceBindings } from "./controlled-provider-collection-schema";
import type { ControlledTargetReview } from "./controlled-provider-collection-contract";
import type { controlledCollectionManifest } from "./controlled-provider-adapter-contract";
type Operation=Pick<typeof subscriptionControlledOperations.$inferSelect,"id"|"resourceId"|"kind"|"requestDigest"|"originalRequest">;
type Component=typeof subscriptionControlledComponents.$inferSelect;
type History=Awaited<ReturnType<typeof controlledProviderJournal>>;
type Source={resource:Pick<typeof subscriptionControlledResources.$inferSelect,"id"|"originalScope">;manifest:z.infer<typeof controlledCollectionManifest>;
 review:{quote:{snapshot:Pick<ControlledTargetReview["quote"]["snapshot"],"periodAmountMinor"|"interval"|"intervalCount">}};
 history:{operations:Operation[];calls:Pick<History["calls"][number],"id"|"operationId">[];facts:Pick<History["facts"][number],"actual"|"callId">[]};
 binding:Pick<typeof subscriptionControlledInvoiceBindings.$inferSelect,"creatorOperationId"|"providerInvoiceRef">|null};
const record=(value:unknown)=>z.record(z.string(),z.unknown()).safeParse(value);
const object=(value:unknown):Record<string,unknown>=>{const result=record(value);return result.success?result.data:{};};
const ref=(value:unknown)=>typeof value==="string"?value:typeof object(value).id==="string"?String(object(value).id):null;
const empty=(value:unknown)=>value===null||Array.isArray(value)&&value.length===0;
function refuse():never{throw new ServiceError("conflict","The genuine original invoice/component creator, observed bank metadata, accepted target, price or period does not match. Preserve the actual fact and caller for recovery; never adopt by amount or current account.");}
function observedInvoice(operation:Operation,invoiceRef:unknown){const payload=object(operation.originalRequest.payload);
 if(operation.kind!=="list_invoices"&&operation.kind!=="create_draft"&&payload.providerInvoiceRef!==invoiceRef)refuse();
}
export function assertControlledInvoiceOrigin(source:Source,originKind:"created_draft"|"update_generated"|"calendar_generated",creator:Operation,observer:Operation,raw:Record<string,unknown>){
 const scope=source.resource.originalScope,bootstrap=source.history.operations.find(row=>row.kind==="bootstrap"),tag=originalSubscriptionInvoiceMetadata(raw),parent=object(object(raw.parent).subscription_details),manifest=source.manifest;
 if(!bootstrap||creator.resourceId!==source.resource.id||observer.resourceId!==source.resource.id||!source.history.calls.some(row=>row.operationId===creator.id)
  ||!/^in_[A-Za-z0-9_]{1,196}$/.test(String(raw.id))||(ref(raw.subscription)??ref(parent.subscription))!==ref(object(creator.originalRequest.payload).providerSubscriptionRef)
  ||ref(raw.customer)!==scope.providerCustomerRef||raw.currency!==scope.currency.toLowerCase()||raw.auto_advance!==false||raw.collection_method!=="charge_automatically"
  ||ref(raw.default_payment_method)!==scope.providerMethodRef||object(raw.automatic_tax).enabled!==false||!empty(raw.discounts)||!empty(raw.default_tax_rates))refuse();
 assertMerchantIntent(scope,raw);observedInvoice(observer,raw.id);
 const original={freeholder_controlled_subscription_version:"1",freeholder_subscription_id:scope.subscriptionId,freeholder_subscription_terms_id:scope.termsId,
  freeholder_controlled_generation:String(scope.generation),freeholder_bootstrap_operation_id:bootstrap.id,freeholder_bootstrap_request_digest:bootstrap.requestDigest,freeholder_platform_account_id:scope.providerPlatformAccountId};
 if(Object.entries(original).some(([key,value])=>tag[key]!==value))refuse();
 if(originKind==="created_draft"){
  const payload=controlledCollectionPayload.parse(creator.originalRequest.payload),own=object(raw.metadata);
  if(creator.kind!=="create_draft"||payload.invoiceOrigin.kind!=="created_draft"||payload.manifest.collectionId!==manifest.collectionId||merchantTaxDigest(payload.manifest)!==merchantTaxDigest(manifest))refuse();
  const expected={freeholder_controlled_collection_protocol:manifest.protocol,freeholder_controlled_collection_id:manifest.collectionId,freeholder_controlled_collection_quote_id:manifest.quoteId,
   freeholder_canonical_invoice_id:manifest.canonicalInvoiceId,freeholder_canonical_target_digest:manifest.canonicalTargetDigest,freeholder_controlled_collection_quote_digest:manifest.acceptedQuoteDigest,
   freeholder_controlled_creator_operation_id:creator.id,freeholder_controlled_creator_request_digest:creator.requestDigest};
  if(Object.entries(expected).some(([key,value])=>own[key]!==value)||observer.kind==="create_draft"&&observer.id!==creator.id)refuse();
 }else{
  const payload=object(creator.originalRequest.payload);
  if(creator.kind!=="update_calendar"||!z.uuid().safeParse(payload.collectionId).success||!z.string().regex(/^[a-f0-9]{64}$/).safeParse(payload.acceptedQuoteDigest).success
   ||originKind==="update_generated"&&(payload.collectionId!==manifest.collectionId||payload.acceptedQuoteDigest!==manifest.acceptedQuoteDigest)
   ||tag.freeholder_controlled_price_epoch_id!==payload.collectionId||tag.freeholder_controlled_update_operation_id!==creator.id||tag.freeholder_controlled_update_request_digest!==creator.requestDigest
   ||tag.freeholder_controlled_accepted_quote_digest!==payload.acceptedQuoteDigest||originKind==="update_generated"&&raw.billing_reason!=="subscription_update"
   ||originKind==="calendar_generated"&&!["subscription_cycle","subscription_create"].includes(String(raw.billing_reason)))refuse();
 }
}
export function assertControlledComponentLine(source:Source,component:Component,creator:Operation,observer:Operation,line:Record<string,unknown>){
 const binding=source.binding;if(!binding||creator.resourceId!==source.resource.id||observer.resourceId!==source.resource.id)refuse();observedInvoice(observer,binding.providerInvoiceRef);
 const parent=object(line.parent),ii=object(parent.invoice_item_details),si=object(parent.subscription_item_details),pricing=object(object(line.pricing).price_details),period=object(line.period),tag=object(line.metadata),manifest=source.manifest;
 const invoiceItemRef=ref(ii.invoice_item)??ref(si.invoice_item),priceRef=ref(pricing.price),actual=manifest.components.find(row=>row.id===component.id);
 if(!actual||!/^il_[A-Za-z0-9_]{1,196}$/.test(String(line.id))||line.amount!==component.amountMinor||line.currency!==component.currency.toLowerCase()||line.quantity!==1
  ||Number(period.start)*1000!==component.periodStart.getTime()||Number(period.end)*1000!==component.periodEnd.getTime()||!empty(line.discount_amounts)||!empty(line.taxes)
  ||line.tax_amounts!==undefined&&!empty(line.tax_amounts)||component.kind!=="locked_canonical_credit"&&ref(pricing.product)!==actual.providerProductRef)refuse();
 if(invoiceItemRef){
  const payload=controlledCollectionPayload.parse(creator.originalRequest.payload),expected={freeholder_controlled_collection_id:manifest.collectionId,freeholder_controlled_component_id:component.id,
   freeholder_controlled_component_digest:component.provenanceDigest,freeholder_canonical_target_digest:manifest.canonicalTargetDigest,freeholder_controlled_item_operation_id:creator.id,freeholder_controlled_item_request_digest:creator.requestDigest};
  if(creator.kind!=="add_invoice_component"||payload.componentId!==component.id||payload.providerInvoiceRef!==binding.providerInvoiceRef||merchantTaxDigest(payload.manifest)!==merchantTaxDigest(manifest)
   ||Object.entries(expected).some(([key,value])=>tag[key]!==value)||!/^ii_[A-Za-z0-9_]{1,196}$/.test(invoiceItemRef))refuse();
  return{originKind:"invoice_item" as const,providerInvoiceItemRef:invoiceItemRef,providerPriceRef:priceRef};
 }
 const observerCall=source.history.calls.find(row=>row.operationId===observer.id),price=source.history.facts.find(row=>row.callId===observerCall?.id&&row.actual.kind==="price_read"&&row.actual.raw.id===priceRef)?.actual.raw;
 const payload=object(creator.originalRequest.payload),target=object(payload.target),recurring=object(price?.recurring);
 if(component.kind!=="net"||object(component.provenance).canonicalComponent==="setup"||creator.id!==binding.creatorOperationId||creator.kind!=="update_calendar"||parent.type!=="subscription_item_details"||si.proration!==false
  ||!price||price.unit_amount!==source.review.quote.snapshot.periodAmountMinor||price.currency!==component.currency.toLowerCase()||ref(price.product)!==actual.providerProductRef
  ||recurring.interval!==source.review.quote.snapshot.interval||recurring.interval_count!==source.review.quote.snapshot.intervalCount
  ||target.principalMinor!==source.review.quote.snapshot.periodAmountMinor||target.interval!==recurring.interval||target.intervalCount!==recurring.interval_count
  ||typeof si.subscription_item!=="string"||!source.history.facts.some(row=>row.actual.kind==="subscription_read"&&Array.isArray(object(row.actual.raw.items).data)
   &&z.array(z.record(z.string(),z.unknown())).parse(object(row.actual.raw.items).data).some(item=>item.id===si.subscription_item&&ref(object(item.price).id)===priceRef)))refuse();
 return{originKind:"subscription_line" as const,providerInvoiceItemRef:null,providerPriceRef:priceRef};
}
