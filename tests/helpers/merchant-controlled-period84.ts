// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: fictional HTTP responses for actual original 4000 CAD mandate.
import { z } from "zod";
import { controlledProviderEdge80 } from "./merchant-controlled-provider80";
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function controlledPeriodEdge84(options:{atProviderStart?:true;extra?:(url:URL,init:RequestInit)=>Promise<Response|null>}={}){
 let bank:()=>Record<string,unknown>|undefined=()=>undefined,product:Record<string,unknown>|null=null,previewPosts=0;
 const edge=controlledProviderEdge80({strictIntervalCalendar:true,extra:async(url,init)=>{
  const extra=await options.extra?.(url,init);if(extra)return extra;
  if(url.pathname==="/v1/products"&&init.method==="POST"){
   const form=new URLSearchParams(init.body as URLSearchParams);product={id:"prod_actualPeriodTax",name:form.get("name"),active:form.get("active")==="true",metadata:Object.fromEntries([...form].filter(([key])=>key.startsWith("metadata[")).map(([key,value])=>[key.slice(9,-1),value]))};return Response.json(product);
  }
  if(url.pathname==="/v1/products/prod_actualPeriodTax"&&init.method==="GET"&&product)return Response.json(product);
  const current=bank();if(!current)return null;
  if(url.pathname===`/v1/customers/${z.string().min(1).max(200).parse(current.customer)}`&&init.method==="GET")return Response.json({id:current.customer,currency:"cad",balance:0,invoice_credit_balance:{cad:0},cash_balance:null});
  if(url.pathname==="/v1/credit_notes"&&init.method==="GET")return Response.json({data:[],has_more:false});
  if(url.pathname!=="/v1/invoices/create_preview"||init.method!=="POST")return null;
  previewPosts++;const form=new URLSearchParams(init.body as URLSearchParams),items=object(current.items).data;
  if(!Array.isArray(items)||items.length!==1)throw Error("Retain the genuine original item before its preview.");
  const item=object(items[0]),start=Number(item.current_period_start),end=Number(item.current_period_end),target=Number(form.get("subscription_details[items][0][price_data][unit_amount]"));
  if(target!==4000)throw Error("This bank oracle represents only the real original 4000 CAD mandate.");
  const native=form.get("subscription_details[proration_behavior]")==="create_prorations",trial=form.get("subscription_details[trial_end]"),at=Number(form.get("subscription_details[proration_date]"));
  const productRef=form.get("subscription_details[items][0][price_data][product]"),line=(id:string,amount:number,from:number,to:number,proration:boolean)=>({id,amount,currency:"cad",quantity:1,period:{start:from,end:to},
   parent:{type:"subscription_item_details",subscription_item_details:{subscription:current.id,subscription_item:item.id,proration}},pricing:{price_details:{price:"price_actualPeriodPreview",product:productRef}},discount_amounts:[],taxes:[]});
  let forecastStart:number,forecastEnd:number,rows:Array<ReturnType<typeof line>>;
  if(trial){
   forecastStart=Number(trial);const next=new Date(forecastStart*1000);next.setUTCMonth(next.getUTCMonth()+1);forecastEnd=next.getTime()/1000;
   rows=[line("il_actualPeriodTrialForecast",4000,forecastStart,forecastEnd,false)];
  }else{
   if(end-start!==86400||native&&at!==start+(options.atProviderStart?0:21600)||!native&&form.has("subscription_details[proration_date]"))throw Error("This original paid-day oracle declares one quarter-day native estimate.");
   forecastStart=end;forecastEnd=end+86400;rows=[...(native?[line("il_actualPeriodCurrentEstimate",options.atProviderStart?4000:3000,at,end,true)]:[]),line("il_actualPeriodForecast",4000,forecastStart,forecastEnd,false)];
  }
  const total=rows.reduce((sum,row)=>sum+row.amount,0);
  return Response.json({id:`upcoming_in_actualPeriod${previewPosts}`,customer:current.customer,currency:"cad",amount_paid:0,subtotal:total,total,amount_due:total,period_start:forecastStart,period_end:forecastEnd,lines:{has_more:false,data:rows}});
 }});
 bank=edge.currentSubscription;
 return{...edge,previewPosts:()=>previewPosts,previewAt:(trial=false)=>{const items=object(bank()?.items).data;if(!Array.isArray(items))throw Error("Prepare the actual bank resource first.");return new Date((Number(object(items[0]).current_period_start)+(trial?1:options.atProviderStart?0:21600))*1000);}};
}
