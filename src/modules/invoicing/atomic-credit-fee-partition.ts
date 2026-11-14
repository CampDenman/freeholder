// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: genuine current source proof and immutable fee epoch are distinct.
import {sql} from "drizzle-orm";
import {z} from "zod";
import {getService,ServiceError,type ServiceContext} from "@/core/service";
import {ATOMIC_CREDIT_FEE_PROTOCOL} from "./atomic-credit-fee-protocol";
import {atomicCreditFeeEconomicPlan,atomicCreditFeeStoredEconomics} from "./atomic-credit-fee-partition-contract";
import {atomicCreditFeeCapacities,type AtomicCreditFeeCapacityInput} from "./atomic-credit-fee-amounts";
import {selectAtomicCreditFeeSegments} from "./atomic-credit-reservation-segments";
import type {AtomicCreditFeeSegment} from "./atomic-credit-reservation-contract";
import {readAtomicCreditFeeAncestry} from "./atomic-credit-fee-ancestry";
import {assertAtomicCreditSourcePrefix} from "./atomic-credit-source-prefix";
import {controlledAtomicFeeOwner,controlledAtomicRefundFeeState,controlledAtomicRefundTarget} from "./controlled-atomic-refund-target";
import {readAtomicFeeReturnResources} from "./atomic-fee-return-resources";
import {readControlledCanonicalBankPrincipal} from "./controlled-canonical-bank-principal";
import {originalMerchantRefundCash} from "./merchant-refund-origin";
import {routingForPayment} from "./merchant-charge";
import {parentFinancialGraphForTx} from "./controlled-provider-financial-parent";
import {controlledObservationEntries,type ObservationFingerprint} from "./controlled-cash-observation-revision";
import {principalAuthorityResult} from "./principal-authority-contract";
import {merchantTaxDigest} from "./merchant-tax-store";
function refuse():never{throw new ServiceError("conflict","Restore the complete current original atomic fee, every sibling disposition and exact unreturned credit source; a planned target, older bank read or missing partition cannot supply collected capacity.");}
/** Ordinary real-context reader only. No money/access authority, registration,
 * provider I/O, lock acquisition or caller/debt exclusion. The outer writer
 * discovers and holds the COMPLETE prefix before any canonical source lock.
 * Known atomic sources never fall back when the genuine installed proof fails.
 */
export async function controlledAtomicCreditFeePartition(ctx:ServiceContext,input:{paymentId:string;sourceApplicationId:string|null;takeMinor:number}){
 if(!z.uuid().safeParse(input.paymentId).success||input.sourceApplicationId!==null&&!z.uuid().safeParse(input.sourceApplicationId).success||!Number.isSafeInteger(input.takeMinor)||input.takeMinor<0)refuse();
 const owner=await controlledAtomicFeeOwner(ctx,input.paymentId);if(!owner)return null;
 const prefix=await assertAtomicCreditSourcePrefix(ctx,[input.paymentId]);
 const[installed]=await ctx.tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_credit_atomic_fee_ready()') is not null as present`);if(installed?.present!==true)refuse();
 const[ready]=await ctx.tx.execute<{ready:boolean}>(sql`select freeholder_credit_atomic_fee_ready() as ready`);if(ready?.ready!==true)refuse();
 const ancestry=await readAtomicCreditFeeAncestry(ctx.tx,input.paymentId),payment=ancestry.payment;
 if(payment.refundedMinor!==0||payment.status!=="succeeded"||payment.invoiceId!==owner.invoiceId)refuse();
 const routing=await routingForPayment(ctx,payment.id);
 if(routing.originalChargeReceiptId!==owner.receiptId||routing.applicationFeeMinor===undefined)refuse();
 const originalCash=await originalMerchantRefundCash(ctx,{kind:"payment",paymentId:payment.id});
 const bank=await readControlledCanonicalBankPrincipal(ctx,payment,originalCash);
 if(!bank.applies||!bank.principalMatches||bank.ancillaryDebtPending||bank.receiptId!==owner.receiptId||bank.collectionId!==owner.collectionId)refuse();
 const authority=getService("invoicing.originalPrincipalAuthority");if(!authority)refuse();
 const principal=principalAuthorityResult.parse(await ctx.callAsSystem(authority,{paymentId:payment.id}));if(!principal.principalSafe||principal.witness.paymentId!==payment.id)refuse();
 const target=await controlledAtomicRefundTarget(ctx,payment.id),state=await controlledAtomicRefundFeeState(ctx,payment.id),returns=await readAtomicFeeReturnResources(ctx,payment.id);
 if(!returns||returns.pendingOperationIds.length||returns.unfinishedIds.length||returns.binding.route.applicationFeeMinor!==routing.applicationFeeMinor)refuse();
 // With no principal refund the original full Fi must still be physically
 // present. An out-of-band fee return is not a new smaller economic epoch.
 if(!target&&(state!==null||ancestry.originalInvoice.refundedMinor!==0||returns.returnedMinor!==0))refuse();
 if(target&&(target.target===null||target.unassignedDutyMinor!==0||!state||state.pending||state.proof.paymentId!==payment.id||state.proof.receiptId!==owner.receiptId
  ||state.proof.inspectionId!==bank.inspectionId||state.proof.bankObservationId!==bank.observationId||state.proof.originalFeeMinor!==routing.applicationFeeMinor
  ||state.proof.acceptedReturnedFeeMinor!==returns.returnedMinor||state.proof.actualRetainedFeeMinor!==state.proof.targetRetainedFeeMinor))refuse();
 const retired=returns.returnedMinor,collected=state&&!state.pending?state.actualRetainedFeeMinor:routing.applicationFeeMinor;
 if(collected+retired!==routing.applicationFeeMinor)refuse();
 const visiting=new Set<string>();
 type Capacity={amounts:ReturnType<typeof atomicCreditFeeCapacities>;rootFundingId:string|null;rootEconomicRevision:string|null;originalRootPrincipalMinor:number;originalRootFeeMinor:number;sourceSegments:AtomicCreditFeeSegment[];takeSegments:AtomicCreditFeeSegment[]};
 const capacity=(sourceApplicationId:string|null,takeMinor:number):Capacity=>{
  const key=sourceApplicationId??"direct";if(visiting.has(key))refuse();visiting.add(key);
  const originalPrincipalMinor=payment.amountMinor,originalFeeMinor=routing.applicationFeeMinor,acceptedRetiredFeeMinor=retired,actualCollectedFeeMinor=collected;
  if(sourceApplicationId){
   const application=ancestry.applications.find(row=>row.reservationId===sourceApplicationId),reservation=ancestry.reservations.find(row=>row.id===sourceApplicationId),parent=reservation&&ancestry.funding.find(row=>row.id===reservation.fundingId);
   if(!application||!reservation||!parent||parent.sourcePaymentId!==payment.id||application.feeUnexpected||reservation.feeUnexpected||parent.feeUnexpected
    ||!["not_due","recorded_remitted","verified_collected"].includes(application.feeCollectionState)||application.feeProvenCollectedMinor!==application.feeObligationMinor)refuse();
   const root=capacity(parent.sourceApplicationId,0),reservationChild=ancestry.reservationPartitions.find(row=>row.reservationId===sourceApplicationId);
   // An inherited promise is usable only while its ORIGINAL entire assigned
   // source prefix is actually covered. No later partial rebasing at399/4199.
   if(root.amounts.currentOwedAssignedFeeMinor!==0||root.amounts.declaredProvenFeeMinor<parent.feeProvenCollectedMinor||!reservationChild)refuse();
   const economic=reservationChild.economics,sourceSegments=economic.segments,existing=ancestry.funding.filter(row=>row.sourceApplicationId===sourceApplicationId);
   const occupied=existing.map(row=>{
    const child=ancestry.partitions.find(value=>value.fundingId===row.id);if(!child||child.economics.plan.rootFundingId!==economic.rootFundingId
     ||child.economics.plan.rootEconomicRevision!==economic.rootEconomicRevision||merchantTaxDigest(child.economics.plan.sourceSegments)!==merchantTaxDigest(sourceSegments))refuse();
    return{reservationId:row.id,segments:child.economics.plan.takeSegments};
   });
   const selected=selectAtomicCreditFeeSegments({originalPrincipalMinor:economic.originalPrincipalMinor,originalFeeMinor:economic.originalFeeMinor,sourceSegments,occupied,takeMinor});
   const declaredProven=existing.reduce((sum,row)=>sum+BigInt(row.feeProvenCollectedMinor),0n);
   if(selected.whole.amountMinor!==reservation.amountMinor||selected.whole.assignedFeeMinor!==application.feeObligationMinor||selected.whole.provenCollectedMinor!==application.feeProvenCollectedMinor
    ||declaredProven!==BigInt(selected.occupied.provenCollectedMinor))refuse();
   const amounts={originalPrincipalMinor:reservation.amountMinor,originalFeeMinor:selected.whole.nominalFeeMinor,acceptedRetiredFeeMinor:selected.whole.retiredFeeMinor,actualCollectedFeeMinor:selected.whole.provenCollectedMinor,
    allocatedPrincipalMinor:selected.occupied.amountMinor,allocatedNominalFeeMinor:selected.occupied.nominalFeeMinor,allocatedRetiredFeeMinor:selected.occupied.retiredFeeMinor,allocatedAssignedFeeMinor:selected.occupied.assignedFeeMinor,declaredProvenFeeMinor:selected.occupied.provenCollectedMinor,
    currentCoveredAssignedFeeMinor:selected.occupied.provenCollectedMinor,currentOwedAssignedFeeMinor:selected.occupied.owedFeeMinor,availablePrincipalMinor:selected.available.amountMinor,availableActualFeeMinor:selected.available.assignedFeeMinor,
    takePrincipalMinor:selected.selected.amountMinor,takeNominalFeeMinor:selected.selected.nominalFeeMinor,takeRetiredFeeMinor:selected.selected.retiredFeeMinor,takeAssignedFeeMinor:selected.selected.assignedFeeMinor,takeProvenCollectedMinor:selected.selected.provenCollectedMinor,takeOwedFeeMinor:selected.selected.owedFeeMinor,
    afterPrincipalMinor:selected.occupied.amountMinor+selected.selected.amountMinor,afterNominalFeeMinor:selected.occupied.nominalFeeMinor+selected.selected.nominalFeeMinor,afterAssignedFeeMinor:selected.occupied.assignedFeeMinor+selected.selected.assignedFeeMinor,
    remainingPrincipalMinor:selected.remaining.amountMinor,remainingActualFeeMinor:selected.remaining.assignedFeeMinor,priorFundingIds:existing.map(row=>row.id).sort()};
   visiting.delete(key);return{amounts,rootFundingId:economic.rootFundingId,rootEconomicRevision:economic.rootEconomicRevision,originalRootPrincipalMinor:economic.originalPrincipalMinor,originalRootFeeMinor:economic.originalFeeMinor,sourceSegments:[...sourceSegments],takeSegments:selected.segments};
  }
  const loans:AtomicCreditFeeCapacityInput["loans"]=ancestry.funding.filter(row=>row.sourceApplicationId===sourceApplicationId).map(row=>{
   if(row.feeUnexpected||!["not_due","recorded_remitted","verified_collected"].includes(row.feeCollectionState))refuse();
   const child=ancestry.partitions.find(value=>value.fundingId===row.id);
   if(!child)return{kind:"legacy",fundingId:row.id,principalMinor:row.amountMinor,assignedFeeMinor:row.feeObligationMinor,provenCollectedMinor:row.feeProvenCollectedMinor};
   const plan=child.economics.plan;
   if(plan.epochKind!==(sourceApplicationId?"inherited":"direct")||plan.originalPrincipalMinor!==originalPrincipalMinor||plan.originalFeeMinor!==originalFeeMinor
    ||plan.originalPaymentFeeMinor!==routing.applicationFeeMinor||plan.originalResourceRetiredFeeMinor>retired||plan.sourceCollectionId!==owner.collectionId||plan.sourceResourceId!==prefix.sources.find(source=>source.paymentId===payment.id)?.resourceId)refuse();
   return{kind:"atomic",fundingId:row.id,principalMinor:row.amountMinor,assignedFeeMinor:row.feeObligationMinor,provenCollectedMinor:row.feeProvenCollectedMinor,
    nominalFeeMinor:plan.takeNominalFeeMinor,retiredShareMinor:plan.takeRetiredFeeMinor,retiredAtBirthMinor:plan.acceptedRetiredFeeMinor,priorFundingIds:plan.priorFundingIds};
  });
  const result=atomicCreditFeeCapacities({originalPrincipalMinor,originalFeeMinor,acceptedRetiredFeeMinor,actualCollectedFeeMinor,loans,takeMinor});visiting.delete(key);return{amounts:result,rootFundingId:null,rootEconomicRevision:null,originalRootPrincipalMinor:originalPrincipalMinor,originalRootFeeMinor:originalFeeMinor,sourceSegments:[],takeSegments:[]};
 };
 const selectedCapacity=capacity(input.sourceApplicationId,input.takeMinor),{amounts,...rootEconomics}=selectedCapacity,parentApplication=input.sourceApplicationId?ancestry.applications.find(row=>row.reservationId===input.sourceApplicationId):null;
 const parentReservation=parentApplication?ancestry.reservations.find(row=>row.id===parentApplication.reservationId):null;
 const parentFunding=parentReservation?ancestry.funding.find(row=>row.id===parentReservation.fundingId):null;
 const source=prefix.sources.find(row=>row.paymentId===payment.id);if(!source||source.receiptId!==owner.receiptId)refuse();
 const retiredResources=returns.resources.map(row=>({ledger:row.ledger,operationId:row.operationId,providerRef:row.providerRef,feeRef:row.feeRef,amountMinor:row.amountMinor,currency:row.currency}));
 const economics={protocol:ATOMIC_CREDIT_FEE_PROTOCOL,epochKind:input.sourceApplicationId?"inherited" as const:"direct" as const,sourcePaymentId:payment.id,sourceApplicationId:input.sourceApplicationId,parentFundingId:parentFunding?.id??null,
  sourceCollectionId:owner.collectionId,sourceResourceId:source.resourceId,originalPaymentFeeMinor:routing.applicationFeeMinor,originalResourceRetiredFeeMinor:retired,...amounts,...rootEconomics,retiredResources};
 const plan=atomicCreditFeeEconomicPlan.parse({...economics,economicRevision:merchantTaxDigest(economics)});
 const currentEntries=async()=>{
  const actualAncestry=await readAtomicCreditFeeAncestry(ctx.tx,payment.id),actualBank=await readControlledCanonicalBankPrincipal(ctx,payment,originalCash);
  if(!actualBank.applies||!actualBank.principalMatches||actualBank.ancillaryDebtPending)refuse();
  const entries:ObservationFingerprint[]=actualAncestry.physical.map(row=>({...row,domain:"postgres_row"}));
  entries.push(...actualBank.physicalEntries.map(row=>({...row,domain:"postgres_row" as const})));
  for(const subscriptionId of prefix.subscriptionIds){
   const graph=await parentFinancialGraphForTx(ctx.tx,subscriptionId);
   entries.push(...graph.physical.map(row=>({...row,domain:row.table==="subscription_provider_schedule_resources"?"schedule_stable" as const:"postgres_row" as const})),
    ...graph.children.entries.map(row=>({...row,domain:row.table.startsWith("subscription_controlled_")||["merchant_cash_return_inspection_stops","merchant_fee_refund_invocations"].includes(row.table)?"postgres_row" as const:"dependency_canonical" as const})),
    ...[...graph.proration.entries,...graph.controlled.entries].map(row=>({...row,domain:"postgres_row" as const})));
  }
  return controlledObservationEntries(entries).full;
 };
 const beforeEntries=await currentEntries();
 if(prefix.physicalIdentities.some(key=>!beforeEntries.some(row=>row.key===key)))refuse();
 const currentParentRevision=merchantTaxDigest(beforeEntries),currentFeeProofRevision=state&&!state.pending?state.proof.revision:returns.revision;
 const feeEvidenceDigest=merchantTaxDigest({protocol:ATOMIC_CREDIT_FEE_PROTOCOL,economicPlan:plan});
 const readBankRevision=async()=>{
  const rows=await ctx.tx.execute<{inspection_id:string;observation_id:string;revision:string}>(sql`select actual_inspection_id::text as inspection_id,actual_observation_id::text as observation_id,bank_fingerprint as revision
   from freeholder_controlled_receipt_bank_observation(${owner.collectionId}::uuid,${owner.receiptId}::uuid)`);
  if(rows.length!==1||rows[0]?.inspection_id!==bank.inspectionId||rows[0].observation_id!==bank.observationId||!/^[a-f0-9]{64}$/.test(rows[0].revision))refuse();return rows[0].revision;
 };
 const bankNamespaceRevision=await readBankRevision();
 if(state&&!state.pending&&state.proof.bankNamespaceRevision!==bankNamespaceRevision)refuse();
 const storedEconomics=atomicCreditFeeStoredEconomics.parse({plan,currentParentRevision,currentFeeProofRevision,bankNamespaceRevision,sourceGraphRevision:prefix.revision,feeEvidenceDigest});
 const afterPrefix=await assertAtomicCreditSourcePrefix(ctx,[payment.id]),afterOwner=await controlledAtomicFeeOwner(ctx,payment.id),afterReturns=await readAtomicFeeReturnResources(ctx,payment.id);
 if(afterPrefix.revision!==prefix.revision||!afterOwner||afterOwner.revision!==owner.revision||!afterReturns||afterReturns.revision!==returns.revision
  ||await readBankRevision()!==bankNamespaceRevision||merchantTaxDigest(await currentEntries())!==currentParentRevision)refuse();
 return{kind:"atomic_partition" as const,requiresChild:retired>0||ancestry.originalInvoice.refundedMinor>0,owner,bank,principal,ancestry,plan,storedEconomics,beforeEntries,
  allocation:{feeObligationMinor:plan.takeAssignedFeeMinor,provenCollectedMinor:plan.takeProvenCollectedMinor,collectionState:plan.takeAssignedFeeMinor===0?"not_due" as const:plan.takeOwedFeeMinor===0?"verified_collected" as const:"owed" as const,unexpectedFee:false,evidenceDigest:feeEvidenceDigest},
  revision:merchantTaxDigest({storedEconomics,beforeEntries,bankRevision:bank.revision,principal,sourceOwner:owner.revision,physicalReturns:returns.revision})};
}
