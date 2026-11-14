// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: exact original capture + current unchanged bank funds, not a return.
import { currentBankPrincipalMatches } from "./original-bank-principal-policy";
import type { MerchantReturnedCashEvidence } from "./merchant-returned-cash-proof";
import type { MerchantChargeScope } from "@/adapters/payments";
import type { merchantPaymentEvidence } from "./merchant-payment-observations";
import type { z } from "zod";
export type ControlledCashBankExpectation=MerchantChargeScope&{providerPlatformAccountId:string;providerApiVersion:"2026-10-28.endive";providerRef:string;chargeRef:string;
 amountMinor:number;currency:string;feeMinor:number;originalFeeRef:string|null;customerChargeVerified:boolean;merchantRouteVerified:boolean};
/** Does not authenticate an inspection or confer application authority. Caller
 * MUST independently authenticate the exact original receipt/call/fact route
 * and complete returned inspection. Unknown fields remain unknown/refused. */
export function controlledCashBankApplicationEvidence(expected:ControlledCashBankExpectation,bank:MerchantReturnedCashEvidence):z.infer<typeof merchantPaymentEvidence>|null{
 if(!expected.customerChargeVerified||!expected.merchantRouteVerified||!Number.isSafeInteger(expected.feeMinor)||expected.feeMinor<0||expected.feeMinor>expected.amountMinor
  ||!currentBankPrincipalMatches({amountMinor:expected.amountMinor,currency:expected.currency,refundedMinor:0,apiVersion:expected.providerApiVersion,
   platform:expected.providerPlatformAccountId,account:expected.providerAccountId??null,paymentRef:expected.providerRef,chargeRef:expected.chargeRef},bank)
  ||bank.refunded!==false||!bank.feeFieldObserved||!bank.transferFieldObserved)return null;
 const recipient=expected.destinationAccountId??expected.providerAccountId??null,fee=bank.fee,transfer=bank.transfer;
 if(expected.feeMinor===0){if(fee!==null||expected.originalFeeRef!==null)return null;}
 else if(!fee||expected.originalFeeRef!==null&&fee.providerRef!==expected.originalFeeRef||fee.originatingChargeRef!==expected.chargeRef||fee.accountId!==recipient
  ||fee.amountMinor!==expected.feeMinor||fee.refundedMinor!==0||fee.currency!==expected.currency)return null;
 if(expected.destinationAccountId){
  if(expected.providerAccountId||expected.settlementMerchantAccountId!==expected.destinationAccountId||!transfer||transfer.sourceChargeRef!==expected.chargeRef
   ||transfer.destinationAccountId!==expected.destinationAccountId||transfer.amountMinor!==expected.amountMinor||transfer.reversedMinor!==0||transfer.reversed!==false||transfer.currency!==expected.currency)return null;
 }else if(expected.settlementMerchantAccountId||transfer!==null)return null;
 // Route/customer proof is the authenticated ORIGINAL controlled cash receipt,
 // not the neutral inspection's intentionally false primary route flags. Its
 // exact SAME captured PI/charge is independently proved above; fee/recipient
 // settlement additionally requires every current actual field above.
 return{providerApiVersion:expected.providerApiVersion,providerPlatformAccountId:bank.providerPlatformAccountId,providerAccountId:bank.chargeAccountId??undefined,
  destinationAccountId:expected.destinationAccountId,settlementMerchantAccountId:expected.settlementMerchantAccountId,providerRef:bank.paymentProviderRef,status:"succeeded",
  amountMinor:bank.amountMinor,currency:bank.currency,providerChargeRef:bank.providerChargeRef,customerChargeVerified:true,merchantRouteVerified:true,merchantSettlementVerified:true,
  applicationFeeMinor:expected.feeMinor,applicationFeeRef:fee?.providerRef,applicationFeeCurrency:fee?.currency??bank.currency,observedApplicationFeeMinor:fee?.amountMinor??0,
  observedFeeRefundedMinor:fee?.refundedMinor??0,transferRef:transfer?.providerRef};
}
