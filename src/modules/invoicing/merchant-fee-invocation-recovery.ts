// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: fresh human local-caller stop, never a bank/no-effect receipt.
import {createHash} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {defineService,ServiceError,type ServiceContext} from "@/core/service";
import {merchantCallerLiveness} from "./merchant-physical-caller";
import {merchantFeeRefundInvocations} from "./merchant-fee-invocation-schema";
import {merchantFeeInvocationFinancialWitness} from "./merchant-fee-invocation-witnesses";
import {merchantFeeInvocations} from "./merchant-fee-invocation-store";
import {signMerchantFeeInvocationProof} from "./merchant-fee-invocation-proof";
import {originalCashSigningKey} from "./original-cash-recovery-store";
import {merchantTaxDigest} from "./merchant-tax-store";
import {readControlledCashObservationCoverage} from "./controlled-cash-observation-parent";
import {CONTROLLED_COLLECTION_PROTOCOL} from "@/modules/subscriptions/controlled-provider-collection-protocol";
import {MERCHANT_FEE_STOP_CONFIRMATION} from "./merchant-fee-invocation-contract";
export {MERCHANT_FEE_STOP_CONFIRMATION} from "./merchant-fee-invocation-contract";
const input=z.object({paymentId:z.uuid(),invocationId:z.uuid()}).strict();
export const merchantFeeInvocationRecoveryList=defineService({name:"invoicing.merchantFeeInvocationRecoveryList",summary:"List complete exact unfinished original fee callers for a signed-in person's hosting review.",kind:"query",permission:"scoped",agentCallable:false,
 input:z.object({}).strict(),output:z.array(z.object({invocationId:z.uuid(),paymentId:z.uuid(),kind:z.enum(["source_inspect","post","recover_get"]),host:z.string(),pid:z.number().int().positive()})).max(5000),handler:async(_input,ctx)=>{
  if(ctx.actor.kind!=="user"||ctx.actor.keyScopes)throw new ServiceError("permission","A signed-in person must open original fee caller recovery.");
  const rows=await ctx.tx.select().from(merchantFeeRefundInvocations).where(sql`${merchantFeeRefundInvocations.finish} is null and ${merchantFeeRefundInvocations.stop} is null`).limit(5001);
  if(rows.length>5000)throw new ServiceError("conflict","Restore a complete bounded original fee caller inventory before hosting review.");
  if(!rows.length)return[];
  const witness=await merchantFeeInvocationFinancialWitness(ctx.tx,{paymentIds:[...new Set(rows.map(row=>row.paymentId))]});
  if(witness.entries.length>5000||rows.some(row=>!witness.entries.some(entry=>entry.id===row.id)))throw new ServiceError("conflict","Restore the actual fee caller and all original financial parents before review.");
  return rows.map(row=>({invocationId:row.id,paymentId:row.paymentId,kind:row.kind,host:row.caller.host,pid:row.caller.pid}));
 }});
async function stopPlan(ctx:ServiceContext,selected:z.infer<typeof input>){
 const initial=await merchantFeeInvocationFinancialWitness(ctx.tx,{paymentIds:[selected.paymentId]}),entry=initial.entries.find(row=>row.id===selected.invocationId);if(!entry)throw new ServiceError("not_found","There is no such exact original fee caller for this payment.");
 // Raw coverage deliberately retains OTHER unfinished callers. A human may
 // independently stop one actual absent caller without a mutual-stop cycle.
 const coverage=await readControlledCashObservationCoverage(ctx,{collectionId:entry.parents.collectionId,receiptId:entry.parents.receiptId,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL});
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-fee-invocation:${selected.paymentId}`}))`);
 const witness=await merchantFeeInvocationFinancialWitness(ctx.tx,{paymentIds:[selected.paymentId]});
 const rows=await merchantFeeInvocations(ctx.tx,selected.paymentId),row=rows.find(value=>value.id===selected.invocationId);if(!row||row.paymentId!==selected.paymentId)throw new ServiceError("conflict","Restore the actual original fee admission before its local hosting review.");
 const current=witness.entries.find(value=>value.id===row.id);if(!current)throw new ServiceError("conflict","Restore the complete original financial fingerprint.");
 const mechanicalCheck=merchantCallerLiveness(row.caller),revision=merchantTaxDigest({row,witness:witness.entries,coverageRevision:coverage.revision,unfinishedCallers:coverage.unfinishedCallers,mechanicalCheck});
 return{row,mechanicalCheck,revision,admissionFingerprint:current.fingerprint};
}
export const merchantFeeInvocationStopPlan=defineService({name:"invoicing.merchantFeeInvocationStopPlan",summary:"Review the exact original fee caller's actual local birth and complete current evidence before a separate fresh-human stop.",kind:"query",permission:"scoped",agentCallable:false,
 input,output:z.object({invocationId:z.uuid(),kind:z.enum(["source_inspect","post","recover_get"]),mechanicalCheck:z.enum(["live","absent","unobservable"]),revision:z.string().regex(/^[a-f0-9]{64}$/),alreadyClosed:z.boolean()}),handler:async(selected,ctx)=>{
  const plan=await stopPlan(ctx,selected);return{invocationId:plan.row.id,kind:plan.row.kind,mechanicalCheck:plan.mechanicalCheck,revision:plan.revision,alreadyClosed:Boolean(plan.row.finish||plan.row.stop)};
 }});
export const reviewMerchantFeeInvocationStopped=defineService({name:"invoicing.reviewMerchantFeeInvocationStopped",summary:"Record an exact fresh-human mechanically absent original fee caller stop; no finish, bank result or replay authority is supplied.",kind:"mutation",permission:"scoped",stepUp:true,agentCallable:false,writeClass:"money",auditInputFields:["paymentId","invocationId","expectedRevision"],
 input:input.extend({expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),hostingEvidence:z.string().trim().min(30).max(2000),confirmation:z.literal(MERCHANT_FEE_STOP_CONFIRMATION)}),output:z.object({stopped:z.literal(true),suppliesBankEvidence:z.literal(false)}),handler:async(selected,ctx)=>{
  if(ctx.actor.kind!=="user"||ctx.actor.keyScopes)throw new ServiceError("permission","A freshly verified signed-in person must review this exact original hosting stop.");
  const plan=await stopPlan(ctx,selected);if(plan.row.finish||plan.row.stop||plan.revision!==selected.expectedRevision||plan.mechanicalCheck!=="absent")throw new ServiceError("conflict","Use a new current review of an actually absent original process. A live, unobservable or old caller cannot be stopped by age or text alone.");
  const body={invocationId:plan.row.id,admissionDigest:plan.row.digest,callerInstanceId:plan.row.caller.id,admissionFingerprint:plan.admissionFingerprint,mechanicalCheck:"absent",reviewedBy:`user:${ctx.actor.userId}`,
   reviewRevision:plan.revision,hostingEvidenceDigest:createHash("sha256").update(selected.hostingEvidence).digest("hex"),reviewedAt:new Date().toISOString()};
  const stop=signMerchantFeeInvocationProof(plan.row,"stop",body,originalCashSigningKey());
  await ctx.tx.execute(sql`select set_config('freeholder.merchant_fee_invocation_v1','1',true)`);
  await ctx.tx.update(merchantFeeRefundInvocations).set({stop}).where(eq(merchantFeeRefundInvocations.id,plan.row.id));ctx.setSubject("payment",selected.paymentId);
  return{stopped:true as const,suppliesBankEvidence:false as const};
 }});
export default[merchantFeeInvocationRecoveryList,merchantFeeInvocationStopPlan,reviewMerchantFeeInvocationStopped];
