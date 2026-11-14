// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: actual batch bank evidence, separate from CURRENT parent authority.
import { and,asc,eq,sql } from "drizzle-orm";
import { z } from "zod";
import type { ServiceContext } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { invoiceOutstanding } from "@/modules/invoicing/invoice-balance";
import { merchantAgreementPaymentRoutes } from "@/modules/invoicing/merchant-agreement-schema";
import { payments } from "@/modules/invoicing/schema";
import { commercialInvoiceCashHistory } from "@/modules/invoicing/commercial-attestations";
import { invoiceCashFeeAllocation,invoiceCashFeeBudget } from "@/modules/invoicing/invoice-credit-cash-fee";
import { controlledAtomicFeeAmounts } from "@/modules/invoicing/controlled-cash-atomic-fee-amounts";
import { controlledCashBankApplicationEvidence } from "@/modules/invoicing/controlled-cash-application-bank-policy";
import { originalCashInspectionBankFacts } from "@/modules/invoicing/merchant-cash-inspection-bank-facts";
import type { MerchantRefundCashOrigin } from "@/modules/invoicing/merchant-refund-origin";
import { merchantReturnedCashEvidenceSchema } from "@/modules/invoicing/merchant-returned-cash-contract";
import { requireHeldControlledCashResource } from "@/modules/invoicing/controlled-cash-inspection-observation-context";
import { originalCashCallersFinished,originalCashRecoveryCashWitness } from "@/modules/invoicing/original-cash-recovery-store";
import { subscriptionProviderChargeReceipts } from "./schema";
import { controlledCollectionState } from "./controlled-provider-collection-state";
import { readControlledCashObservationSource } from "./controlled-provider-cash-observation-source";
import { latestControlledCashInspectionLineage } from "./controlled-cash-inspection-lineage";
import { controlledRawFinancialReview } from "./controlled-provider-raw-financial-review";
import { CONTROLLED_COLLECTION_PROTOCOL } from "./controlled-provider-collection-protocol";
import { controlledCashManifest,refuseControlledCash } from "./controlled-provider-collection-cash-manifest";
import { controlledProspectiveRawBindings } from "./controlled-provider-cash-prospective-occurrences";
import { controlledCashBankExpectation,controlledCashPhysicalEntry,controlledCollectionCashProof,type ControlledCashReceiptProof,type ControlledCollectionCashProof } from "./controlled-provider-collection-cash-contract";
export { controlledCollectionCashProof,type ControlledCollectionCashProof } from "./controlled-provider-collection-cash-contract";
const request=z.object({collectionId:z.uuid(),receiptIds:z.array(z.uuid()).min(1).max(5000)}).strict().refine(value=>new Set(value.receiptIds).size===value.receiptIds.length&&value.receiptIds.every((id,i,ids)=>{const previous=ids[i-1];return i===0||previous!==undefined&&previous<id;}),"Provide the exact sorted unique receipt UUID batch.");
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const bankRow=z.object({actual_inspection_id:z.uuid(),actual_observation_id:z.uuid(),current_evidence:merchantReturnedCashEvidenceSchema,original_expectation:z.record(z.string(),z.unknown()),bank_witness:z.array(z.object({table:z.string(),id:z.string(),fingerprint:sha}).strict()).min(1).max(5000),bank_fingerprint:sha,immutable_bank_fingerprint:sha,admitted_source_history_digest:sha}).strict();
const bigintNumber=(value:bigint)=>{const number=Number(value);if(!Number.isSafeInteger(number)||number<0)refuseControlledCash();return number;};
/** No SDK, write, fake context, historical parent equality or allowed flag.
 * Outer genuine application caller already holds contact→resource→parent→
 * sorted canonical locks. Namespace locks below follow that prefix. The parent
 * MUST independently authenticate its complete CURRENT batch/caller/privacy/
 * financial graph and recheck this source proof immediately before mutation. */
async function readControlledCollectionCash(ctx:ServiceContext,rawInput:{collectionId:string;receiptIds:string[]},atomic:boolean):Promise<ControlledCollectionCashProof>{
 const input=request.parse(rawInput),source=await controlledCollectionState(ctx.tx,input.collectionId),{collection,resource,parent,history,canonical,manifest}=source;
 await requireHeldControlledCashResource(ctx,resource.id);
 if(history.unfinished.length||history.closures.length||!canonical.currentCollectible||canonical.invoice.refundedMinor!==0)refuseControlledCash();
 const bank=controlledCashManifest(source);
 const ownedReceipts=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(and(eq(subscriptionProviderChargeReceipts.subscriptionId,parent.id),eq(subscriptionProviderChargeReceipts.providerPlatformAccountId,resource.originalScope.providerPlatformAccountId),
  sql`${subscriptionProviderChargeReceipts.chargeAccountId} is not distinct from ${resource.originalScope.providerAccountId??null}`,eq(subscriptionProviderChargeReceipts.providerInvoiceRef,bank.providerInvoiceRef),eq(subscriptionProviderChargeReceipts.providerSubscriptionRef,bank.providerSubscriptionRef))).orderBy(asc(subscriptionProviderChargeReceipts.id)).limit(5001);
 if(ownedReceipts.length!==bank.cash.length||ownedReceipts.length>5000||input.receiptIds.some(id=>!ownedReceipts.some(row=>row.id===id)))refuseControlledCash();
 // Acquire ALL known original namespaces in deterministic order before reading
 // any bank tuple. Actual callback ingress uses these same exact namespace keys.
 const namespaces=ownedReceipts.map(row=>`subscription-cash:${row.providerPlatformAccountId}:${row.chargeAccountId??""}:${row.providerPaymentIntentRef}`).sort();
 for(const namespace of namespaces)await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${namespace}))`);
 const prior=await commercialInvoiceCashHistory(ctx,canonical.invoice);
 if(prior.pending||prior.refunded!==0n||prior.cash!==BigInt(canonical.invoice.paidMinor))refuseControlledCash();
 const actualPriorCashMinor=bigintNumber(prior.cash),actualPriorAllocatedFeeMinor=bigintNumber(prior.allocatedFee);
 let plannedCash=actualPriorCashMinor,plannedFee=actualPriorAllocatedFeeMinor;const unfinishedInspectionIds:string[]=[],unfinishedNamespaceCallers:Array<{kind:"refund"|"recovery";id:string}>=[],precedingReceiptIds:string[]=[],proofs:ControlledCashReceiptProof[]=[],allBankProofs:ControlledCashReceiptProof[]=[],physical=new Map<string,string>();
 for(const receipt of ownedReceipts){
  const actual=bank.cash.find(row=>row.providerPaymentIntentRef===receipt.providerPaymentIntentRef);
  if(!actual||actual.amountMinor!==receipt.amountMinor||actual.currency!==receipt.currency||actual.providerChargeRef!==receipt.providerChargeRef||!receipt.providerChargeRef||receipt.currency!==manifest.currency)refuseControlledCash();
  const identity=await readControlledCashObservationSource(ctx.tx,{collectionId:collection.id,receiptId:receipt.id});if(identity.unfinishedControlledCallIds.length)refuseControlledCash();
  const routes=await ctx.tx.select({route:merchantAgreementPaymentRoutes,payment:payments}).from(merchantAgreementPaymentRoutes).innerJoin(payments,eq(payments.id,merchantAgreementPaymentRoutes.paymentId)).where(eq(merchantAgreementPaymentRoutes.originalChargeReceiptId,receipt.id)).limit(2);
  if(routes.length>1)refuseControlledCash();const existing=routes[0];
  if(existing&&(existing.payment.invoiceId!==canonical.invoice.id||existing.payment.status!=="succeeded"||existing.payment.provider!=="stripe"||existing.payment.providerRef!==receipt.providerPaymentIntentRef||existing.payment.currency!==receipt.currency||existing.payment.amountMinor!==receipt.amountMinor||existing.payment.refundedMinor!==0
   ||existing.route.subscriptionId!==parent.id||existing.route.providerPlatformAccountId!==receipt.providerPlatformAccountId||existing.route.chargeAccountId!==receipt.chargeAccountId||existing.route.providerInvoiceRef!==receipt.providerInvoiceRef))refuseControlledCash();
  const requested=input.receiptIds.includes(receipt.id);if(!existing&&!requested)refuseControlledCash();
  const allocation=existing||atomic?null:await invoiceCashFeeAllocation(ctx,canonical.invoice,canonical.marketPolicy.feeMinor,{amountMinor:receipt.amountMinor,priorCashMinor:plannedCash,priorAllocatedFeeMinor:plannedFee});
  const latest=await latestControlledCashInspectionLineage(ctx.tx,receipt.id);
  const unfinished=latest.admissions.filter(row=>!latest.finishes.some(finish=>finish.inspectionId===row.id&&finish.callerInstanceId===row.caller.id)&&!latest.stops.some(stop=>stop.inspectionId===row.id));
  unfinishedInspectionIds.push(...unfinished.map(row=>row.id));if(unfinished.length)refuseControlledCash();
  const namespaceCallers=await ctx.tx.execute<{kind:"refund"|"recovery";id:string}>(sql`
   select 'refund'::text as kind,dispatch.id::text as id from merchant_refund_dispatches dispatch join merchant_refund_requests request on request.id=dispatch.request_id
   left join merchant_refund_dispatch_finishes finish on finish.dispatch_id=dispatch.id left join merchant_refund_dispatch_stops stop on stop.dispatch_id=dispatch.id
   where request.provider_platform_account_id=${receipt.providerPlatformAccountId} and request.charge_account_id is not distinct from ${receipt.chargeAccountId} and request.original_payment_ref=${receipt.providerPaymentIntentRef}
    and ((finish.dispatch_id is null and stop.dispatch_id is null) or(finish.dispatch_id is not null and stop.dispatch_id is not null)
     or(finish.dispatch_id is not null and(finish.caller_instance_id::text is distinct from dispatch.caller->>'id' or finish.outcome not in('returned','threw')))
     or(stop.dispatch_id is not null and(stop.caller_instance_id::text is distinct from dispatch.caller->>'id' or stop.request_digest is distinct from dispatch.request_digest)))
   union all select 'recovery',operation.id::text from original_cash_recovery_operations operation join original_cash_recoveries owner on owner.id=operation.recovery_id
   where owner.owner->'cash'->>'providerPlatformAccountId'=${receipt.providerPlatformAccountId} and owner.owner->'cash'->>'chargeAccountId' is not distinct from ${receipt.chargeAccountId} and owner.owner->'cash'->>'providerRef'=${receipt.providerPaymentIntentRef}
    and not exists(select 1 from original_cash_recovery_facts fact where fact.operation_id=operation.id and(fact.kind='finish' and fact.evidence->>'callerInstanceId'=operation.caller->>'id' and fact.evidence->>'outcome' in('returned','threw') or fact.kind='stop' and fact.evidence->>'operationDigest'=operation.digest))
   order by 1,2 limit 5001`);
  if(namespaceCallers.length)refuseControlledCash();unfinishedNamespaceCallers.push(...namespaceCallers);
  if(latest.inspection.subscriptionChargeReceiptId!==receipt.id||latest.inspection.subscriptionChargeObservationId===null)refuseControlledCash();
  const rows=await ctx.tx.execute(sql`select * from freeholder_controlled_receipt_bank_observation(${collection.id}::uuid,${receipt.id}::uuid)`);
  if(rows.length!==1)refuseControlledCash();const sqlBank=bankRow.parse(rows[0]);
  // An atomic batch uses the fee physically observed on THIS exact charge.
  // Neutral bank/route/refund/recipient checks below still authenticate it;
  // only the complete actual endpoint determines the cumulative policy.
  const feeMinor=existing?.route.applicationFeeMinor??(atomic?sqlBank.current_evidence.fee?.amountMinor??0:allocation?.feeMinor);if(feeMinor===undefined)refuseControlledCash();
  const feeAllocation={basis:existing?"existing_original_route" as const:atomic?"actual_atomic_batch" as const:"actual_prior_and_exact_earlier_batch" as const,actualPriorCashMinor,actualPriorAllocatedFeeMinor,precedingReceiptIds:existing?[]:[...precedingReceiptIds],priorCashMinor:existing?actualPriorCashMinor:plannedCash,priorAllocatedFeeMinor:existing?actualPriorAllocatedFeeMinor:plannedFee,feeMinor,
   revision:merchantTaxDigest({receiptId:receipt.id,originalRoute:existing?.route??null,actualPriorCashMinor,actualPriorAllocatedFeeMinor,precedingReceiptIds:existing?[]:precedingReceiptIds,plannedCash:existing?null:plannedCash,plannedFee:existing?null:plannedFee,allocation,...(atomic?{atomicBankFingerprint:sqlBank.immutable_bank_fingerprint}: {})})};
  if(sqlBank.actual_inspection_id!==latest.inspection.id||!sqlBank.bank_witness.some(row=>row.table==="subscription_controlled_cash_inspection_lineages"&&row.id===latest.inspection.id))refuseControlledCash();
  const originalExpectation=controlledCashBankExpectation.parse({providerApiVersion:resource.originalScope.providerApiVersion,providerPlatformAccountId:resource.originalScope.providerPlatformAccountId,providerAccountId:resource.originalScope.providerAccountId,destinationAccountId:resource.originalScope.destinationAccountId,settlementMerchantAccountId:resource.originalScope.settlementMerchantAccountId,
   providerRef:receipt.providerPaymentIntentRef,chargeRef:receipt.providerChargeRef,amountMinor:receipt.amountMinor,currency:receipt.currency,feeMinor,originalFeeRef:receipt.applicationFeeRef,customerChargeVerified:receipt.customerChargeVerified&&actual.customerChargeVerified,merchantRouteVerified:receipt.merchantRouteVerified&&actual.merchantRouteVerified});
  const actualOriginalExpectation={...resource.originalScope,providerRef:receipt.providerPaymentIntentRef,chargeRef:receipt.providerChargeRef,amountMinor:receipt.amountMinor,currency:receipt.currency,originalFeeRef:receipt.applicationFeeRef,customerChargeVerified:receipt.customerChargeVerified,merchantRouteVerified:receipt.merchantRouteVerified};
  if(merchantTaxDigest(sqlBank.original_expectation)!==merchantTaxDigest(actualOriginalExpectation))refuseControlledCash();
  const cash:MerchantRefundCashOrigin={paymentId:null,originalObservationId:null,subscriptionChargeReceiptId:receipt.id,subscriptionChargeObservationId:latest.inspection.subscriptionChargeObservationId,providerPlatformAccountId:receipt.providerPlatformAccountId,chargeAccountId:receipt.chargeAccountId,providerApiVersion:"2026-10-28.endive",providerRef:receipt.providerPaymentIntentRef,amountMinor:receipt.amountMinor,currency:receipt.currency,applied:!!existing,
   originalChargeRef:receipt.providerChargeRef,originalFeeRef:receipt.applicationFeeRef,subscriptionOrigin:{providerApiVersion:"2026-10-28.endive",providerSubscriptionRef:receipt.providerSubscriptionRef,providerInvoiceRef:receipt.providerInvoiceRef,providerPaymentIntentRef:receipt.providerPaymentIntentRef}};
  const facts=await originalCashInspectionBankFacts(ctx.tx,latest.inspection,cash,sqlBank.actual_observation_id);
  if(!facts||merchantTaxDigest(facts.evidence)!==merchantTaxDigest(sqlBank.current_evidence)||facts.finish.callerInstanceId!==latest.inspection.caller.id)refuseControlledCash();
  const recovery=await originalCashRecoveryCashWitness(ctx.tx,cash);if(!originalCashCallersFinished(recovery))refuseControlledCash();
  const verdict=await ctx.tx.execute<{eligible:boolean}>(sql`select freeholder_controlled_bank_unreturned(${JSON.stringify(originalExpectation)}::jsonb,${JSON.stringify(facts.evidence)}::jsonb) as eligible`);
  const actualPaymentEvidence=controlledCashBankApplicationEvidence(originalExpectation,facts.evidence);
  if(verdict.length!==1||verdict[0]?.eligible!==true||!actualPaymentEvidence)refuseControlledCash();
  const physicalWitnessEntries=sqlBank.bank_witness.map(row=>controlledCashPhysicalEntry.parse({...row,hashDomain:"postgres_row"}));
  for(const row of physicalWitnessEntries){const key=`${row.table}:${row.id}`,previous=physical.get(key);if(previous!==undefined&&previous!==row.fingerprint)refuseControlledCash();physical.set(key,row.fingerprint);}
  if(physical.size>5000)refuseControlledCash();
  const receiptProof={receiptId:receipt.id,amountMinor:receipt.amountMinor,currency:receipt.currency,originOperationId:identity.originOperationId,originCallId:identity.originCallId,originFactId:identity.originFactId,originalObservationIds:identity.originalObservationIds,
   inspectionId:latest.inspection.id,bankObservationId:facts.observation.id,finishCallerId:facts.finish.callerInstanceId,immutableBankRevision:sqlBank.immutable_bank_fingerprint,namespaceRevision:sqlBank.bank_fingerprint,physicalWitnessEntries,actualPaymentEvidence,actualBankEvidence:facts.evidence,originalExpectation,feeAllocation,existingPaymentId:existing?.payment.id??null,
   originRevision:merchantTaxDigest({source:identity.sourceRevision,lineage:latest.revision,originalReceipt:receipt,originalRoute:existing?.route??null,bankOriginalExpectation:sqlBank.original_expectation,recovery:merchantTaxDigest(recovery)})};
  allBankProofs.push(receiptProof);if(requested)proofs.push(receiptProof);
  if(!existing){plannedCash=bigintNumber(BigInt(plannedCash)+BigInt(receipt.amountMinor));plannedFee=bigintNumber(BigInt(plannedFee)+BigInt(feeMinor));precedingReceiptIds.push(receipt.id);}
 }
 if(proofs.length!==input.receiptIds.length||plannedCash>canonical.invoice.totalMinor-canonical.invoice.creditedMinor)refuseControlledCash();
 let atomicFeePolicy:ControlledCollectionCashProof["atomicFeePolicy"];
 if(atomic){
  const budget=await invoiceCashFeeBudget(ctx,canonical.invoice,canonical.marketPolicy.feeMinor);
  const amounts=controlledAtomicFeeAmounts({principalMinor:budget.principalMinor,feeTargetMinor:budget.physicalFeeTargetMinor,actualPriorCashMinor,actualPriorAllocatedFeeMinor,
   receipts:proofs.filter(row=>row.existingPaymentId===null).map(row=>({receiptId:row.receiptId,amountMinor:row.amountMinor,feeMinor:row.feeAllocation.feeMinor}))});
  const policy={kind:"actual_atomic_batch" as const,principalMinor:budget.principalMinor,feeTargetMinor:budget.physicalFeeTargetMinor,actualPriorCashMinor,actualPriorAllocatedFeeMinor,batchCashMinor:amounts.batchCashMinor,batchFeeMinor:amounts.batchFeeMinor};
  atomicFeePolicy={...policy,revision:merchantTaxDigest({policy,budget,actualReceipts:proofs.map(row=>({receiptId:row.receiptId,bank:row.immutableBankRevision,fee:row.feeAllocation}))})};
 }
 const currentCanonical={outstandingMinor:invoiceOutstanding(canonical.invoice),totalMinor:canonical.invoice.totalMinor,creditedMinor:canonical.invoice.creditedMinor,paidMinor:canonical.invoice.paidMinor,refundedMinor:canonical.invoice.refundedMinor,currentCollectible:canonical.currentCollectible,originalCreditNoteId:collection.creditNoteId,
  originalCreditFundingIds:canonical.funding.map(row=>row.id).sort(),creditReservationIds:canonical.reservations.map(row=>row.id).sort(),creditApplicationIds:canonical.applications.map(row=>row.reservationId).sort(),feeDutyId:canonical.feeDuty?.invoiceId??null,feeCreditAssignmentIds:canonical.feeCreditAssignments.map(row=>row.applicationId).sort(),
  creditRevision:merchantTaxDigest({funding:canonical.funding,notes:canonical.notes,noteLines:canonical.noteLines,reservations:canonical.reservations,applications:canonical.applications,releases:canonical.releases}),feeRevision:merchantTaxDigest({originalPolicy:canonical.marketPolicy,duty:canonical.feeDuty,creditAssignments:canonical.feeCreditAssignments,actualPriorCash:{cash:actualPriorCashMinor,refunded:bigintNumber(prior.refunded),allocatedFee:actualPriorAllocatedFeeMinor,pending:prior.pending}}),revision:merchantTaxDigest({invoice:canonical.invoice,acceptedTarget:canonical.digest})};
 const prospectiveRawBindings=controlledProspectiveRawBindings(source,bank,ownedReceipts),rawReviewFactIds=controlledRawFinancialReview(resource,history).factIds;
 const preApplicationRevision=merchantTaxDigest({collectionId:collection.id,requestedReceiptIds:input.receiptIds,canonical:currentCanonical,actualBankProofs:allBankProofs.map(row=>({receiptId:row.receiptId,immutableBankRevision:row.immutableBankRevision,namespaceRevision:row.namespaceRevision,originRevision:row.originRevision,feeAllocation:row.feeAllocation})),prospectiveRawBindings,rawReviewFactIds,currentControlledJournalRevision:history.revision,...(atomicFeePolicy?{atomicFeePolicy}:{})});
 return controlledCollectionCashProof.parse({protocol:CONTROLLED_COLLECTION_PROTOCOL,collectionId:collection.id,quoteId:collection.quoteId,resourceId:resource.id,subscriptionId:parent.id,invoiceId:canonical.invoice.id,termsId:collection.termsId,acceptedQuoteDigest:collection.acceptedQuoteDigest,canonicalTargetDigest:collection.canonicalTargetDigest,requestedReceiptIds:input.receiptIds,
  bankInvoice:{providerSubscriptionRef:bank.providerSubscriptionRef,providerInvoiceRef:bank.providerInvoiceRef,providerCustomerRef:resource.originalScope.providerCustomerRef,currency:manifest.currency,status:bank.status,totalMinor:bank.totalMinor,paidMinor:bank.paidMinor,remainingMinor:bank.remainingMinor,positiveReceiptIds:ownedReceipts.map(row=>row.id),manifestOperationId:bank.operation.id,manifestCallId:bank.read.callId,manifestResultDigest:bank.read.actualResultDigest,manifestDigest:merchantTaxDigest(manifest),zeroWalletProofDigest:bank.zeroWalletProofDigest},
  canonical:currentCanonical,receipts:proofs,...(atomicFeePolicy?{atomicFeePolicy}:{}),prospectiveRawBindings,rawReviewFactIds,unfinishedControlledCallIds:history.unfinished,unfinishedInspectionIds,unfinishedNamespaceCallers,preApplicationRevision,sourceRevision:merchantTaxDigest({preApplicationRevision,allActualBankRows:allBankProofs,bankManifestResult:bank.read.actualResultDigest}),suppliesObservationAuthority:false,suppliesPrincipalAuthority:false,suppliesApplicationAuthority:false,suppliesAccessAuthority:false});
}
/** Historical/default singleton and batch readers retain exact prefix floors. */
export async function readControlledCollectionCashAuthority(ctx:ServiceContext,input:{collectionId:string;receiptIds:string[]}){return readControlledCollectionCash(ctx,input,false);}
/** Internal real batch writer only. No public DTO/policy selector is accepted. */
export async function readControlledAtomicCollectionCashAuthority(ctx:ServiceContext,input:{collectionId:string;receiptIds:string[]}){return readControlledCollectionCash(ctx,input,true);}
/** Singleton is still an explicit actual UUID batch; never amount discovery. */
export async function readControlledReceiptCashAuthority(ctx:ServiceContext,input:{collectionId:string;receiptId:string}){return readControlledCollectionCashAuthority(ctx,{collectionId:input.collectionId,receiptIds:[input.receiptId]});}
