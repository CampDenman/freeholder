// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: actual HTTP adapter; explicit nonpayable bank preview fixture.
import { controlledProviderEdge80 } from "./merchant-controlled-provider80";
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function controlledProrationEdge82(){
 let bank:()=>Record<string,unknown>|undefined=()=>undefined,product:Record<string,unknown>|null=null,previewPosts=0;
 const edge=controlledProviderEdge80({strictIntervalCalendar:true,extra:async(url,init)=>{
  if(url.pathname==="/v1/products"&&init.method==="POST"){
   const form=new URLSearchParams(init.body as URLSearchParams);product={id:"prod_actualControlledTax",name:form.get("name"),active:form.get("active")==="true",metadata:Object.fromEntries([...form].filter(([key])=>key.startsWith("metadata[")).map(([key,value])=>[key.slice(9,-1),value]))};return Response.json(product);
  }
  if(url.pathname==="/v1/products/prod_actualControlledTax"&&init.method==="GET"&&product)return Response.json(product);
  const current=bank();if(!current)return null;
  if(url.pathname===`/v1/customers/${current.customer}`&&init.method==="GET")return Response.json({id:current.customer,currency:"cad",balance:0,invoice_credit_balance:{cad:0},cash_balance:null});
  if(url.pathname==="/v1/credit_notes"&&init.method==="GET")return Response.json({data:[],has_more:false});
  if(url.pathname!=="/v1/invoices/create_preview"||init.method!=="POST")return null;
  previewPosts++;const form=new URLSearchParams(init.body as URLSearchParams),items=object(current.items).data;
  if(!Array.isArray(items)||items.length!==1)throw Error("Retain the real fictional current subscription item before preview.");
  const item=object(items[0]),start=Number(item.current_period_start),end=Number(item.current_period_end),target=Number(form.get("subscription_details[items][0][price_data][unit_amount]"));
  if(end-start!==86400||target!==6000)throw Error("This declared bank oracle models exactly a 6000 CAD NET day, independent of canonical old paid credit.");
  const behavior=form.get("subscription_details[proration_behavior]"),native=behavior==="create_prorations",at=Number(form.get("subscription_details[proration_date]"));
  if(native&&at!==start+21600||!native&&form.has("subscription_details[proration_date]"))throw Error("Native proration is exactly a quarter of this actual provider day; no-proration preview omits its date.");
  const productRef=form.get("subscription_details[items][0][price_data][product]"),line=(id:string,amount:number,from:number,to:number,proration:boolean)=>({id,amount,currency:"cad",quantity:1,period:{start:from,end:to},
   parent:{type:"subscription_item_details",subscription_item_details:{subscription:current.id,subscription_item:item.id,proration}},pricing:{price_details:{price:"price_actualPreview",product:productRef}},discount_amounts:[],taxes:[]});
  const rows=[...(native?[line("il_actualControlledCurrent",4500,at,end,true)]:[]),line("il_actualControlledForecast",6000,end,end+86400,false)];
  return Response.json({id:`upcoming_in_actualControlled${previewPosts}`,customer:current.customer,currency:"cad",amount_paid:0,subtotal:native?10500:6000,total:native?10500:6000,amount_due:native?10500:6000,
   period_start:end,period_end:end+86400,lines:{has_more:false,data:rows}});
 }});
 bank=edge.currentSubscription;
 return{...edge,previewPosts:()=>previewPosts,quarterDayInstant:()=>{const items=object(bank()?.items).data;if(!Array.isArray(items))throw Error("Prepare the actual original bank resource first.");return new Date((Number(object(items[0]).current_period_start)+21600)*1000);}};
}
