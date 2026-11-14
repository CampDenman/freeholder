// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: genuine whole-batch BEFORE evidence; no registration or grant.
import { eq,inArray,sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { getService,ServiceError,type ServiceContext } from "@/core/service";
import { subscriptions,subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { subscriptionControlledResources } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { controlledCollectionState } from "@/modules/subscriptions/controlled-provider-collection-state";
import { controlledCollectionCoverage } from "@/modules/subscriptions/controlled-provider-collection-coverage";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-contract";
import { subscriptionProviderScheduleOperations } from "@/modules/subscriptions/provider-schedule-schema";
import { scheduleCallerHasStopped } from "@/modules/subscriptions/provider-schedule-proof";
import { originalProviderReadsFinished } from "@/modules/subscriptions/provider-schedule-read-proof";
import { payments,creditNotes } from "./schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantTaxProfiles,merchantTaxProfileVersions,invoiceMerchantTaxQuotes } from "./merchant-tax-schema";
import { requireControlledFinancialProtocol } from "./controlled-provider-financial-protocol";
import { withControlledCashProspectiveEvaluation } from "./controlled-cash-prospective-context";
import { readControlledCashObservationCoverage,readControlledOriginalCallers } from "./controlled-cash-observation-parent";
import { parentFinancialGraph } from "./controlled-provider-financial-parent";
import { controlledTargetRawClassification } from "./controlled-target-raw-classification";
import { controlledCashAdmissionPlan,controlledCashPhysicalSnapshot } from "./controlled-cash-application-admission-policy";
import { reserveOriginalSubscriptionCashApplication } from "./merchant-refund-application";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { creditNoteDisposition } from "./credit-disposition";
import { originalCreditFeeAllocation } from "./credit-fee-origin";
import { merchantTaxDigest } from "./merchant-tax-store";
const sha=z.string().regex(/^[a-f0-9]{64}$/),ids=z.array(z.uuid()).max(5000);
const inputSchema=z.object({collectionId:z.uuid(),receiptIds:ids.min(1),requiredProtocol:z.literal(CONTROLLED_COLLECTION_PROTOCOL)}).strict();
const scopeSchema=z.object({subscriptions:ids,directInvoices:ids,invoices:ids,payments:ids,receipts:ids,prorations:ids,funding:ids,reservations:ids,applications:ids,notes:ids,resources:ids,operations:ids,calls:ids,quotes:ids,collections:ids,refunds:ids,
 requests:ids,refundDispatches:ids,inspections:ids,cashOwners:ids,fees:ids,profiles:ids,contacts:ids,legacyReads:ids,paymentDispatches:ids,resolutions:ids,dataRequests:ids,batches:ids,receiptProofs:ids,plans:ids,cardReads:ids,returns:ids,
 namespaces:z.array(z.object({platform:z.string().min(1),account:z.string().nullable(),intent:z.string().min(1),charge:z.string().nullable()}).strict()).max(5000)}).strict();
const principalSchema=z.object({principalSafe:z.boolean(),financialDebtPending:z.boolean(),witness:z.object({paymentId:z.uuid(),revision:sha}).passthrough()}).passthrough();
const debtSchema=z.object({pending:z.boolean(),reasons:z.array(z.string())}).passthrough();
const uuidSql=(values:readonly string[])=>values.length?sql.join(values.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`;
function refuse():never{throw new ServiceError("conflict","Restore the complete authentic original bank batch, every current parent/source caller, ownership/privacy and exact canonical credit/fee/principal disposition before application. Retained money stays durable; a marker, amount match or later zero cannot authorize it.");}
async function scopeFor(ctx:ServiceContext,collectionId:string){const[row]=await ctx.tx.execute<{scope:unknown}>(sql`select freeholder_controlled_cash_scope(${collectionId}::uuid) as scope`);const scope=scopeSchema.parse(row?.scope);
 for(const [key,value]of Object.entries(scope))if(key!=="namespaces"&&new Set<unknown>(value).size!==value.length)refuse();return scope;}
async function snapshotFor(ctx:ServiceContext,collectionId:string){const[row]=await ctx.tx.execute<{snapshot:unknown}>(sql`select freeholder_controlled_cash_parent_snapshot(${collectionId}::uuid) as snapshot`);return controlledCashPhysicalSnapshot.parse(row?.snapshot);}
/** NOT a service and NOT an allowed result. The real producer is obtained by the
 * private initializer, never supplied by an API/test context. All queries below
 * run under one actual contact→own-resource→parent→sorted full canonical→cash
 * prefix. Foreign original source journals are authenticated as plain readers;
 * this function never acquires another resource after canonical locks.
 *
 * The callback is read-only. Its real before/after bank and full-PG invariance
 * checks prevent caching this evidence across any own canonical mutation. The
 * later writer must persist exact HMAC admissions, then use genuine783 stages.
 */
export async function readControlledCashApplicationEvaluation(ctx:ServiceContext,value:z.input<typeof inputSchema>){
 const input=inputSchema.parse(value);if(ctx.actor.kind!=="system"||new Set(input.receiptIds).size!==input.receiptIds.length)refuse();
 input.receiptIds.sort();await lockContactIdentityForRead(ctx.tx);await requireControlledFinancialProtocol(ctx.tx);
 const[reference]=await ctx.tx.select({resourceId:subscriptionControlledResources.id,subscriptionId:subscriptionControlledResources.subscriptionId}).from(subscriptionControlledCollections)
  .innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId)).innerJoin(subscriptionControlledResources,eq(subscriptionControlledResources.id,subscriptionControlledQuotes.resourceId))
  .where(eq(subscriptionControlledCollections.id,input.collectionId)).limit(1);if(!reference)refuse();
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
 await ctx.tx.select({id:subscriptionControlledResources.id}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).limit(1).for("update");
 await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,reference.subscriptionId)).limit(1).for("update");
 // Discover ALL original source-credit parents before acquiring even one payment
 // lock: locking a partial graph first could acquire lower IDs in reverse later.
 const scope=await scopeFor(ctx,input.collectionId);if(!scope.resources.includes(reference.resourceId)||!scope.subscriptions.includes(reference.subscriptionId))refuse();
 for(const id of [...scope.payments].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`);
 for(const id of [...scope.invoices].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${id}`}))`);
 for(const id of [...scope.notes].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit-note:${id}`}))`);
 for(const key of [...new Set(scope.namespaces.map(row=>`${row.platform}:${row.account??""}:${row.intent}`))].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription-cash:${key}`}))`);
 if(merchantTaxDigest(await scopeFor(ctx,input.collectionId))!==merchantTaxDigest(scope))refuse();
 return withControlledCashProspectiveEvaluation(ctx,{collectionId:input.collectionId,receiptIds:input.receiptIds},async actualBank=>{
  const snapshot=await snapshotFor(ctx,input.collectionId),plan=controlledCashAdmissionPlan(actualBank,snapshot);
  const source=await controlledCollectionState(ctx.tx,input.collectionId),{parent,resource,collection,quote,canonical,manifest,history}=source;
  if(parent.id!==reference.subscriptionId||resource.id!==reference.resourceId||actualBank.subscriptionId!==parent.id||actualBank.resourceId!==resource.id||actualBank.invoiceId!==canonical.invoice.id
   ||actualBank.quoteId!==quote.id||actualBank.termsId!==collection.termsId||actualBank.acceptedQuoteDigest!==collection.acceptedQuoteDigest||actualBank.canonicalTargetDigest!==collection.canonicalTargetDigest
   ||canonical.invoice.contactId!==parent.contactId||canonical.invoice.currency!==parent.currency||canonical.invoice.sourceId!==quote.canonicalSourceId||history.unfinished.length||history.closures.length
   ||!canonical.currentCollectible||canonical.invoice.totalMinor!==actualBank.canonical.totalMinor||canonical.invoice.creditedMinor!==actualBank.canonical.creditedMinor||canonical.invoice.paidMinor!==actualBank.canonical.paidMinor||canonical.invoice.refundedMinor!==0)refuse();
  if(!["sent","viewed","partially_paid","overdue"].includes(canonical.invoice.status))refuse();
  const capacity={appliedMinor:plan.expectedCashMinor,outstandingBeforeMinor:actualBank.canonical.outstandingMinor,outstandingAfterMinor:plan.outstandingAfterMinor};
  const coverageEvidence:Array<{receiptId:string;revision:string}>=[];
  for(const receipt of plan.pending){const coverage=await readControlledCashObservationCoverage(ctx,{collectionId:collection.id,receiptId:receipt.receiptId,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL});
   if(coverage.unfinishedCallers.length||coverage.unfinishedInspectionIds.length||coverage.source.resourceId!==resource.id||coverage.source.invoiceId!==canonical.invoice.id)refuse();coverageEvidence.push({receiptId:receipt.receiptId,revision:coverage.revision});
   await reserveOriginalSubscriptionCashApplication(ctx,receipt.receiptId);
  }
  const allPayments=scope.payments.length?await ctx.tx.select().from(payments).where(inArray(payments.id,scope.payments)).orderBy(payments.id).limit(5001):[];
  const allReceipts=scope.receipts.length?await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(inArray(subscriptionProviderChargeReceipts.id,scope.receipts)).limit(5001):[];
  const aliases=scope.receipts.length?await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(inArray(merchantAgreementPaymentRoutes.originalChargeReceiptId,scope.receipts)).limit(5001):[];
  if(allPayments.length!==scope.payments.length||allReceipts.length!==scope.receipts.length||aliases.length>5000)refuse();
  const wholeCallers=await readControlledOriginalCallers(ctx,{money:allPayments,receipts:allReceipts},scope.subscriptions);
  if(wholeCallers.unfinished.length||wholeCallers.unfinishedInspectionIds.length)refuse();
  const pendingIds=new Set(plan.pending.map(row=>row.receiptId));
  for(const receipt of allReceipts){const owners=aliases.filter(row=>row.originalChargeReceiptId===receipt.id);
   if(pendingIds.has(receipt.id)){
    const[existing]=await ctx.tx.execute<{present:boolean}>(sql`select exists(select 1 from merchant_payment_observations o join payments p on p.id=o.payment_id
     where o.provider_platform_account_id=${receipt.providerPlatformAccountId} and o.charge_account_id is not distinct from ${receipt.chargeAccountId} and o.provider_ref=${receipt.providerPaymentIntentRef}
      and p.provider='stripe' and p.status in('created','processing','succeeded')) as present`);
    if(owners.length||existing?.present!==false)refuse();continue;
   }
   if(owners.length!==1)refuse();const owner=owners[0],payment=owner?allPayments.find(row=>row.id===owner.paymentId):null;
   if(!owner||!payment||payment.status!=="succeeded"||payment.provider!=="stripe"||payment.method!=="provider_schedule"||owner.subscriptionId!==receipt.subscriptionId||payment.providerRef!==receipt.providerPaymentIntentRef
    ||payment.amountMinor!==receipt.amountMinor||payment.currency!==receipt.currency||owner.providerPlatformAccountId!==receipt.providerPlatformAccountId||owner.chargeAccountId!==receipt.chargeAccountId
    ||owner.providerApiVersion!==receipt.providerApiVersion||owner.providerSubscriptionRef!==receipt.providerSubscriptionRef||owner.providerInvoiceRef!==receipt.providerInvoiceRef||owner.providerPaymentIntentRef!==receipt.providerPaymentIntentRef||owner.providerChargeRef!==receipt.providerChargeRef)refuse();
  }
  const principalReader=getService("invoicing.originalPrincipalAuthority"),debtReader=getService("invoicing.merchantPaymentRecoveryDebt");if(!principalReader||!debtReader)refuse();
  const paymentProofs:Array<{paymentId:string;financial:z.infer<typeof debtSchema>;current:z.infer<typeof principalSchema>|null}>=[];
  const feeProofs:Array<{fundingId:string;fee:Awaited<ReturnType<typeof originalCreditFeeAllocation>>}>=[];
  for(const payment of allPayments){if(["created","processing"].includes(payment.status))refuse();const financial=debtSchema.parse(await ctx.callAsSystem(debtReader,{paymentId:payment.id}));
   const creditSources=canonical.funding.filter(row=>row.sourcePaymentId===payment.id);
   if(financial.pending&&(!creditSources.length||financial.reasons.some(reason=>reason!=="commission")))refuse();
   const current=payment.status==="succeeded"?principalSchema.parse(await ctx.callAsSystem(principalReader,{paymentId:payment.id})):null;
   if(current&&(!current.principalSafe||current.witness.paymentId!==payment.id||current.financialDebtPending&&!financial.pending)||creditSources.length&&payment.refundedMinor!==0)refuse();
   paymentProofs.push({paymentId:payment.id,financial,current});
   for(const funding of creditSources){const fee=await originalCreditFeeAllocation(ctx,payment.id,funding.sourceApplicationId,0);
    if(fee.collectionState==="review"||fee.unexpectedFee||!source.review.feeReview||source.review.feeReview.originalSourceDebt&&!source.review.requiresMerchantReview)refuse();feeProofs.push({fundingId:funding.id,fee});}
  }
  const creditProofs:Array<{creditNoteId:string;disposition:Awaited<ReturnType<typeof creditNoteDisposition>>}>=[];
  for(const note of canonical.notes){const[actual]=await ctx.tx.select().from(creditNotes).where(eq(creditNotes.id,note.id)).limit(1);if(!actual||actual.status!=="issued"||actual.currency!==canonical.invoice.currency||!scope.notes.includes(actual.id))refuse();
   const disposition=await creditNoteDisposition(ctx.tx,note.id);if(disposition.reservedForReturns||disposition.reviewRequired)refuse();creditProofs.push({creditNoteId:note.id,disposition});}
  if(canonical.feeDuty&&(canonical.feeDuty.invoiceId!==canonical.invoice.id||canonical.feeDuty.merchantProfileId!==quote.profileId||canonical.feeDuty.profileVersion!==quote.profileVersion
   ||canonical.feeDuty.acceptedQuoteDigest!==collection.acceptedQuoteDigest||canonical.feeDuty.targetFeeMinor!==canonical.marketPolicy.feeMinor||canonical.feeDuty.cashFeeTargetMinor!==manifest.applicationFeeMinor))refuse();
  // The whole original profile history stays hashed. Only the actual target
  // and credit-source invoice versions supply current legal credit/tax facts;
  // an unrelated old erased version is not silently made this target's owner.
  const sourceInvoiceIds=[...new Set([canonical.invoice.id,...canonical.funding.map(row=>row.sourceInvoiceId)])];
  if(sourceInvoiceIds.some(id=>!scope.invoices.includes(id)))refuse();
  const taxSources=await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(inArray(invoiceMerchantTaxQuotes.invoiceId,sourceInvoiceIds)).limit(5001);
  if(taxSources.length>5000||sourceInvoiceIds.some(id=>!taxSources.some(row=>row.invoiceId===id)))refuse();
  const profiles=scope.profiles.length?await ctx.tx.select().from(merchantTaxProfiles).where(inArray(merchantTaxProfiles.id,scope.profiles)).limit(5001):[];
  const versionIds=snapshot.entries.filter(row=>row.table==="merchant_tax_profile_versions").map(row=>row.id);
  const versions=versionIds.length?await ctx.tx.select().from(merchantTaxProfileVersions).where(inArray(merchantTaxProfileVersions.id,versionIds)).limit(5001):[];
  if(profiles.length!==scope.profiles.length||versions.length!==versionIds.length||versions.length>5000||!profiles.some(profile=>profile.id===quote.profileId&&profile.state==="active")
   ||taxSources.some(row=>!scope.profiles.includes(row.profileId)||!versions.some(version=>version.profileId===row.profileId&&version.version===row.profileVersion&&version.erasedAt===null))
   ||!taxSources.some(row=>row.invoiceId===canonical.invoice.id&&row.profileId===quote.profileId&&row.profileVersion===quote.profileVersion))refuse();
  const[privacy]=await ctx.tx.execute<{ready:boolean}>(sql`select not exists(select 1 from contacts p where p.id in(${uuidSql(scope.contacts)}) and p.source='privacy-erasure')
   and not exists(select 1 from data_requests r where r.contact_id in(${uuidSql(scope.contacts)}) and r.kind='erasure' and r.verified_at is not null and r.status in('verified','in_progress','completed','partially_completed'))
   and not exists(select 1 from privacy_retention_exceptions h join data_requests r on r.id=h.data_request_id where r.contact_id in(${uuidSql(scope.contacts)}) and h.scope in('commerce.money','commerce.merchantTax','subscriptions.agreements','privacy.records') and(h.expires_at is null or h.expires_at>clock_timestamp())) as ready`);
  if(privacy?.ready!==true||!scope.contacts.includes(parent.contactId))refuse();
  await assertNoUnappliedMerchantCharge(ctx,canonical.invoice.id);
  const rawEvidence:Array<{subscriptionId:string;operations:Array<typeof subscriptionProviderScheduleOperations.$inferSelect>;coverageRevision:string;rawRevision:string}>=[];
  for(const subscriptionId of [...scope.subscriptions].sort()){
   const operations=await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId,subscriptionId)).limit(5001);
   if(operations.length>5000||operations.some(operation=>merchantTaxDigest(operation.originalRequest)!==operation.requestDigest||!["confirmed","refused"].includes(operation.state)||!scheduleCallerHasStopped(operation)||!originalProviderReadsFinished(operation)))refuse();
   const graph=await parentFinancialGraph(ctx,subscriptionId);
   if(graph.money.some(row=>!scope.payments.includes(row.id))||graph.fullInvoices.some(row=>!scope.invoices.includes(row.id))||graph.notes.some(row=>!scope.notes.includes(row.id)))refuse();
   const coverage=await controlledCollectionCoverage(ctx.tx,{subscriptionId}),raw=await controlledTargetRawClassification(ctx.tx,subscriptionId,coverage,graph);
   if(raw.unresolvedFactIds.length||coverage.transport.unfinishedCalls.length)refuse();rawEvidence.push({subscriptionId,operations,coverageRevision:coverage.revision,rawRevision:raw.revision});
  }
  const after=await snapshotFor(ctx,input.collectionId);
  if(after.revision!==snapshot.revision||JSON.stringify(after.entries)!==JSON.stringify(snapshot.entries)||after.physicalRowCount!==snapshot.physicalRowCount||merchantTaxDigest(await scopeFor(ctx,input.collectionId))!==merchantTaxDigest(scope))refuse();
  const parentRevision=merchantTaxDigest({collectionId:collection.id,requestedReceiptIds:input.receiptIds,bankRevision:actualBank.sourceRevision,parentPgRevision:snapshot.revision,coverageEvidence,wholeCallers,paymentProofs,creditProofs,feeProofs,privacy,rawEvidence,capacity});
  return{protocol:CONTROLLED_COLLECTION_PROTOCOL,collectionId:collection.id,resourceId:resource.id,subscriptionId:parent.id,invoiceId:canonical.invoice.id,parentRevision,preApplicationRevision:actualBank.preApplicationRevision,
   bankRevision:actualBank.sourceRevision,parentPgRevision:snapshot.revision,scope,plan,coverageEvidence,wholeCallers,paymentProofs,creditProofs,feeProofs,rawEvidence,
   suppliesApplicationAuthority:false as const,suppliesPrincipalAuthority:false as const,suppliesAccessAuthority:false as const};
 });
}
