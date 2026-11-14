// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: committed signed receipt epochs, never a caller-selected fee policy.
import {createHash} from "node:crypto";
import { eq,inArray,sql } from "drizzle-orm";
import {ServiceError,type ServiceContext} from "@/core/service";
import { controlledCashApplicationBatches,controlledCashApplicationReceipts } from "./controlled-cash-application-protocol-schema";
import { verifiedControlledCashBatch,verifiedControlledCashReceipt } from "./controlled-cash-application-protocol-proof";
import { CONTROLLED_CASH_ATOMIC_PROTOCOL } from "./controlled-cash-application-protocol";
import { controlledAtomicRefundAmounts,type AtomicRefundResource } from "./controlled-atomic-refund-amounts";
import { merchantTaxDigest } from "./merchant-tax-store";
export type ControlledAtomicRefundTarget={applies:true;target:number|null;revision:string|null;resources:AtomicRefundResource[];unassignedDutyMinor:number|null};
export type ControlledAtomicRefundFeeProof={paymentId:string;receiptId:string;inspectionId:string;bankObservationId:string;bankNamespaceRevision:string;namespaceKey:string;originalFeeRef:string|null;originalFeeMinor:number;acceptedReturnedFeeMinor:number;targetRetainedFeeMinor:number;actualRetainedFeeMinor:number;feeOperationIds:string[];invocationIds:string[];revision:string};
export type ControlledAtomicRefundFeeState={pending:true;actualRetainedFeeMinor:number|null;proof:null}|{pending:false;actualRetainedFeeMinor:number;proof:ControlledAtomicRefundFeeProof};
type SqlTarget={known:boolean;payment_id:string;receipt_id:string;batch_id:string;receipt_proof_id:string;amount_minor:number;refunded_minor:number;original_fee_minor:number;original_fee_ref:string|null;actual_fee_returned_minor:number;target_retained_fee_minor:number;principal_minor:number;fee_minor:number;revision:string};
type SqlFeeState={known:boolean;actual_retained_fee_minor:number;reconciled:boolean;receipt_id:string;inspection_id:string|null;observation_id:string|null;bank_namespace_revision:string|null};
async function knownAtomicFeeHistory(ctx:ServiceContext,invoiceId:string){
 const[installed]=await ctx.tx.execute<{present:boolean}>(sql`select to_regclass('merchant_fee_refund_invocations') is not null as present`);if(!installed?.present)return false;
 const[known]=await ctx.tx.execute<{known:boolean}>(sql`select exists(select 1 from merchant_fee_refund_invocations actual_call join payments p on p.id=actual_call.payment_id where p.invoice_id=${invoiceId}::uuid) as known`);return known?.known===true;
}
/** Actual applied ownership, including a no-refund/satisfied payment. A real
 * readonly source call exists before any fee operation and must not invent one.
 * This proves its original namespace, never dispatch/settlement entitlement. */
export async function controlledAtomicFeeOwner(ctx:ServiceContext,paymentId:string){
 const[installed]=await ctx.tx.execute<{present:boolean}>(sql`select to_regclass('controlled_cash_application_batches') is not null as present`);if(!installed?.present)return null;
 const[identity]=await ctx.tx.execute<{batchId:string}>(sql`select l.batch_id::text as "batchId" from controlled_cash_application_links l where l.payment_id=${paymentId}::uuid`);if(!identity)return null;
 const[batch]=await ctx.tx.select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.id,identity.batchId));
 if(!batch||!verifiedControlledCashBatch(batch))throw new ServiceError("conflict","Restore the authentic original cash batch before inspecting its fee namespace.");
 const epochs=await ctx.tx.select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.invoiceId,batch.invoiceId)).limit(5001);
 if(epochs.length>5000||epochs.some(row=>!verifiedControlledCashBatch(row)))throw new ServiceError("conflict","Restore every authentic original fee epoch; a known v1/v2 mixture cannot be downgraded or repriced.");
 if(!epochs.some(row=>row.protocol===CONTROLLED_CASH_ATOMIC_PROTOCOL)){if(await knownAtomicFeeHistory(ctx,batch.invoiceId))throw new ServiceError("conflict","Restore every original atomic epoch; retained real fee callers cannot be downgraded after a partial restore.");return null;}
 const[owner]=await ctx.tx.execute<{batchId:string;proofId:string;collectionId:string;subscriptionId:string;receiptId:string;invoiceId:string;namespaceKey:string;applicationFeeRef:string|null;providerChargeRef:string|null;valid:boolean}>(sql`select b.id::text as "batchId",proof.id::text as "proofId",b.collection_id::text as "collectionId",b.subscription_id::text as "subscriptionId",l.receipt_id::text as "receiptId",p.invoice_id::text as "invoiceId",
  receipt.provider_platform_account_id||':'||coalesce(receipt.charge_account_id,'')||':'||receipt.provider_payment_intent_ref as "namespaceKey",coalesce(receipt.application_fee_ref,bank.evidence->'fee'->>'providerRef') as "applicationFeeRef",receipt.provider_charge_ref as "providerChargeRef",
  (b.protocol in ('controlled_net_gross.v1','controlled_cash_atomic.v1') and b.admission_transaction_id<>txid_current()::text and b.invoice_id=p.invoice_id and b.subscription_id=receipt.subscription_id and receipt.id=route.original_charge_receipt_id
   and receipt.provider_payment_intent_ref=p.provider_ref and receipt.amount_minor=p.amount_minor and receipt.currency=p.currency
   and proof.receipt_id=receipt.id and proof.batch_id=b.id and proof.amount_minor=p.amount_minor and proof.currency=p.currency and proof.fee_minor=route.application_fee_minor
   and receipt.provider_platform_account_id=route.provider_platform_account_id and receipt.charge_account_id is not distinct from route.charge_account_id
   and bank.inspection_id=proof.bank_inspection_id
   and exists(select 1 from jsonb_array_elements(b.before_entries) frozen where frozen->>'table'='merchant_cash_return_observations' and frozen->>'id'=bank.id::text and frozen->>'hashDomain'='postgres_row'
    and frozen->>'fingerprint'=encode(sha256(convert_to(to_jsonb(bank)::text,'UTF8')),'hex'))
   and bank.evidence->>'providerPlatformAccountId'=receipt.provider_platform_account_id
   and bank.evidence->>'chargeAccountId' is not distinct from receipt.charge_account_id and bank.evidence->>'paymentProviderRef'=receipt.provider_payment_intent_ref
   and bank.evidence->>'providerChargeRef'=receipt.provider_charge_ref and bank.evidence->>'currency'=receipt.currency
   and (route.application_fee_minor=0 or (bank.evidence->'fee'->>'amountMinor'=route.application_fee_minor::text and bank.evidence->'fee'->>'originatingChargeRef'=receipt.provider_charge_ref
    and (receipt.application_fee_ref is null or receipt.application_fee_ref=bank.evidence->'fee'->>'providerRef')))) is true as valid
  from payments p join controlled_cash_application_links l on l.payment_id=p.id join controlled_cash_application_batches b on b.id=l.batch_id
  join controlled_cash_application_receipts proof on proof.id=l.receipt_proof_id join merchant_agreement_payment_routes route on route.payment_id=p.id
  join subscription_provider_charge_receipts receipt on receipt.id=l.receipt_id
  join merchant_cash_return_observations bank on bank.id=proof.bank_observation_id
  where p.id=${paymentId}::uuid`);
 if(!owner||owner.batchId!==batch.id)throw new ServiceError("conflict","Restore complete actual applied atomic fee ancestry; missing proof cannot fall back to an ordinary caller.");
 const[proof]=await ctx.tx.select().from(controlledCashApplicationReceipts).where(eq(controlledCashApplicationReceipts.id,owner.proofId));
 if(!owner.valid||!proof||!verifiedControlledCashReceipt(proof)||!batch.requestedReceiptIds.includes(owner.receiptId))throw new ServiceError("conflict","Restore the exact issued original receipt, route, initial returned bank and signed application proof.");
 return{...owner,revision:merchantTaxDigest({owner,batch,proof})};
}
/** No new admission or mutation. Default/old namespaces retain their original
 * rules; an actual atomic owner with unavailable evidence refuses instead of
 * falling back to per-payment arithmetic. Current raw/caller/bank debt remains
 * the responsibility of the existing genuine reconciliation boundary. */
export async function controlledAtomicRefundTarget(ctx:ServiceContext,paymentId:string):Promise<ControlledAtomicRefundTarget|null>{
 const[installed]=await ctx.tx.execute<{batches:boolean;policy:boolean}>(sql`select to_regclass('controlled_cash_application_batches') is not null as batches,to_regprocedure('freeholder_controlled_atomic_refund_targets(uuid)') is not null as policy`);
 if(!installed?.batches)return null;
 const[owner]=await ctx.tx.execute<{invoice_id:string;refunded_minor:number;linked:boolean}>(sql`select p.invoice_id,i.refunded_minor::float8,exists(select 1 from controlled_cash_application_batches b where b.invoice_id=p.invoice_id) as linked from payments p join invoices i on i.id=p.invoice_id where p.id=${paymentId}::uuid`);
 // No customer principal has returned: the unchanged original per-payment
 // target already retains the full immutable Fi. In particular a NEW genuine
 // application's own not-yet-linked staged receipt is not historical refund
 // authority and must not poison the existing canonical creation spine.
 if(!owner?.linked||owner.refunded_minor===0)return null;
 const unavailable:ControlledAtomicRefundTarget={applies:true,target:null,revision:null,resources:[],unassignedDutyMinor:null};
 const batches=await ctx.tx.select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.invoiceId,owner.invoice_id)).limit(5001);
 if(!batches.length||batches.length>5000||batches.some(row=>!verifiedControlledCashBatch(row)))return unavailable;
 if(!batches.some(row=>row.protocol===CONTROLLED_CASH_ATOMIC_PROTOCOL))return await knownAtomicFeeHistory(ctx,owner.invoice_id)?unavailable:null;
 if(!installed.policy)return unavailable;
 const rows=await ctx.tx.execute<SqlTarget>(sql`select * from freeholder_controlled_atomic_refund_targets(${owner.invoice_id}::uuid)`);
 if(!rows.length||rows.length>5000||rows.some(row=>row.known!==true)||!rows.some(row=>row.payment_id===paymentId))return unavailable;
 const proofs=await ctx.tx.select().from(controlledCashApplicationReceipts).where(inArray(controlledCashApplicationReceipts.id,rows.map(row=>row.receipt_proof_id))).limit(5001);
 if(rows.length+batches.length+proofs.length>5000||batches.some(row=>!verifiedControlledCashBatch(row))||proofs.some(row=>!verifiedControlledCashReceipt(row))
  ||batches.length!==new Set(rows.map(row=>row.batch_id)).size||proofs.length!==rows.length||rows.some(row=>!proofs.some(proof=>proof.id===row.receipt_proof_id&&proof.batchId===row.batch_id&&proof.receiptId===row.receipt_id&&proof.amountMinor===row.amount_minor&&proof.feeMinor===row.original_fee_minor))
  ||batches.some(batch=>batch.invoiceId!==owner.invoice_id||!proofs.filter(proof=>proof.batchId===batch.id).every(proof=>batch.requestedReceiptIds.includes(proof.receiptId))))return unavailable;
 const first=rows[0];if(!first)return unavailable;
 const resources=rows.map(row=>({receiptId:row.receipt_id,paymentId:row.payment_id,amountMinor:row.amount_minor,refundedMinor:row.refunded_minor,feeMinor:row.original_fee_minor,feeReturnedMinor:row.actual_fee_returned_minor}));
 let amounts:ReturnType<typeof controlledAtomicRefundAmounts>;
 try{amounts=controlledAtomicRefundAmounts({principalMinor:first.principal_minor,feeMinor:first.fee_minor,resources});}catch(error){if(!(error instanceof RangeError))throw error;return unavailable;}
 if(rows.some(row=>row.principal_minor!==first.principal_minor||row.fee_minor!==first.fee_minor||row.revision!==first.revision||amounts.resources.find(resource=>resource.paymentId===row.payment_id)?.targetRetainedFeeMinor!==row.target_retained_fee_minor))return unavailable;
 const selected=amounts.resources.find(row=>row.paymentId===paymentId);
 return{applies:true,target:selected?.targetRetainedFeeMinor??null,resources,unassignedDutyMinor:amounts.unassignedDutyMinor,revision:merchantTaxDigest({rows,batches,proofs})};
}

/** The existing fee claim otherwise locks its selected payment first. Genuine
 * atomic siblings must be locked in the canonical order BEFORE that row lock
 * so a concurrent refund cannot change the aggregate while one fee dispatch
 * is admitted. No source or foreign resource lock is acquired in reverse. */
async function lockAtomicRefundCoverage(ctx:ServiceContext,paymentId:string){
 const owner=await controlledAtomicFeeOwner(ctx,paymentId);if(!owner)return null;
 const current=await controlledAtomicRefundTarget(ctx,paymentId);
 const[installed]=await ctx.tx.execute<{present:boolean}>(sql`select to_regclass('merchant_fee_refund_invocations') is not null as present`);if(!installed?.present)throw new ServiceError("conflict","Install the actual original fee invocation protocol before another atomic refund reconciliation.");
 const{readControlledCashObservationCoverage}=await import("./controlled-cash-observation-parent");
 const{CONTROLLED_COLLECTION_PROTOCOL}=await import("@/modules/subscriptions/controlled-provider-collection-protocol");
 const coverage=await readControlledCashObservationCoverage(ctx,{collectionId:owner.collectionId,receiptId:owner.receiptId,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL});
 const{merchantFeeInvocationFinancialWitness}=await import("./merchant-fee-invocation-witnesses");
 const expected=await merchantFeeInvocationFinancialWitness(ctx.tx,{invoiceIds:[owner.invoiceId]});
 if(expected.entries.some(entry=>!coverage.entries.some(row=>row.key===`${entry.table}:${entry.id}`&&row.postgres_row===entry.fingerprint)))throw new ServiceError("conflict","Install complete current fee-invocation financial coverage before another original caller. Every actual row must remain in the full PostgreSQL fingerprint graph.");
 return{current,coverage,owner};
}
/** Current owned graph is locked contact→resource→parent→all canonical sources
 * BEFORE the fee operation row. A real pending POST remains in full coverage;
 * only its exact same-process private nonce can identify that own phase. */
export async function lockControlledAtomicRefundTarget(ctx:ServiceContext,paymentId:string){
 const context=await lockAtomicRefundCoverage(ctx,paymentId);if(!context)return;
 if(context.current?.target===null)throw new ServiceError("conflict","Restore complete exact current atomic refund targets before a new fee call.");
 const{merchantFeeRefundInvocations}=await import("./merchant-fee-invocation-schema");
 const{verifiedMerchantFeeInvocation}=await import("./merchant-fee-invocation-proof");
 const{merchantPhysicalCaller}=await import("./merchant-physical-caller");
 const{originalCashEvidenceKeys}=await import("./original-cash-recovery-store");
 const[capability]=await ctx.tx.execute<{nonce:string|null}>(sql`select current_setting('freeholder.merchant_fee_invocation_nonce',true) as nonce`);
 const nonceHash=capability?.nonce?createHash("sha256").update(capability.nonce).digest("hex"):null;
 const own=nonceHash?(await ctx.tx.select().from(merchantFeeRefundInvocations).where(eq(merchantFeeRefundInvocations.nonceHash,nonceHash)).limit(2)):[];
 const candidate=own.length===1?own[0]:undefined;
 const ownPost=candidate&&candidate.kind==="post"&&!candidate.firstResult&&!candidate.finish&&!candidate.stop&&candidate.request.paymentId===paymentId&&candidate.caller.id===merchantPhysicalCaller().id&&verifiedMerchantFeeInvocation(candidate,originalCashEvidenceKeys())?candidate:null;
 if(context.coverage.unfinishedCallers.some(caller=>caller.kind!=="fee_invocation"||caller.id!==ownPost?.id))throw new ServiceError("conflict","Keep every unrelated original physical caller as debt before a new fee call.");
 const{controlledCollectionCoverage}=await import("@/modules/subscriptions/controlled-provider-collection-coverage");
 const{parentFinancialGraphForTx}=await import("./controlled-provider-financial-parent");
 const{controlledTargetRawClassification}=await import("./controlled-target-raw-classification");
 const graph=await parentFinancialGraphForTx(ctx.tx,context.owner.subscriptionId),coverage=await controlledCollectionCoverage(ctx.tx,{subscriptionId:context.owner.subscriptionId});
 const raw=await controlledTargetRawClassification(ctx.tx,context.owner.subscriptionId,coverage,graph);
 if(raw.unresolvedFactIds.length)throw new ServiceError("conflict","Resolve every exact original raw financial occurrence before returning additional original commission; another known fee or equal amount cannot adopt it.");
 // No entry is removed from coverage or its current revision.
}
/** Recording an actual earlier ACK cannot erase other current caller debt or
 * require that money to disappear. This acquires the same genuine prefix but
 * grants no new SDK dispatch or current-target entitlement. */
export async function lockControlledAtomicRefundEvidence(ctx:ServiceContext,paymentId:string){
 return lockAtomicRefundCoverage(ctx,paymentId);
}

/** A planned target is not an actual physical return. In particular the
 * whole-invoice duty must keep the cent pending until the original fee ACK
 * and an actual bank observation agree with its exact retained resources. */
export async function controlledAtomicRefundFeeState(ctx:ServiceContext,paymentId:string):Promise<ControlledAtomicRefundFeeState|null>{
 const target=await controlledAtomicRefundTarget(ctx,paymentId);if(!target)return null;
 if(target.target===null)return{pending:true,actualRetainedFeeMinor:null,proof:null};
 const[state]=await ctx.tx.execute<SqlFeeState>(sql`select * from freeholder_controlled_atomic_refund_fee_state(${paymentId}::uuid)`);
 let authenticBank:Awaited<ReturnType<typeof import("@/modules/subscriptions/controlled-cash-inspection-lineage").latestControlledCashInspectionLineage>>|null=null;
 if(state?.reconciled===true&&state.inspection_id){
  const{latestControlledCashInspectionLineage}=await import("@/modules/subscriptions/controlled-cash-inspection-lineage");
  try{const latest=await latestControlledCashInspectionLineage(ctx.tx,state.receipt_id);if(latest.inspection.id===state.inspection_id)authenticBank=latest;}catch(error){if(!(error instanceof ServiceError)||!["conflict","not_found","validation"].includes(error.code))throw error;authenticBank=null;}
 }
 const{merchantFeeRefunds}=await import("./merchant-collection-schema");
 const{merchantFeeInvocationPaymentCallers,merchantFeeInvocationCallersClosed,merchantFeeInvocations}=await import("./merchant-fee-invocation-store");
 const fees=await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId,paymentId)).limit(5001);
 const callers=await merchantFeeInvocationPaymentCallers(ctx.tx,paymentId);
 let closed=fees.length<=5000&&!callers.unfinishedIds.length;
 for(const fee of fees)if(!await merchantFeeInvocationCallersClosed(ctx.tx,fee.id))closed=false;
 if(state?.known!==true||state.reconciled!==true||!authenticBank||!Number.isSafeInteger(state.actual_retained_fee_minor)||state.actual_retained_fee_minor<0||target.unassignedDutyMinor!==0||!closed)return{pending:true,actualRetainedFeeMinor:state?.known===true?state.actual_retained_fee_minor:null,proof:null};
 const resource=target.resources.find(row=>row.paymentId===paymentId),invocations=await merchantFeeInvocations(ctx.tx,paymentId);
 if(!resource||invocations.length+fees.length>5000||!state.inspection_id||!state.observation_id||!state.bank_namespace_revision)return{pending:true,actualRetainedFeeMinor:state.actual_retained_fee_minor,proof:null};
 const owner=await controlledAtomicFeeOwner(ctx,paymentId);if(!owner)return{pending:true,actualRetainedFeeMinor:state.actual_retained_fee_minor,proof:null};
 const{parentFinancialGraphForTx}=await import("./controlled-provider-financial-parent");
 const{controlledObservationEntries}=await import("./controlled-cash-observation-revision");
 const{merchantFeeInvocationFinancialWitness}=await import("./merchant-fee-invocation-witnesses");
 const graph=await parentFinancialGraphForTx(ctx.tx,owner.subscriptionId),feeWitness=await merchantFeeInvocationFinancialWitness(ctx.tx,{invoiceIds:[owner.invoiceId]});
 const physical=controlledObservationEntries([
  ...graph.physical.map(row=>({...row,domain:row.table==="subscription_provider_schedule_resources"?"schedule_stable" as const:"postgres_row" as const})),
  ...graph.children.entries.map(row=>({...row,domain:row.table.startsWith("subscription_controlled_")||row.table==="merchant_cash_return_inspection_stops"||row.table==="merchant_fee_refund_invocations"?"postgres_row" as const:"dependency_canonical" as const})),
  ...[...graph.proration.entries,...graph.controlled.entries,...feeWitness.entries].map(row=>({...row,domain:"postgres_row" as const})),
 ]).full;
 const[after]=await ctx.tx.execute<SqlFeeState>(sql`select * from freeholder_controlled_atomic_refund_fee_state(${paymentId}::uuid)`);
 if(!after||merchantTaxDigest(after)!==merchantTaxDigest(state))return{pending:true,actualRetainedFeeMinor:null,proof:null};
 const proof:ControlledAtomicRefundFeeProof={paymentId,receiptId:state.receipt_id,inspectionId:state.inspection_id,bankObservationId:state.observation_id,bankNamespaceRevision:state.bank_namespace_revision,namespaceKey:owner.namespaceKey,originalFeeRef:owner.applicationFeeRef,originalFeeMinor:resource.feeMinor,acceptedReturnedFeeMinor:resource.feeReturnedMinor,targetRetainedFeeMinor:target.target,
  actualRetainedFeeMinor:state.actual_retained_fee_minor,feeOperationIds:fees.map(row=>row.id).sort(),invocationIds:invocations.map(row=>row.id).sort(),revision:merchantTaxDigest({target,state,authenticBank,fees,invocations,physical})};
 return{pending:false,actualRetainedFeeMinor:state.actual_retained_fee_minor,proof};
}
