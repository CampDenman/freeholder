// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN pure projections; no inspection/caller/DB authenticity claim.
import { describe,expect,it } from "vitest";
import { controlledCashBankApplicationEvidence,type ControlledCashBankExpectation } from "@/modules/invoicing/controlled-cash-application-bank-policy";
import type { MerchantReturnedCashEvidence } from "@/modules/invoicing/merchant-returned-cash-proof";
function vector(destination=false){
 const expected:ControlledCashBankExpectation={providerApiVersion:"2026-10-28.endive",providerPlatformAccountId:"acct_originalPlatform",...(destination?{destinationAccountId:"acct_originalSeller",settlementMerchantAccountId:"acct_originalSeller"}:{providerAccountId:"acct_originalSeller"}),
  providerRef:"pi_original",chargeRef:"ch_original",amountMinor:1000,currency:"CAD",feeMinor:50,originalFeeRef:"fee_original",customerChargeVerified:true,merchantRouteVerified:true};
 const bank:MerchantReturnedCashEvidence={providerPlatformAccountId:"acct_originalPlatform",chargeAccountId:destination?null:"acct_originalSeller",providerApiVersion:"2026-10-28.endive",paymentProviderRef:"pi_original",providerChargeRef:"ch_original",
  amountMinor:1000,currency:"CAD",paymentIntentStatus:"succeeded",amountCapturableMinor:0,chargePaymentProviderRef:"pi_original",chargeAmountMinor:1000,chargeCurrency:"CAD",paid:true,captured:true,refunded:false,amountRefundedMinor:0,
  refundsComplete:true,refunds:[],disputesComplete:true,disputes:[],feeFieldObserved:true,fee:{providerRef:"fee_original",originatingChargeRef:"ch_original",accountId:"acct_originalSeller",amountMinor:50,refundedMinor:0,currency:"CAD"},
  transferFieldObserved:true,transfer:destination?{providerRef:"tr_original",sourceChargeRef:"ch_original",destinationAccountId:"acct_originalSeller",amountMinor:1000,reversedMinor:0,reversed:false,currency:"CAD"}:null};
 return{expected,bank};
}
describe("genuine-source/current-bank prospective observation policy",()=>{
 it.each([false,true])("derives settlement only from original route proof plus exact current fee/recipient fields; destination=%s",destination=>{
  const v=vector(destination),before=JSON.stringify(v),actual=controlledCashBankApplicationEvidence(v.expected,v.bank);
  expect(actual).toMatchObject({providerRef:"pi_original",providerChargeRef:"ch_original",amountMinor:1000,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:true,merchantSettlementVerified:true,
   applicationFeeRef:"fee_original",observedApplicationFeeMinor:50,observedFeeRefundedMinor:0});expect(JSON.stringify(v)).toBe(before);
 });
 it("requires actual observed null fee to prove a legitimate frozen zero fee",()=>{
  const v=vector();v.expected.feeMinor=0;v.expected.originalFeeRef=null;v.bank.fee=null;
  expect(controlledCashBankApplicationEvidence(v.expected,v.bank)).toMatchObject({applicationFeeMinor:0,observedApplicationFeeMinor:0,merchantSettlementVerified:true});
  v.bank.feeFieldObserved=false;expect(controlledCashBankApplicationEvidence(v.expected,v.bank)).toBeNull();
 });
 it.each(["customerChargeVerified","merchantRouteVerified"] as const)("does not promote neutral inspection flags or an unverified original %s into proof",field=>{
  const v=vector();v.expected[field]=false;expect(controlledCashBankApplicationEvidence(v.expected,v.bank)).toBeNull();
 });
 it.each(["pending","requires_action","succeeded"] as const)("retains actual %s refunds rather than applying the original gross receipt",status=>{
  const v=vector();v.bank.refunds=[{providerRef:"re_original",paymentProviderRef:"pi_original",chargeRef:"ch_original",amountMinor:1,currency:"CAD",status}];
  if(status==="succeeded"){v.bank.amountRefundedMinor=1;v.bank.refunded=true;}
  expect(controlledCashBankApplicationEvidence(v.expected,v.bank)).toBeNull();
 });
 it.each(["failed","canceled"] as const)("retains the actual %s refund fact without inventing returned cash",status=>{
  const v=vector();v.bank.refunds=[{providerRef:"re_original",paymentProviderRef:"pi_original",chargeRef:"ch_original",amountMinor:1,currency:"CAD",status}];
  expect(controlledCashBankApplicationEvidence(v.expected,v.bank)?.amountMinor).toBe(1000);expect(v.bank.refunds).toHaveLength(1);
 });
 it.each(["foreign-platform","foreign-account","foreign-charge","foreign-fee-owner","wrong-fee","fee-currency","fee-returned","missing-fee-field","missing-transfer-field","incomplete-refunds","incomplete-disputes","open-dispute"] as const)("refuses %s with the same nominal principal",kind=>{
  const v=vector();
  if(kind==="foreign-platform")v.bank.providerPlatformAccountId="acct_foreign";
  if(kind==="foreign-account")v.bank.chargeAccountId="acct_foreign";
  if(kind==="foreign-charge")v.bank.providerChargeRef="ch_foreign";
  if(kind==="foreign-fee-owner")v.bank.fee!.accountId="acct_foreign";
  if(kind==="wrong-fee")v.bank.fee!.amountMinor=49;
  if(kind==="fee-currency")v.bank.fee!.currency="USD";
  if(kind==="fee-returned")v.bank.fee!.refundedMinor=1;
  if(kind==="missing-fee-field")v.bank.feeFieldObserved=false;
  if(kind==="missing-transfer-field")v.bank.transferFieldObserved=false;
  if(kind==="incomplete-refunds")v.bank.refundsComplete=false;
  if(kind==="incomplete-disputes")v.bank.disputesComplete=false;
  if(kind==="open-dispute")v.bank.disputes=[{providerRef:"du_original",chargeRef:"ch_original",status:"needs_response"}];
  expect(controlledCashBankApplicationEvidence(v.expected,v.bank)).toBeNull();
 });
 it.each(["foreign-recipient","wrong-principal","reversed","unknown-reversal","foreign-transfer-currency","foreign-source-charge"] as const)("refuses destination %s without guessing net cash or FX",kind=>{
  const v=vector(true);
  if(kind==="foreign-recipient")v.bank.transfer!.destinationAccountId="acct_foreign";
  if(kind==="wrong-principal")v.bank.transfer!.amountMinor=950;
  if(kind==="reversed")v.bank.transfer!.reversedMinor=1;
  if(kind==="unknown-reversal")v.bank.transfer!.reversed=null;
  if(kind==="foreign-transfer-currency")v.bank.transfer!.currency="USD";
  if(kind==="foreign-source-charge")v.bank.transfer!.sourceChargeRef="ch_foreign";
  expect(controlledCashBankApplicationEvidence(v.expected,v.bank)).toBeNull();
 });
});
