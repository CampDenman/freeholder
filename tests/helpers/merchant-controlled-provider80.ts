// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Fictional HTTP edge, actual shared-service admission/writers.
import { expect,vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
export function controlledProviderEdge80(options:{loseBootstrapReply?:boolean}={}){
 let subscription:Record<string,unknown>|undefined,price:Record<string,unknown>|undefined,bootstrapPosts=0,pausePosts=0,cancelCalls=0,discoveryGets=0,lost=false,unexpectedPaid=false,unexpectedPending=false;
 const forms:URLSearchParams[]=[];
 const metadata=(form:URLSearchParams)=>Object.fromEntries([...form].filter(([key])=>key.startsWith("metadata[")).map(([key,value])=>[key.slice(9,-1),value]));
 const invoice=()=>{if(!subscription)throw Error("Create the real fictional controlled resource first");return{id:"in_actualControlledZero",object:"invoice",subscription:subscription.id,customer:subscription.customer,
  parent:{type:"subscription_details",subscription_details:{subscription:subscription.id,metadata:subscription.metadata}},currency:"cad",status:"paid",total:0,subtotal:0,amount_paid:0,amount_due:0,amount_remaining:0,
  auto_advance:false,starting_balance:0,ending_balance:0,post_payment_credit_notes_amount:0,pre_payment_credit_notes_amount:0};};
 const unexpectedInvoice=()=>({...invoice(),id:"in_actualControlledUnexpected",status:unexpectedPaid?"paid":"open",total:500,subtotal:500,amount_paid:unexpectedPaid?500:0,amount_due:500,amount_remaining:unexpectedPaid?0:500});
 const fetcher=vi.fn<typeof fetch>(async(input,init={})=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url),headers=new Headers(init.headers);
  expect(url.origin).toBe("https://stripe.example.test");expect(headers.has("stripe-account")).toBe(false);
  if(url.pathname==="/v1/account")return Response.json({id:"acct_fixturePlatform"});
  expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
  if(url.pathname==="/v1/subscriptions"&&init.method==="POST"){
   bootstrapPosts++;const form=new URLSearchParams(init.body as URLSearchParams);forms.push(form);expect(form.get("payment_behavior")).toBe("default_incomplete");expect(form.get("items[0][price_data][unit_amount]")).toBe("0");
   const start=Math.floor(Date.now()/1000),end=start+30*86400;
   price={id:"price_actualControlledZero",product:form.get("items[0][price_data][product]"),currency:form.get("items[0][price_data][currency]"),unit_amount:0,unit_amount_decimal:"0",billing_scheme:"per_unit",type:"recurring",transform_quantity:null,
    tax_behavior:"exclusive",recurring:{interval:form.get("items[0][price_data][recurring][interval]"),interval_count:Number(form.get("items[0][price_data][recurring][interval_count]")),usage_type:"licensed"}};
   subscription={id:"sub_actualControlledZero",object:"subscription",customer:form.get("customer"),currency:form.get("items[0][price_data][currency]"),metadata:metadata(form),status:"active",collection_method:"charge_automatically",
    default_payment_method:form.get("default_payment_method"),billing_mode:{type:"flexible"},pause_collection:null,latest_invoice:"in_actualControlledZero",billing_cycle_anchor:start,trial_end:null,trial_start:null,pending_update:null,
    schedule:null,cancel_at:null,cancel_at_period_end:false,automatic_tax:{enabled:false},default_tax_rates:[],discounts:[],pending_invoice_item_interval:null,next_pending_invoice_item_invoice:null,
    transfer_data:{destination:form.get("transfer_data[destination]")},on_behalf_of:form.get("on_behalf_of"),
    items:{has_more:false,data:[{id:"si_actualControlledZero",quantity:1,tax_rates:[],discounts:[],current_period_start:start,current_period_end:end,price}]}};
   if(options.loseBootstrapReply&&!lost){lost=true;throw Error("Fictional bank accepted original zero create but its actual response was lost");}
   return Response.json(subscription);
  }
  if(url.pathname==="/v1/subscriptions"&&init.method==="GET"){discoveryGets++;return Response.json({data:subscription?[subscription]:[],has_more:false});}
  if(url.pathname==="/v1/subscriptions/sub_actualControlledZero"&&subscription){
   if(init.method==="POST"){pausePosts++;const form=new URLSearchParams(init.body as URLSearchParams);expect(form.get("pause_collection[behavior]")).toBe("keep_as_draft");subscription={...subscription,pause_collection:{behavior:"keep_as_draft",resumes_at:null}};}
   else if(init.method==="DELETE"){cancelCalls++;expect(url.searchParams.get("invoice_now")).toBe("false");expect(url.searchParams.get("prorate")).toBe("false");const now=Math.floor(Date.now()/1000);subscription={...subscription,status:"canceled",canceled_at:now,ended_at:now};}
   else expect(init.method).toBe("GET");
   return Response.json(subscription);
  }
  if(url.pathname==="/v1/invoices"&&init.method==="GET")return Response.json({data:unexpectedPaid||unexpectedPending?[invoice(),unexpectedInvoice()]:[invoice()],has_more:false});
  if(url.pathname==="/v1/invoices/in_actualControlledUnexpected"&&init.method==="GET"&&(unexpectedPaid||unexpectedPending))return Response.json(unexpectedInvoice());
  if(url.pathname==="/v1/invoices/in_actualControlledZero"&&init.method==="GET")return Response.json(invoice());
  if(url.pathname==="/v1/invoice_payments"&&init.method==="GET")return Response.json({data:url.searchParams.get("invoice")==="in_actualControlledUnexpected"&&(unexpectedPaid||unexpectedPending)?[{id:"inpay_actualControlledUnexpected",invoice:"in_actualControlledUnexpected",status:unexpectedPaid?"paid":"open",currency:"cad",amount_requested:500,amount_paid:unexpectedPaid?500:0,payment:{type:"payment_intent",payment_intent:"pi_actualControlledUnexpected"}}]:[],has_more:false});
  if(url.pathname==="/v1/payment_intents/pi_actualControlledUnexpected"&&init.method==="GET"&&(unexpectedPaid||unexpectedPending)&&subscription)return Response.json({id:"pi_actualControlledUnexpected",status:unexpectedPaid?"succeeded":"processing",customer:subscription.customer,amount:500,amount_received:unexpectedPaid?500:0,amount_capturable:0,currency:"cad",latest_charge:"ch_actualControlledUnexpected",transfer_data:subscription.transfer_data,on_behalf_of:subscription.on_behalf_of});
  if(url.pathname==="/v1/invoices/in_actualControlledUnexpected/lines"&&init.method==="GET"&&(unexpectedPaid||unexpectedPending))return Response.json({has_more:false,data:[{id:"il_actualControlledUnexpected",amount:500,currency:"cad",quantity:1,pricing:{type:"price_details",price_details:{price:"price_actualControlledUnexpected",product:price?.product}},period:{start:1,end:2}}]});
  if(url.pathname==="/v1/prices/price_actualControlledUnexpected"&&init.method==="GET"&&price&&(unexpectedPaid||unexpectedPending))return Response.json({...price,id:"price_actualControlledUnexpected",unit_amount:500,unit_amount_decimal:"500"});
  if(url.pathname==="/v1/invoices/in_actualControlledZero/lines"&&init.method==="GET")return Response.json({has_more:false,data:[{id:"il_actualControlledZero",amount:0,currency:"cad",quantity:1,pricing:{type:"price_details",price_details:{price:"price_actualControlledZero",product:price?.product}},period:{start:1,end:2}}]});
  if(url.pathname==="/v1/prices/price_actualControlledZero"&&init.method==="GET"&&price)return Response.json(price);
  throw Error(`Unexpected fictional controlled provider request: ${init.method} ${url.pathname}`);
 });
 return{provider:createStripePayments({secretKey:"sk_actual_controlled_fixture",apiBase:"https://stripe.example.test",fetch:fetcher}),forms,externallyPayUnexpectedInvoice:()=>{if(!subscription)throw Error("An actual original controlled resource must exist first");unexpectedPaid=true;unexpectedPending=false;subscription={...subscription,latest_invoice:"in_actualControlledUnexpected"};},externallyAddUnpaidUnexpectedInvoice:()=>{if(!subscription)throw Error("Create the actual original controlled resource before its external bank obligation");unexpectedPending=true;subscription={...subscription,latest_invoice:"in_actualControlledUnexpected"};},bootstrapPosts:()=>bootstrapPosts,pausePosts:()=>pausePosts,cancelCalls:()=>cancelCalls,discoveryGets:()=>discoveryGets};
}
