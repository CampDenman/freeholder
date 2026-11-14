// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual cryptographic envelopes; no native money/IO claim.
import {describe,expect,it} from "vitest";
import type {merchantFeeRefundInvocations} from "@/modules/invoicing/merchant-fee-invocation-schema";
import {merchantFeeInvocationCallerClosed,signMerchantFeeInvocation,signMerchantFeeInvocationProof,verifiedMerchantFeeInvocation,verifiedMerchantFeePreflight} from "@/modules/invoicing/merchant-fee-invocation-proof";
type Row=typeof merchantFeeRefundInvocations.$inferSelect;
const key="fictional-original-fee-evidence-key";
function admission():Row{
 const body={id:"00000000-0000-4000-8000-000000000001",paymentId:"00000000-0000-4000-8000-000000000006",originalChargeReceiptId:"00000000-0000-4000-8000-000000000007",namespaceKey:"acct_platform::pi_original",feeOperationId:"00000000-0000-4000-8000-000000000002",ordinal:1,kind:"post" as const,feeOperationFingerprint:"a".repeat(64),request:{paymentId:"00000000-0000-4000-8000-000000000006",originalChargeReceiptId:"00000000-0000-4000-8000-000000000007",providerRef:"pi_original",applicationFeeRef:"fee_original",amountMinor:1,currency:"CAD",providerPlatformAccountId:"acct_platform",recipientAccountId:"acct_original"},
  caller:{id:"00000000-0000-4000-8000-000000000003",pid:123,host:"fixture",startedAt:"2026-11-14T00:00:00.000Z",bootId:"actual-fixture-boot",pidNamespace:"actual-fixture-namespace",startTicks:"123"},nonceHash:"b".repeat(64),firstResult:null,finish:null,stop:null,createdAt:new Date("2026-11-14T00:00:00.000Z")};
 return{...body,...signMerchantFeeInvocation(body,key)};
}
function finish(row:Row,outcome:"returned"|"threw"){return signMerchantFeeInvocationProof(row,"finish",{invocationId:row.id,admissionDigest:row.digest,callerInstanceId:row.caller.id,outcome,firstResultDigest:row.firstResult?.digest??null,returnedResult:null,postDispatchReleased:row.kind==="post"?outcome==="returned":null,finishedAt:"2026-11-14T00:00:01.000Z"},key);}
describe("genuine original fee invocation signatures",()=>{
 it("refuses authentic but malformed JSON namespace atoms instead of implicit string coercion",()=>{
  const row=admission();
  for(const[field,value,namespaceKey]of [["providerPlatformAccountId",42,"42::pi_original"],["providerAccountId",{},"acct_platform:[object Object]:pi_original"],["providerRef",["pi_original"],"acct_platform::pi_original"]]as const){
   const body={...row,request:{...row.request,[field]:value},namespaceKey};
   expect(verifiedMerchantFeeInvocation({...body,...signMerchantFeeInvocation(body,key)},[key])).toBe(false);
  }
 });
 it("authenticates the exact original fee/PI/account/body and leaves an admitted caller open",()=>{
  const row=admission();expect(verifiedMerchantFeeInvocation(row,["rotated",key])).toBe(true);expect(merchantFeeInvocationCallerClosed(row,[key])).toBe(false);
  for(const changed of [{...row,paymentId:"00000000-0000-4000-8000-000000000008"},{...row,originalChargeReceiptId:"00000000-0000-4000-8000-000000000008"},{...row,namespaceKey:"acct_other::pi_original"},{...row,feeOperationId:"00000000-0000-4000-8000-000000000004"},{...row,feeOperationFingerprint:"c".repeat(64)},{...row,request:{...row.request,providerRef:"pi_other"}},{...row,request:{...row.request,recipientAccountId:"acct_other"}},{...row,nonceHash:"d".repeat(64)}])expect(verifiedMerchantFeeInvocation(changed,[key])).toBe(false);
 });
 it("authenticates a real readonly probe without inventing a fee operation or releasing its unfinished caller",()=>{
  const original=admission();const body={...original,kind:"source_inspect" as const,feeOperationId:null,feeOperationFingerprint:null,request:{...original.request,readKind:"payment_source",parentFeeInvocationId:null,amountMinor:null}};
  const probe:Row={...body,...signMerchantFeeInvocation(body,key)};expect(verifiedMerchantFeeInvocation(probe,[key])).toBe(true);expect(merchantFeeInvocationCallerClosed(probe,[key])).toBe(false);
  expect(verifiedMerchantFeeInvocation({...probe,feeOperationId:original.feeOperationId},[key])).toBe(false);
  const foreign={...probe,originalChargeReceiptId:"00000000-0000-4000-8000-000000000008"};expect(verifiedMerchantFeeInvocation({...foreign,...signMerchantFeeInvocation(foreign,key)},[key])).toBe(false);
  probe.finish=finish(probe,"returned");expect(merchantFeeInvocationCallerClosed(probe,[key])).toBe(true);
 });
 it("binds one real fee preparation child to its exact nonrecursive parent header and separate PostgreSQL birth fingerprint",()=>{
  const parent=admission(),body={...parent,id:"00000000-0000-4000-8000-000000000009",ordinal:2,kind:"source_inspect" as const,feeOperationId:null,feeOperationFingerprint:null,nonceHash:"e".repeat(64),
   request:{...parent.request,readKind:"fee_preflight",parentFeeInvocationId:parent.id,parentAdmissionDigest:parent.digest,parentAdmissionFingerprint:"f".repeat(64),amountMinor:null}};
  const child:Row={...body,...signMerchantFeeInvocation(body,key)};
  expect(verifiedMerchantFeePreflight(child,parent,[key],"f".repeat(64))).toBe(true);
  expect(verifiedMerchantFeePreflight(child,parent,[key],"a".repeat(64))).toBe(false);
  const reused={...child,nonceHash:parent.nonceHash};expect(verifiedMerchantFeePreflight({...reused,...signMerchantFeeInvocation(reused,key)},parent,[key],"f".repeat(64))).toBe(false);
  const recursive={...parent,kind:"source_inspect" as const,feeOperationId:null,feeOperationFingerprint:null,request:{...parent.request,readKind:"payment_source",parentFeeInvocationId:null,amountMinor:null}};
  expect(verifiedMerchantFeePreflight(child,{...recursive,...signMerchantFeeInvocation(recursive,key)},[key],"f".repeat(64))).toBe(false);
 });
 it("binds actual finish to the same holder and independently authenticates the first actual result",()=>{
  const row=admission();row.firstResult=signMerchantFeeInvocationProof(row,"first_result",{invocationId:row.id,admissionDigest:row.digest,callerInstanceId:row.caller.id,result:{providerRef:"fr_original",applicationFeeRef:"fee_original",amountMinor:1,currency:"CAD"}},key);row.finish=finish(row,"returned");
  expect(merchantFeeInvocationCallerClosed(row,[key])).toBe(true);
  expect(verifiedMerchantFeeInvocation({...row,firstResult:{...row.firstResult,body:{...row.firstResult.body,result:{providerRef:"fr_foreign"}}}},[key])).toBe(false);
  expect(verifiedMerchantFeeInvocation({...row,caller:{...row.caller,id:"00000000-0000-4000-8000-000000000004"}},[key])).toBe(false);
 });
 it("retains thrown caller closure without turning it into a successful bank result",()=>{
  const row=admission();row.finish=finish(row,"threw");expect(merchantFeeInvocationCallerClosed(row,[key])).toBe(true);expect(row.firstResult).toBeNull();expect(row.finish.body.outcome).toBe("threw");
 });
 it("accepts independently signed absent-process closure but refuses a time/live/unknown waiver and conflicting finish",()=>{
  const row=admission();const body={invocationId:row.id,admissionDigest:row.digest,callerInstanceId:row.caller.id,admissionFingerprint:"e".repeat(64),mechanicalCheck:"absent",reviewedBy:"user:00000000-0000-4000-8000-000000000005",reviewRevision:"f".repeat(64),hostingEvidenceDigest:"a".repeat(64),reviewedAt:"2026-11-14T00:00:02.000Z"};
  row.stop=signMerchantFeeInvocationProof(row,"stop",body,key);expect(merchantFeeInvocationCallerClosed(row,[key])).toBe(true);expect(row.firstResult).toBeNull();
  for(const mechanicalCheck of ["live","unobservable","old","timeout"])expect(verifiedMerchantFeeInvocation({...row,stop:signMerchantFeeInvocationProof(row,"stop",{...body,mechanicalCheck},key)},[key])).toBe(false);
  expect(verifiedMerchantFeeInvocation({...row,finish:finish(row,"returned")},[key])).toBe(false);
 });
});
