// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: exact current sibling disposition precedes any new funding birth.
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {getService,ServiceError,type ServiceContext} from "@/core/service";
import {invoices,payments} from "./schema";
import {controlledCashApplicationBatches,controlledCashApplicationLinks} from "./controlled-cash-application-protocol-schema";
import {CONTROLLED_CASH_ATOMIC_PROTOCOL} from "./controlled-cash-application-protocol";
import {verifiedControlledCashBatch} from "./controlled-cash-application-protocol-proof";
import {controlledCollectionState} from "@/modules/subscriptions/controlled-provider-collection-state";
import {controlledAtomicFeeOwner,controlledAtomicRefundTarget,controlledAtomicRefundFeeState} from "./controlled-atomic-refund-target";
import {readControlledAtomicRefundBankState} from "./controlled-atomic-refund-bank-state";
import {controlledAtomicCreditFeePartition} from "./atomic-credit-fee-partition";
import {readAtomicCreditFeeDispositionAncestry} from "./atomic-credit-fee-ancestry";
import {readAtomicFeeReturnResources} from "./atomic-fee-return-resources";
import {assertAtomicCreditSourcePrefix} from "./atomic-credit-source-prefix";
import {readControlledCanonicalBankPrincipal} from "./controlled-canonical-bank-principal";
import {originalMerchantRefundCash} from "./merchant-refund-origin";
import {principalAuthorityResult} from "./principal-authority-contract";
import {controlledObservationEntries,type ObservationFingerprint} from "./controlled-cash-observation-revision";
import {parentFinancialGraphForTx} from "./controlled-provider-financial-parent";
import {merchantTaxDigest} from "./merchant-tax-store";
function refuse():never{throw new ServiceError("conflict","Restore the exact original atomic invoice, every sibling refund/fee/current bank/caller and issued credit ancestry before choosing unreturned source principal.");}
async function readDisposition(ctx:ServiceContext,input:{subscriptionId:string;originalInvoiceId:string}){
 const[invoice]=await ctx.tx.select().from(invoices).where(eq(invoices.id,input.originalInvoiceId));if(!invoice)refuse();
 const money=await ctx.tx.select().from(payments).where(eq(payments.invoiceId,invoice.id)).orderBy(payments.id).limit(5001);
 const batches=await ctx.tx.select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.invoiceId,invoice.id)).limit(5001);
 if(money.length+batches.length>5000||batches.some(row=>!verifiedControlledCashBatch(row)))refuse();
 if(!batches.some(row=>row.protocol===CONTROLLED_CASH_ATOMIC_PROTOCOL)){
  // Known lost bridges or retained atomic fee callers are never ordinary.
  const[known]=await ctx.tx.execute<{known:boolean}>(sql`select exists(select 1 from merchant_fee_refund_invocations i join payments p on p.id=i.payment_id where p.invoice_id=${invoice.id}::uuid) as known`);
  if(known?.known!==false||money.some(row=>row.idempotencyKey.startsWith("controlled-receipt:"))&&batches.length===0)refuse();
  return{kind:"ordinary" as const};
 }
 const[installed]=await ctx.tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_credit_atomic_fee_ready()') is not null as present`);if(installed?.present!==true)refuse();
 const[guarded]=await ctx.tx.execute<{ready:boolean}>(sql`select freeholder_atomic_auxiliary_fee_ready() and freeholder_credit_atomic_fee_ready() as ready`);if(guarded?.ready!==true)refuse();
 if(!money.length||money.some(row=>["created","processing"].includes(row.status)))refuse();
 const collectionIds=[...new Set(batches.map(row=>row.collectionId))];if(collectionIds.length!==1)refuse();
 const collectionId=collectionIds[0];if(!collectionId)refuse();
 const target=await controlledCollectionState(ctx.tx,collectionId);
 if(target.collection.invoiceId!==invoice.id||target.parent.id!==input.subscriptionId||target.canonical.invoice.id!==invoice.id||target.parent.contactId!==invoice.contactId
  ||target.parent.currency!==invoice.currency||invoice.sourceType!=="subscription"||target.quote.canonicalSourceId!==invoice.sourceId
  ||batches.some(row=>row.subscriptionId!==input.subscriptionId||row.resourceId!==target.resource.id||row.collectionId!==target.collection.id||row.invoiceId!==invoice.id))refuse();
 const prefix=await assertAtomicCreditSourcePrefix(ctx,money.map(row=>row.id));
 const{assertInvoiceMerchantCreatorsQuiesced,assertMerchantPaymentTerminal}=await import("./merchant-payment-request");
 const{assertNoUnappliedMerchantCharge}=await import("./merchant-payment-observations");
 await assertInvoiceMerchantCreatorsQuiesced(ctx,invoice.id);await assertNoUnappliedMerchantCharge(ctx,invoice.id);
 const successful=money.filter(row=>row.status==="succeeded");
 if(!successful.length||successful.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)!==BigInt(invoice.paidMinor)
  ||successful.reduce((sum,row)=>sum+BigInt(row.refundedMinor),0n)!==BigInt(invoice.refundedMinor))refuse();
 for(const payment of money.filter(row=>row.status!=="succeeded"))await assertMerchantPaymentTerminal(ctx,payment.id);
 const principalService=getService("invoicing.originalPrincipalAuthority");if(!principalService)refuse();
 const siblings=[];
 const physical:ObservationFingerprint[]=[];
 let whole:Awaited<ReturnType<typeof controlledAtomicRefundTarget>>=null;
 for(const payment of successful){
  const owner=await controlledAtomicFeeOwner(ctx,payment.id);if(!owner||owner.collectionId!==collectionId||owner.invoiceId!==invoice.id||owner.subscriptionId!==input.subscriptionId)refuse();
  const[link]=await ctx.tx.select().from(controlledCashApplicationLinks).where(eq(controlledCashApplicationLinks.paymentId,payment.id));
  if(!link||link.batchId!==owner.batchId||link.receiptId!==owner.receiptId||link.receiptProofId!==owner.proofId)refuse();
  const original=await originalMerchantRefundCash(ctx,{kind:"payment",paymentId:payment.id}),bank=await readControlledCanonicalBankPrincipal(ctx,payment,original);
  const principal=principalAuthorityResult.parse(await ctx.callAsSystem(principalService,{paymentId:payment.id}));
  if(!bank.applies||!bank.principalMatches||bank.ancillaryDebtPending||bank.receiptId!==owner.receiptId||principal.witness.paymentId!==payment.id)refuse();
  if(payment.refundedMinor===0&&(!principal.principalSafe||principal.currentPrincipalMinor!==payment.amountMinor||principal.financialDebtPending))refuse();
  const feeTarget=await controlledAtomicRefundTarget(ctx,payment.id),feeState=await controlledAtomicRefundFeeState(ctx,payment.id),feeReturns=await readAtomicFeeReturnResources(ctx,payment.id);
  if(!feeReturns||feeReturns.pendingOperationIds.length||feeReturns.unfinishedIds.length||feeTarget&&(feeTarget.target===null||feeTarget.unassignedDutyMinor!==0||!feeState||feeState.pending))refuse();
  if(invoice.refundedMinor>0&&!feeTarget)refuse();
  // A returned sibling supplies NO new funding/principal authority. Preserve
  // its generic review/debt state, while independently proving its actual
  // current zero/remaining bank disposition and exact whole fee/recipient
  // conservation. A stale generic whole-closure flag is never rewritten.
  const currentRefundBank=payment.refundedMinor>0?await readControlledAtomicRefundBankState(ctx,payment.id):null;
  if(payment.refundedMinor>0&&!currentRefundBank)refuse();
  if(currentRefundBank&&(currentRefundBank.receiptId!==owner.receiptId||currentRefundBank.refundedMinor!==payment.refundedMinor||currentRefundBank.unfinishedFeeInvocationIds.length))refuse();
  if(feeTarget){
   if(whole&&merchantTaxDigest(whole.resources)!==merchantTaxDigest(feeTarget.resources))refuse();whole=feeTarget;
   const resource=feeTarget.resources.find(row=>row.paymentId===payment.id);
   if(!resource||resource.receiptId!==owner.receiptId||resource.amountMinor!==payment.amountMinor||resource.refundedMinor!==payment.refundedMinor||resource.feeReturnedMinor!==feeReturns.returnedMinor)refuse();
  }
  const ancestry=await readAtomicCreditFeeDispositionAncestry(ctx.tx,payment.id);
  // A returned sibling stays explicit and cannot supply another loan. An
  // existing promise against that returned source is a conflict, not capacity.
  if(payment.refundedMinor!==0&&ancestry.funding.length)refuse();
  const partition=payment.refundedMinor===0?await controlledAtomicCreditFeePartition(ctx,{paymentId:payment.id,sourceApplicationId:null,takeMinor:0}):null;
  if(payment.refundedMinor===0&&!partition)refuse();
  const disposition=payment.refundedMinor===0?"unreturned" as const:payment.refundedMinor===payment.amountMinor?"fully_returned" as const:"partially_returned" as const;
  siblings.push({payment,owner,link,original,bank,principal,currentRefundBank,feeTarget,feeState,feeReturns,ancestry,partition,disposition,
   currentPrincipalMinor:payment.amountMinor-payment.refundedMinor,availableForNewFundingMinor:partition?.plan.availablePrincipalMinor??0,
   suppliesReturnedSourceFundingAuthority:false as const,suppliesPrincipalAuthority:false as const});
  physical.push(...bank.physicalEntries.map(row=>({...row,domain:"postgres_row" as const})),...ancestry.physical.map(row=>({...row,domain:"postgres_row" as const})));
  for(const entry of partition?.beforeEntries??[]){
   const colon=entry.key.indexOf(":"),table=entry.key.slice(0,colon),id=entry.key.slice(colon+1);if(colon<1)refuse();
   if(entry.postgres_row)physical.push({table,id,fingerprint:entry.postgres_row,domain:"postgres_row"});
   if(entry.dependency_canonical)physical.push({table,id,fingerprint:entry.dependency_canonical,domain:"dependency_canonical"});
   if(entry.schedule_stable)physical.push({table,id,fingerprint:entry.schedule_stable,domain:"schedule_stable"});
  }
 }
 if(whole&&whole.resources.length!==successful.length)refuse();
 for(const subscriptionId of prefix.subscriptionIds){
  const graph=await parentFinancialGraphForTx(ctx.tx,subscriptionId);
  physical.push(...graph.physical.map(row=>({...row,domain:row.table==="subscription_provider_schedule_resources"?"schedule_stable" as const:"postgres_row" as const})),
   ...graph.children.entries.map(row=>({...row,domain:row.table.startsWith("subscription_controlled_")||["controlled_cash_application_batches","controlled_cash_application_receipts","controlled_cash_application_links","invoice_credit_funding_atomic_fee_partitions","invoice_credit_reservation_atomic_fee_partitions","merchant_cash_return_inspection_stops","merchant_fee_refund_invocations"].includes(row.table)?"postgres_row" as const:"dependency_canonical" as const})),
   ...[...graph.proration.entries,...graph.controlled.entries].map(row=>({...row,domain:"postgres_row" as const})));
 }
 const entries=controlledObservationEntries(physical).full,invoiceEntry=entries.find(row=>row.key===`invoices:${invoice.id}`);
 if(!invoiceEntry?.postgres_row||prefix.physicalIdentities.some(key=>!entries.some(entry=>entry.key===key)))refuse();
 const inherited=target.canonical.applications.map(application=>{
  const reservation=target.canonical.reservations.find(row=>row.id===application.reservationId),funding=reservation&&target.canonical.funding.find(row=>row.id===reservation.fundingId);
  if(!reservation||!funding||application.invoiceId!==invoice.id||reservation.targetSourceId!==invoice.sourceId)refuse();return{application,reservation,funding};
 });
 if(inherited.reduce((sum,row)=>sum+BigInt(row.reservation.amountMinor),0n)!==BigInt(invoice.creditedMinor))refuse();
 const source={invoice:{id:invoice.id,postgresRowFingerprint:invoiceEntry.postgres_row,totalMinor:invoice.totalMinor,paidMinor:invoice.paidMinor,refundedMinor:invoice.refundedMinor,creditedMinor:invoice.creditedMinor,currency:invoice.currency},
  subscriptionId:input.subscriptionId,collectionId,resourceId:target.resource.id,termsId:target.terms.id,periodStart:target.review.calendar.proposedPeriodStart,periodEnd:target.review.calendar.proposedPeriodEnd,
  originalPrincipalMinor:target.manifest.grossMinor,targetCashDueMinor:target.manifest.cashDueMinor,originalFeeMinor:target.manifest.applicationFeeMinor,
  wholeTargetFeeMinor:whole?siblings.reduce((sum,row)=>sum+(row.feeTarget?.target??0),0):target.manifest.applicationFeeMinor,unassignedDutyMinor:whole?.unassignedDutyMinor??0,
  siblings,money,batches,inherited,prefix,entries,suppliesFundingAuthority:false as const};
 return{kind:"atomic_sibling_disposition.v1" as const,...source,revision:merchantTaxDigest(source)};
}
/** Readonly comparison context, not cached quote authority. Quote and accept
 * invoke independently under the complete discovered resource/parent prefix.
 * FULL evidence contains every sibling, even explicit unavailable sources.
 */
export async function readAtomicCreditInvoiceDisposition(ctx:ServiceContext,input:{subscriptionId:string;originalInvoiceId:string}){
 if(!z.uuid().safeParse(input.subscriptionId).success||!z.uuid().safeParse(input.originalInvoiceId).success)refuse();
 try{
  const before=await readDisposition(ctx,input);if(before.kind==="ordinary")return before;
  const after=await readDisposition(ctx,input);if(after.kind!=="atomic_sibling_disposition.v1"||after.revision!==before.revision)refuse();return after;
 }catch(error){
  if(error instanceof ServiceError&&["conflict","validation","not_found","permission"].includes(error.code)||error instanceof z.ZodError)return{kind:"review" as const,invoiceId:input.originalInvoiceId,suppliesFundingAuthority:false as const};
  throw error;
 }
}
