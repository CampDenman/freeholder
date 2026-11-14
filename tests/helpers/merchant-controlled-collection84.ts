// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Real HTTP adapter; fictional bank objects only, never DB rows.
import { expect } from "vitest";
import { z } from "zod";
import { controlledPeriodEdge84 } from "./merchant-controlled-period84";
const bankRef=(value:unknown)=>z.string().min(1).max(200).parse(value);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const tag=(form:URLSearchParams)=>Object.fromEntries([...form].filter(([key])=>key.startsWith("metadata[")).map(([key,value])=>[key.slice(9,-1),value]));
export function controlledCollectionEdge84(options:{loseUpdateReply?:true;loseDraftReply?:true;failAfterPositiveCash?:true}={}){
 let current:()=>Record<string,unknown>|undefined=()=>undefined,zero:()=>Record<string,unknown>=()=>{throw Error("The actual bootstrap must exist first.");};
 let originalZero:Record<string,unknown>|null=null,updatePosts=0,draftPosts=0,itemPosts=0,feePosts=0,finalizePosts=0,payPosts=0,cashGets=0,externalAttachments=0;
 let lostUpdate=false,lostDraft=false,failedCash=false;
 const bankInvoices=new Map<string,Record<string,unknown>>(),bankLines=new Map<string,Array<Record<string,unknown>>>(),prices=new Map<string,Record<string,unknown>>(),intents=new Map<string,Record<string,unknown>>();
 const intentInvoices=new Map<string,string>(),externalRefunds=new Map<string,Record<string,unknown>>();
 const forms:Array<{path:string;form:URLSearchParams}>=[];
 const edge=controlledPeriodEdge84({atProviderStart:true,extra:async(url,init)=>{
  const subscription=current();if(!subscription)return null;
  if(!originalZero){
   // Freeze the ORIGINAL fictional bank document once, before any update.
   // These fields come from the actual bootstrap POST's returned subscription;
   // the old generic zero-only fixture deliberately did not model them.
   const original=z.object({collection_method:z.literal("charge_automatically"),default_payment_method:z.string().min(1),automatic_tax:z.object({enabled:z.literal(false)}).passthrough(),
    discounts:z.array(z.unknown()).length(0),default_tax_rates:z.array(z.unknown()).length(0),transfer_data:z.object({destination:z.string().nullable()}).passthrough().nullable(),on_behalf_of:z.string().nullable()}).parse(subscription);
   originalZero={...structuredClone(zero()),...structuredClone(original),application_fee_amount:null,total_discount_amounts:[],total_taxes:[],total_tax_amounts:[],paid_out_of_band:false};
  }
  const form=()=>{const actual=new URLSearchParams(init.body as URLSearchParams);forms.push({path:url.pathname,form:actual});return actual;};
  const refresh=(id:string)=>{const invoice=bankInvoices.get(id),lines=bankLines.get(id);if(!invoice||!lines)throw Error("A genuine bank invoice and lines must exist.");const total=lines.reduce((n,line)=>n+Number(line.amount),0);invoice.total=total;invoice.subtotal=total;invoice.amount_due=total;invoice.amount_remaining=total-Number(invoice.amount_paid);};
  if(url.pathname===`/v1/subscriptions/${bankRef(subscription.id)}`&&init.method==="POST"){
   const actual=new URLSearchParams(init.body as URLSearchParams);if(!actual.has("items[0][price_data][unit_amount]"))return null;
   updatePosts++;forms.push({path:url.pathname,form:actual});expect(actual.get("proration_behavior")).toBe("none");expect(actual.get("pause_collection[behavior]")).toBe("keep_as_draft");expect(actual.get("billing_cycle_anchor[type]")).toBe("unchanged");
   const items=object(subscription.items).data;if(!Array.isArray(items)||items.length!==1)throw Error("Use the actual original subscription item.");const item=object(items[0]);expect(actual.get("items[0][id]")).toBe(item.id);
   const price={...object(item.price),id:`price_actualPeriodEpoch${updatePosts}`,unit_amount:Number(actual.get("items[0][price_data][unit_amount]")),unit_amount_decimal:actual.get("items[0][price_data][unit_amount]"),product:actual.get("items[0][price_data][product]"),
    currency:actual.get("items[0][price_data][currency]"),recurring:{interval:actual.get("items[0][price_data][recurring][interval]"),interval_count:Number(actual.get("items[0][price_data][recurring][interval_count]")),usage_type:"licensed"}};
   item.price=price;prices.set(price.id,price);subscription.metadata={...object(subscription.metadata),...tag(actual)};
   if(actual.has("trial_end")){subscription.trial_end=Number(actual.get("trial_end"));subscription.billing_cycle_anchor=Number(actual.get("trial_end"));item.current_period_end=Number(actual.get("trial_end"));subscription.status="trialing";}
   if(options.loseUpdateReply&&!lostUpdate){lostUpdate=true;throw Error("Fictional bank accepted the real original update; its response was lost.");}
   return Response.json(subscription);
  }
  if(url.pathname==="/v1/invoices"&&init.method==="POST"){
   draftPosts++;const actual=form(),id=`in_actualPeriodTarget${draftPosts}`;expect(actual.get("subscription")).toBe(subscription.id);expect(actual.get("auto_advance")).toBe("false");expect(actual.get("pending_invoice_items_behavior")).toBe("exclude");
   const invoice={id,object:"invoice",subscription:subscription.id,customer:subscription.customer,parent:{type:"subscription_details",subscription_details:{subscription:subscription.id,metadata:{...object(subscription.metadata)}}},
    metadata:tag(actual),currency:actual.get("currency"),collection_method:actual.get("collection_method"),default_payment_method:actual.get("default_payment_method"),auto_advance:false,status:"draft",total:0,subtotal:0,amount_paid:0,amount_due:0,amount_remaining:0,
    automatic_tax:{enabled:false},discounts:[],default_tax_rates:[],total_discount_amounts:[],total_taxes:[],starting_balance:0,ending_balance:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,
    transfer_data:subscription.transfer_data,on_behalf_of:subscription.on_behalf_of,application_fee_amount:null};
   bankInvoices.set(id,invoice);bankLines.set(id,[]);
   if(options.loseDraftReply&&!lostDraft){lostDraft=true;throw Error("Fictional bank created the real exact original draft; its response was lost.");}
   return Response.json(invoice);
  }
  if(url.pathname==="/v1/invoiceitems"&&init.method==="POST"){
   itemPosts++;const actual=form(),invoiceId=String(actual.get("invoice"));if(!bankInvoices.has(invoiceId))throw Error("Attach to a genuine original bank draft.");
   const id=`ii_actualPeriodComponent${itemPosts}`,lineId=`il_actualPeriodComponent${itemPosts}`,priceId=actual.has("amount")?null:`price_actualPeriodComponent${itemPosts}`,amount=Number(actual.get("amount")??actual.get("price_data[unit_amount]")),metadata=tag(actual);
   const pricing={type:"price_details",price_details:{price:priceId,product:actual.get("price_data[product]")}},line={id:lineId,amount,currency:actual.get("currency"),quantity:1,period:{start:Number(actual.get("period[start]")),end:Number(actual.get("period[end]"))},metadata,
    parent:{type:"invoice_item_details",invoice_item_details:{invoice_item:id}},pricing,discount_amounts:[],taxes:[]};
   bankLines.get(invoiceId)!.push(line);if(priceId)prices.set(priceId,{id:priceId,object:"price",currency:actual.get("currency"),product:actual.get("price_data[product]"),unit_amount:amount,unit_amount_decimal:String(amount),billing_scheme:"per_unit",type:"one_time",tax_behavior:"exclusive",transform_quantity:null});refresh(invoiceId);
   return Response.json({id,invoice:invoiceId,customer:subscription.customer,amount,currency:actual.get("currency"),metadata,pricing});
  }
  const invoiceId=url.pathname.split("/")[3]??"",invoice=bankInvoices.get(invoiceId);
  if(invoice&&url.pathname===`/v1/invoices/${invoiceId}`&&init.method==="POST"){
   feePosts++;const actual=form();expect(actual.get("auto_advance")).toBe("false");invoice.application_fee_amount=Number(actual.get("application_fee_amount"));return Response.json(invoice);
  }
  if(invoice&&url.pathname===`/v1/invoices/${invoiceId}/finalize`&&init.method==="POST"){
   finalizePosts++;expect(form().get("auto_advance")).toBe("false");expect(invoice.status).toBe("draft");invoice.status="open";return Response.json(invoice);
  }
  if(invoice&&url.pathname===`/v1/invoices/${invoiceId}/pay`&&init.method==="POST"){
   payPosts++;expect(form().get("off_session")).toBe("true");expect(invoice.status).toBe("open");const id=`pi_actualPeriodTarget${payPosts}`;
   const intent={id,object:"payment_intent",status:"succeeded",customer:subscription.customer,payment_method:subscription.default_payment_method,amount:invoice.total,amount_received:invoice.total,amount_capturable:0,currency:invoice.currency,latest_charge:`ch_actualPeriodTarget${payPosts}`,transfer_data:subscription.transfer_data,on_behalf_of:subscription.on_behalf_of,application_fee_amount:invoice.application_fee_amount};
   intents.set(id,intent);intentInvoices.set(id,invoiceId);invoice.status="paid";invoice.amount_paid=invoice.total;invoice.amount_remaining=0;return Response.json(invoice);
  }
  if(url.pathname==="/v1/invoices"&&init.method==="GET")return Response.json({data:[originalZero,...bankInvoices.values()],has_more:false});
  if(url.pathname===`/v1/invoices/${bankRef(originalZero.id)}`&&init.method==="GET")return Response.json(originalZero);
  if(invoice&&url.pathname===`/v1/invoices/${invoiceId}`&&init.method==="GET")return Response.json(invoice);
  if(invoice&&url.pathname===`/v1/invoices/${invoiceId}/lines`&&init.method==="GET")return Response.json({data:bankLines.get(invoiceId),has_more:false});
  if(url.pathname==="/v1/invoice_payments"&&init.method==="GET"&&bankInvoices.has(String(url.searchParams.get("invoice")))){
   const selected=String(url.searchParams.get("invoice")),matches=[...intents.values()].filter(intent=>intentInvoices.get(bankRef(intent.id))===selected);
   return Response.json({data:matches.map(intent=>({id:`inpay_${bankRef(intent.id)}`,invoice:selected,status:"paid",amount_paid:intent.amount_received,amount_requested:intent.amount,currency:intent.currency,payment:{type:"payment_intent",payment_intent:intent.id}})),has_more:false});
  }
  const intent=[...intents.values()].find(row=>url.pathname===`/v1/payment_intents/${bankRef(row.id)}`);
  if(intent&&init.method==="GET"){cashGets++;return Response.json(intent);}
  const chargeIntent=[...intents.values()].find(row=>url.pathname===`/v1/charges/${bankRef(row.latest_charge)}`);
  if(chargeIntent&&init.method==="GET")return Response.json({id:chargeIntent.latest_charge,payment_intent:chargeIntent.id,amount_captured:chargeIntent.amount_received,currency:chargeIntent.currency,paid:true,captured:true,refunded:[...externalRefunds.values()].filter(refund=>refund.payment_intent===chargeIntent.id).reduce((sum,refund)=>sum+Number(refund.amount),0)===Number(chargeIntent.amount_received),amount_refunded:[...externalRefunds.values()].filter(refund=>refund.payment_intent===chargeIntent.id).reduce((sum,refund)=>sum+Number(refund.amount),0),
   application_fee:Number(chargeIntent.application_fee_amount)>0?`fee_${bankRef(chargeIntent.id)}`:null,transfer:`tr_${bankRef(chargeIntent.id)}`});
  const feeIntent=[...intents.values()].find(row=>url.pathname===`/v1/application_fees/fee_${bankRef(row.id)}`);
  if(feeIntent&&init.method==="GET")return Response.json({id:`fee_${bankRef(feeIntent.id)}`,originating_transaction:feeIntent.latest_charge,charge:feeIntent.latest_charge,account:object(feeIntent.transfer_data).destination,amount:feeIntent.application_fee_amount,amount_refunded:0,currency:feeIntent.currency});
  const transferIntent=[...intents.values()].find(row=>url.pathname===`/v1/transfers/tr_${bankRef(row.id)}`);
  if(transferIntent&&init.method==="GET")return Response.json({id:`tr_${bankRef(transferIntent.id)}`,source_transaction:transferIntent.latest_charge,destination:object(transferIntent.transfer_data).destination,amount:transferIntent.amount_received,amount_reversed:0,currency:transferIntent.currency,reversed:false});
  if(url.pathname==="/v1/refunds"&&init.method==="GET")return Response.json({data:[...externalRefunds.values()].filter(refund=>(!url.searchParams.has("charge")||refund.charge===url.searchParams.get("charge"))&&(!url.searchParams.has("payment_intent")||refund.payment_intent===url.searchParams.get("payment_intent"))),has_more:false});
  const externalRefund=externalRefunds.get(url.pathname.slice("/v1/refunds/".length));if(externalRefund&&init.method==="GET")return Response.json(externalRefund);
  if(url.pathname==="/v1/disputes"&&init.method==="GET")return Response.json({data:[],has_more:false});
  const price=prices.get(url.pathname.slice("/v1/prices/".length));if(price&&init.method==="GET"){
   if(options.failAfterPositiveCash&&intents.size&&!failedCash){failedCash=true;throw Error("Fictional original price GET failed after actual positive cash occurrence was retained.");}return Response.json(price);
  }
  return null;
 }});
 current=edge.currentSubscription;zero=edge.currentZeroInvoice;
 function externallyAttachPayment(providerInvoiceRef:string,amountMinor:number,feeMinor=0){
  const invoice=bankInvoices.get(providerInvoiceRef),subscription=current();
  if(!invoice||!subscription||invoice.status!=="open"||!Number.isSafeInteger(amountMinor)||amountMinor<=0||amountMinor>Number(invoice.amount_remaining)
   ||!Number.isSafeInteger(feeMinor)||feeMinor<0||feeMinor>amountMinor)throw Error("An actual OPEN original invoice and exact real external principal/fee are required; never clip or invent an invoice.");
  externalAttachments++;const id=`pi_actualPeriodExternal${externalAttachments}`;
  const intent={id,object:"payment_intent",status:"succeeded",customer:subscription.customer,payment_method:subscription.default_payment_method,amount:amountMinor,amount_received:amountMinor,amount_capturable:0,currency:invoice.currency,
   latest_charge:`ch_actualPeriodExternal${externalAttachments}`,transfer_data:subscription.transfer_data,on_behalf_of:subscription.on_behalf_of,application_fee_amount:feeMinor};
  intents.set(id,intent);intentInvoices.set(id,providerInvoiceRef);invoice.amount_paid=Number(invoice.amount_paid)+amountMinor;invoice.amount_remaining=Number(invoice.total)-Number(invoice.amount_paid);invoice.status=invoice.amount_remaining===0?"paid":"open";
  return{providerInvoiceRef,providerPaymentIntentRef:id,amountMinor,feeMinor};
 }
 function externallyRefundPayment(providerPaymentIntentRef:string,amountMinor:number){
  const intent=intents.get(providerPaymentIntentRef),already=[...externalRefunds.values()].filter(refund=>refund.payment_intent===providerPaymentIntentRef).reduce((sum,refund)=>sum+Number(refund.amount),0);
  if(!intent||!Number.isSafeInteger(amountMinor)||amountMinor<=0||amountMinor+already>Number(intent.amount_received))throw Error("Refund only real already captured original bank principal, without mutating local money or inventing an intent.");
  const id=`re_actualControlledExternal${externalRefunds.size+1}`,refund={id,object:"refund",payment_intent:providerPaymentIntentRef,charge:intent.latest_charge,amount:amountMinor,currency:intent.currency,status:"succeeded",created:Math.floor(Date.now()/1000)};
  externalRefunds.set(id,refund);return refund;
 }
 // Explicit fictional external anomalies, never a production policy selector.
 // Original identity comes ONLY from the already-created exact bank invoice.
 // These methods intentionally describe contradictory received bank facts; the
 // real application must retain them without FX, clipping or owner adoption.
 function externalAnomaly(providerInvoiceRef:string,kind:"wrong_currency"|"overage"){
  const invoice=bankInvoices.get(providerInvoiceRef),subscription=current(),total=Number(invoice?.total);
  if(!invoice||!subscription||invoice.status!=="open"||invoice.currency!=="cad"||invoice.amount_paid!==0||!Number.isSafeInteger(total)||total<=0||total>=Number.MAX_SAFE_INTEGER)
   throw Error("Use an actual untouched OPEN CAD bank target before attaching its declared external anomaly.");
  const amountMinor=kind==="overage"?total+1:1,currency=kind==="wrong_currency"?"usd":"cad",feeMinor=kind==="overage"?Number(invoice.application_fee_amount):0;
  if(!Number.isSafeInteger(feeMinor)||feeMinor<0||feeMinor>amountMinor)throw Error("The fictional anomaly must still retain an actual bounded bank fee.");
  externalAttachments++;const id=`pi_actualPeriodAnomaly${externalAttachments}`;
  const intent={id,object:"payment_intent",status:"succeeded",customer:subscription.customer,payment_method:subscription.default_payment_method,amount:amountMinor,amount_received:amountMinor,amount_capturable:0,currency,
   latest_charge:`ch_actualPeriodAnomaly${externalAttachments}`,transfer_data:structuredClone(subscription.transfer_data),on_behalf_of:subscription.on_behalf_of,application_fee_amount:feeMinor};
  intents.set(id,intent);intentInvoices.set(id,providerInvoiceRef);invoice.amount_paid=amountMinor;invoice.amount_remaining=kind==="overage"?0:total-amountMinor;invoice.status=kind==="overage"?"paid":"open";
  return{providerInvoiceRef,providerPaymentIntentRef:id,amountMinor,currency:currency.toUpperCase(),feeMinor};
 }
 return{...edge,forms,externallyAttachPayment,externallyRefundPayment,externalRefunds:()=>[...externalRefunds.values()],externallyAttachWrongCurrencyPayment:(providerInvoiceRef:string)=>externalAnomaly(providerInvoiceRef,"wrong_currency"),externallyOverpayInvoice:(providerInvoiceRef:string)=>externalAnomaly(providerInvoiceRef,"overage"),
  externalAttachments:()=>externalAttachments,invoices:()=>[...bankInvoices.values()],intents:()=>[...intents.values()],counts:()=>({updatePosts,draftPosts,itemPosts,feePosts,finalizePosts,payPosts,cashGets})};
}
