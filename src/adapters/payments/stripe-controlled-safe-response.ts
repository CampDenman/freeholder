// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08: project actual HTTP ingress before callbacks, cache or FIN.
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { ServiceError } from "@/core/service";
import { merchantIntentEvidence } from "./stripe-merchant-scope";
import type { MerchantChargeScope } from "./types";
import { CONTROLLED_PROJECTION_KEY, CONTROLLED_SAFE_RESPONSE_PROTOCOL, CONTROLLED_SAFE_PRODUCERS, CONTROLLED_SAFE_PRODUCER_BY_KIND } from "./merchant-controlled-safe-response-contract";
import type { ControlledIngressContext, ControlledProjectionMetadata, ControlledSafeUnknown, ControlledSafeUnknownReason, ControlledSafeBinding, ControlledSafeProducer } from "./merchant-controlled-safe-response-contract";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Shape = "invoice" | "intent" | "charge" | "refund" | "dispute" | "customer" | "cash_balance" | "credit_note" | "subscription" | "item" | "line" | "price" | "product" | "invoice_payment" | "application_fee" | "transfer" | "balance_transaction" | "page" | "parent" | "subscription_details" | "invoice_item_details" | "subscription_item_details" | "pricing" | "price_details" | "payment" | "period" | "recurring" | "pause_collection" | "automatic_tax" | "transfer_data" | "billing_mode" | "status_transitions" | "amount_entry";
type Rule = "minor" | "boolean" | "currency" | "reference" | "enum" | "metadata" | "currency_map" | "public_name" | "page_url" | "decimal" | Shape | readonly [Shape];
const fields: Record<Shape, Readonly<Record<string, Rule>>> = {
 invoice: { id:"reference",object:"enum",customer:"customer",subscription:"reference",parent:"parent",metadata:"metadata",status:"enum",currency:"currency",billing_reason:"enum",collection_method:"enum",default_payment_method:"reference",auto_advance:"boolean",total:"minor",subtotal:"minor",amount_due:"minor",amount_paid:"minor",amount_remaining:"minor",starting_balance:"minor",ending_balance:"minor",pre_payment_credit_notes_amount:"minor",post_payment_credit_notes_amount:"minor",application_fee_amount:"minor",transfer_data:"transfer_data",on_behalf_of:"reference",automatic_tax:"automatic_tax",discounts:["amount_entry"],default_tax_rates:["amount_entry"],total_discount_amounts:["amount_entry"],total_taxes:["amount_entry"],total_tax_amounts:["amount_entry"],paid_out_of_band:"boolean",period_start:"minor",period_end:"minor",status_transitions:"status_transitions",payment_intent:"intent",payments:"page",lines:"page" },
 intent: { id:"reference",object:"enum",customer:"customer",payment_method:"reference",invoice:"reference",metadata:"metadata",status:"enum",amount:"minor",amount_received:"minor",amount_capturable:"minor",currency:"currency",latest_charge:"charge",application_fee_amount:"minor",transfer_data:"transfer_data",on_behalf_of:"reference",capture_method:"enum",confirmation_method:"enum",cancellation_reason:"enum",canceled_at:"minor",processing:"amount_entry" },
 charge: { id:"reference",object:"enum",payment_intent:"reference",customer:"customer",invoice:"reference",currency:"currency",amount:"minor",amount_captured:"minor",amount_refunded:"minor",captured:"boolean",paid:"boolean",refunded:"boolean",disputed:"boolean",dispute:"dispute",application_fee:"application_fee",application_fee_amount:"minor",transfer:"transfer",transfer_data:"transfer_data",on_behalf_of:"reference",balance_transaction:"balance_transaction",refunds:"page",metadata:"metadata" },
 refund: { id:"reference",object:"enum",charge:"reference",payment_intent:"reference",currency:"currency",amount:"minor",status:"enum",reason:"enum",fee:"reference",transfer:"reference",balance_transaction:"balance_transaction",metadata:"metadata",created:"minor" },
 dispute: { id:"reference",object:"enum",charge:"reference",payment_intent:"reference",currency:"currency",amount:"minor",status:"enum",reason:"enum",balance_transactions:["balance_transaction"],metadata:"metadata",created:"minor" },
 customer: { id:"reference",object:"enum",deleted:"boolean",currency:"currency",balance:"minor",invoice_credit_balance:"currency_map",cash_balance:"cash_balance",metadata:"metadata" },
 cash_balance: { id:"reference",object:"enum",customer:"reference",available:"currency_map" },
 credit_note: { id:"reference",object:"enum",customer:"reference",invoice:"reference",status:"enum",currency:"currency",amount:"minor",credit_amount:"minor",pre_payment_amount:"minor",post_payment_amount:"minor",refund:"refund",refunds:["refund"],out_of_band_amount:"minor",lines:"page",metadata:"metadata",voided_at:"minor",status_transitions:"status_transitions" },
 subscription: { id:"reference",object:"enum",customer:"customer",currency:"currency",status:"enum",collection_method:"enum",default_payment_method:"reference",metadata:"metadata",billing_cycle_anchor:"minor",billing_mode:"billing_mode",trial_end:"minor",trial_start:"minor",cancel_at_period_end:"boolean",cancel_at:"minor",canceled_at:"minor",ended_at:"minor",pause_collection:"pause_collection",automatic_tax:"automatic_tax",discounts:["amount_entry"],default_tax_rates:["amount_entry"],transfer_data:"transfer_data",on_behalf_of:"reference",application_fee_percent:"minor",pending_setup_intent:"intent",latest_invoice:"invoice",items:"page",pending_update:"amount_entry",schedule:"reference",pending_invoice_item_interval:"amount_entry",next_pending_invoice_item_invoice:"reference" },
 item: { id:"reference",object:"enum",subscription:"reference",quantity:"minor",current_period_start:"minor",current_period_end:"minor",price:"price",tax_rates:["amount_entry"],discounts:["amount_entry"],metadata:"metadata" },
 line: { id:"reference",object:"enum",invoice:"reference",customer:"customer",amount:"minor",currency:"currency",quantity:"minor",period:"period",parent:"parent",pricing:"pricing",price:"price",metadata:"metadata",discount_amounts:["amount_entry"],taxes:["amount_entry"],tax_amounts:["amount_entry"] },
 price: { id:"reference",object:"enum",product:"product",currency:"currency",unit_amount:"minor",unit_amount_decimal:"decimal",billing_scheme:"enum",type:"enum",tax_behavior:"enum",transform_quantity:"amount_entry",recurring:"recurring",active:"boolean",metadata:"metadata" },
 product: { id:"reference",object:"enum",active:"boolean",name:"public_name",metadata:"metadata" },
 invoice_payment: { id:"reference",object:"enum",invoice:"reference",status:"enum",currency:"currency",amount_paid:"minor",amount_requested:"minor",payment:"payment",created:"minor",status_transitions:"status_transitions" },
 application_fee: { id:"reference",object:"enum",amount:"minor",amount_refunded:"minor",currency:"currency",refunded:"boolean",refunds:"page",charge:"reference",originating_transaction:"reference",balance_transaction:"balance_transaction",account:"reference" },
 transfer: { id:"reference",object:"enum",amount:"minor",amount_reversed:"minor",currency:"currency",reversed:"boolean",reversals:"page",destination:"reference",source_transaction:"reference",balance_transaction:"balance_transaction",metadata:"metadata" },
 balance_transaction: { id:"reference",object:"enum",amount:"minor",fee:"minor",net:"minor",currency:"currency",status:"enum",type:"enum",source:"reference",fee_details:["amount_entry"],exchange_rate:"minor" },
 page: { object:"enum",data:["amount_entry"],has_more:"boolean",url:"page_url" },
 parent: { type:"enum",subscription_details:"subscription_details",invoice_item_details:"invoice_item_details",subscription_item_details:"subscription_item_details" },
 subscription_details: { subscription:"reference",metadata:"metadata" },
 invoice_item_details: { invoice_item:"reference",subscription:"reference",proration:"boolean" },
 subscription_item_details: { subscription:"reference",subscription_item:"reference",invoice_item:"reference",proration:"boolean" },
 pricing: { type:"enum",price_details:"price_details" },price_details: { price:"reference",product:"reference" },
 payment: { type:"enum",payment_intent:"reference" },period: { start:"minor",end:"minor" },
 recurring: { interval:"enum",interval_count:"minor",usage_type:"enum" },pause_collection: { behavior:"enum",resumes_at:"minor" },
 automatic_tax: { enabled:"boolean",status:"enum" },transfer_data: { destination:"reference",amount:"minor",amount_percent:"minor" },
 billing_mode: { type:"enum" },status_transitions: { paid_at:"minor",finalized_at:"minor",voided_at:"minor",marked_uncollectible_at:"minor",canceled_at:"minor" },
 amount_entry: { id:"reference",object:"enum",amount:"minor",currency:"currency",tax_rate:"reference",discount:"reference",taxability_reason:"enum",type:"enum",percentage:"minor",inclusive:"boolean",behavior:"enum" },
};
const enums = new Set("invoice payment_intent setup_intent charge refund dispute customer cash_balance credit_note subscription subscription_item line_item invoice_line_item price product invoice_payment application_fee transfer balance_transaction list draft open paid void uncollectible deleted issued succeeded pending failed canceled processing requires_payment_method requires_confirmation requires_action requires_capture incomplete incomplete_expired trialing active past_due unpaid paused charge_automatically send_invoice subscription_create subscription_cycle subscription_update manual automatic automatic_async manual_multiple automatic_preferred card not_requested unchanged flexible classic principal merchant_declared_tax_collection locked_canonical_credit per_unit tiered recurring one_time exclusive inclusive unspecified licensed metered day week month year keep_as_draft mark_uncollectible void subscription_details invoice_item_details subscription_item_details price_details fraudulent duplicate requested_by_customer abandoned expired order_change bank_account_unusable debit_not_authorized insufficient_funds customer_initiated merchant_initiated lost stolen credit product_unsatisfactory general unrecognized subscription_canceled credit_not_processed incorrect_account_details fraudulent disputed warning_needs_response warning_under_review warning_closed needs_response under_review won lost available refund_failure transfer_cancel transfer_refund adjustment tax fee application_fee_refund transfer_reversal invoiceitem".split(" "));
const metadataKeys = new Set([
 "freeholder_bootstrap_operation_id","freeholder_bootstrap_request_digest","freeholder_canonical_invoice_id","freeholder_canonical_target_digest","freeholder_controlled_accepted_quote_digest","freeholder_controlled_collection_id","freeholder_controlled_collection_policy","freeholder_controlled_collection_protocol","freeholder_controlled_collection_quote_digest","freeholder_controlled_collection_quote_id","freeholder_controlled_component","freeholder_controlled_component_digest","freeholder_controlled_component_id","freeholder_controlled_component_kind","freeholder_controlled_creator_operation_id","freeholder_controlled_creator_request_digest","freeholder_controlled_generation","freeholder_controlled_item_operation_id","freeholder_controlled_item_request_digest","freeholder_controlled_price_epoch_id","freeholder_controlled_product_operation_id","freeholder_controlled_product_request_digest","freeholder_controlled_subscription_version","freeholder_controlled_transport","freeholder_controlled_update_operation_id","freeholder_controlled_update_request_digest","freeholder_merchant_profile_id","freeholder_merchant_profile_version","freeholder_merchant_tax_quote_digest","freeholder_platform_account_id","freeholder_subscription_id","freeholder_subscription_terms_id",
]);
const privateFields = new Set("client_secret email name phone address shipping billing_details payment_method_details receipt_email receipt_url description statement_descriptor statement_descriptor_suffix livemode url hosted_invoice_url invoice_pdf customer_email customer_name customer_phone customer_address customer_shipping custom_fields footer number next_action last_payment_error last_setup_error fraud_details outcome seller_message seller_protection failure_message failure_code network_status risk_level risk_score payment_method_options invoice_settings preferred_locales tax_ids tax_exempt test_clock request settings evidence evidence_details cancellation_details default_source sources subscriptions fingerprint card bank_account account_holder_name account_holder_type routing_number last4 brand country postal_code network token wallet mandates mandate acceptance customer_acceptance tos_acceptance ip user_agent person individual company business_profile capabilities requirements future_requirements external_accounts payout_schedule dashboard reason_details balance_settings".split(" "));
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function deny(): never { throw new ServiceError("conflict", "Restore an authentic bounded controlled provider response before retaining it."); }
function fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const completelyFrozen = new WeakSet<object>();
function frozen<T>(value: T): T { if (value && typeof value === "object" && !completelyFrozen.has(value)) { for (const child of Object.values(value)) frozen(child); Object.freeze(value); completelyFrozen.add(value); } return value; }
const reference = (v: unknown): v is string => typeof v === "string" && /^(?:acct|cus|sub|in|upcoming_in|pi|seti|ch|re|dp|cn|cnli|il|inpay|ii|si|price|prod|fee|fr|tr|trr|txn|txr|txcd|di|cb|src|pm|sched)_[A-Za-z0-9_]{1,195}$/.test(v);
interface Ticket { context: Readonly<ControlledIngressContext>; snapshot: Readonly<Record<string, unknown>>; fingerprint: string; metadata: ControlledProjectionMetadata; parents: readonly Ticket[]; }
const tickets = new WeakMap<object, Ticket>();

function rootShape(path: string, method: string): Shape {
 const base=path.split("?",1)[0]??"";
 if (base.endsWith("/lines")) return "page";
 if (base==="/v1/invoices/create_preview") return "invoice";
 const group=base.split("/")[2];
 const table: Readonly<Record<string, Shape>>={subscriptions:"subscription",invoices:"invoice",payment_intents:"intent",customers:"customer",products:"product",prices:"price",invoiceitems:"line",invoice_payments:"invoice_payment",credit_notes:"credit_note",charges:"charge",refunds:"refund",disputes:"dispute"};
 const selected=group?table[group]:undefined;if(!selected)deny();
 return method==="GET"&&base.split("/").length===3?"page":selected;
}
/** Complete actual shape projection. Unknown metadata contains no provider key/value bytes. */
function projection(actual: unknown, context: ControlledIngressContext, shapeOverride?: Shape): Readonly<Record<string, unknown>> {
 if (!record(actual) || !Number.isSafeInteger(context.dispatchOrdinal) || context.dispatchOrdinal<1) deny();
 const unknown: ControlledSafeUnknown[]=[], unknownCount={value:0};let nodes=0;
 const debt=(path:string,reason:ControlledSafeUnknownReason)=>{unknownCount.value++;if(unknown.length<64)unknown.push({path,reason});};
 const walk=(value:unknown,shape:Shape,path:string,pageMember:Shape="amount_entry",pagePath?:string,allowReference=true):Json=>{
  if(++nodes>100000)deny();
  if(value===null)return null;
  if(allowReference&&typeof value==="string"&&reference(value))return value;
  if(!record(value)){debt(path,"unsupported_financial_shape");return null;}
  const out:{[key:string]:Json}={};const rules=fields[shape];let slot=0;
  for(const[key,item]of Object.entries(value)){
   const ownPath=`${path}.f${slot++}`;
   if(key===CONTROLLED_PROJECTION_KEY){debt(ownPath,"reserved_projection_collision");continue;}
   const rule=rules[key];
   if(key==="object"&&rule){const expected:Partial<Record<Shape,readonly string[]>>={invoice:["invoice"],intent:["payment_intent","setup_intent"],charge:["charge"],refund:["refund"],dispute:["dispute"],customer:["customer"],cash_balance:["cash_balance"],credit_note:["credit_note"],subscription:["subscription"],item:["subscription_item"],line:["line_item","invoice_line_item","invoiceitem"],price:["price"],product:["product"],invoice_payment:["invoice_payment"],application_fee:["application_fee"],transfer:["transfer","transfer_reversal"],balance_transaction:["balance_transaction"],page:["list"]};const accepted=expected[shape];if(accepted&&(!accepted.some(name=>name===item))){out[key]=null;debt(ownPath,"unsupported_financial_shape");continue;}}
   if(!rule){if(!privateFields.has(key))debt(ownPath,"unsupported_financial_field");continue;}
   if(item===null){if(rule==="page_url"||rule==="public_name")debt(ownPath,rule==="page_url"?"unknown_page_url":"public_product_context_conflict");else out[key]=null;continue;}
   if(rule==="metadata"){
    if(!record(item)){debt(ownPath,"unsupported_financial_shape");out[key]=null;continue;}
    const tags:{[key:string]:Json}={};let index=0;
    for(const[k,v]of Object.entries(item)){
     const at=`${ownPath}.m${index++}`;
     if(!metadataKeys.has(k))continue;
     if(typeof v==="string"&&(/^[a-f0-9-]{36}$/.test(v)||/^[a-f0-9]{64}$/.test(v)||/^[0-9]{1,16}$/.test(v)||reference(v)||["zero_only_preparation","draft_calendar","canonical_gross_target_locked_credit_no_wallet","principal","merchant_declared_tax_collection","net","locked_canonical_credit","controlled_net_gross.v1","exact_canonical_components.v1"].includes(v)))tags[k]=v;
     else debt(at,"unsupported_financial_shape");
    }out[key]=tags;continue;
   }
   if(rule==="currency_map"){
    if(!record(item)){debt(ownPath,"unsupported_financial_shape");out[key]=null;continue;}
    const map:{[key:string]:Json}={};let index=0;
    for(const[k,v]of Object.entries(item)){const at=`${ownPath}.c${index++}`;if(!/^[a-z]{3}$/.test(k)){debt(at,"unsupported_financial_shape");continue;}if(typeof v==="number"&&Number.isSafeInteger(v))map[k]=v;else{map[k]=null;debt(at,"unsupported_financial_shape");}}
    out[key]=map;continue;
   }
   if(rule==="public_name"){
    const product=context.publicProduct,tag=record(value.metadata)?value.metadata:null;
    if(product&&["createMerchantControlledTaxProduct","inspectMerchantControlledTaxProduct"].includes(context.producer)&&item===product.name&&tag?.freeholder_controlled_component===product.component&&tag.freeholder_controlled_product_operation_id===product.creatorOperationId&&tag.freeholder_controlled_product_request_digest===product.creatorRequestDigest&&tag.freeholder_platform_account_id===product.platformAccountId)out[key]=product.name;
    else debt(ownPath,"public_product_context_conflict");continue;
   }
   if(rule==="page_url"){
    const requestPath=context.requestPath.split("?",1)[0], allowed=new Set(["/v1/subscriptions","/v1/invoices","/v1/invoice_payments","/v1/credit_notes","/v1/refunds","/v1/disputes"]);
    if(typeof item==="string"&&item===(pagePath??requestPath)&&(allowed.has(item)||/^\/v1\/invoices\/in_[A-Za-z0-9_]{1,196}\/lines$/.test(item)))out[key]=item;
    else if(typeof item==="string"&&item===pagePath&&/^\/v1\/charges\/ch_[A-Za-z0-9_]{1,196}\/refunds$/.test(item))out[key]=item;
    else debt(ownPath,"unknown_page_url");continue;
   }
   if(typeof rule!=="string"){
    if(!Array.isArray(item)){out[key]=null;debt(ownPath,"unsupported_financial_shape");continue;}
    const expected=shape==="page"&&key==="data"?pageMember:rule[0];
    out[key]=item.map((child,index)=>walk(child,expected,`${ownPath}.i${index}`,"amount_entry",undefined,shape!=="page"||key!=="data"));continue;
   }
   if(rule==="reference"&&record(item)){if(reference(item.id))out[key]=item.id;else{out[key]=null;debt(ownPath,"unsupported_financial_shape");}continue;}
   if(rule==="minor"||rule==="boolean"||rule==="currency"||rule==="reference"||rule==="enum"||rule==="decimal"){
    const valid=rule==="minor"?typeof item==="number"&&Number.isSafeInteger(item):rule==="boolean"?typeof item==="boolean":rule==="currency"?typeof item==="string"&&/^[a-z]{3}$/.test(item):rule==="reference"?reference(item):rule==="decimal"?typeof item==="string"&&/^-?\d{1,16}(?:\.\d{1,12})?$/.test(item):typeof item==="string"&&enums.has(item);
    if(valid&&(typeof item==="string"||typeof item==="number"||typeof item==="boolean"))out[key]=item;else{out[key]=null;debt(ownPath,"unsupported_financial_shape");}continue;
   }
   const member:Shape=key==="lines"?"line":key==="payments"?"invoice_payment":key==="items"?"item":key==="refunds"?"refund":key==="reversals"?"transfer":"amount_entry";
   const nestedPath=shape==="charge"&&key==="refunds"&&reference(value.id)?`/v1/charges/${value.id}/refunds`:undefined;
   out[key]=walk(item,rule,ownPath,member,nestedPath);
  }
  return out;
 };
 const root=shapeOverride??rootShape(context.requestPath,context.method),base=context.requestPath.split("?",1)[0]??"";
 const pageMember:Shape=base.endsWith("/lines")?"line":base==="/v1/subscriptions"?"subscription":base==="/v1/invoice_payments"?"invoice_payment":base==="/v1/credit_notes"?"credit_note":base==="/v1/refunds"?"refund":base==="/v1/disputes"?"dispute":"invoice";
 const projected=walk(actual,root,"response",pageMember);if(!record(projected))deny();
 if(unknownCount.value>64)unknown.push({path:"response",reason:"unknown_path_capacity_exceeded"});
 const metadata:ControlledProjectionMetadata={protocol:CONTROLLED_SAFE_RESPONSE_PROTOCOL,context:context.producer,unknownFinancialPaths:unknown,unknownFinancialPathCount:unknownCount.value};
 const result={...projected,[CONTROLLED_PROJECTION_KEY]:metadata};
 return frozen(result);
}
export function projectControlledResponse(actual: unknown, context: ControlledIngressContext): Readonly<Record<string, unknown>> {
 const snapshot=projection(actual,context),metadata=snapshot[CONTROLLED_PROJECTION_KEY];
 if(!record(metadata)||metadata.protocol!==CONTROLLED_SAFE_RESPONSE_PROTOCOL)deny();
 // The projection just constructed this typed metadata; no provider marker is adopted.
 const parsed=projectionMetadata(metadata);
 tickets.set(snapshot,{context:frozen(structuredClone(context)),snapshot,fingerprint:fingerprint(snapshot),metadata:parsed,parents:[]});return snapshot;
}
function projectionMetadata(value:unknown):ControlledProjectionMetadata {
 if(!record(value)||value.protocol!==CONTROLLED_SAFE_RESPONSE_PROTOCOL||typeof value.context!=="string"||!CONTROLLED_SAFE_PRODUCERS.some(producer=>producer===value.context)||!Array.isArray(value.unknownFinancialPaths)||typeof value.unknownFinancialPathCount!=="number")deny();
 const context=CONTROLLED_SAFE_PRODUCERS.find(producer=>producer===value.context);if(!context)deny();
 const unknownFinancialPaths:ControlledSafeUnknown[]=[];
 for(const entry of value.unknownFinancialPaths){if(!record(entry)||typeof entry.path!=="string"||typeof entry.reason!=="string")deny();
  const reasons:readonly ControlledSafeUnknownReason[]=["unsupported_financial_shape","unsupported_financial_field","reserved_projection_collision","unknown_page_url","public_product_context_conflict","unknown_path_capacity_exceeded"];
  const reason=reasons.find(reason=>reason===entry.reason);if(!reason)deny();unknownFinancialPaths.push({path:entry.path,reason});}
 return frozen({protocol:CONTROLLED_SAFE_RESPONSE_PROTOCOL,context,unknownFinancialPaths,unknownFinancialPathCount:value.unknownFinancialPathCount});
}
/** A historical safe VIEW creates no ingress ticket and no new bank occurrence. */
export function projectControlledHistoricalRecord(actual:unknown,context:ControlledIngressContext,shape:Shape):Readonly<Record<string,unknown>> {
 return projection(actual,context,shape);
}

/** Identity AND complete object fingerprint are required; serialized markers confer nothing. */
export function authenticateControlledIngress(value: unknown, context: ControlledIngressContext): Readonly<Record<string, unknown>> {
 if(!record(value))deny();const ticket=tickets.get(value);
 if(!ticket||fingerprint(ticket.context)!==fingerprint(context)||fingerprint(value)!==ticket.fingerprint||JSON.stringify(value)!==JSON.stringify(ticket.snapshot))deny();
 return ticket.snapshot;
}
export function controlledProjectionHasUnknown(value: unknown): boolean {
 if(!record(value))return true;const metadata=value[CONTROLLED_PROJECTION_KEY];
 return !record(metadata)||metadata.protocol!==CONTROLLED_SAFE_RESPONSE_PROTOCOL||typeof metadata.unknownFinancialPathCount!=="number"||metadata.unknownFinancialPathCount!==0;
}


interface Ingress { value: Readonly<Record<string, unknown>>; context: ControlledIngressContext; observed: boolean; kind: string; }
interface Session { binding: Readonly<ControlledSafeBinding>; producer?: ControlledSafeProducer; dispatches: Ingress[]; allocated: number; }
const sessions = new AsyncLocalStorage<Session>();
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
function current(): Session { const session=sessions.getStore();if(!session)deny();return session; }
export function withControlledSafeResponseSession<T>(binding: ControlledSafeBinding, work: () => Promise<T>): Promise<T> {
 if(!uuid(binding.operationId)||!uuid(binding.callId)||!uuid(binding.resourceId)||!/^([a-f0-9]{64})$/.test(binding.requestDigest))deny();
 if(sessions.getStore())deny();
 return sessions.run({binding:frozen({...binding}),dispatches:[],allocated:0},work);
}
function observationKind(path:string,method:string,producer:ControlledSafeProducer):string {
 const base=path.split("?",1)[0]??"";
 if(base==="/v1/invoices/create_preview")return "proration_preview";
 if(base==="/v1/subscriptions")return method==="GET"?"subscription_list_read":"bootstrap_subscription";
 if(base==="/v1/invoice_payments")return "invoice_payments_read";
 if(base==="/v1/credit_notes")return "customer_credit_notes_read";
 if(base==="/v1/invoices")return method==="GET"?"invoice_list_read":"controlled_draft_created";
 if(/^\/v1\/invoices\/in_[A-Za-z0-9_]+\/lines$/.test(base))return "invoice_lines_read";
 if(base.startsWith("/v1/payment_intents/"))return "intent_read";
 if(base.startsWith("/v1/prices/"))return "price_read";
 if(base.startsWith("/v1/customers/"))return "customer_financial_read";
 if(base.startsWith("/v1/products"))return method==="GET"?"product_read":"product_created";
 if(base==="/v1/invoiceitems")return "controlled_item_created";
 if(base.endsWith("/finalize"))return "controlled_invoice_finalized";
 if(base.endsWith("/pay"))return "controlled_invoice_paid";
 if(base.startsWith("/v1/invoices/"))return method==="GET"?"invoice_read":"controlled_invoice_updated";
 if(base.startsWith("/v1/subscriptions/"))return method==="DELETE"?"calendar_canceled":method==="GET"?"subscription_read":producer==="pauseMerchantControlledBootstrap"?"pause_subscription":"calendar_updated";
 deny();
}
function authenticateTicket(value:object,session:Session):Ticket {
 const ticket=tickets.get(value);if(!ticket||fingerprint(ticket.context.binding)!==fingerprint(session.binding)||fingerprint(value)!==ticket.fingerprint||JSON.stringify(value)!==JSON.stringify(ticket.snapshot))deny();
 return ticket;
}
function registerChildren(value:unknown,context:ControlledIngressContext,metadata:ControlledProjectionMetadata,parent:Ticket):void {
 if(!value||typeof value!=="object")return;
 if(record(value)&&value!==parent.snapshot&&tickets.has(value))return;
 if(record(value)&&value!==parent.snapshot)tickets.set(value,{context,snapshot:value,fingerprint:fingerprint(value),metadata,parents:[parent]});
 for(const[key,child]of Object.entries(value))if(key!==CONTROLLED_PROJECTION_KEY)registerChildren(child,context,metadata,parent);
}
/** Only the nine controlled factory bindings receive this API. Ordinary APIs stay exact. */
export function controlledSafeResponseApi<S>(api:(path:string,init:RequestInit,scope:S)=>Promise<Record<string,unknown>>) {
 return async(path:string,init:RequestInit,scope:S):Promise<Record<string,unknown>>=>{
  const session=current(),producer=session.producer;if(!producer||session.allocated>=5000)deny();
  const request=record(scope)?scope:null,method=init.method??"GET";if(!request||!["GET","POST","DELETE"].includes(method))deny();
  if(request.requestDigest!==undefined&&request.requestDigest!==session.binding.requestDigest)deny();
  const body=init.body instanceof URLSearchParams?init.body.toString():typeof init.body==="string"?init.body:init.body==null?null:undefined;
  if(body===undefined)deny();
  const originalHeaders=new Headers(init.headers),originalInit={...init,headers:originalHeaders,...(body===null?{}:{body})};
  const base=path.split("?",1)[0]??"";
  const writes:Readonly<Record<string,readonly ControlledSafeProducer[]>>={"/v1/subscriptions":["createMerchantControlledBootstrap"],"/v1/products":["createMerchantControlledTaxProduct"],"/v1/invoices/create_preview":["previewMerchantControlledProration","previewMerchantControlledCalendarUpdate"],"/v1/invoices":["prepareMerchantControlledDraft"],"/v1/invoiceitems":["addMerchantControlledComponent"]};
  if(method!=="GET"){
   if(method==="DELETE"&&(producer!=="cancelMerchantControlledCalendar"||!/^\/v1\/subscriptions\/sub_[A-Za-z0-9_]+$/.test(base))||method==="POST"&&producer==="cancelMerchantControlledCalendar")deny();
   const permitted=writes[base]??(/^\/v1\/subscriptions\/sub_[A-Za-z0-9_]+$/.test(base)?method==="DELETE"?["cancelMerchantControlledCalendar"]:["pauseMerchantControlledBootstrap","updateMerchantControlledCalendar"]:/^\/v1\/invoices\/in_[A-Za-z0-9_]+\/pay$/.test(base)?["payMerchantControlledInvoice"]:/^\/v1\/invoices\/in_[A-Za-z0-9_]+\/finalize$/.test(base)?["finalizeMerchantControlledInvoice"]:/^\/v1\/invoices\/in_[A-Za-z0-9_]+$/.test(base)?["setMerchantControlledInvoiceFee"]:[]);
   if(!permitted.some(value=>value===producer))deny();
  }
  const context:ControlledIngressContext={binding:session.binding,producer,method:method==="POST"?"POST":method==="DELETE"?"DELETE":"GET",requestPath:path,dispatchOrdinal:++session.allocated,
   requestParametersDigest:fingerprint({body}),requestHeadersDigest:fingerprint([...originalHeaders]),requestNamespaceDigest:fingerprint({providerApiVersion:request.providerApiVersion??null,providerPlatformAccountId:request.providerPlatformAccountId??null,providerAccountId:request.providerAccountId??null})};
  if(["createMerchantControlledTaxProduct","inspectMerchantControlledTaxProduct"].includes(producer)){
   const creatorOperationId=request.originalProductOperationId??request.operationId,creatorRequestDigest=request.originalProductRequestDigest??request.requestDigest;
   if(typeof request.name!=="string"||request.name.length>500||request.component!=="merchant_declared_tax_collection"||!uuid(creatorOperationId)||typeof creatorRequestDigest!=="string"||!/^[a-f0-9]{64}$/.test(creatorRequestDigest)||typeof request.providerPlatformAccountId!=="string")deny();
   context.publicProduct={name:request.name,component:request.component,creatorOperationId,creatorRequestDigest,platformAccountId:request.providerPlatformAccountId};
  }
  // Capture the actual response once, before any callback/domain interpretation.
  const response=projectControlledResponse(await api(path,originalInit,scope),context),ticket=tickets.get(response);if(!ticket)deny();
  registerChildren(response,context,ticket.metadata,ticket);
  session.dispatches.push({value:response,context,observed:false,kind:observationKind(path,method,producer)});
  return response;
 };
}
function sealDerived(value:unknown,session:Session):Readonly<Record<string,unknown>> {
 if(!record(value))deny();const existing=tickets.get(value);if(existing){authenticateTicket(value,session);return existing.snapshot;}
 // Derived records come only from this actual factory invocation; every retained
 // provider subtree must still be the complete immutable ingress identity.
 const parents:Ticket[]=[];const parentIds=new Set<Ticket>(),seen=new Set<object>();
 const rawKeys=new Set(["actualInvoice","actualRaw","customer","invoice","intent","invoicePayment","raw","actualPayments","actualIntents","actualPrices","actualInvoices","creditNotes","actualCash"]);
 const visit=(child:unknown,key="derived"):void=>{
  if(!child||typeof child!=="object"||seen.has(child))return;seen.add(child);
  const owned=tickets.get(child);if(owned){authenticateTicket(child,session);if(!parentIds.has(owned)){parentIds.add(owned);parents.push(owned);}return;}
  if(!Array.isArray(child)&&!record(child))deny();
  if(record(child)&&(CONTROLLED_PROJECTION_KEY in child||rawKeys.has(key)||key==="actualLines"&&!Object.hasOwn(child,"raw")))deny();
  if(Array.isArray(child)){for(const nested of child)visit(nested,key);}else for(const[name,nested]of Object.entries(child))visit(nested,name);
 };
 visit(value);
 const ingresses=session.dispatches;for(const entry of ingresses)authenticateTicket(entry.value,session);
 if(!ingresses.length||!session.producer)deny();
 const allUnknown:ControlledSafeUnknown[]=[],unknownIds=new Set<ControlledProjectionMetadata>();let count=0;
 for(const entry of ingresses){const metadata=tickets.get(entry.value)?.metadata;if(!metadata||unknownIds.has(metadata))continue;unknownIds.add(metadata);count+=metadata.unknownFinancialPathCount;
  for(const unknown of metadata.unknownFinancialPaths)if(allUnknown.length<64)allUnknown.push({path:`dispatch${entry.context.dispatchOrdinal}.${unknown.path}`,reason:unknown.reason});}
 if(count>64)allUnknown.push({path:"response",reason:"unknown_path_capacity_exceeded"});
 const metadata:ControlledProjectionMetadata={protocol:CONTROLLED_SAFE_RESPONSE_PROTOCOL,context:session.producer,unknownFinancialPaths:allUnknown,unknownFinancialPathCount:count};
 const snapshot=frozen({...value,[CONTROLLED_PROJECTION_KEY]:metadata}),context=ingresses[ingresses.length-1]?.context;if(!context)deny();
 const derived:Ticket={context,snapshot,fingerprint:fingerprint(snapshot),metadata:frozen(metadata),parents};tickets.set(snapshot,derived);registerChildren(snapshot,context,derived.metadata,derived);return snapshot;
}
/** Wrap real controlled methods without altering any ordinary adapter binding. */
export function controlledSafeResponseFactory<T extends object>(factory:T):T {
 return new Proxy(factory,{get(target,key,receiver){const member:unknown=Reflect.get(target,key,receiver);if(typeof member!=="function")return member;
  if(typeof key!=="string"||!CONTROLLED_SAFE_PRODUCERS.some(value=>value===key))deny();
  const producer=CONTROLLED_SAFE_PRODUCERS.find(value=>value===key);if(!producer)deny();
  return async(request:unknown)=>{
   const session=current();if(CONTROLLED_SAFE_PRODUCER_BY_KIND[session.binding.kind]!==producer||session.producer||!record(request)||typeof request.onObserved!=="function")deny();session.producer=producer;
   const observe=request.onObserved;
   try{
    const bound={...request,onObserved:async(actual:unknown)=>{
     if(!record(actual)||typeof actual.kind!=="string"||!record(actual.raw))deny();
     if(actual.kind==="cash_observed"){
      const cash=record(actual.raw.cash)?actual.raw.cash:null,invoice=record(actual.raw.invoice)?actual.raw.invoice:null,intent=record(actual.raw.intent)?actual.raw.intent:null,payment=record(actual.raw.invoicePayment)?actual.raw.invoicePayment:null;
      if(!cash||!invoice||!intent||!payment)deny();authenticateTicket(invoice,session);authenticateTicket(intent,session);authenticateTicket(payment,session);
      const relation=record(payment.payment)?payment.payment:null,referenceOf=(value:unknown)=>typeof value==="string"?value:record(value)?value.id:null;
      if(!relation||relation.type!=="payment_intent"||referenceOf(relation.payment_intent)!==intent.id||referenceOf(payment.invoice)!==invoice.id
       ||cash.providerInvoiceRef!==invoice.id||cash.providerPaymentIntentRef!==intent.id||cash.providerChargeRef!==undefined&&cash.providerChargeRef!==referenceOf(intent.latest_charge)
       ||cash.providerCustomerRef!==referenceOf(intent.customer)||cash.amountMinor!==intent.amount_received||typeof intent.amount_received!=="number"||!Number.isSafeInteger(intent.amount_received)||intent.amount_received<=0
       ||typeof intent.currency!=="string"||cash.currency!==intent.currency.toUpperCase()||cash.customerChargeVerified!==(intent.status==="succeeded"&&referenceOf(intent.customer)===request.providerCustomerRef))deny();
      for(const field of ["subscriptionId","providerSubscriptionRef","providerCustomerRef","providerPlatformAccountId","providerAccountId"] as const)if((cash[field]??null)!==(request[field]??null))deny();
      if(request.providerApiVersion!=="2026-10-28.endive")deny();const scope:MerchantChargeScope={providerApiVersion:"2026-10-28.endive"};
      for(const field of ["providerPlatformAccountId","providerAccountId","destinationAccountId","settlementMerchantAccountId"] as const){const value=request[field];if(value!==undefined){if(typeof value!=="string"||!/^acct_[A-Za-z0-9_]{1,195}$/.test(value))deny();scope[field]=value;}}
      const route=merchantIntentEvidence(scope,intent);if(cash.merchantRouteVerified!==route.merchantRouteVerified||(cash.destinationAccountId??null)!==(route.destinationAccountId??null)||(cash.settlementMerchantAccountId??null)!==(route.settlementMerchantAccountId??null))deny();
     }
     const raw=sealDerived(actual.raw,session),owned=tickets.get(raw);if(!owned)deny();
     const ingress=session.dispatches.find(entry=>entry.value===raw);if(ingress){if(ingress.kind!==actual.kind)deny();ingress.observed=true;}
     const returned:unknown=Reflect.apply(observe,undefined,[frozen({...actual,raw})]);await returned;
    }};
    const result:unknown=await Reflect.apply(member,target,[bound]),sealed=sealDerived(result,session),ticket=tickets.get(sealed);if(!ticket)deny();
    const publicResult=frozen(Object.fromEntries(Object.entries(sealed).filter(([name])=>name!==CONTROLLED_PROJECTION_KEY)));
    tickets.set(publicResult,{...ticket,snapshot:publicResult,fingerprint:fingerprint(publicResult),parents:[ticket]});return publicResult;
   }finally{session.producer=undefined;}
  };
 }});
}
/** Before runtime clone/cache/FIN: object identity, ancestry and whole bytes. */
export function controlledSafeOwnedSnapshot(value:unknown):Readonly<Record<string,unknown>> {
 if(!record(value))deny();const session=current();authenticateTicket(value,session);
 const original=tickets.get(value);if(!original)deny();const snapshot:unknown=JSON.parse(JSON.stringify(value));if(!record(snapshot)||JSON.stringify(snapshot)!==JSON.stringify(value))deny();
 if(!Object.hasOwn(value,CONTROLLED_PROJECTION_KEY))snapshot[CONTROLLED_PROJECTION_KEY]=original.metadata;
 const owned=frozen(snapshot);tickets.set(owned,{...original,snapshot:owned,fingerprint:fingerprint(owned),parents:[original]});return owned;
}
export function controlledSafePendingResponses():readonly {kind:string;raw:Readonly<Record<string,unknown>>}[]{
 const session=current();return session.dispatches.filter(entry=>!entry.observed).sort((first,second)=>first.context.dispatchOrdinal-second.context.dispatchOrdinal).map(entry=>{authenticateTicket(entry.value,session);entry.observed=true;return frozen({kind:entry.kind,raw:entry.value});});
}

/** Failed-commit replay authenticates the exact original immutable cached object,
 * independently of a later AsyncLocalStorage scope. No serialized marker works. */
export function assertControlledSafeSnapshot(value: unknown, binding: ControlledSafeBinding): void {
 if(!record(value))deny();const ticket=tickets.get(value);
 if(!ticket||fingerprint(ticket.context.binding)!==fingerprint(binding)||fingerprint(value)!==ticket.fingerprint||JSON.stringify(value)!==JSON.stringify(ticket.snapshot))deny();
}

/** Historical rows without the new marker keep their exact old classification;
 * a present unknown/malformed marker can never be resolved as known zero. */
export function recordedControlledProjectionHasUnknown(value: unknown): boolean {
 return record(value)&&((tickets.get(value)?.metadata.unknownFinancialPathCount??0)>0||Object.hasOwn(value,CONTROLLED_PROJECTION_KEY)&&controlledProjectionHasUnknown(value));
}
