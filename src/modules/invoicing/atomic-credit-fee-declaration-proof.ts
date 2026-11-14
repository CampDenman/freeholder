// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: actual server plan IDs are authenticated without pretending birth.
import {atomicCreditFeeDeclaration,type AtomicCreditFeeDeclaration} from "./atomic-credit-fee-declaration-contract";
import {merchantTaxDigest} from "./merchant-tax-store";
import {signOriginalCashRecovery,verifyOriginalCashRecovery} from "./original-cash-recovery-proof";
export {originalCashEvidenceKeys as atomicCreditFeeDeclarationKeys,originalCashSigningKey as atomicCreditFeeDeclarationSigningKey} from "./original-cash-evidence-keys";
type Body=Omit<AtomicCreditFeeDeclaration,"digest"|"authentication">;
export function signAtomicCreditFeeDeclaration(body:Body,quoteCreatedAt:Date,key:string){const digest=merchantTaxDigest(body);return{...body,digest,authentication:signOriginalCashRecovery("atomic_credit_fee_declaration.v1",{id:body.quoteId,createdAt:quoteCreatedAt,digest},key)};}
export function verifiedAtomicCreditFeeDeclaration(value:unknown,quoteCreatedAt:Date,keys:readonly string[]){
 const parsed=atomicCreditFeeDeclaration.safeParse(value);if(!parsed.success)return false;
 const row=parsed.data,{digest,authentication,...body}=row;
 if(new Set(row.fundings.map(source=>source.fundingId)).size!==row.fundings.length||new Set(row.fundings.map(source=>`${source.sourcePaymentId}:${source.sourceApplicationId??"direct"}`)).size!==row.fundings.length
  ||row.fundings.reduce((sum,source)=>sum+BigInt(source.amountMinor),0n)>BigInt(Number.MAX_SAFE_INTEGER))return false;
 return verifyOriginalCashRecovery("atomic_credit_fee_declaration.v1",{id:row.quoteId,createdAt:quoteCreatedAt,digest,authentication},body,keys);
}
