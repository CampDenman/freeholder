// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: current per-namespace bank proof, not a stale whole-parent comparison.
import {and,eq,inArray,or,sql} from "drizzle-orm";
import {z} from "zod";
import {ServiceError,type ServiceContext} from "@/core/service";
import {payments,refunds} from "./schema";
import {merchantRefundRequests,merchantRefundResourceBindings,merchantRefundObservations} from "./merchant-refund-schema";
import {merchantRefundObservationCaptures} from "./merchant-refund-current-schema";
import {controlledCashApplicationReceipts} from "./controlled-cash-application-protocol-schema";
import {controlledAtomicFeeOwner} from "./controlled-atomic-refund-target";
import {originalMerchantRefundCash} from "./merchant-refund-origin";
import {originalCashInspectionBankFacts} from "./merchant-cash-inspection-bank-facts";
import {latestControlledCashInspectionLineage} from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import {verifiedControlledCashInspectionLineage} from "@/modules/subscriptions/controlled-cash-inspection-lineage-proof";
import {verifiedCashInspectionRefundCapture} from "./merchant-cash-inspection-refund-capture";
import {controlledAtomicRefundBankPolicy,type AtomicRefundBankObservation,type AtomicRefundBankRequest} from "./controlled-atomic-refund-bank-policy";
import {originalCashCallersFinished,originalCashEvidenceKeys,originalCashRecoveryFinancialWitness} from "./original-cash-recovery-store";
import {merchantFeeInvocationFinancialWitness} from "./merchant-fee-invocation-witnesses";
import {merchantFeeInvocationPaymentCallers} from "./merchant-fee-invocation-store";
import {merchantTaxDigest} from "./merchant-tax-store";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const physical=z.object({table:z.string().regex(/^[a-z_][a-z0-9_]*$/),id:z.string().min(1),fingerprint:sha}).strict();
const state=z.object({known:z.literal(true),payment_id:z.uuid(),receipt_id:z.uuid(),inspection_id:z.uuid(),observation_id:z.uuid(),refunded_minor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),namespace_revision:sha,evidence_fingerprint:sha,physical_witness:z.array(physical).min(1).max(5000)}).strict();
function refuse():never{throw new ServiceError("conflict","Restore the exact current lineaged original bank refund inventory, all authenticated captures and real finished callers; an old receipt or equal amount cannot supply another atomic fee target.");}
async function snapshot(ctx:ServiceContext,paymentId:string){
 const rows=await ctx.tx.execute<z.infer<typeof state>>(sql`select * from freeholder_controlled_atomic_refund_bank_state(${paymentId}::uuid)`);
 if(rows.length!==1)refuse();const result=state.parse(rows[0]);
 if(result.payment_id!==paymentId||new Set(result.physical_witness.map(row=>`${row.table}:${row.id}`)).size!==result.physical_witness.length)refuse();return result;
}
/** Full ordinary verifier uses a REAL ServiceContext. It never calls the
 * target/fee/canonical-principal reader (which would recurse through targets),
 * changes a historical receipt, projects a capture or supplies dispatch grant.
 * Null means the unchanged generic resolver already covers every succeeded
 * canonical refund; it is never a downgrade for a failed known controlled read.
 */
export async function readControlledAtomicRefundBankState(ctx:ServiceContext,paymentId:string){
 if(!z.uuid().safeParse(paymentId).success)refuse();
 const[required]=await ctx.tx.execute<{required:boolean}>(sql`select exists(select 1 from refunds r left join merchant_refund_requests q on q.refund_id=r.id
  where r.payment_id=${paymentId}::uuid and r.status='succeeded' and(q.id is null or not freeholder_original_refund_resolved(q.id,'succeeded',r.provider_ref))) as required`);
 if(required?.required!==true)return null;
 const owner=await controlledAtomicFeeOwner(ctx,paymentId);if(!owner)refuse();
 const before=await snapshot(ctx,paymentId);
 const[payment]=await ctx.tx.select().from(payments).where(eq(payments.id,paymentId));
 const[proof]=await ctx.tx.select().from(controlledCashApplicationReceipts).where(eq(controlledCashApplicationReceipts.id,owner.proofId));
 if(!payment||payment.status!=="succeeded"||!payment.providerRef||!proof||proof.receiptId!==owner.receiptId||before.receipt_id!==owner.receiptId)refuse();
 const cash=await originalMerchantRefundCash(ctx,{kind:"subscription",receiptId:owner.receiptId,observationId:proof.originalObservationId});
 const latest=await latestControlledCashInspectionLineage(ctx.tx,owner.receiptId),bank=await originalCashInspectionBankFacts(ctx.tx,latest.inspection,cash);
 if(!bank||latest.inspection.id!==before.inspection_id||bank.observation.id!==before.observation_id||!cash.originalChargeRef)refuse();
 const chargeRef=cash.originalChargeRef;
 // The SQL tuple selects this exact immutable final observation. Bind its
 // full PG row once; do not rerun the entire namespace just to fetch its body.
 const[bankRow]=await ctx.tx.execute<{fingerprint:string}>(sql`select encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') as fingerprint from merchant_cash_return_observations o where o.id=${bank.observation.id}::uuid`);
 if(!bankRow||before.physical_witness.find(row=>row.table==="merchant_cash_return_observations"&&row.id===bank.observation.id)?.fingerprint!==bankRow.fingerprint)refuse();
 const requests=await ctx.tx.select().from(merchantRefundRequests).where(or(eq(merchantRefundRequests.paymentId,payment.id),eq(merchantRefundRequests.subscriptionChargeReceiptId,owner.receiptId),
  and(eq(merchantRefundRequests.providerPlatformAccountId,cash.providerPlatformAccountId),sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${cash.chargeAccountId}`,eq(merchantRefundRequests.originalPaymentRef,cash.providerRef)))).limit(5001);
 const ids=requests.map(row=>row.id),refs=bank.evidence.refunds.map(row=>row.providerRef);
 const bindings=ids.length?await ctx.tx.select().from(merchantRefundResourceBindings).where(inArray(merchantRefundResourceBindings.requestId,ids)).limit(5001):[];
 const canonical=await ctx.tx.select().from(refunds).where(eq(refunds.paymentId,payment.id)).limit(5001);
 const observations=await ctx.tx.select().from(merchantRefundObservations).where(or(eq(merchantRefundObservations.paymentId,payment.id),eq(merchantRefundObservations.subscriptionChargeReceiptId,owner.receiptId),
  ...(ids.length?[inArray(merchantRefundObservations.requestId,ids),inArray(merchantRefundObservations.claimedRequestId,ids)]:[]),
  and(eq(merchantRefundObservations.providerPlatformAccountId,cash.providerPlatformAccountId),sql`${merchantRefundObservations.chargeAccountId} is not distinct from ${cash.chargeAccountId}`,
   or(eq(merchantRefundObservations.paymentProviderRef,cash.providerRef),...(refs.length?[inArray(merchantRefundObservations.providerRef,refs)]:[]))))).limit(5001);
 const observationIds=observations.map(row=>row.id),captures=observationIds.length?await ctx.tx.select().from(merchantRefundObservationCaptures).where(inArray(merchantRefundObservationCaptures.observationId,observationIds)).limit(5001):[];
 if([requests,bindings,canonical,observations,captures].some(rows=>rows.length>5000))refuse();
 const actualRequests:AtomicRefundBankRequest[]=requests.map(request=>{
  const refund=canonical.find(row=>row.id===request.refundId),resources=bindings.filter(row=>row.requestId===request.id),ownedRefs=[...new Set(resources.map(row=>row.providerRef))];
  const resourceRef=ownedRefs[0];
  if(request.purpose!=="invoice_refund"||request.paymentId!==payment.id||request.subscriptionChargeReceiptId!==null||!refund||refund.invoiceId!==payment.invoiceId||refund.amountMinor!==request.amountMinor
   ||refund.currency!==request.currency||refund.idempotencyKey!==request.idempotencyKey||refund.failureCode==="provider_already_refunded"||ownedRefs.length!==1||!resourceRef||refund.providerRef!==resourceRef)refuse();
  return{requestId:request.id,refundId:refund.id,providerRef:resourceRef,amountMinor:request.amountMinor,currency:request.currency,status:refund.status,providerPlatformAccountId:request.providerPlatformAccountId,
   chargeAccountId:request.chargeAccountId,providerApiVersion:request.providerApiVersion,originalPaymentRef:request.originalPaymentRef,chargeRef};
 });
 if(canonical.length!==actualRequests.length)refuse();
 const keys=originalCashEvidenceKeys();
 const priorIds=[...new Set(observations.flatMap(row=>row.status!==bank.evidence.refunds.find(value=>value.providerRef===row.providerRef)?.status&&row.inspectionId?[row.inspectionId]:[]))];
 const{subscriptionControlledCashInspectionLineages}=await import("@/modules/subscriptions/controlled-cash-inspection-lineage-schema");
 const priorRows=priorIds.length?await ctx.tx.select().from(subscriptionControlledCashInspectionLineages).where(inArray(subscriptionControlledCashInspectionLineages.inspectionId,priorIds)).limit(5001):[];
 if(priorRows.length!==priorIds.length)refuse();
 const actualObservations:AtomicRefundBankObservation[]=observations.map(observation=>{
  const actual=bank.evidence.refunds.find(row=>row.providerRef===observation.providerRef),own=captures.filter(row=>row.observationId===observation.id);
  return{...observation,captures:own.map(capture=>{
   if(observation.status===actual?.status)return{captureId:capture.id,provenance:{kind:"same_state" as const}};
   const prior=latest.admissions.find(row=>row.id===observation.inspectionId),priorFinish=latest.finishes.find(row=>row.inspectionId===observation.inspectionId);
   // All actual prior rows/lineages were authenticated by latest's complete
   // inventory. Recheck this exact HMAC and capture, never an opaque old ID.
   const priorLineage=priorRows.find(row=>row.inspectionId===observation.inspectionId);
   if(!priorLineage||!prior||!verifiedControlledCashInspectionLineage(prior,priorLineage,keys)||priorLineage.receiptId!==owner.receiptId||priorLineage.resourceId!==latest.lineage.resourceId||priorLineage.namespaceKey!==latest.lineage.namespaceKey
    ||!priorFinish||priorFinish.outcome!=="returned"||priorFinish.callerInstanceId!==prior.caller.id||latest.stops.some(row=>row.inspectionId===prior.id)
    ||!latest.lineage.closedInspectionIds.includes(prior.id)||!verifiedCashInspectionRefundCapture(prior,observation,capture,keys))refuse();
   return{captureId:capture.id,provenance:{kind:"earlier_returned_inspection" as const,inspectionId:prior.id,admissionSequence:priorLineage.admissionSequence,callerInstanceId:priorFinish.callerInstanceId}};
  })};
 });
 const policy=controlledAtomicRefundBankPolicy({payment:{id:payment.id,providerRef:payment.providerRef,chargeRef,platform:cash.providerPlatformAccountId,account:cash.chargeAccountId,apiVersion:cash.providerApiVersion,amountMinor:payment.amountMinor,refundedMinor:payment.refundedMinor,currency:payment.currency},
  bank:bank.evidence,requests:actualRequests,observations:actualObservations,latest:{inspectionId:latest.inspection.id,admissionSequence:latest.lineage.admissionSequence,closedInspectionIds:latest.lineage.closedInspectionIds}});
 if(policy.returnedMinor!==before.refunded_minor)refuse();
 const original=await originalCashRecoveryFinancialWitness(ctx.tx,[payment.id],[owner.receiptId]);if(!originalCashCallersFinished(original)||original.owners.some(row=>row.namespaceKey!==owner.namespaceKey))refuse();
 const fee=await merchantFeeInvocationFinancialWitness(ctx.tx,{paymentIds:[payment.id]}),feeCallers=await merchantFeeInvocationPaymentCallers(ctx.tx,payment.id);
 const physicalRows=new Map(before.physical_witness.map(row=>[`${row.table}:${row.id}`,row.fingerprint]));
 for(const row of fee.entries){const previous=physicalRows.get(`${row.table}:${row.id}`);if(previous&&previous!==row.fingerprint)refuse();physicalRows.set(`${row.table}:${row.id}`,row.fingerprint);}
 if(physicalRows.size>5000)refuse();
 for(const[table,rows]of [["merchant_refund_requests",requests],["merchant_refund_resource_bindings",bindings],["refunds",canonical],["merchant_refund_observations",observations],["merchant_refund_observation_captures",captures]] as const)
  for(const row of rows)if(!physicalRows.has(`${table}:${row.id}`))refuse();
 for(const[table,rows]of [["original_cash_recoveries",original.owners],["original_cash_recovery_operations",original.operations],["original_cash_recovery_facts",original.facts],["original_cash_recovery_closures",original.closures]] as const)
  for(const row of rows)if(!physicalRows.has(`${table}:${row.id}`))refuse();
 for(const row of original.feedback)if(!physicalRows.has(`legacy_bank_feedback:${row.feedback.id}`))refuse();
 // Recheck the COMPLETE exact PG namespace after ordinary HMAC/policy reads.
 // Every authenticated original/lineage/fee row is retained in this same
 // snapshot. Byte-identical full rows need no second expensive HMAC traversal.
 const after=await snapshot(ctx,payment.id);if(merchantTaxDigest(before)!==merchantTaxDigest(after))refuse();
 return{paymentId:payment.id,receiptId:owner.receiptId,inspectionId:bank.inspection.id,observationId:bank.observation.id,refundedMinor:policy.returnedMinor,bankNamespaceRevision:after.namespace_revision,
  physicalEntries:[...physicalRows].sort(([a],[b])=>a.localeCompare(b)).map(([key,fingerprint])=>{const colon=key.indexOf(":");return{table:key.slice(0,colon),id:key.slice(colon+1),fingerprint,hashDomain:"postgres_row" as const};}),
  unfinishedFeeInvocationIds:feeCallers.unfinishedIds,suppliesDispatchAuthority:false as const,revision:merchantTaxDigest({owner,bank:after,latest,policy,original,fee,feeCallers})};
}
