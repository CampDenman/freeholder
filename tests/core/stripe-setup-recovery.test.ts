// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C11.10: original-request customer creation and actual setup recovery.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MethodSetupRequest } from "@/adapters/payments/types";

const fetchUrl=(value:Parameters<typeof fetch>[0])=>new URL(typeof value==="string"?value:value instanceof URL?value.href:value.url);
function formBody(body:RequestInit["body"]):URLSearchParams{if(body instanceof URLSearchParams)return body;if(typeof body==="string")return new URLSearchParams(body);throw new Error("Expected the adapter’s actual form body");}
const at=Math.floor(Date.now()/1000);
const request:MethodSetupRequest={setupAttemptId:"50000000-0000-4000-8000-000000000005",subscriptionId:"30000000-0000-4000-8000-000000000003",contactId:"20000000-0000-4000-8000-000000000002",currency:"CAD",providerAccountId:"acct_original",customer:{email:"original-setup@example.test",name:"Original setup name"},successUrl:"https://shop.example.test/memberships/trial-return",cancelUrl:"https://shop.example.test/memberships",idempotencyKey:"trial-card:original-attempt"};
const metadata={freeholder_setup_attempt_id:request.setupAttemptId,freeholder_subscription_id:request.subscriptionId,freeholder_contact_id:request.contactId};
const session={id:"cs_original",mode:"setup",status:"open",currency:"cad",customer:"cus_original",metadata,created:at,expires_at:at+3600,url:"https://checkout.example.test/original",payment_status:"no_payment_required",setup_intent:"seti_original"};
const method={id:"pm_original",type:"card",customer:"cus_original",card:{brand:"visa",last4:"4242",exp_month:12,exp_year:2030}};
const intent={id:"seti_original",status:"succeeded",usage:"off_session",customer:"cus_original",metadata,created:at,payment_method:method,client_secret:"synthetic-never-return"};
const recovery={...request,providerCustomerRef:"cus_original",providerRef:"cs_original",createdAt:new Date((at-10)*1000).toISOString()};
function provider(respond:(url:URL,init?:RequestInit)=>unknown){
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
  const value=respond(url,init);
  return value instanceof Response?value:Response.json(value);
 });
 const adapter=createStripePayments({secretKey:"sk_setup_fixture",webhookSecrets:["whsec_setup_fixture"],apiBase:"https://stripe.example.test",fetch:fetcher});
 if(!adapter.createSetupCustomer||!adapter.createMethodSetup||!adapter.recoverMethodSetup)throw new Error("Stripe setup operations must exist.");
 return {adapter,fetcher,createCustomer:adapter.createSetupCustomer.bind(adapter),createSession:adapter.createMethodSetup.bind(adapter),recover:adapter.recoverMethodSetup.bind(adapter)};
}

describe("Stripe durable setup edges (C12.38/C11.10)",()=>{
 it("creates only the account-scoped customer before a separate exact setup Checkout request",async()=>{
  const p=provider(url=>url.pathname==="/v1/customers"?{id:"cus_original"}:session);
  expect(await p.createCustomer(request)).toEqual({providerCustomerRef:"cus_original",providerAccountId:"acct_original"});
  expect(p.fetcher).toHaveBeenCalledOnce();
  const customerCall=p.fetcher.mock.calls[0]![1]!;
  expect(customerCall).toMatchObject({method:"POST",headers:{"stripe-account":"acct_original","idempotency-key":`${request.idempotencyKey}:customer`}});
  const customerForm=formBody(customerCall.body);
  expect(customerForm.get("email")).toBe(request.customer.email);
  expect(customerForm.get("name")).toBe(request.customer.name);
  expect(customerForm.get("metadata[freeholder_setup_attempt_id]")).toBe(request.setupAttemptId);
  expect(customerForm.get("metadata[freeholder_subscription_id]")).toBe(request.subscriptionId);
  expect(customerForm.get("metadata[freeholder_contact_id]")).toBe(request.contactId);
  await p.createSession({...request,providerCustomerRef:"cus_original"});
  const call=p.fetcher.mock.calls[1]![1]!;
  expect(call).toMatchObject({method:"POST",headers:{"stripe-account":"acct_original","idempotency-key":request.idempotencyKey}});
  const form=formBody(call.body);
  expect(form.get("currency")).toBe("cad");expect(form.get("mode")).toBe("setup");expect(form.get("customer")).toBe("cus_original");
  expect(form.get("metadata[freeholder_setup_attempt_id]")).toBe(request.setupAttemptId);
  expect(form.get("setup_intent_data[metadata][freeholder_setup_attempt_id]")).toBe(request.setupAttemptId);
  expect(form.has("customer_creation")).toBe(false);expect(form.has("customer_email")).toBe(false);
  expect([...form.keys()].some(key=>key.includes("unit_amount"))).toBe(false);
 });
 it("refuses Checkout without a committed customer before any provider I/O",async()=>{
  const p=provider(()=>session);
  await expect(p.createSession(request)).rejects.toMatchObject({code:"invalid_request"});
  expect(p.fetcher).not.toHaveBeenCalled();
 });
 it.each([{},{id:"acct_wrong"},{id:42},{id:"cus_"}])("refuses malformed customer evidence %#",async response=>{
  const p=provider(()=>response);
  await expect(p.createCustomer(request)).rejects.toMatchObject({code:"provider_failure"});
 });
 it("refuses a Checkout response on a different customer",async()=>{
  const p=provider(()=>({...session,customer:"cus_other"}));
  await expect(p.createSession({...request,providerCustomerRef:"cus_original"})).rejects.toMatchObject({code:"provider_failure"});
 });
 it("recovers a lost customer by exact original metadata without relying on an unchanged email",async()=>{
  const p=provider(url=>{
   if(url.pathname==="/v1/customers"){
    expect(url.searchParams.has("email")).toBe(false);
    expect(url.searchParams.get("created[gte]")).toBe(String(at-130));
    return {has_more:false,data:[{id:"cus_unrelated",metadata:{}},{id:"cus_original",email:"changed-in-dashboard@example.test",metadata}]};
   }
   return {has_more:false,data:[session]};
  });
  expect(await p.recover({...request,createdAt:recovery.createdAt})).toMatchObject({state:"open",providerCustomerRef:"cus_original",providerRef:"cs_original",providerAccountId:"acct_original",url:session.url});
  for(const [,init] of p.fetcher.mock.calls)expect(init).toMatchObject({method:"GET",headers:{"stripe-account":"acct_original"}});
 });
 it("walks every bounded page while preserving an unresolved original provider outcome",async()=>{
  const p=provider(url=>url.searchParams.has("starting_after")?{has_more:false,data:[]}:{has_more:true,data:[{id:"cus_unrelated",metadata:{}}]});
  expect(await p.recover({...request,createdAt:recovery.createdAt})).toEqual({state:"unresolved",providerAccountId:"acct_original"});
  expect(p.fetcher).toHaveBeenCalledTimes(2);
  expect(fetchUrl(p.fetcher.mock.calls[1]![0]).searchParams.get("starting_after")).toBe("cus_unrelated");
 });
 it("recovers a committed customer with no Checkout without creating a second customer",async()=>{
  const p=provider(()=>({has_more:false,data:[]}));
  expect(await p.recover({...recovery,providerRef:undefined})).toEqual({state:"customer_only",providerCustomerRef:"cus_original",providerAccountId:"acct_original"});
  expect(p.fetcher).toHaveBeenCalledOnce();
  expect(fetchUrl(p.fetcher.mock.calls[0]![0]).href).toContain("customer=cus_original");
 });
 it("closes only an actually expired original setup without manufacturing card evidence",async()=>{
  const p=provider(()=>({...session,status:"expired",url:null}));
  expect(await p.recover(recovery)).toEqual({state:"expired",providerRef:"cs_original",providerCustomerRef:"cus_original",providerAccountId:"acct_original"});
  expect(p.fetcher).toHaveBeenCalledOnce();
 });
 it.each([
  {id:"cs_other"},{mode:"payment"},{currency:"usd"},{customer:"cus_other"},
  {metadata:{...metadata,freeholder_setup_attempt_id:"60000000-0000-4000-8000-000000000006"}},
  {metadata:{...metadata,freeholder_contact_id:"70000000-0000-4000-8000-000000000007"}},
  {status:"unknown"},{status:"open",expires_at:at-1},
 ])("refuses a mismatched or unproven recovered setup %#",async patch=>{
  const p=provider(()=>({...session,...patch}));
  await expect(p.recover(recovery)).rejects.toMatchObject({code:"provider_failure"});
 });
 it("retrieves the completed original SetupIntent and returns masked exact-attempt evidence",async()=>{
  const p=provider(url=>url.pathname.startsWith("/v1/setup_intents/")?intent:{...session,status:"complete"});
  const result=await p.recover(recovery);
  expect(result).toMatchObject({state:"complete",providerRef:"cs_original",providerCustomerRef:"cus_original",event:{kind:"saved_method_added",contactId:request.contactId,providerAccountId:"acct_original",setup:{attemptId:request.setupAttemptId,subscriptionId:request.subscriptionId,checkoutRef:"cs_original",setupIntentRef:"seti_original"},method:{providerRef:"pm_original",last4:"4242"},occurredAt:new Date(at*1000).toISOString()}});
  expect(p.fetcher).toHaveBeenCalledTimes(2);
  expect(p.fetcher.mock.calls[1]![1]).toMatchObject({method:"GET",headers:{"stripe-account":"acct_original"}});
  expect(JSON.stringify(result)).not.toContain(intent.client_secret);
  expect(result.event?.kind.startsWith("payment_")).toBe(false);
 });
 it("refuses incomplete intent recovery and duplicate matching provider resources",async()=>{
  const p=provider(url=>url.pathname.startsWith("/v1/setup_intents/")?{...intent,status:"requires_action"}:{...session,status:"complete"});
  await expect(p.recover(recovery)).rejects.toMatchObject({code:"provider_failure"});
  const duplicate=provider(()=>({has_more:false,data:[{id:"cus_one",metadata},{id:"cus_two",metadata}]}));
  await expect(duplicate.recover({...request,createdAt:recovery.createdAt})).rejects.toMatchObject({code:"provider_failure"});
 });
 it("refuses incomplete lookup pages and never turns a provider outage into absence",async()=>{
  const p=provider(()=>({data:[]}));
  await expect(p.recover({...request,createdAt:recovery.createdAt})).rejects.toMatchObject({code:"provider_failure"});
  const unavailable=provider(()=>new Response(JSON.stringify({error:{message:"Synthetic provider outage"}}),{status:503}));
  await expect(unavailable.recover({...request,createdAt:recovery.createdAt})).rejects.toMatchObject({code:"provider_failure"});
 });
 it("positively verifies an operator-supplied created Customer on its original account before accepting its binding",async()=>{
  const p=provider(url=>url.pathname==="/v1/customers/cus_original"?{id:"cus_original",metadata}:{has_more:false,data:[]});
  expect(await p.recover({...recovery,providerRef:undefined,verifyCustomerCreation:true})).toMatchObject({state:"customer_only",providerCustomerRef:"cus_original",providerAccountId:"acct_original"});
  expect(p.fetcher.mock.calls[0]![1]).toMatchObject({method:"GET",headers:{"stripe-account":"acct_original"}});
  expect(fetchUrl(p.fetcher.mock.calls[0]![0]).href).toContain("/v1/customers/cus_original");
 });
 it.each([
  {id:"cus_other",metadata},{id:"cus_original",metadata:{}},
  {id:"cus_original",metadata:{...metadata,freeholder_contact_id:"another-contact"}},
  {id:"cus_original",metadata:{...metadata,freeholder_setup_attempt_id:"another-attempt"}},
  {id:"cus_original",deleted:true},
 ])("refuses unbound operator-supplied Customer evidence %#",async value=>{
  const p=provider(()=>value);
  await expect(p.recover({...recovery,providerRef:undefined,verifyCustomerCreation:true})).rejects.toMatchObject({code:"provider_failure"});
  expect(p.fetcher).toHaveBeenCalledOnce();
 });

});
