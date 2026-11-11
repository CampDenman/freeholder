// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C11.10: a signed setup session must resolve its actual saved method.
import {createHmac} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createStripePayments} from "@/adapters/payments/stripe";

const at=1_700_000_100;
const contactId="20000000-0000-4000-8000-000000000002";
const subscriptionId="30000000-0000-4000-8000-000000000003";
const metadata={freeholder_contact_id:contactId,freeholder_subscription_id:subscriptionId};
const session={id:"cs_saved",mode:"setup",payment_status:"no_payment_required",customer:"cus_saved",metadata,setup_intent:"seti_saved"};
const method={id:"pm_saved",type:"card",customer:"cus_saved",card:{brand:"visa",last4:"4242",exp_month:12,exp_year:2030}};
const intent={id:"seti_saved",status:"succeeded",usage:"off_session",customer:"cus_saved",metadata,payment_method:method,client_secret:"synthetic-do-not-return"};
function requestUrl(input:string|URL|Request):string{return typeof input==="string" ? input : input instanceof URL ? input.href : input.url;}
function signed(value:Record<string,unknown>=session,account:unknown="acct_original",valid=true){
  const raw=JSON.stringify({id:"evt_saved",type:"checkout.session.completed",created:at,account,data:{object:value}});
  const signature=createHmac("sha256","whsec_test_only").update(`${at}.${raw}`).digest("hex");
  return {headers:{"stripe-signature":`t=${at},v1=${valid ? signature : "0".repeat(64)}`},body:Uint8Array.from(Buffer.from(raw)),receivedAt:new Date(at*1000).toISOString()};
}
function provider(response:Record<string,unknown>=intent,status=200){
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response),{status}));
  const adapter=createStripePayments({secretKey:"sk_test_only",webhookSecrets:["whsec_test_only"],apiBase:"https://stripe.example.test",fetch:fetcher});
  return {adapter,fetcher};
}

describe("Stripe setup evidence (C12.38/C11.10)",()=>{
  it("resolves an unexpanded SetupIntent on the signed original account without recording money",async()=>{
    const {adapter,fetcher}=provider();
    const events=await adapter.verifyWebhook(signed());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url,options]=fetcher.mock.calls[0]!;
    expect(requestUrl(url)).toBe("https://stripe.example.test/v1/setup_intents/seti_saved?expand%5B%5D=payment_method");
    expect(options).toMatchObject({method:"GET",headers:{"stripe-account":"acct_original"}});
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({kind:"saved_method_added",contactId,providerAccountId:"acct_original",providerCustomerRef:"cus_saved",method:{providerRef:"pm_saved",providerCustomerRef:"cus_saved",last4:"4242"}});
    expect(events.some(event=>event.kind.startsWith("payment_"))).toBe(false);
    expect(JSON.stringify(events)).not.toContain("synthetic-do-not-return");
  });
  it.each([
    {id:"seti_other"},
    {status:"requires_action"},
    {usage:"on_session"},
    {customer:"cus_other"},
    {metadata:{...metadata,freeholder_subscription_id:"40000000-0000-4000-8000-000000000004"}},
    {payment_method:{...method,customer:"cus_other"}},
    {payment_method:"pm_saved"},
  ])("refuses mismatched or incomplete setup evidence %#",async patch=>{
    const {adapter}=provider({...intent,...patch});
    await expect(adapter.verifyWebhook(signed())).rejects.toMatchObject({code:"provider_failure"});
  });
  it("never retrieves evidence before raw signature and account validation",async()=>{
    const {adapter,fetcher}=provider();
    await expect(adapter.verifyWebhook(signed(session,"acct_original",false))).rejects.toMatchObject({code:"authentication"});
    await expect(adapter.verifyWebhook(signed(session,"other-account"))).rejects.toMatchObject({code:"invalid_request"});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("ignores contact-only setup metadata even when the signed payload expands a payment method",async()=>{
    const {adapter,fetcher}=provider();
    expect(await adapter.verifyWebhook(signed({...session,metadata:{freeholder_contact_id:contactId},setup_intent:{...intent,payment_method:method}}))).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("ignores unrelated setup sessions and preserves retryable provider failures",async()=>{
    const {adapter,fetcher}=provider({error:{message:"synthetic temporary outage"}},503);
    expect(await adapter.verifyWebhook(signed({...session,metadata:{}}))).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(adapter.verifyWebhook(signed())).rejects.toMatchObject({code:"provider_failure"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
