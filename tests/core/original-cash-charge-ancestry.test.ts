// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: PREPARED / UNRUN pure and readonly SQL-adapter controls.
import { getTableName,type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe,expect,it } from "vitest";
import { env } from "@/core/env";
import type { Tx } from "@/core/service";
import { merchantPaymentObservations } from "@/modules/invoicing/merchant-collection-schema";
import { merchantAgreementPaymentRoutes } from "@/modules/invoicing/merchant-agreement-schema";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { originalChargeFeedbackAncestry,chargeOnlyFeedbackMatchesOriginal } from "@/modules/invoicing/original-cash-charge-ancestry";
import { originalCashFeedbackFinancialWitness } from "@/modules/invoicing/original-cash-feedback-witness";
import { legacyBankFeedback } from "@/modules/invoicing/legacy-bank-feedback-schema";
import { normalizeLegacyBankFeedback,signLegacyBankFeedback } from "@/modules/invoicing/legacy-bank-feedback-proof";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`,createdAt=new Date("2026-11-13T00:00:00.000Z"),sha="a".repeat(64);
function observation():typeof merchantPaymentObservations.$inferSelect{return{id:id(2),paymentId:id(1),providerEventRef:"evt_actual",providerApiVersion:"2026-10-28.endive",providerRef:"pi_original",status:"succeeded",amountMinor:1000,currency:"CAD",
 providerPlatformAccountId:"acct_originalPlatform",chargeAccountId:null,recipientAccountId:"acct_originalSeller",settlementMerchantAccountId:"acct_originalSeller",applicationFeeMinor:0,providerChargeRef:"ch_original",applicationFeeRef:null,transferRef:"tr_original",
 routeVerified:true,customerChargeVerified:true,applicationFeeCurrency:"CAD",observedApplicationFeeMinor:0,observedFeeRefundedMinor:0,settlementVerified:false,observedAt:createdAt};}
function receipt():typeof subscriptionProviderChargeReceipts.$inferSelect{return{id:id(3),subscriptionId:id(4),providerPlatformAccountId:"acct_originalPlatform",chargeAccountId:null,providerSubscriptionRef:"sub_original",providerApiVersion:"2026-10-28.endive",providerInvoiceRef:"in_original",
 providerPaymentIntentRef:"pi_original",providerChargeRef:"ch_original",amountMinor:1000,currency:"CAD",applicationFeeRef:null,observedApplicationFeeMinor:0,observedApplicationFeeCurrency:"CAD",actualDestinationAccountId:"acct_originalSeller",actualSettlementMerchantAccountId:"acct_originalSeller",merchantRouteVerified:true,customerChargeVerified:true,createdAt};}
function route():typeof merchantAgreementPaymentRoutes.$inferSelect{return{paymentId:id(1),subscriptionId:id(4),agreementRoutingVersion:1,collectionKind:"destination",providerPlatformAccountId:"acct_originalPlatform",chargeAccountId:null,recipientAccountId:"acct_originalSeller",settlementMerchantAccountId:"acct_originalSeller",applicationFeeMinor:0,
 providerApiVersion:"2026-10-28.endive",originKind:"provider_schedule",providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",providerPaymentIntentRef:"pi_original",providerChargeRef:"ch_original",originalChargeReceiptId:id(3),createdAt};}
function feedback(intent:string|null=null):typeof legacyBankFeedback.$inferSelect{
 const evidence=normalizeLegacyBankFeedback({id:"evt_charge_only",kind:"refund_succeeded",providerRef:"re_original",paymentProviderRef:intent??"ch_original",observedPaymentIntentRef:intent,providerChargeRef:"ch_original",providerPlatformAccountId:"acct_originalPlatform",providerAccountId:null,
  observedProviderApiVersion:"2026-10-28.endive",providerStatus:"succeeded",rawProviderStatus:"succeeded",amountMinor:333,currency:"CAD",occurredAt:createdAt.toISOString()},{rawBodySha256:sha,receivedAt:createdAt.toISOString()});
 const row={id:id(5),captureKey:sha,evidenceDigest:merchantTaxDigest(evidence),createdAt},key=env().CREDENTIAL_KEY??env().SESSION_SECRET;
 if(!key)throw new Error("The test's original feedback signing key is missing.");return{...row,evidence,authentication:signLegacyBankFeedback(row,key)};
}
type Data={positive?:ReturnType<typeof observation>[];receipts?:ReturnType<typeof receipt>[];routes?:ReturnType<typeof route>[];feedback?:ReturnType<typeof feedback>[]};
function driver(data:Data){
 const dialect=new PgDialect(),queries:Array<{table:string;query:string;params:unknown[]}>=[];
 const tx={select:()=>{let table="",predicate="",params:unknown[]=[];const chain={
  from:(source:Parameters<typeof getTableName>[0])=>{table=getTableName(source);return chain;},innerJoin:()=>chain,where:(condition:SQL)=>{const compiled=dialect.sqlToQuery(condition);predicate=compiled.sql;params=compiled.params;return chain;},orderBy:()=>chain,
  limit:async(count:number)=>{expect(count).toBe(5001);queries.push({table,query:predicate,params});
   if(table==="merchant_payment_observations"){
    expect(predicate).toContain('"status" =');expect(predicate).toContain('"amount_minor">0');expect(params).not.toContain(333);expect(params).not.toContain(1000);
    if(predicate.includes('"payment_id" in'))return(data.positive??[]).filter(row=>params.includes(row.paymentId));
    expect(predicate).toContain('"provider_charge_ref" =');expect(predicate).toContain('"provider_platform_account_id" =');expect(predicate).toContain('"charge_account_id" is not distinct from');
    expect(params).toContain("ch_original");expect(params).toContain("acct_originalPlatform");return data.positive??[];
   }
   if(table==="subscription_provider_charge_receipts"){
    if(predicate.includes('"id" in'))return(data.receipts??[]).filter(row=>params.includes(row.id));
    expect(predicate).toContain('"provider_charge_ref" =');expect(predicate).toContain('"provider_platform_account_id" =');expect(predicate).toContain('"charge_account_id" is not distinct from');return data.receipts??[];
   }
   if(table==="merchant_agreement_payment_routes")return data.routes??[];
   if(table==="merchant_refund_resource_bindings"||table==="original_cash_recovery_facts")return[];
   if(table==="legacy_bank_feedback"){
    expect(predicate).toContain("'observedPaymentRef' is null");expect(predicate).toContain("'observedChargeRef' in");
    return(data.feedback??[]).filter(row=>row.evidence.observedPaymentRef!==null?params.includes(row.evidence.observedPaymentRef):row.evidence.observedChargeRef!==null&&params.includes(row.evidence.observedChargeRef));
   }
   throw new Error(`Unexpected original charge ancestry table ${table}`);
  }};return chain;}} as unknown as Tx;
 return{tx,queries};
}
describe("exact charge-only original financial feedback ancestry",()=>{
 it("matches only an absent PI plus the actual original charge/platform/account tuple",()=>{
  const evidence=feedback().evidence,source={platform:"acct_originalPlatform",account:null,chargeRef:"ch_original"};expect(chargeOnlyFeedbackMatchesOriginal(evidence,source)).toBe(true);
  for(const changed of [{...source,platform:"acct_foreign"},{...source,account:"acct_foreign"},{...source,chargeRef:"ch_foreign"}])expect(chargeOnlyFeedbackMatchesOriginal(evidence,changed)).toBe(false);
  expect(chargeOnlyFeedbackMatchesOriginal({...evidence,observedPaymentRef:"pi_contradictory"},source)).toBe(false);
 });
 it("discovers raw review before any owner/known refund ref while preserving the old namespace bytes",async()=>{
  const data={positive:[observation()],feedback:[feedback()]},mock=driver(data),entries=await originalCashFeedbackFinancialWitness(mock.tx,[id(1)],[]);
  expect(entries).toHaveLength(1);expect(entries[0]!.feedback).toEqual(data.feedback[0]);
  const original={paymentId:id(1),subscriptionChargeReceiptId:null,originalObservationIds:[id(2)],providerPlatformAccountId:"acct_originalPlatform",chargeAccountId:null,originalPaymentRef:"pi_original",providerApiVersion:"2026-10-28.endive",originalResourceRefs:[]};
  expect(JSON.stringify(entries[0]!.namespace)).toBe(JSON.stringify(original));
  const prior=await originalCashFeedbackFinancialWitness(driver({positive:[observation()],feedback:[feedback("pi_original")]}).tx,[id(1)],[]);
  expect(JSON.stringify(prior[0]!.namespace)).toBe(JSON.stringify(entries[0]!.namespace));expect(Object.keys(entries[0]!.namespace)).not.toContain("originalChargeRefs");
 });
 it("retains a real receipt-only namespace without manufacturing a canonical payment",async()=>{
  const actual=await originalChargeFeedbackAncestry(driver({receipts:[receipt()]}).tx,feedback().evidence);
  expect(actual?.candidates).toMatchObject([{paymentId:null,subscriptionChargeReceiptId:id(3),paymentRef:"pi_original"}]);expect(actual?.aliases).toEqual([]);
 });
 it("requires the actual receipt FK alias to collapse matching payment and receipt owners",async()=>{
  await expect(originalChargeFeedbackAncestry(driver({positive:[observation()],receipts:[receipt()]}).tx,feedback().evidence)).rejects.toMatchObject({code:"conflict"});
  const actual=await originalChargeFeedbackAncestry(driver({positive:[observation()],receipts:[receipt()],routes:[route()]}).tx,feedback().evidence);
  expect(actual?.aliases).toEqual([{paymentId:id(1),receiptId:id(3)}]);expect(actual?.identities).toHaveLength(3);
 });
 it("refuses a globally competing original payment even when the caller selects only one and amounts agree",async()=>{
  const positive=[observation(),{...observation(),id:id(6),paymentId:id(7)}];
  await expect(originalCashFeedbackFinancialWitness(driver({positive,feedback:[feedback()]}).tx,[id(1)],[])).rejects.toMatchObject({code:"conflict"});
 });
 it.each(["platform","account","charge","alias"] as const)("refuses foreign %s instead of selecting by amount",async kind=>{
  const data:Data={positive:[observation()]};if(kind==="platform")data.positive![0]!.providerPlatformAccountId="acct_foreign";
  if(kind==="account")data.positive![0]!.chargeAccountId="acct_foreign";if(kind==="charge")data.positive![0]!.providerChargeRef="ch_foreign";
  if(kind==="alias"){data.receipts=[receipt()];data.routes=[{...route(),providerChargeRef:"ch_foreign"}];}
  await expect(originalChargeFeedbackAncestry(driver(data).tx,feedback().evidence)).rejects.toMatchObject({code:"conflict"});
 });
 it("does not use a charge to replace a contradictory present PI or invent a missing platform",async()=>{
  const mock=driver({positive:[observation()]});expect(await originalChargeFeedbackAncestry(mock.tx,feedback("pi_contradictory").evidence)).toBeNull();
  expect(await originalChargeFeedbackAncestry(mock.tx,{...feedback().evidence,observedPlatformAccountId:null})).toBeNull();expect(mock.queries).toEqual([]);
 });
 it("rejects corrupt raw feedback authentication before deriving charge ownership",async()=>{
  const raw=feedback();raw.authentication="0".repeat(64);
  await expect(originalCashFeedbackFinancialWitness(driver({positive:[observation()],feedback:[raw]}).tx,[id(1)],[])).rejects.toMatchObject({code:"conflict"});
 });
 it("refuses a truncated global original-charge inventory",async()=>{
  const positive=Array.from({length:5001},(_,n)=>({...observation(),id:id(100+n)}));
  await expect(originalChargeFeedbackAncestry(driver({positive}).tx,feedback().evidence)).rejects.toMatchObject({code:"conflict"});
 });
});
