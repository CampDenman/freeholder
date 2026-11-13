// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Finished current bank evidence is distinct from application or returned money.
import { eq } from "drizzle-orm";
import type { ServiceContext } from "@/core/service";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes } from "./merchant-refund-schema";
import { cashInspectionSource,cashInspectionEvidence } from "./merchant-cash-inspection-evidence";
import { originalMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundCashHistory } from "./merchant-refund-history";
import { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
import { merchantTaxDigest } from "./merchant-tax-store";
/** Caller supplies its REAL shared ServiceContext and holds the appropriate
 * original money locks. This function reads only. It never creates a refund,
 * return intent/resolution, payment, bank call or principal/access authority.
 * A changed namespace requires a genuine fresh admitted GET, not rebasing. */
export async function currentOriginalCashInspection(ctx:ServiceContext,input:{inspectionId:string;observationId?:string}){
 const[inspection]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,input.inspectionId)).limit(1);
 if(!inspection)return null;
 const source=cashInspectionSource(inspection),cash=await originalMerchantRefundCash(ctx,source),own=await cashInspectionEvidence(ctx.tx,inspection.id);
 const history=await merchantRefundCashHistory(ctx,cash,inspection.id);
 const[finish]=await ctx.tx.select().from(merchantCashReturnInspectionFinishes).where(eq(merchantCashReturnInspectionFinishes.inspectionId,inspection.id)).limit(1);
 const observation=own.observations.at(-1),evidence=merchantReturnedCashEvidenceSchema.safeParse(observation?.evidence);
 const originalPrimary=own.primary.length>0&&own.primary.every(({evidence:primary})=>primary.providerRef===cash.providerRef
  &&(primary.status==="succeeded"||primary.status==="failed"&&evidence.success&&evidence.data.paymentIntentStatus==="canceled")
  &&primary.providerApiVersion===cash.providerApiVersion&&primary.amountMinor===cash.amountMinor&&primary.currency===cash.currency
  &&primary.providerPlatformAccountId===cash.providerPlatformAccountId&&(primary.providerAccountId??null)===cash.chargeAccountId);
 if(!finish||finish.callerInstanceId!==inspection.caller.id||finish.outcome!=="returned"||!observation||input.observationId!==undefined&&input.observationId!==observation.id||!evidence.success||!originalPrimary
  ||cash.applied||cash.providerRef!==inspection.originalPaymentRef||cash.providerPlatformAccountId!==inspection.providerPlatformAccountId||cash.chargeAccountId!==inspection.chargeAccountId
  ||cash.providerApiVersion!==inspection.providerApiVersion||cash.amountMinor!==inspection.originalCashAmountMinor||cash.currency!==inspection.currency
  ||history.incomplete||!history.creatorsQuiesced||history.inventoryCount+own.primary.length+own.observations.length+own.refunds.length+2>5000||history.digest!==inspection.sourceHistoryDigest)return null;
 const actual=evidence.data;
 if(actual.providerPlatformAccountId!==cash.providerPlatformAccountId||actual.chargeAccountId!==cash.chargeAccountId||actual.providerApiVersion!==cash.providerApiVersion||actual.paymentProviderRef!==cash.providerRef
  ||actual.amountMinor!==cash.amountMinor||actual.currency!==cash.currency||cash.originalChargeRef&&actual.providerChargeRef!==cash.originalChargeRef
  ||actual.chargePaymentProviderRef!==cash.providerRef||actual.chargeAmountMinor!==cash.amountMinor||actual.chargeCurrency!==cash.currency
  ||!actual.refundsComplete||!actual.disputesComplete)return null;
 // Every refund callback attributed to THIS finished read must appear in
 // its final complete bank state. A late/contrary occurrence cannot hide in
 // the separately composed own-reader rows or revive an earlier clean state.
 if(own.refunds.some(row=>row.providerPlatformAccountId!==cash.providerPlatformAccountId||row.chargeAccountId!==cash.chargeAccountId
  ||row.paymentProviderRef!==cash.providerRef||row.currency!==cash.currency||!actual.refunds.some(refund=>refund.providerRef===row.providerRef&&refund.paymentProviderRef===row.paymentProviderRef
   &&refund.chargeRef===row.providerChargeRef&&refund.amountMinor===row.amountMinor&&refund.currency===row.currency&&refund.status===row.status)))return null;
 // Return even genuine negative/current refund or dispute evidence. The
 // financial consumer decides eligibility; it cannot fall back to an older
 // zero-return snapshot. Fee/recipient unknown facts remain explicitly unknown.
 return{inspection,source,cash,own,observation,finish,history,evidence:actual,
  revision:merchantTaxDigest({inspection,source,cash,ownEvidenceDigest:own.digest,observation,finish,currentSourceHistoryDigest:history.digest})};
}
