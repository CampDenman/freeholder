// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: incomplete own GET packets may precede its actual complete snapshot;
// contradictory or foreign packets cannot be erased by a later good packet.
import type { z } from "zod";
import type { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
import { merchantTaxDigest } from "./merchant-tax-store";
type Bank=z.infer<typeof merchantReturnedCashEvidenceSchema>;
export function originalInventoryStatesAgree(states:readonly Bank[],last:Bank){
  if(!states.length||!last.refundsComplete||!last.disputesComplete)return false;
  const identity=(value:Bank)=>({platform:value.providerPlatformAccountId,account:value.chargeAccountId,api:value.providerApiVersion,intent:value.paymentProviderRef,charge:value.providerChargeRef,amount:value.amountMinor,currency:value.currency});
  const known=(before:unknown,after:unknown)=>before===null||merchantTaxDigest(before)===merchantTaxDigest(after);
  return states.every(state=>merchantTaxDigest(identity(state))===merchantTaxDigest(identity(last))
    &&state.paymentIntentStatus===last.paymentIntentStatus&&known(state.amountCapturableMinor,last.amountCapturableMinor)
    &&known(state.chargePaymentProviderRef,last.chargePaymentProviderRef)&&known(state.chargeAmountMinor,last.chargeAmountMinor)&&known(state.chargeCurrency,last.chargeCurrency)
    &&known(state.paid,last.paid)&&known(state.captured,last.captured)&&known(state.refunded,last.refunded)&&known(state.amountRefundedMinor,last.amountRefundedMinor)
    &&(state.fee!==null?last.feeFieldObserved&&merchantTaxDigest(state.fee)===merchantTaxDigest(last.fee):!state.feeFieldObserved||last.feeFieldObserved&&last.fee===null)
    &&(state.transfer!==null?last.transferFieldObserved&&merchantTaxDigest(state.transfer)===merchantTaxDigest(last.transfer):!state.transferFieldObserved||last.transferFieldObserved&&last.transfer===null)
    &&new Set(state.refunds.map(row=>row.providerRef)).size===state.refunds.length&&new Set(last.refunds.map(row=>row.providerRef)).size===last.refunds.length
    &&state.refunds.every(row=>last.refunds.some(actual=>merchantTaxDigest(actual)===merchantTaxDigest(row)))
    &&(!state.refundsComplete||state.refunds.length===last.refunds.length)
    &&new Set(state.disputes.map(row=>row.providerRef)).size===state.disputes.length&&new Set(last.disputes.map(row=>row.providerRef)).size===last.disputes.length
    &&state.disputes.every(row=>last.disputes.some(actual=>merchantTaxDigest(actual)===merchantTaxDigest(row)))
    &&(!state.disputesComplete||state.disputes.length===last.disputes.length));
}
