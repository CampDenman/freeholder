// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08: genuine response projection, full immutable ingress identity and debt preservation.
import { createHash } from "node:crypto";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { projectControlledResponse, authenticateControlledIngress, controlledProjectionHasUnknown, controlledSafeResponseApi, controlledSafeResponseFactory, withControlledSafeResponseSession, controlledSafeOwnedSnapshot } from "@/adapters/payments/stripe-controlled-safe-response";
import { CONTROLLED_PROJECTION_KEY } from "@/adapters/payments/merchant-controlled-safe-response-contract";
import type { ControlledIngressContext } from "@/adapters/payments/merchant-controlled-safe-response-contract";
import { controlledSubscriptionFactsDigest } from "@/adapters/payments/controlled-subscription-digest";
import { controlledCurrentResultData } from "@/modules/subscriptions/controlled-provider-safe-response-proof";
const context:ControlledIngressContext={binding:{operationId:"11111111-1111-4111-8111-111111111111",callId:"22222222-2222-4222-8222-222222222222",requestDigest:"a".repeat(64),resourceId:"33333333-3333-4333-8333-333333333333",kind:"read_invoice"},producer:"inspectMerchantControlledInvoice",method:"GET",requestPath:"/v1/invoices/in_original",dispatchOrdinal:1};
const secret="PRIVATE_client_secret_contact_email_card_canary";
function invoice(){return{id:"in_original",object:"invoice",currency:"usd",status:"paid",total:4200,subtotal:4000,amount_paid:4200,amount_remaining:0,customer:{id:"cus_original",object:"customer",email:secret,name:secret,balance:0,invoice_credit_balance:{usd:0}},payment_intent:{id:"pi_original",object:"payment_intent",client_secret:secret,customer:"cus_original",status:"succeeded",currency:"usd",amount:4200,amount_received:4200,latest_charge:{id:"ch_original",object:"charge",amount:4200,amount_refunded:1,currency:"usd",disputed:true,billing_details:{name:secret,email:secret},refunds:{object:"list",data:[{id:"re_original",object:"refund",amount:1,currency:"usd",status:"succeeded",charge:"ch_original",metadata:{private:secret}}],has_more:false,url:"/v1/charges/ch_original/refunds"}}}};}
describe("controlled safe response projection",()=>{
 it("retains positive/refunded/disputed financial counters while excluding nested private fields",()=>{
  const result=projectControlledResponse(invoice(),context),encoded=JSON.stringify(result);
  expect(encoded).not.toContain(secret);expect(result).toMatchObject({id:"in_original",amount_paid:4200,payment_intent:{id:"pi_original",amount_received:4200,latest_charge:{id:"ch_original",amount_refunded:1,disputed:true,refunds:{data:[{id:"re_original",amount:1}]}}}});
  expect(authenticateControlledIngress(result,context)).toBe(result);
 });
 it("never filters an invalid currency key into known zero or retains its private bytes",()=>{
  const actual={id:"cus_original",object:"customer",balance:0,invoice_credit_balance:{usd:0,[secret]:secret},cash_balance:null};
  const result=projectControlledResponse(actual,{...context,producer:"inspectMerchantControlledCustomerFinancials",requestPath:"/v1/customers/cus_original"});
  expect(JSON.stringify(result)).not.toContain(secret);expect(result).toMatchObject({invoice_credit_balance:{usd:0}});expect(controlledProjectionHasUnknown(result)).toBe(true);
 });
 it("keeps all rows and duplicates with bounded unknown detail and explicit full-response overflow",()=>{
  const data=Array.from({length:70},()=>({id:"in_same",object:"invoice",amount_paid:3,total:3,amount_remaining:0,currency:"usd",unsupportedFinancialCounter:secret}));
  const result=projectControlledResponse({object:"list",data,has_more:false},{...context,producer:"listMerchantControlledInvoices",requestPath:"/v1/invoices"});
  expect(result.data).toHaveLength(70);expect(JSON.stringify(result)).not.toContain(secret);const metadata=z.object({unknownFinancialPathCount:z.number(),unknownFinancialPaths:z.array(z.object({path:z.string(),reason:z.string()}))}).parse(result[CONTROLLED_PROJECTION_KEY]);expect(metadata.unknownFinancialPathCount).toBe(70);expect(metadata.unknownFinancialPaths).toHaveLength(65);expect(metadata.unknownFinancialPaths.slice(0,64).every(row=>row.reason==="unsupported_financial_field")).toBe(true);expect(metadata.unknownFinancialPaths[64]).toEqual({path:"response",reason:"unknown_path_capacity_exceeded"});
 });
 it("rejects same-value clones, transplanted metadata, different request and attempted mutation",()=>{
  const result=projectControlledResponse(invoice(),context),clone:unknown=JSON.parse(JSON.stringify(result));
  expect(()=>authenticateControlledIngress(clone,context)).toThrow();expect(()=>authenticateControlledIngress({...invoice(),[CONTROLLED_PROJECTION_KEY]:result[CONTROLLED_PROJECTION_KEY]},context)).toThrow();
  expect(()=>authenticateControlledIngress(result,{...context,binding:{...context.binding,callId:"44444444-4444-4444-8444-444444444444"}})).toThrow();
  expect(Object.isFrozen(result)).toBe(true);expect(Reflect.set(result,"amount_paid",0)).toBe(false);expect(authenticateControlledIngress(result,context).amount_paid).toBe(4200);
 });
 it("omits hostile/mismatched list URLs instead of inventing a replacement",()=>{
  for(const url of ["https://stripe.invalid/v1/invoices?email="+secret,"/v1/invoices?secret="+secret,"/v1/invoices/foreign/lines","/v1/invoices#"+secret]){
   const result=projectControlledResponse({object:"list",data:[],has_more:false,url},{...context,requestPath:"/v1/invoices"});expect(result).not.toHaveProperty("url");expect(JSON.stringify(result)).not.toContain(secret);expect(controlledProjectionHasUnknown(result)).toBe(true);
  }
  const missing=projectControlledResponse({object:"list",data:[],has_more:false},{...context,requestPath:"/v1/invoices"});expect(missing).not.toHaveProperty("url");
 });
 it("retains a genuine canonical Unicode product name only in the original product purpose",()=>{
  const productContext:ControlledIngressContext={...context,producer:"createMerchantControlledTaxProduct",method:"POST",requestPath:"/v1/products",publicProduct:{name:"Taxe déclarée — été",component:"merchant_declared_tax_collection",creatorOperationId:context.binding.operationId,creatorRequestDigest:context.binding.requestDigest,platformAccountId:"acct_original"}};
  const raw={id:"prod_original",object:"product",name:productContext.publicProduct?.name,active:true,metadata:{freeholder_controlled_component:"merchant_declared_tax_collection",freeholder_controlled_product_operation_id:context.binding.operationId,freeholder_controlled_product_request_digest:context.binding.requestDigest,freeholder_platform_account_id:"acct_original"}};
  expect(projectControlledResponse(raw,productContext).name).toBe("Taxe déclarée — été");const wrong=projectControlledResponse({...raw,name:secret},productContext);expect(JSON.stringify(wrong)).not.toContain(secret);expect(controlledProjectionHasUnknown(wrong)).toBe(true);
 });
 it("authenticates the actual API response before callback/cache and refuses a copied marker",async()=>{
  await withControlledSafeResponseSession(context.binding,async()=>{
   const api=controlledSafeResponseApi(async()=>invoice());
   const factory=controlledSafeResponseFactory({inspectMerchantControlledInvoice:async(request:{onObserved:(actual:unknown)=>Promise<void>})=>{const raw=await api(context.requestPath,{method:"GET"},{});await request.onObserved({kind:"invoice_read",raw});return{actualInvoice:raw};}});
   let actual:unknown;const result=await factory.inspectMerchantControlledInvoice({onObserved:async(value)=>{actual=value;}});
   expect(actual).toMatchObject({kind:"invoice_read",raw:{amount_paid:4200}});expect(JSON.stringify(result)).not.toContain(secret);expect(result).not.toHaveProperty(CONTROLLED_PROJECTION_KEY);
   const owned=controlledSafeOwnedSnapshot(result);expect(Object.isFrozen(owned)).toBe(true);expect(owned).toHaveProperty(CONTROLLED_PROJECTION_KEY);expect(()=>controlledSafeOwnedSnapshot(JSON.parse(JSON.stringify(result)))).toThrow();
  });
 });
 it("keeps producer metadata out of financial equality without changing legacy bytes",()=>{
  const first={...invoice(),[CONTROLLED_PROJECTION_KEY]:{context:"inspectMerchantControlledCalendar"}},second={...invoice(),[CONTROLLED_PROJECTION_KEY]:{context:"previewMerchantControlledProration"}};
  expect(controlledSubscriptionFactsDigest(first)).toBe(controlledSubscriptionFactsDigest(second));
  const data=controlledCurrentResultData(first);expect(data).not.toHaveProperty(CONTROLLED_PROJECTION_KEY);expect(first).toHaveProperty(CONTROLLED_PROJECTION_KEY);expect(data.amount_paid).toBe(4200);
  const legacy=(value:unknown):string=>Array.isArray(value)?`[${value.map(legacy).join(",")}]`:value&&typeof value==="object"?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${legacy(item)}`).join(",")}}`:JSON.stringify(value)??"null";
  expect(controlledSubscriptionFactsDigest(invoice())).toBe(createHash("sha256").update(legacy(invoice())).digest("hex"));
  expect(controlledSubscriptionFactsDigest({...first,amount_paid:4199})).not.toBe(controlledSubscriptionFactsDigest(first));
 });
});
