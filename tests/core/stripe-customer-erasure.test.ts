// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: actual account-scoped deletion or tombstone is required.
import {describe,expect,it,vi} from "vitest";
import {createStripePayments} from "@/adapters/payments/stripe";
const request={providerCustomerRef:"cus_original",providerAccountId:"acct_original",idempotencyKey:"privacy-customer:original-job"};
function provider(responses:unknown[]){
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>{
  const response=responses.shift();if(response===undefined)throw new Error("Unexpected provider I/O");
  return response instanceof Response?response:Response.json(response);
 });
 const adapter=createStripePayments({secretKey:"sk_erasure_fixture",webhookSecrets:["whsec_erasure_fixture"],apiBase:"https://stripe.example.test",fetch:fetcher});
 if(!adapter.eraseCustomer)throw new Error("Stripe must erase its merchant customer.");
 return {erase:adapter.eraseCustomer.bind(adapter),fetcher};
}
describe("Stripe customer erasure (C1.08/C12.38)",()=>{
 it("confirms the exact account customer before deleting and requires its actual acknowledgement",async()=>{
  const p=provider([{id:"cus_original"},{id:"cus_original",deleted:true}]);
  await p.erase(request);expect(p.fetcher).toHaveBeenCalledTimes(2);
  for(const [url,init] of p.fetcher.mock.calls){expect(typeof url==="string"?url:url instanceof URL?url.href:url.url).toBe("https://stripe.example.test/v1/customers/cus_original");expect(init).toMatchObject({headers:{"stripe-account":"acct_original"}});}
  expect(p.fetcher.mock.calls[0]![1]?.method).toBe("GET");
  expect(p.fetcher.mock.calls[1]![1]).toMatchObject({method:"DELETE",headers:{"idempotency-key":request.idempotencyKey}});
 });
 it("acknowledges an already deleted original customer without another DELETE",async()=>{
  const p=provider([{id:"cus_original",deleted:true}]);
  await p.erase(request);expect(p.fetcher).toHaveBeenCalledOnce();expect(p.fetcher.mock.calls[0]![1]?.method).toBe("GET");
 });
 it("refuses another customer's retrieved identity before deletion",async()=>{
  const p=provider([{id:"cus_other"}]);
  await expect(p.erase(request)).rejects.toMatchObject({code:"provider_failure"});expect(p.fetcher).toHaveBeenCalledOnce();
 });
 it.each([{id:"cus_other",deleted:true},{id:"cus_original",deleted:false},{id:"cus_original"},{}])("refuses an incomplete or mismatched deletion acknowledgement %#",async response=>{
  const p=provider([{id:"cus_original"},response]);
  await expect(p.erase(request)).rejects.toMatchObject({code:"provider_failure"});
 });
 it("keeps a provider outage unresolved and retries the same original deletion key",async()=>{
  const p=provider([{id:"cus_original"},new Response(JSON.stringify({error:{code:"temporary_failure"}}),{status:503}),{id:"cus_original"},{id:"cus_original",deleted:true}]);
  await expect(p.erase(request)).rejects.toMatchObject({code:"provider_failure",retryable:true});await p.erase(request);
  const keys=p.fetcher.mock.calls.filter(([,init])=>init?.method==="DELETE").map(([,init])=>new Headers(init?.headers).get("idempotency-key"));expect(keys).toEqual([request.idempotencyKey,request.idempotencyKey]);
 });
 it("never falls back to platform scope when the original connected account refuses access",async()=>{
  const p=provider([new Response(JSON.stringify({error:{code:"account_invalid"}}),{status:403})]);
  await expect(p.erase(request)).rejects.toMatchObject({code:"authentication"});expect(p.fetcher).toHaveBeenCalledOnce();expect(p.fetcher.mock.calls[0]![1]).toMatchObject({headers:{"stripe-account":"acct_original"}});
 });
 it("verifies a new resource's original platform before its customer read and deletion",async()=>{
  const p=provider([{id:"acct_platform"},{id:"cus_original"},{id:"acct_platform"},{id:"cus_original",deleted:true}]);
  await p.erase({...request,providerPlatformAccountId:"acct_platform"});
  expect(p.fetcher).toHaveBeenCalledTimes(4);
  expect(p.fetcher.mock.calls.map(([url])=>url)).toEqual(["https://stripe.example.test/v1/account","https://stripe.example.test/v1/customers/cus_original","https://stripe.example.test/v1/account","https://stripe.example.test/v1/customers/cus_original"]);
  for(const index of [0,2])expect(new Headers(p.fetcher.mock.calls[index]![1]?.headers).has("stripe-account")).toBe(false);
  for(const index of [1,3])expect(new Headers(p.fetcher.mock.calls[index]![1]?.headers).get("stripe-account")).toBe("acct_original");
 });
 it("refuses replacement platform credentials before touching a new scoped customer",async()=>{
  const p=provider([{id:"acct_replacement"}]);
  await expect(p.erase({...request,providerPlatformAccountId:"acct_platform"})).rejects.toMatchObject({code:"authentication"});
  expect(p.fetcher).toHaveBeenCalledOnce();expect(p.fetcher.mock.calls[0]![0]).toBe("https://stripe.example.test/v1/account");
 });
 it("keeps erasure pending if the platform changes between the original read and deletion",async()=>{
  const p=provider([{id:"acct_platform"},{id:"cus_original"},{id:"acct_replacement"}]);
  await expect(p.erase({...request,providerPlatformAccountId:"acct_platform"})).rejects.toMatchObject({code:"authentication"});
  expect(p.fetcher.mock.calls.some(([,init])=>init?.method==="DELETE")).toBe(false);
 });
 it.each(["../cus_other","acct_other","cus_"])("refuses invalid customer references before provider I/O: %s",async reference=>{
  const p=provider([]);await expect(p.erase({...request,providerCustomerRef:reference})).rejects.toMatchObject({code:"invalid_request"});expect(p.fetcher).not.toHaveBeenCalled();
 });
});
