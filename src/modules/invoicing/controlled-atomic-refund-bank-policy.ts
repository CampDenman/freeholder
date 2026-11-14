// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: exact current bank facts never discard a retained refund occurrence.
import {ServiceError} from "@/core/service";
import type {z} from "zod";
import type {merchantReturnedCashEvidenceSchema} from "./merchant-returned-cash-contract";
import {currentBankPrincipalMatches} from "./original-bank-principal-policy";
type Bank=z.infer<typeof merchantReturnedCashEvidenceSchema>;
export type AtomicRefundBankRequest={requestId:string;refundId:string;providerRef:string;amountMinor:number;currency:string;status:string;providerPlatformAccountId:string;chargeAccountId:string|null;providerApiVersion:string;originalPaymentRef:string;chargeRef:string};
export type AtomicRefundBankCapture={captureId:string;provenance:{kind:"same_state"}|{kind:"earlier_returned_inspection";inspectionId:string;admissionSequence:number;callerInstanceId:string}};
export type AtomicRefundBankObservation={id:string;requestId:string|null;claimedRequestId:string|null;bindingVerified:boolean;providerRef:string;providerPlatformAccountId:string;chargeAccountId:string|null;providerApiVersion:string|null;paymentProviderRef:string|null;providerChargeRef:string|null;amountMinor:number|null;currency:string|null;status:string|null;captures:AtomicRefundBankCapture[]};
function refuse():never{throw new ServiceError("conflict","Restore every exact original refund resource, current bank state and genuine capture/caller lineage; another amount, old success or detached contradictory occurrence cannot close this atomic fee target.");}
/** Pure consistency policy, not an authentication/authority constructor.
 * The ordinary reader verifies actual HMAC/PG/caller provenance first. */
export function controlledAtomicRefundBankPolicy(input:{payment:{id:string;providerRef:string;chargeRef:string;platform:string;account:string|null;apiVersion:string;amountMinor:number;refundedMinor:number;currency:string};
 bank:Bank;requests:AtomicRefundBankRequest[];observations:AtomicRefundBankObservation[];latest:{inspectionId:string;admissionSequence:number;closedInspectionIds:readonly string[]}}){
 const p=input.payment,b=input.bank;
 if(![p.amountMinor,p.refundedMinor].every(Number.isSafeInteger)||p.amountMinor<=0||p.refundedMinor<0||p.refundedMinor>p.amountMinor||input.requests.length+input.observations.length>5000
  ||!Number.isSafeInteger(input.latest.admissionSequence)||input.latest.admissionSequence<=0||new Set(input.requests.map(row=>row.requestId)).size!==input.requests.length
  ||new Set(input.requests.map(row=>row.refundId)).size!==input.requests.length||new Set(input.requests.map(row=>row.providerRef)).size!==input.requests.length||new Set(input.observations.map(row=>row.id)).size!==input.observations.length)refuse();
 if(!currentBankPrincipalMatches({amountMinor:p.amountMinor,currency:p.currency,refundedMinor:p.refundedMinor,apiVersion:p.apiVersion,platform:p.platform,account:p.account,paymentRef:p.providerRef,chargeRef:p.chargeRef},b)
  ||b.refunded!==(p.refundedMinor===p.amountMinor))refuse();
 const refs=new Set<string>();let returned=0n;
 for(const resource of b.refunds){
  if(refs.has(resource.providerRef)||resource.paymentProviderRef!==p.providerRef||resource.chargeRef!==p.chargeRef||resource.currency!==p.currency||resource.amountMinor===null
   ||!Number.isSafeInteger(resource.amountMinor)||resource.amountMinor<=0||!["succeeded","failed","canceled"].includes(resource.status??""))refuse();refs.add(resource.providerRef);
  const request=input.requests.find(row=>row.providerRef===resource.providerRef);if(!request||request.amountMinor!==resource.amountMinor||request.currency!==resource.currency||request.originalPaymentRef!==p.providerRef
   ||request.providerPlatformAccountId!==p.platform||request.chargeAccountId!==p.account||request.providerApiVersion!==p.apiVersion||request.chargeRef!==p.chargeRef
   ||request.status!==(resource.status==="succeeded"?"succeeded":"failed")&&!(request.status==="cancelled"&&resource.status==="canceled"))refuse();
  if(resource.status==="succeeded")returned+=BigInt(resource.amountMinor);
 }
 if(returned!==BigInt(p.refundedMinor)||input.requests.some(row=>!refs.has(row.providerRef)))refuse();
 const captures=new Set<string>();
 for(const observation of input.observations){
  const resource=b.refunds.find(row=>row.providerRef===observation.providerRef),request=input.requests.find(row=>row.providerRef===observation.providerRef);
  if(!resource||!request||observation.providerPlatformAccountId!==p.platform||observation.chargeAccountId!==p.account||observation.providerApiVersion!==p.apiVersion
   ||observation.paymentProviderRef!==null&&observation.paymentProviderRef!==p.providerRef||observation.providerChargeRef!==null&&observation.providerChargeRef!==p.chargeRef
   ||observation.amountMinor!==resource.amountMinor||observation.currency!==resource.currency
   ||observation.requestId!==null&&observation.requestId!==request.requestId&&!(observation.bindingVerified===false&&observation.claimedRequestId===observation.requestId)
   ||!observation.captures.length)refuse();
  for(const capture of observation.captures){
   if(!capture.captureId||captures.has(capture.captureId))refuse();captures.add(capture.captureId);
   if(observation.status===resource.status){if(capture.provenance.kind!=="same_state")refuse();continue;}
   const proof=capture.provenance;
   if(proof.kind!=="earlier_returned_inspection"||!Number.isSafeInteger(proof.admissionSequence)||proof.admissionSequence<=0||proof.admissionSequence>=input.latest.admissionSequence
    ||proof.inspectionId===input.latest.inspectionId||!input.latest.closedInspectionIds.includes(proof.inspectionId)||!proof.callerInstanceId)refuse();
  }
 }
 if(input.requests.length+input.observations.length+captures.size>5000)refuse();
 for(const request of input.requests)if(!input.observations.some(row=>row.providerRef===request.providerRef&&row.requestId===request.requestId&&row.bindingVerified))refuse();
 return{returnedMinor:Number(returned),refundResourceRefs:[...refs].sort(),observationIds:input.observations.map(row=>row.id).sort(),captureIds:[...captures].sort()};
}
