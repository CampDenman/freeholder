// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: one actual receipt/payment each, in the caller's ONE real transaction.
import { eq,inArray,sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { getService,ServiceError,type ServiceContext } from "@/core/service";
import { subscriptions,subscriptionProviderChargeReceipts,subscriptionProviderChargeObservations } from "@/modules/subscriptions/schema";
import { subscriptionControlledResources } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { controlledCollectionState } from "@/modules/subscriptions/controlled-provider-collection-state";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-contract";
import { controlledCashEvidence,readOriginalControlledChargeAuthority } from "@/modules/subscriptions/controlled-provider-cash-origin";
import { parentFinancialGraph,lockControlledParentMoney } from "./controlled-provider-financial-parent";
import { planControlledReceiptBatch } from "./controlled-receipt-batch-plan";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { recordMerchantPaymentObservation } from "./merchant-payment-observations";
import { payments,invoices } from "./schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { readControlledCashApplicationBank } from "./controlled-cash-application-bank";
import { cashObservationSourceMatches } from "@/modules/subscriptions/controlled-provider-cash-observation-source";
const inputSchema=z.object({collectionId:z.uuid(),receiptIds:z.array(z.uuid()).min(1).max(5000),requiredProtocol:z.literal(CONTROLLED_COLLECTION_PROTOCOL)}).strict();
const authorityResult=z.object({allowed:z.literal(true),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const paymentResult=z.object({id:z.uuid(),invoiceId:z.uuid(),provider:z.literal("stripe"),method:z.literal("provider_schedule"),amountMinor:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),currency:z.string(),status:z.enum(["created","processing","succeeded"]),providerRef:z.string().nullable()});
function refuse():never{throw new ServiceError("conflict","Restore the genuine current prospective cash authority and exact original retained receipt batch before canonical application; missing proof remains raw money for review.");}
/** UNREGISTERED until the genuine producer/inspection/prospective context and
 * installed transition guards qualify. Missing private authority REFUSES. This
 * ordinary function never creates a producer, synthetic ServiceContext, bank
 * POST, return intent or access grant. Every callAsSystem shares ctx.tx; errors
 * deliberately propagate so a later receipt refusal rolls back the WHOLE batch.
 */
export async function applyControlledReceiptBatch(ctx:ServiceContext,value:z.input<typeof inputSchema>){
 const input=inputSchema.parse(value);if(ctx.actor.kind!=="system"||new Set(input.receiptIds).size!==input.receiptIds.length)refuse();
 const authority=getService("invoicing.controlledProviderCashApplicationAuthority"),create=getService("invoicing.createPayment"),settle=getService("invoicing.settlePayment");
 if(!authority||!create||!settle)refuse();
 await lockContactIdentityForRead(ctx.tx);
 const[reference]=await ctx.tx.select({resourceId:subscriptionControlledResources.id,subscriptionId:subscriptionControlledResources.subscriptionId})
  .from(subscriptionControlledCollections).innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId))
  .innerJoin(subscriptionControlledResources,eq(subscriptionControlledResources.id,subscriptionControlledQuotes.resourceId))
  .where(eq(subscriptionControlledCollections.id,input.collectionId)).limit(1);if(!reference)refuse();
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
 await ctx.tx.select({id:subscriptionControlledResources.id}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).limit(1).for("update");
 await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,reference.subscriptionId)).limit(1).for("update");
 const graph=await parentFinancialGraph(ctx,reference.subscriptionId);await lockControlledParentMoney(ctx,graph);
 const entries=new Map<string,string>();
 for(const row of [...graph.physical,...graph.children.entries,...graph.proration.entries,...graph.controlled.entries]){
  const key=`${row.table}:${row.id}`,prior=entries.get(key);if(prior&&prior!==row.fingerprint)refuse();entries.set(key,row.fingerprint);if(entries.size>5000)refuse();
 }
 const source=await controlledCollectionState(ctx.tx,input.collectionId);if(!source.binding||source.resource.id!==reference.resourceId||source.parent.id!==reference.subscriptionId)refuse();
 const receipts=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(inArray(subscriptionProviderChargeReceipts.id,input.receiptIds)).limit(5001);
 const aliases=await ctx.tx.select({route:merchantAgreementPaymentRoutes,payment:payments}).from(merchantAgreementPaymentRoutes).innerJoin(payments,eq(payments.id,merchantAgreementPaymentRoutes.paymentId))
  .where(inArray(merchantAgreementPaymentRoutes.originalChargeReceiptId,input.receiptIds)).limit(5001);
 if(receipts.length>5000||aliases.length>5000)refuse();
 const candidates=receipts.map(receipt=>{const owners=aliases.filter(row=>row.route.originalChargeReceiptId===receipt.id);if(owners.length>1)refuse();
  const origin=source.history.chargeOrigins.find(row=>row.receiptId===receipt.id);return{receipt,origin:origin??null,payment:owners[0]?.payment??null,route:owners[0]?.route??null};});
 const plan=planControlledReceiptBatch({collectionId:source.collection.id,resourceId:source.resource.id,subscriptionId:source.parent.id,providerInvoiceRef:source.binding.providerInvoiceRef,
  providerSubscriptionRef:receipts[0]?.providerSubscriptionRef??"",platform:source.resource.originalScope.providerPlatformAccountId,account:source.resource.originalScope.providerAccountId??null,
  invoice:source.canonical.invoice,receiptIds:input.receiptIds,candidates});
 // All original facts, exact observations and required authorities are read
 // BEFORE the first canonical write. Membership never follows equal amounts.
 const observed=new Map<string,typeof subscriptionProviderChargeObservations.$inferSelect>();
 const observationRows=await ctx.tx.select().from(subscriptionProviderChargeObservations).where(eq(subscriptionProviderChargeObservations.subscriptionId,source.parent.id))
  .orderBy(subscriptionProviderChargeObservations.createdAt,subscriptionProviderChargeObservations.id).limit(5001);if(observationRows.length>5000)refuse();
 for(const row of candidates){const origin=row.origin,fact=origin?source.history.facts.find(item=>item.id===origin.factId&&item.callId===origin.callId&&item.actual.kind==="cash_observed"):null;
  if(!origin||!fact)refuse();const actual=await readOriginalControlledChargeAuthority(ctx.tx,controlledCashEvidence.parse(fact.actual.raw.cash),{resourceId:source.resource.id,callId:origin.callId,factId:origin.factId});
  if(actual.controlledOrigin.operationId!==origin.operationId||actual.controlledOrigin.originalEvidenceDigest!==origin.originalEvidenceDigest||!cashObservationSourceMatches(row.receipt,actual.controlledCash))refuse();
  const matching=observationRows.filter(item=>item.providerPaymentIntentRef===row.receipt.providerPaymentIntentRef);
  if(!matching.length||matching.some(item=>item.providerPlatformAccountId!==row.receipt.providerPlatformAccountId||item.chargeAccountId!==row.receipt.chargeAccountId||item.providerApiVersion!==row.receipt.providerApiVersion
   ||item.providerInvoiceRef!==row.receipt.providerInvoiceRef||item.providerSubscriptionRef!==row.receipt.providerSubscriptionRef||item.providerChargeRef!==null&&item.providerChargeRef!==row.receipt.providerChargeRef||item.amountMinor!==row.receipt.amountMinor
   ||item.currency!==row.receipt.currency||item.actualDestinationAccountId!==row.receipt.actualDestinationAccountId||item.actualSettlementMerchantAccountId!==row.receipt.actualSettlementMerchantAccountId
   ||!item.customerChargeVerified||!item.merchantRouteVerified))refuse();const latest=matching.at(-1);if(!latest)refuse();observed.set(row.receipt.id,latest);
 }
 const preflight=[];
 for(const item of plan.pending){const proof=authorityResult.parse(await ctx.callAsSystem(authority,{collectionId:input.collectionId,receiptId:item.receiptId,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL}));preflight.push({receiptId:item.receiptId,revision:proof.revision});}
 for(const item of preflight){const proof=authorityResult.parse(await ctx.callAsSystem(authority,{collectionId:input.collectionId,receiptId:item.receiptId,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL}));if(proof.revision!==item.revision)refuse();}
 const batchRevision=merchantTaxDigest({collectionId:input.collectionId,receiptIds:[...input.receiptIds].sort(),preflight});
 const result=[...plan.applied];
 for(const item of plan.pending){
  // Prior receipts in this transaction are now REAL canonical payments. Obtain
  // the next actual current revision before its FIRST write; never pretend a
  // bank-proof revision remained unchanged across our own canonical writes.
  const first=authorityResult.parse(await ctx.callAsSystem(authority,{collectionId:input.collectionId,receiptId:item.receiptId,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL}));
  const bank=await readControlledCashApplicationBank(ctx,{collectionId:input.collectionId,receiptId:item.receiptId});
  const current=authorityResult.parse(await ctx.callAsSystem(authority,{collectionId:input.collectionId,receiptId:item.receiptId,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL}));if(current.revision!==first.revision)refuse();
  if(result.length===plan.applied.length&&current.revision!==preflight.find(row=>row.receiptId===item.receiptId)?.revision)refuse();
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_cash_application_v1',${JSON.stringify({collectionId:input.collectionId,receiptId:item.receiptId,revision:current.revision})},true)`);
  const created=paymentResult.parse(await ctx.callAsSystem(create,{invoiceId:source.canonical.invoice.id,provider:"stripe",method:"provider_schedule",amountMinor:item.amountMinor,
   idempotencyKey:item.idempotencyKey,subscriptionChargeReceiptId:item.receiptId}));
  if(created.invoiceId!==source.canonical.invoice.id||created.amountMinor!==item.amountMinor||created.currency!==item.currency||created.status!=="created")refuse();
  const[route]=await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId,created.id)).limit(1);
  if(!route||route.originalChargeReceiptId!==item.receiptId||route.subscriptionId!==source.parent.id||route.providerInvoiceRef!==source.binding.providerInvoiceRef)refuse();
  const evidence=observed.get(item.receiptId);if(!evidence)refuse();
  if(bank.receiptId!==item.receiptId||bank.paymentEvidence.providerRef!==evidence.providerPaymentIntentRef||bank.paymentEvidence.providerChargeRef!==bank.receiptChargeRef
   ||evidence.providerChargeRef!==null&&bank.paymentEvidence.providerChargeRef!==evidence.providerChargeRef
   ||bank.paymentEvidence.amountMinor!==evidence.amountMinor||bank.paymentEvidence.currency!==evidence.currency)refuse();
  await ctx.callAsSystem(recordMerchantPaymentObservation,{paymentId:created.id,providerEventRef:`controlled-cash-bank:${bank.observationId}:${item.receiptId}`,evidence:bank.paymentEvidence});
  const settled=paymentResult.parse(await ctx.callAsSystem(settle,{id:created.id,providerRef:evidence.providerPaymentIntentRef,processedAt:bank.processedAt}));
  if(settled.id!==created.id||settled.status!=="succeeded"||settled.providerRef!==evidence.providerPaymentIntentRef||settled.amountMinor!==item.amountMinor||settled.currency!==item.currency)refuse();
  result.push({receiptId:item.receiptId,paymentId:settled.id});
 }
 await ctx.tx.execute(sql`select set_config('freeholder.controlled_cash_application_v1','',true)`);
 const[invoice]=await ctx.tx.select().from(invoices).where(eq(invoices.id,source.canonical.invoice.id)).limit(1);if(!invoice)refuse();
 const expected=BigInt(source.canonical.invoice.paidMinor)+plan.pending.reduce((sum,item)=>sum+BigInt(item.amountMinor),0n);
 if(BigInt(invoice.paidMinor)!==expected||invoice.creditedMinor!==source.canonical.invoice.creditedMinor||invoice.totalMinor!==source.canonical.invoice.totalMinor
  ||invoice.currency!==source.canonical.invoice.currency||invoice.refundedMinor!==source.canonical.invoice.refundedMinor)refuse();
 const outstandingMinor=Number(BigInt(invoice.totalMinor)-BigInt(invoice.creditedMinor)-BigInt(invoice.paidMinor));
 if(outstandingMinor<0||outstandingMinor>0&&invoice.status==="paid"||outstandingMinor===0&&invoice.status!=="paid")refuse();
 ctx.setSubject("invoice",invoice.id);return{invoiceId:invoice.id,payments:result.sort((a,b)=>a.receiptId.localeCompare(b.receiptId)),outstandingMinor,batchRevision};
}
