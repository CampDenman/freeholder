// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: physical identity is independent of equal money or ACK order.
import {z} from "zod";
import {merchantTaxDigest} from "./merchant-tax-store";
const id=z.uuid(),ref=z.string().regex(/^fr_[A-Za-z0-9_]+$/),sha=z.string().regex(/^[a-f0-9]{64}$/),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const atomicFeeResource=z.object({ledger:z.enum(["merchant_fee","original_auxiliary"]),paymentId:id,receiptId:id,operationId:id,platform:z.string().regex(/^acct_[A-Za-z0-9]+$/),feeRef:z.string().regex(/^fee_[A-Za-z0-9_]+$/),chargeRef:z.string().regex(/^ch_[A-Za-z0-9_]+$/),account:z.string().regex(/^acct_[A-Za-z0-9]+$/),providerRef:ref,amountMinor:minor.positive(),currency:z.string().regex(/^[A-Z]{3}$/),evidenceDigest:sha}).strict();
export type AtomicFeeResource=z.infer<typeof atomicFeeResource>;
/** Inputs are individually authenticated actual reader outputs. This pure
 * union grants no ownership, caller closure, bank or mutation authority. */
export function atomicFeeResourceUnion(values:readonly AtomicFeeResource[]){
 if(values.length>5000)throw Error("Restore the complete bounded original physical fee return inventory.");
 const operations=new Map<string,string>(),actual=new Map<string,AtomicFeeResource>(),evidence=new Map<string,Set<string>>();
 for(const value of values){const row=atomicFeeResource.parse(value),key=`${row.platform}:${row.providerRef}`,prior=actual.get(key);
  const operationKey=`${row.ledger}:${row.operationId}`,originalRef=operations.get(operationKey);if(originalRef&&originalRef!==row.providerRef)throw Error("One exact original operation cannot adopt two physical fee resources.");operations.set(operationKey,row.providerRef);
  if(prior&&(prior.ledger!==row.ledger||prior.operationId!==row.operationId||prior.feeRef!==row.feeRef||prior.paymentId!==row.paymentId||prior.receiptId!==row.receiptId||prior.chargeRef!==row.chargeRef||prior.account!==row.account||prior.amountMinor!==row.amountMinor||prior.currency!==row.currency))throw Error("One physical fee return cannot belong to conflicting operations, ledgers or original resources.");
  actual.set(key,prior??row);const witnesses=evidence.get(key)??new Set<string>();witnesses.add(row.evidenceDigest);evidence.set(key,witnesses);
 }
 const resources=[...actual.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>({...row,evidenceDigests:[...(evidence.get(key)??[])].sort()}));
 const total=resources.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n);if(total>BigInt(Number.MAX_SAFE_INTEGER))throw Error("Original fee returns exceed exact safe minor units.");
 return{resources,returnedMinor:Number(total),revision:merchantTaxDigest(resources)};
}
