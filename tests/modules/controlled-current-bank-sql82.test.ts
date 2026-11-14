// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN SQL policy controls. Mock JSON is NOT a retained bank receipt.
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { hasDatabase,closeDb } from "../helpers/spine";
function vector(destination=false){
 const expected:Record<string,unknown>={providerApiVersion:"2026-10-28.endive",providerPlatformAccountId:"acct_originalPlatform",providerAccountId:destination?null:"acct_originalSeller",
  destinationAccountId:destination?"acct_originalSeller":null,settlementMerchantAccountId:destination?"acct_originalSeller":null,
  providerRef:"pi_original",chargeRef:"ch_original",amountMinor:1000,currency:"CAD",feeMinor:50,originalFeeRef:"fee_original",customerChargeVerified:true,merchantRouteVerified:true};
 const observed:Record<string,unknown>={providerPlatformAccountId:"acct_originalPlatform",chargeAccountId:destination?null:"acct_originalSeller",providerApiVersion:"2026-10-28.endive",paymentProviderRef:"pi_original",providerChargeRef:"ch_original",
  amountMinor:1000,currency:"CAD",paymentIntentStatus:"succeeded",amountCapturableMinor:0,chargePaymentProviderRef:"pi_original",chargeAmountMinor:1000,chargeCurrency:"CAD",paid:true,captured:true,refunded:false,amountRefundedMinor:0,
  refundsComplete:true,refunds:[],disputesComplete:true,disputes:[],feeFieldObserved:true,fee:{providerRef:"fee_original",originatingChargeRef:"ch_original",accountId:"acct_originalSeller",amountMinor:50,refundedMinor:0,currency:"CAD"},
  transferFieldObserved:true,transfer:destination?{providerRef:"tr_original",sourceChargeRef:"ch_original",destinationAccountId:"acct_originalSeller",amountMinor:1000,reversedMinor:0,reversed:false,currency:"CAD"}:null};
 return{expected,observed};
}
async function evaluate(expected:Record<string,unknown>,observed:Record<string,unknown>){
 const[row]=await db().execute<{known:boolean}>(sql`select freeholder_controlled_bank_unreturned(${JSON.stringify(expected)}::jsonb,${JSON.stringify(observed)}::jsonb) as known`);return row?.known;
}
describe.runIf(hasDatabase)("actual SQL bank-state policy (not application/provider qualification)",()=>{
 beforeAll(ready,60000);afterAll(async()=>{await stopJobs();await closeDb();});
 it.each([false,true])("accepts the complete exact known original bank projection; destination=%s",async destination=>{
  const v=vector(destination);expect(await evaluate(v.expected,v.observed)).toBe(true);
 });
 it("preserves a legitimate one-cent partial capture with actual observed-null frozen zero fee",async()=>{
  const v=vector();v.expected.amountMinor=1;v.expected.feeMinor=0;v.expected.originalFeeRef=null;v.observed.amountMinor=1;v.observed.chargeAmountMinor=1;v.observed.fee=null;
  expect(await evaluate(v.expected,v.observed)).toBe(true);
 });
 it("preserves the exact safe-integer principal boundary without numeric coercion",async()=>{
  const v=vector();v.expected.amountMinor=Number.MAX_SAFE_INTEGER;v.expected.feeMinor=0;v.expected.originalFeeRef=null;v.observed.amountMinor=Number.MAX_SAFE_INTEGER;v.observed.chargeAmountMinor=Number.MAX_SAFE_INTEGER;v.observed.fee=null;
  expect(await evaluate(v.expected,v.observed)).toBe(true);
 });
 it.each(["failed","canceled"])("keeps actual %s refund inventory without inventing returned principal",async status=>{
  const v=vector();v.observed.refunds=[{providerRef:"pyr_original",paymentProviderRef:"pi_original",chargeRef:"ch_original",amountMinor:1,currency:"CAD",status}];
  expect(await evaluate(v.expected,v.observed)).toBe(true);
 });
 it.each(["providerPlatformAccountId","chargeAccountId","paymentProviderRef","providerChargeRef","chargePaymentProviderRef","currency","chargeCurrency"])("refuses a foreign %s despite the same nominal amount",async field=>{
  const v=vector();v.observed[field]="foreign";expect(await evaluate(v.expected,v.observed)).toBe(false);
 });
 it.each(["amountMinor","chargeAmountMinor","amountCapturableMinor","amountRefundedMinor"])("rejects quoted numeric %s instead of coercing raw money",async field=>{
  const v=vector();v.observed[field]=String(v.observed[field]);expect(await evaluate(v.expected,v.observed)).toBe(false);
 });
 it.each(["paid","captured","refunded","refundsComplete","disputesComplete","feeFieldObserved","transferFieldObserved"])("rejects quoted boolean %s instead of inventing proof",async field=>{
  const v=vector();v.observed[field]=String(v.observed[field]);expect(await evaluate(v.expected,v.observed)).toBe(false);
 });
 it.each(["pending","requires_action","succeeded",null])("does not waive an actual %s refund occurrence",async status=>{
  const v=vector();v.observed.refunds=[{providerRef:"re_original",paymentProviderRef:"pi_original",chargeRef:"ch_original",amountMinor:1,currency:"CAD",status}];
  expect(await evaluate(v.expected,v.observed)).toBe(false);
 });
 it("refuses duplicate failed refund IDs and incomplete inventories",async()=>{
  const v=vector(),refund={providerRef:"re_original",paymentProviderRef:"pi_original",chargeRef:"ch_original",amountMinor:1,currency:"CAD",status:"failed"};v.observed.refunds=[refund,refund];
  expect(await evaluate(v.expected,v.observed)).toBe(false);v.observed.refunds=[];v.observed.refundsComplete=false;expect(await evaluate(v.expected,v.observed)).toBe(false);
 });
 it("retains actual fee/recipient FX, reversal and owner disagreements",async()=>{
  const v=vector(true);v.observed.fee={providerRef:"fee_original",originatingChargeRef:"ch_original",accountId:"acct_foreign",amountMinor:50,refundedMinor:0,currency:"CAD"};
  expect(await evaluate(v.expected,v.observed)).toBe(false);v.observed.fee=vector(true).observed.fee;
  for(const change of[{destinationAccountId:"acct_foreign"},{currency:"USD"},{amountMinor:950},{reversedMinor:1},{reversed:null}]){
   v.observed.transfer={providerRef:"tr_original",sourceChargeRef:"ch_original",destinationAccountId:"acct_originalSeller",amountMinor:1000,reversedMinor:0,reversed:false,currency:"CAD",...change};
   expect(await evaluate(v.expected,v.observed)).toBe(false);
  }
 });
 it("refuses an open/foreign/duplicated dispute while retaining an actual won dispute",async()=>{
  const v=vector(),dispute={providerRef:"du_original",chargeRef:"ch_original",status:"won"};v.observed.disputes=[dispute];expect(await evaluate(v.expected,v.observed)).toBe(true);
  v.observed.disputes=[{...dispute,status:"needs_response"}];expect(await evaluate(v.expected,v.observed)).toBe(false);
  v.observed.disputes=[dispute,dispute];expect(await evaluate(v.expected,v.observed)).toBe(false);
 });
 it.each(["1000",0,-1,0.5,9007199254740992,null])("does not accept malformed original principal %s as authority",async amount=>{
  const v=vector();v.expected.amountMinor=amount;expect(await evaluate(v.expected,v.observed)).toBe(false);
 });
 it("cannot invent a controlled bank observation or eligible receipt for unknown real UUIDs",async()=>{
  const collection=randomUUID(),receipt=randomUUID();
  expect(await db().execute(sql`select * from freeholder_controlled_receipt_bank_observation(${collection}::uuid,${receipt}::uuid)`)).toHaveLength(0);
  const[row]=await db().execute<{known:boolean}>(sql`select freeholder_controlled_receipt_bank_unreturned(${collection}::uuid,${receipt}::uuid) as known`);expect(row?.known).toBe(false);
 });
});
