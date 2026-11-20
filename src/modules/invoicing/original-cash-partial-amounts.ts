// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: cumulative shares allocate one actual original resource, not FX quotes.
import { merchantTaxDigest } from "./merchant-tax-store";
import type { MerchantReturnedCashEvidence } from "@/adapters/payments/merchant-returned-cash-types";
const minor = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function authoritativeOriginalLineFees(lines:readonly {id:string;revenueMinor:number}[],bps:number,policy:"per_line"|"aggregate") {
  if(!Number.isSafeInteger(bps)||bps<0||bps>10000||new Set(lines.map(line=>line.id)).size!==lines.length||lines.some(line=>!line.id||!minor(line.revenueMinor)))throw new RangeError("Restore real original line identities and the accepted fee policy.");
  const denominator=10000n,rate=BigInt(bps),shares=lines.map(line=>({id:line.id,amount:BigInt(line.revenueMinor)*rate/denominator,remainder:BigInt(line.revenueMinor)*rate%denominator}));
  if(policy==="aggregate") {
    const target=lines.reduce((sum,line)=>sum+BigInt(line.revenueMinor),0n)*rate/denominator;
    let residual=target-shares.reduce((sum,line)=>sum+line.amount,0n);
    for(const line of [...shares].sort((a,b)=>a.remainder===b.remainder?a.id.localeCompare(b.id):a.remainder>b.remainder?-1:1)){if(!residual)break;line.amount++;residual--;}
    if(residual)throw new RangeError("The exact original fee residual has no original line owner.");
  }
  if(shares.reduce((sum,line)=>sum+line.amount,0n)>BigInt(Number.MAX_SAFE_INTEGER)||shares.some(line=>line.amount>BigInt(Number.MAX_SAFE_INTEGER)))throw new RangeError("Retain original fee money outside the exact supported range.");
  return new Map(shares.sort((a,b)=>a.id.localeCompare(b.id)).map(line=>[line.id,Number(line.amount)]));
}
/** Cumulative flooring preserves exact residual cents for the last original
 * principal unit. Incremental rounding must never mint or lose a cent. */
export function originalCumulativeResourceShare(originalResourceMinor: number, originalPrincipalMinor: number, returnedPrincipalMinor: number): number {
  if (![originalResourceMinor, originalPrincipalMinor, returnedPrincipalMinor].every(minor) || originalPrincipalMinor <= 0 || returnedPrincipalMinor > originalPrincipalMinor) throw new RangeError("Use the exact original resource and cumulative original principal.");
  return Number(BigInt(originalResourceMinor) * BigInt(returnedPrincipalMinor) / BigInt(originalPrincipalMinor));
}
export function originalPartialCashTargets(input: {
  principalMinor: number; principalCurrency: string; customerReturnedMinor: number; acceptedFeeMinor: number; acceptedFeeRetainedMinor: number;
  fee: { originalMinor: number; returnedMinor: number; currency: string } | null;
  recipient: { originalMinor: number; returnedMinor: number; currency: string } | null;
}) {
  if (![input.principalMinor, input.customerReturnedMinor, input.acceptedFeeMinor, input.acceptedFeeRetainedMinor].every(minor)
    || input.principalMinor <= 0 || input.customerReturnedMinor > input.principalMinor || input.acceptedFeeRetainedMinor > input.acceptedFeeMinor) throw new RangeError("Restore the exact accepted original partial-return policy.");
  const feeCredit = input.acceptedFeeMinor - input.acceptedFeeRetainedMinor;
  if (!/^[A-Z]{3}$/.test(input.principalCurrency)) throw new RangeError("Retain the actual original principal currency.");
  const resource = (actual: { originalMinor: number; returnedMinor: number; currency: string } | null, targetMinor: number) => {
    if (!actual) return { targetMinor: 0, remainingMinor: 0, overReturnedMinor: 0 };
    if (![actual.originalMinor, actual.returnedMinor, targetMinor].every(minor) || !/^[A-Z]{3}$/.test(actual.currency)
      || actual.returnedMinor > actual.originalMinor || targetMinor > actual.originalMinor) throw new RangeError("Retain the actual contradictory original resource; do not clamp its cash.");
    return { targetMinor, remainingMinor: Math.max(0, targetMinor - actual.returnedMinor), overReturnedMinor: Math.max(0, actual.returnedMinor - targetMinor) };
  };
  if (input.fee && input.acceptedFeeMinor === 0 && input.fee.originalMinor !== 0) throw new RangeError("An unexpected actual fee needs original commercial review; a zero fee promise has no allocation denominator.");
  const feeTarget = input.fee ? input.fee.currency === input.principalCurrency
    ? input.fee.originalMinor - input.acceptedFeeRetainedMinor
    : input.acceptedFeeMinor>0?originalCumulativeResourceShare(input.fee.originalMinor, input.acceptedFeeMinor, feeCredit):0 : 0;
  return {
    fee: resource(input.fee, feeTarget),
    recipient: resource(input.recipient, input.recipient ? originalCumulativeResourceShare(input.recipient.originalMinor, input.principalMinor, input.customerReturnedMinor) : 0),
  };
}
export const originalPartialTargetKey = (body: unknown) => merchantTaxDigest({ protocol: "freeholder.original-cash-partial-target.v1", body });
export function completeOriginalRefundInventory(evidence:MerchantReturnedCashEvidence) {
  return evidence.refundsComplete&&evidence.disputesComplete&&evidence.feeFieldObserved&&evidence.transferFieldObserved
    &&new Set(evidence.refunds.map(resource=>resource.providerRef)).size===evidence.refunds.length
    &&evidence.refunds.every(resource=>resource.paymentProviderRef===evidence.paymentProviderRef&&resource.chargeRef===evidence.providerChargeRef
      &&resource.amountMinor!==null&&Number.isSafeInteger(resource.amountMinor)&&resource.amountMinor>0&&resource.currency===evidence.currency
      &&["succeeded","failed","canceled"].includes(resource.status??"unknown"));
}
