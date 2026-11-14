// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One original fee epoch/carry equation for local and controlled-provider targets.
import { compareCreditSources,proportionalFeeCarry,remainingCashFeeBudget } from "@/modules/invoicing/credit-fee-amounts";
import { marketFeeMinor } from "@/modules/invoicing/market-policy";
import type { ProrationPrincipal } from "./proration-basis";
export function originalProrationFeeReview(principal:ProrationPrincipal[],debitNetMinor:number,debitGrossMinor:number,creditAppliedMinor:number,siteFeeBps:number){
 let remainder=creditAppliedMinor,appliedFeeObligationMinor=0,appliedFeeProvenCollectedMinor=0;
 for(const source of [...principal].sort(compareCreditSources)){
  const takeMinor=Math.min(remainder,source.amountMinor);if(!takeMinor)break;
  appliedFeeObligationMinor+=proportionalFeeCarry({principalMinor:source.amountMinor,feeObligationMinor:source.feeObligationMinor,allocatedPrincipalMinor:0,allocatedFeeMinor:0,takeMinor});
  appliedFeeProvenCollectedMinor+=proportionalFeeCarry({principalMinor:source.amountMinor,feeObligationMinor:source.feeProvenCollectedMinor,allocatedPrincipalMinor:0,allocatedFeeMinor:0,takeMinor});remainder-=takeMinor;
 }
 const debitFeeObligationMinor=marketFeeMinor(debitNetMinor,siteFeeBps),creditFeeObligationMinor=principal.reduce((n,source)=>n+source.feeObligationMinor,0);
 const budget=remainingCashFeeBudget(debitGrossMinor,debitFeeObligationMinor,creditAppliedMinor,appliedFeeObligationMinor);
 return{debitFeeObligationMinor,creditFeeObligationMinor,appliedFeeObligationMinor,appliedFeeProvenCollectedMinor,remainingNewCashFeeMinor:Math.min(budget.feeObligationMinor,budget.principalMinor),
  separateMerchantReceivableMinor:Math.max(0,budget.feeObligationMinor-budget.principalMinor),originalOverTargetMinor:budget.originalOverTargetMinor,
  originalSourceDebt:principal.some(source=>source.feeUnexpected||["owed","review"].includes(source.feeCollectionState)),sources:principal};
}
