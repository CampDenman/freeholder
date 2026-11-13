// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08/C11.10: independent human review releases only a real old caller.
import { and,eq,sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { actorString,defineService,ServiceError,type ServiceContext } from "@/core/service";
import { merchantCashReturnInspectionFinishes,merchantCashReturnInspections } from "./merchant-refund-schema";
import { merchantCashReturnInspectionStops } from "./merchant-cash-inspection-stop-schema";
import { cashInspectionEvidence,cashInspectionSource } from "./merchant-cash-inspection-evidence";
import { cashInspectionAdmissionFingerprint,cashInspectionSigningKey,cashInspectionStops } from "./merchant-cash-inspection-stops";
import { cashInspectionStopBody,cashInspectionStopVerdict,observableCashInspectionBirth,signCashInspectionStop,CASH_INSPECTION_STOP_CONFIRMATION } from "./merchant-cash-inspection-stop-proof";
import { lockMerchantRefundCash,originalMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundCashHistory } from "./merchant-refund-history";
import { merchantCallerLiveness } from "./merchant-physical-caller";
import { merchantTaxDigest } from "./merchant-tax-store";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
const digest=z.string().regex(/^[a-f0-9]{64}$/);
function human(ctx:ServiceContext){if(ctx.actor.kind!=="user"||ctx.actor.keyScopes)throw new ServiceError("permission","A freshly verified signed-in person must review the exact original inspection caller; an agent or API key cannot approve its stop.");return actorString(ctx.actor);}
async function original(ctx:ServiceContext,inspectionId:string){
 await lockContactIdentityForRead(ctx.tx);
 const[initial]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,inspectionId));if(!initial)throw new ServiceError("conflict","Restore the exact original cash inspection before reviewing its caller.");
 const source=cashInspectionSource(initial),cash=await originalMerchantRefundCash(ctx,source);await lockMerchantRefundCash(ctx,cash);
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-return-read:${inspectionId}`}))`);
 const[inspection]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,inspectionId)).for("update");
 if(!inspection||merchantTaxDigest(inspection)!==merchantTaxDigest(initial))throw new ServiceError("conflict","Reload the exact original immutable inspection admission.");
 const currentCash=await originalMerchantRefundCash(ctx,source);
 if(currentCash.providerRef!==inspection.originalPaymentRef||currentCash.providerPlatformAccountId!==inspection.providerPlatformAccountId||currentCash.chargeAccountId!==inspection.chargeAccountId||currentCash.providerApiVersion!==inspection.providerApiVersion||currentCash.amountMinor!==inspection.originalCashAmountMinor||currentCash.currency!==inspection.currency)throw new ServiceError("conflict","Restore the original inspection's exact receipt and namespace; equal cash cannot adopt a caller.");
 const[finish]=await ctx.tx.select().from(merchantCashReturnInspectionFinishes).where(eq(merchantCashReturnInspectionFinishes.inspectionId,inspectionId));
 const stops=await cashInspectionStops(ctx.tx,[inspection]),stop=stops[0],own=await cashInspectionEvidence(ctx.tx,inspectionId),history=await merchantRefundCashHistory(ctx,currentCash,inspectionId);
 if(history.inventoryCount+own.primary.length+own.observations.length+own.refunds.length+2+stops.length>5000)throw new ServiceError("conflict","Restore a complete bounded original money and caller inventory before stop review.");
 return{inspection,finish,stop,admissionDigest:merchantTaxDigest(inspection),admissionFingerprint:await cashInspectionAdmissionFingerprint(ctx.tx,inspectionId),sourceRevision:merchantTaxDigest({inspection,currentCash,finish:finish??null,ownEvidenceDigest:own.digest,currentHistoryDigest:history.digest,currentHistoryIncomplete:history.incomplete})};
}
export const cashInspectionRecoveryPlan=defineService({name:"invoicing.cashInspectionRecoveryPlan",summary:"Read one exact original cash inspection's caller and current immutable review revision without exposing its completion nonce.",kind:"query",permission:"scoped",agentCallable:false,external:false,auditInputFields:["inspectionId"],
 input:z.object({inspectionId:z.uuid()}).strict(),output:z.object({inspectionId:z.uuid(),callerId:z.uuid(),admissionDigest:digest,sourceRevision:digest,host:z.string(),pid:z.number().int(),startedAt:z.string(),bootId:z.string().nullable(),pidNamespace:z.string().nullable(),startTicks:z.string().nullable(),originalBirthKnown:z.boolean(),liveness:z.enum(["live","absent","unobservable"]),finished:z.boolean(),reviewed:z.boolean()}),
 handler:async({inspectionId},ctx)=>{human(ctx);const current=await original(ctx,inspectionId),caller=current.inspection.caller;return{inspectionId,callerId:caller.id,admissionDigest:current.admissionDigest,sourceRevision:current.sourceRevision,host:caller.host,pid:caller.pid,startedAt:caller.startedAt,bootId:caller.bootId,pidNamespace:caller.pidNamespace,startTicks:caller.startTicks,originalBirthKnown:observableCashInspectionBirth(caller),liveness:merchantCallerLiveness(caller),finished:!!current.finish,reviewed:!!current.stop};}});
export const reviewCashInspectionCallerStopped=defineService({name:"invoicing.reviewCashInspectionCallerStopped",summary:"Record an independent verified original-process stop without inventing a returned bank inspection, payment or refund.",kind:"mutation",permission:"scoped",stepUp:true,agentCallable:false,writeClass:"money",auditInputFields:["inspectionId","expectedCallerId","expectedAdmissionDigest","expectedSourceRevision"],
 input:z.object({inspectionId:z.uuid(),expectedCallerId:z.uuid(),expectedAdmissionDigest:digest,expectedSourceRevision:digest,hostingEvidence:z.string().trim().min(30).max(2000),confirmation:z.literal(CASH_INSPECTION_STOP_CONFIRMATION)}).strict(),output:z.object({reviewed:z.literal(true),mechanicalCheck:z.literal("original_process_absent")}),handler:async(input,ctx)=>{
 const reviewedBy=human(ctx),current=await original(ctx,input.inspectionId),{inspection}=current;
 if(current.stop){if(current.stop.callerInstanceId!==input.expectedCallerId||current.stop.admissionDigest!==input.expectedAdmissionDigest||current.stop.sourceRevision!==input.expectedSourceRevision)throw new ServiceError("conflict","Preserve the first authentic original stopped-caller receipt.");return{reviewed:true as const,mechanicalCheck:current.stop.mechanicalCheck};}
 const verdict=cashInspectionStopVerdict({...input,actualCallerId:inspection.caller.id,actualAdmissionDigest:current.admissionDigest,actualSourceRevision:current.sourceRevision,finished:!!current.finish,originalBirthKnown:observableCashInspectionBirth(inspection.caller),liveness:merchantCallerLiveness(inspection.caller),runtimeEvidence:input.hostingEvidence.trim().length>=30});
 if(verdict!=="original_process_absent")throw new ServiceError("conflict",verdict==="live"?"The exact original process birth is still live. Actually stop it or let its real wrapper finish before reviewing.":"Reload the unchanged original caller and current review revision; restore its actual process birth and runtime evidence before approval.");
 const body:Parameters<typeof cashInspectionStopBody>[0]={inspectionId:inspection.id,callerInstanceId:inspection.caller.id,admissionDigest:current.admissionDigest,admissionFingerprint:current.admissionFingerprint,sourceRevision:current.sourceRevision,mechanicalCheck:verdict,hostingEvidenceDigest:merchantTaxDigest({hostingEvidence:input.hostingEvidence,caller:inspection.caller,reviewedBy}),reviewedBy};
 const retained={...body,digest:merchantTaxDigest(cashInspectionStopBody(body)),createdAt:new Date()},authentication=signCashInspectionStop(retained,cashInspectionSigningKey());
 await ctx.tx.execute(sql`select set_config('freeholder.cash_inspection_stop_v1',${inspection.id},true)`);
 await ctx.tx.insert(merchantCashReturnInspectionStops).values({...retained,authentication});
 const[saved]=await ctx.tx.select().from(merchantCashReturnInspectionStops).where(and(eq(merchantCashReturnInspectionStops.inspectionId,inspection.id),eq(merchantCashReturnInspectionStops.digest,retained.digest)));if(!saved)throw new ServiceError("conflict","Retain the exact original stop receipt before releasing caller debt.");
 ctx.setSubject(inspection.paymentId?"payment":"subscription_provider_charge",inspection.paymentId??inspection.subscriptionChargeReceiptId!);queueOriginalMerchantRefundRepair(ctx,{kind:"cash_stop",id:inspection.id});return{reviewed:true as const,mechanicalCheck:verdict};}});
export default[cashInspectionRecoveryPlan,reviewCashInspectionCallerStopped];
