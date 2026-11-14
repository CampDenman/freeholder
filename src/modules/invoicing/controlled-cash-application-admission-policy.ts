// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: conservation/identity checks, NEVER parent money authority.
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { controlledCollectionCashProof } from "@/modules/subscriptions/controlled-provider-collection-cash-contract";
import { controlledCashBankApplicationEvidence } from "./controlled-cash-application-bank-policy";
import { merchantTaxDigest } from "./merchant-tax-store";
import { controlledAtomicFeeAmounts } from "./controlled-cash-atomic-fee-amounts";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const controlledCashPhysicalSnapshot=z.object({entries:z.array(z.object({table:z.string().min(1),id:z.string().min(1),fingerprint:sha,hashDomain:z.literal("postgres_row")}).strict()).min(1).max(5000),revision:sha,physicalRowCount:z.number().int().min(1).max(5000)}).strict();
function refuse():never{throw new ServiceError("conflict","Restore the exact complete current parent/bank receipt batch, original cash/credit/fee capacity and actual earlier receipt prefix; keep every contradiction for review.");}
/** Pure consistency check of separately authenticated inputs. Neither the
 * structural DTO nor this result supplies current principal/privacy/caller
 * authority. The real parent MUST prove all debt and lock/recheck the full
 * current graph before signing/persisting a same-transaction admission.
 *
 * The full actual PG parent preimage contains each source bank row once. No
 * canonical JS digest is compared to a PG SHA, and a duplicate table+UUID with
 * a different SHA is a contradiction, never last-write-wins deduplication.
 */
export function controlledCashAdmissionPlan(rawProof:unknown,rawSnapshot:unknown){
 const proof=controlledCollectionCashProof.parse(rawProof),snapshot=controlledCashPhysicalSnapshot.parse(rawSnapshot);
 const physical=new Map<string,string>();
 for(const row of snapshot.entries){const key=`${row.table}:${row.id}`;if(physical.has(key))refuse();physical.set(key,row.fingerprint);}
 if(physical.size!==snapshot.physicalRowCount||proof.unfinishedControlledCallIds.length||proof.unfinishedInspectionIds.length||proof.unfinishedNamespaceCallers.length
  ||!proof.canonical.currentCollectible||proof.canonical.refundedMinor!==0||proof.canonical.totalMinor-proof.canonical.creditedMinor-proof.canonical.paidMinor!==proof.canonical.outstandingMinor)refuse();
 const pending=proof.receipts.filter(row=>row.existingPaymentId===null),applied=proof.receipts.filter(row=>row.existingPaymentId!==null);
 if(!pending.length||new Set(applied.map(row=>row.existingPaymentId)).size!==applied.length)refuse();
 let cash=BigInt(proof.canonical.paidMinor),fee:bigint|null=null,addedCash=0n,addedFee=0n;
 const earlier:string[]=[];
 for(const row of proof.receipts){
  if(row.currency!==proof.bankInvoice.currency||!proof.bankInvoice.positiveReceiptIds.includes(row.receiptId))refuse();
  for(const entry of row.physicalWitnessEntries)if(physical.get(`${entry.table}:${entry.id}`)!==entry.fingerprint)refuse();
  const evidence=controlledCashBankApplicationEvidence(row.originalExpectation,row.actualBankEvidence);
  if(!evidence||merchantTaxDigest(evidence)!==merchantTaxDigest(row.actualPaymentEvidence)||row.actualPaymentEvidence.amountMinor!==row.amountMinor
   ||row.actualPaymentEvidence.currency!==row.currency||row.originalExpectation.amountMinor!==row.amountMinor||row.originalExpectation.currency!==row.currency
   ||row.originalExpectation.feeMinor!==row.feeAllocation.feeMinor)refuse();
  const allocation=row.feeAllocation;
  if(allocation.actualPriorCashMinor!==proof.canonical.paidMinor)refuse();
  if(row.existingPaymentId!==null){if(allocation.basis!=="existing_original_route"||allocation.precedingReceiptIds.length)refuse();continue;}
  if(fee===null)fee=BigInt(allocation.actualPriorAllocatedFeeMinor);
  if(allocation.basis!==(proof.atomicFeePolicy?"actual_atomic_batch":"actual_prior_and_exact_earlier_batch")||allocation.actualPriorAllocatedFeeMinor!==Number(fee-addedFee)
   ||BigInt(allocation.priorCashMinor)!==cash||BigInt(allocation.priorAllocatedFeeMinor)!==fee
   ||allocation.precedingReceiptIds.length!==earlier.length||allocation.precedingReceiptIds.some((id,index)=>id!==earlier[index]))refuse();
  cash+=BigInt(row.amountMinor);fee+=BigInt(allocation.feeMinor);addedCash+=BigInt(row.amountMinor);addedFee+=BigInt(allocation.feeMinor);earlier.push(row.receiptId);
 }
 if(addedCash>BigInt(proof.canonical.outstandingMinor)||cash>BigInt(proof.bankInvoice.paidMinor)
  ||BigInt(proof.bankInvoice.paidMinor)+BigInt(proof.bankInvoice.remainingMinor)!==BigInt(proof.bankInvoice.totalMinor)
  ||BigInt(proof.bankInvoice.totalMinor)!==BigInt(proof.canonical.totalMinor)-BigInt(proof.canonical.creditedMinor)
  ||addedCash>BigInt(Number.MAX_SAFE_INTEGER)||addedFee>BigInt(Number.MAX_SAFE_INTEGER))refuse();
 if(proof.atomicFeePolicy){
  const policy=proof.atomicFeePolicy,amounts=controlledAtomicFeeAmounts({...policy,receipts:pending.map(row=>({receiptId:row.receiptId,amountMinor:row.amountMinor,feeMinor:row.feeAllocation.feeMinor}))});
  if(policy.actualPriorCashMinor!==proof.canonical.paidMinor||policy.principalMinor!==proof.canonical.totalMinor-proof.canonical.creditedMinor
   ||pending.some(row=>row.feeAllocation.actualPriorAllocatedFeeMinor!==policy.actualPriorAllocatedFeeMinor)
   ||policy.batchCashMinor!==amounts.batchCashMinor||policy.batchFeeMinor!==amounts.batchFeeMinor||policy.batchCashMinor!==Number(addedCash)||policy.batchFeeMinor!==Number(addedFee))refuse();
 }
 // Complete bank positives outside this explicit request still need exact
 // historical route/payment proof in the live parent/SQL admission. This pure
 // plan never converts their IDs (or raw fact associations) into an exemption.
 return{proof,snapshot,pending,applied,requestedReceiptIds:pending.map(row=>row.receiptId),expectedCashMinor:Number(addedCash),expectedFeeMinor:Number(addedFee),
  outstandingAfterMinor:Number(BigInt(proof.canonical.outstandingMinor)-addedCash),suppliesApplicationAuthority:false as const,suppliesPrincipalAuthority:false as const};
}
