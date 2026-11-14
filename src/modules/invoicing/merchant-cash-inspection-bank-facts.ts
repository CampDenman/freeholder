// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: shared genuine returned bank facts, with no money/caller-history grant.
import { eq } from "drizzle-orm";
import type { Tx } from "@/core/service";
import type { MerchantRefundCashOrigin } from "./merchant-refund-origin";
import type { merchantCashReturnInspections } from "./merchant-refund-schema";
import { merchantCashReturnInspectionFinishes } from "./merchant-refund-schema";
import { cashInspectionSource,cashInspectionEvidence } from "./merchant-cash-inspection-evidence";
import { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
/** The ordinary caller independently authenticates the actual original cash
 * source and its full current coverage. No public origin DTO is accepted by
 * any service. These immutable returned facts alone cannot grant money/access. */
export async function originalCashInspectionBankFacts(tx:Tx,inspection:typeof merchantCashReturnInspections.$inferSelect,cash:MerchantRefundCashOrigin,observationId?:string){
 const source=cashInspectionSource(inspection),own=await cashInspectionEvidence(tx,inspection.id);
 const[finish]=await tx.select().from(merchantCashReturnInspectionFinishes).where(eq(merchantCashReturnInspectionFinishes.inspectionId,inspection.id)).limit(1);
 const observation=own.observations.at(-1),evidence=merchantReturnedCashEvidenceSchema.safeParse(observation?.evidence);
 const originalPrimary=own.primary.length>0&&own.primary.every(({evidence:primary})=>primary.providerRef===cash.providerRef
  &&(primary.status==="succeeded"||primary.status==="failed"&&evidence.success&&evidence.data.paymentIntentStatus==="canceled")
  &&primary.providerApiVersion===cash.providerApiVersion&&primary.amountMinor===cash.amountMinor&&primary.currency===cash.currency
  &&primary.providerPlatformAccountId===cash.providerPlatformAccountId&&(primary.providerAccountId??null)===cash.chargeAccountId);
 if(!finish||finish.callerInstanceId!==inspection.caller.id||finish.outcome!=="returned"||!observation||observationId!==undefined&&observationId!==observation.id||!evidence.success||!originalPrimary
  ||cash.providerRef!==inspection.originalPaymentRef||cash.providerPlatformAccountId!==inspection.providerPlatformAccountId||cash.chargeAccountId!==inspection.chargeAccountId
  ||cash.providerApiVersion!==inspection.providerApiVersion||cash.amountMinor!==inspection.originalCashAmountMinor||cash.currency!==inspection.currency)return null;
 const actual=evidence.data;
 if(actual.providerPlatformAccountId!==cash.providerPlatformAccountId||actual.chargeAccountId!==cash.chargeAccountId||actual.providerApiVersion!==cash.providerApiVersion||actual.paymentProviderRef!==cash.providerRef
  ||actual.amountMinor!==cash.amountMinor||actual.currency!==cash.currency||cash.originalChargeRef&&actual.providerChargeRef!==cash.originalChargeRef
  ||actual.chargePaymentProviderRef!==cash.providerRef||actual.chargeAmountMinor!==cash.amountMinor||actual.chargeCurrency!==cash.currency
  ||!actual.refundsComplete||!actual.disputesComplete)return null;
 if(own.refunds.some(row=>row.providerPlatformAccountId!==cash.providerPlatformAccountId||row.chargeAccountId!==cash.chargeAccountId
  ||row.paymentProviderRef!==cash.providerRef||row.currency!==cash.currency||!actual.refunds.some(refund=>refund.providerRef===row.providerRef&&refund.paymentProviderRef===row.paymentProviderRef
   &&refund.chargeRef===row.providerChargeRef&&refund.amountMinor===row.amountMinor&&refund.currency===row.currency&&refund.status===row.status)))return null;
 return{inspection,source,cash,own,observation,finish,evidence:actual};
}
