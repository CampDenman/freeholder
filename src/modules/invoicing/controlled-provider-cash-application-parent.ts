// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: prospective parent evidence, never an application/paid-access grant.
import { and,eq,sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { getService,ServiceError,type ServiceContext } from "@/core/service";
import { controlledCollectionState } from "@/modules/subscriptions/controlled-provider-collection-state";
import { controlledCollectionCoverage } from "@/modules/subscriptions/controlled-provider-collection-coverage";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-contract";
import { controlledCashEvidence,readOriginalControlledChargeAuthority } from "@/modules/subscriptions/controlled-provider-cash-origin";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { subscriptionControlledResources,subscriptionControlledChargeOrigins } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptions,subscriptionProviderChargeReceipts,subscriptionProviderChargeObservations } from "@/modules/subscriptions/schema";
import { subscriptionProviderScheduleOperations } from "@/modules/subscriptions/provider-schedule-schema";
import { scheduleCallerHasStopped } from "@/modules/subscriptions/provider-schedule-proof";
import { originalProviderReadsFinished } from "@/modules/subscriptions/provider-schedule-read-proof";
import { parentFinancialGraph,lockControlledParentMoney } from "./controlled-provider-financial-parent";
import { requireControlledFinancialProtocol } from "./controlled-provider-financial-protocol";
import { controlledTargetRawClassification } from "./controlled-target-raw-classification";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantFeeRefunds } from "./merchant-collection-schema";
import { merchantTaxProfiles,merchantTaxProfileVersions } from "./merchant-tax-schema";
import { reserveOriginalSubscriptionCashApplication } from "./merchant-refund-application";
import { originalCashRecoveryFinancialWitness,originalCashCallersFinished } from "./original-cash-recovery-store";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { creditNoteDisposition } from "./credit-disposition";
import { originalCreditFeeAllocation } from "./credit-fee-origin";
import { merchantTaxDigest } from "./merchant-tax-store";
import type { invoices } from "./schema";

const sha=z.string().regex(/^[a-f0-9]{64}$/),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const principal=z.object({principalSafe:z.boolean(),financialDebtPending:z.boolean(),witness:z.object({paymentId:z.uuid(),revision:sha}).passthrough()}).passthrough();
const debt=z.object({pending:z.boolean(),reasons:z.array(z.string())}).passthrough();
function refuse():never{throw new ServiceError("conflict","Retain the exact original controlled cash, complete current bank/refund/dispute proof and unchanged canonical invoice/credit/fee/owner evidence before applying this receipt. Coverage, an equal amount or a later zero is not application authority.");}

/** Exact prospective capacity only. No refund restores an already paid invoice
 * balance; an under/over receipt remains raw money requiring disposition. */
export function controlledCashApplicationCapacity(invoice:Pick<typeof invoices.$inferSelect,"totalMinor"|"paidMinor"|"creditedMinor"|"refundedMinor"|"status">,amountMinor:number){
 const values=[invoice.totalMinor,invoice.paidMinor,invoice.creditedMinor,invoice.refundedMinor,amountMinor];
 if(values.some(value=>!minor.safeParse(value).success)||!amountMinor||invoice.refundedMinor!==0||!["sent","viewed","partially_paid","overdue"].includes(invoice.status))refuse();
 const due=BigInt(invoice.totalMinor)-BigInt(invoice.creditedMinor)-BigInt(invoice.paidMinor);
 if(due<=0n||due!==BigInt(amountMinor))refuse();return Number(due);
}

/** Arithmetic for a separately authenticated EXACT receipt batch. This does
 * not prove DB ownership or disposition. One real receipt can fund one payment;
 * a partial batch preserves its genuine unpaid remainder and grants no effect.
 * Over-capture is refused whole, never clipped into invented receipt amounts. */
export function controlledCashApplicationBatchCapacity(invoice:Pick<typeof invoices.$inferSelect,"totalMinor"|"paidMinor"|"creditedMinor"|"refundedMinor"|"status"|"currency">,
 receipts:readonly {receiptId:string;amountMinor:number;currency:string}[]){
 if(!receipts.length||receipts.length>5000||new Set(receipts.map(row=>row.receiptId)).size!==receipts.length
  ||receipts.some(row=>!z.uuid().safeParse(row.receiptId).success||!minor.positive().safeParse(row.amountMinor).success||row.currency!==invoice.currency))refuse();
 const values=[invoice.totalMinor,invoice.paidMinor,invoice.creditedMinor,invoice.refundedMinor];
 if(values.some(value=>!minor.safeParse(value).success)||invoice.refundedMinor!==0||!["sent","viewed","partially_paid","overdue"].includes(invoice.status))refuse();
 const before=BigInt(invoice.totalMinor)-BigInt(invoice.creditedMinor)-BigInt(invoice.paidMinor),applied=receipts.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n);
 if(before<=0n||applied>before)refuse();
 return{receiptIds:receipts.map(row=>row.receiptId),appliedMinor:Number(applied),outstandingBeforeMinor:Number(before),outstandingAfterMinor:Number(before-applied)};
}

/** This ordinary reader deliberately returns EVIDENCE, not allowed:true. The
 * separate service is not registered until the producer's genuine prospective
 * bank proof exists. Caller must use this BEFORE shared createPayment acquires
 * invoice locks, then repeat the whole evidence read in that SAME transaction.
 * Retained own raw facts stay unresolved here, never deleted/excluded by kind.
 * The eventual proof must bind their exact IDs and actual current bank money. */
export async function readControlledCashApplicationParent(ctx:ServiceContext,input:{collectionId:string;receiptId:string;requiredProtocol:typeof CONTROLLED_COLLECTION_PROTOCOL}){
 if(input.requiredProtocol!==CONTROLLED_COLLECTION_PROTOCOL)refuse();
 await lockContactIdentityForRead(ctx.tx);await requireControlledFinancialProtocol(ctx.tx);
 const[reference]=await ctx.tx.select({resourceId:subscriptionControlledResources.id,subscriptionId:subscriptionControlledResources.subscriptionId})
  .from(subscriptionControlledCollections).innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId))
  .innerJoin(subscriptionControlledResources,eq(subscriptionControlledResources.id,subscriptionControlledQuotes.resourceId))
  .where(eq(subscriptionControlledCollections.id,input.collectionId)).limit(1);if(!reference)refuse();
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
 await ctx.tx.select({id:subscriptionControlledResources.id}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).limit(1).for("update");
 await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,reference.subscriptionId)).limit(1).for("update");
 const graph=await parentFinancialGraph(ctx,reference.subscriptionId);await lockControlledParentMoney(ctx,graph);
 const source=await controlledCollectionState(ctx.tx,input.collectionId),coverage=await controlledCollectionCoverage(ctx.tx,{subscriptionId:reference.subscriptionId});
 const{collection,quote,parent,resource,canonical,manifest,history}=source;
 if(parent.id!==reference.subscriptionId||resource.id!==reference.resourceId||!canonical.currentCollectible||canonical.invoice.contactId!==parent.contactId
  ||canonical.invoice.currency!==parent.currency||canonical.invoice.sourceId!==quote.canonicalSourceId||history.unfinished.length||coverage.transport.unfinishedCalls.length||history.closures.length)refuse();
 const legacyOperations=await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId,parent.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
 if(legacyOperations.length>5000||legacyOperations.some(operation=>merchantTaxDigest(operation.originalRequest)!==operation.requestDigest
  ||!["confirmed","refused"].includes(operation.state)||!scheduleCallerHasStopped(operation)||!originalProviderReadsFinished(operation)))refuse();
 const[receipt]=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id,input.receiptId)).limit(1);
 const[origin]=await ctx.tx.select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId,input.receiptId)).limit(1);
 const originalFact=origin?history.facts.find(row=>row.id===origin.factId&&row.callId===origin.callId&&row.actual.kind==="cash_observed"):null;
 if(!receipt||!origin||!originalFact||origin.resourceId!==resource.id||receipt.subscriptionId!==parent.id||receipt.providerApiVersion!==resource.originalScope.providerApiVersion
  ||receipt.providerPlatformAccountId!==resource.originalScope.providerPlatformAccountId||receipt.chargeAccountId!==(resource.originalScope.providerAccountId??null)
  ||!receipt.providerChargeRef||!receipt.customerChargeVerified||!receipt.merchantRouteVerified||receipt.currency!==canonical.invoice.currency||receipt.providerInvoiceRef!==source.binding?.providerInvoiceRef)refuse();
 const actual=await readOriginalControlledChargeAuthority(ctx.tx,controlledCashEvidence.parse(originalFact.actual.raw.cash),{resourceId:resource.id,callId:origin.callId,factId:origin.factId});
 if(actual.controlledOrigin.operationId!==origin.operationId||actual.controlledOrigin.originalEvidenceDigest!==origin.originalEvidenceDigest
  ||actual.controlledCash.providerPaymentIntentRef!==receipt.providerPaymentIntentRef||actual.controlledCash.providerInvoiceRef!==receipt.providerInvoiceRef
  ||actual.controlledCash.providerChargeRef!==receipt.providerChargeRef||actual.controlledCash.amountMinor!==receipt.amountMinor||actual.controlledCash.currency!==receipt.currency)refuse();
 const outstandingMinor=controlledCashApplicationCapacity(canonical.invoice,receipt.amountMinor);
 const observationRows=await ctx.tx.select().from(subscriptionProviderChargeObservations).where(and(eq(subscriptionProviderChargeObservations.subscriptionId,parent.id),
  eq(subscriptionProviderChargeObservations.providerPaymentIntentRef,receipt.providerPaymentIntentRef))).limit(5001);
 if(observationRows.length>5000||!observationRows.length||observationRows.some(row=>row.providerPlatformAccountId!==receipt.providerPlatformAccountId||row.chargeAccountId!==receipt.chargeAccountId
  ||row.providerApiVersion!==receipt.providerApiVersion||row.providerSubscriptionRef!==receipt.providerSubscriptionRef||row.providerInvoiceRef!==receipt.providerInvoiceRef||row.providerChargeRef!==receipt.providerChargeRef
  ||row.amountMinor!==receipt.amountMinor||row.currency!==receipt.currency||row.actualDestinationAccountId!==receipt.actualDestinationAccountId||row.actualSettlementMerchantAccountId!==receipt.actualSettlementMerchantAccountId
  ||!row.customerChargeVerified||!row.merchantRouteVerified))refuse();
 const aliases=await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.originalChargeReceiptId,receipt.id)).limit(2);
 // Idempotent ALREADY applied reconciliation belongs to the existing ordinary
 // payment path. This prospective reader must never adopt a reserved payment.
 if(aliases.length||graph.money.some(payment=>payment.provider==="stripe"&&payment.providerRef===receipt.providerPaymentIntentRef))refuse();
 await reserveOriginalSubscriptionCashApplication(ctx,receipt.id);
 const rawCash=await originalCashRecoveryFinancialWitness(ctx.tx,[],[receipt.id]);
 // An existing return/callback/recovery occurrence requires its genuine bank
 // disposition proof. It cannot disappear merely because no payment exists.
 if(!originalCashCallersFinished(rawCash)||rawCash.closures.length||rawCash.owners.some(owner=>owner.paymentId!==null||owner.subscriptionChargeReceiptId!==receipt.id
  ||owner.owner.cash.providerPlatformAccountId!==receipt.providerPlatformAccountId||owner.owner.cash.chargeAccountId!==receipt.chargeAccountId||owner.owner.cash.providerRef!==receipt.providerPaymentIntentRef
  ||owner.owner.cash.amountMinor!==receipt.amountMinor||owner.owner.cash.currency!==receipt.currency))refuse();
 const receiptFees=await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.originalChargeReceiptId,receipt.id)).limit(5001);
 if(receiptFees.length>5000||receiptFees.some(row=>["reserved","dispatching","unknown"].includes(row.status)))refuse();
 const[profile]=await ctx.tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,quote.profileId)).limit(1);
 const[version]=await ctx.tx.select().from(merchantTaxProfileVersions).where(and(eq(merchantTaxProfileVersions.profileId,quote.profileId),eq(merchantTaxProfileVersions.version,quote.profileVersion))).limit(1);
 if(!profile||profile.state!=="active"||!version||version.erasedAt||canonical.taxes[0]?.profileId!==profile.id||canonical.taxes[0]?.profileVersion!==version.version)refuse();
 const contacts=[parent.contactId,...(profile.contactId?[profile.contactId]:[])];
 const identities=sql.join(contacts.map(id=>sql`${id}::uuid`),sql`, `);
 const[privacy]=await ctx.tx.execute<{ready:boolean}>(sql`select not exists(select 1 from contacts p where p.id in(${identities}) and p.source='privacy-erasure')
  and not exists(select 1 from data_requests r where r.contact_id in(${identities}) and r.kind='erasure' and r.verified_at is not null and r.status in('verified','in_progress','completed','partially_completed'))
  and not exists(select 1 from privacy_retention_exceptions h join data_requests r on r.id=h.data_request_id where r.contact_id in(${identities})
   and h.scope in('commerce.money','commerce.merchantTax','subscriptions.agreements','privacy.records') and(h.expires_at is null or h.expires_at>clock_timestamp())) as ready`);
 if(privacy?.ready!==true)refuse();
 await assertNoUnappliedMerchantCharge(ctx,canonical.invoice.id);
 const principalReader=getService("invoicing.originalPrincipalAuthority"),debtReader=getService("invoicing.merchantPaymentRecoveryDebt");if(!principalReader||!debtReader)refuse();
 const paymentProofs=[];
 for(const payment of graph.money){
  const financial=debt.parse(await ctx.callAsSystem(debtReader,{paymentId:payment.id}));if(financial.pending)refuse();
  const current=payment.status==="succeeded"?principal.parse(await ctx.callAsSystem(principalReader,{paymentId:payment.id})):null;
  if(current&&(!current.principalSafe||current.financialDebtPending||current.witness.paymentId!==payment.id))refuse();
  paymentProofs.push({paymentId:payment.id,financial,current});
 }
 for(const other of graph.receipts){if(other.id===receipt.id)continue;const owners=graph.aliases.filter(row=>row.originalChargeReceiptId===other.id);
  if(owners.length!==1||!graph.money.some(payment=>payment.id===owners[0]!.paymentId&&payment.status==="succeeded"&&payment.providerRef===other.providerPaymentIntentRef&&payment.amountMinor===other.amountMinor&&payment.currency===other.currency))refuse();
 }
 const creditProofs=[],feeProofs=[];
 const notes=[...new Set([...canonical.notes.map(note=>note.id),...(collection.creditNoteId?[collection.creditNoteId]:[])])];
 for(const id of notes){const note=graph.notes.find(row=>row.id===id);if(!note||note.status!=="issued"||note.currency!==canonical.invoice.currency)refuse();
  const disposition=await creditNoteDisposition(ctx.tx,id);if(disposition.reservedForReturns||disposition.reviewRequired)refuse();creditProofs.push({id,disposition});
 }
 for(const funding of canonical.funding){const fee=await originalCreditFeeAllocation(ctx,funding.sourcePaymentId,funding.sourceApplicationId,0);
  if(fee.collectionState==="review"||fee.unexpectedFee)refuse();feeProofs.push({fundingId:funding.id,fee});
 }
 if(canonical.feeDuty&&(canonical.feeDuty.merchantProfileId!==quote.profileId||canonical.feeDuty.profileVersion!==quote.profileVersion||canonical.feeDuty.acceptedQuoteDigest!==collection.acceptedQuoteDigest
  ||canonical.feeDuty.targetFeeMinor!==canonical.marketPolicy.feeMinor||canonical.feeDuty.cashFeeTargetMinor!==manifest.applicationFeeMinor))refuse();
 const rawClassification=await controlledTargetRawClassification(ctx.tx,parent.id,coverage,graph);
 const entries=new Map<string,string>();
 function add(row:{table:string;id:string;fingerprint:string}){const key=`${row.table}:${row.id}`,prior=entries.get(key);if(prior&&prior!==row.fingerprint)refuse();entries.set(key,row.fingerprint);if(entries.size>5000)refuse();}
 for(const row of [...graph.physical,...graph.children.entries,...graph.proration.entries,...graph.controlled.entries,...rawClassification.evidenceEntries])add(row);
 const profileEvidence=await ctx.tx.execute<{table:string;id:string;fingerprint:string}>(sql`select 'merchant_tax_profile_versions' as table,v.id::text as id,encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex') as fingerprint
  from merchant_tax_profile_versions v where v.id=${version.id}::uuid`);
 if(profileEvidence.length!==1)refuse();for(const row of profileEvidence)add(row);
 const privateEvidence=await ctx.tx.execute<{table:string;id:string;fingerprint:string}>(sql`select 'contacts' as table,p.id::text as id,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') as fingerprint from contacts p where p.id in(${identities})
  union all select 'data_requests',r.id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from data_requests r where r.contact_id in(${identities})
  union all select 'privacy_retention_exceptions',h.id::text,encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex') from privacy_retention_exceptions h join data_requests r on r.id=h.data_request_id where r.contact_id in(${identities}) order by 1,2 limit 5001`);
 if(privateEvidence.length>5000||privateEvidence.filter(row=>row.table==="contacts").length!==new Set(contacts).size)refuse();for(const row of privateEvidence)add(row);
 const physicalEntries=[...entries].sort(([a],[b])=>a.localeCompare(b));
 const preApplicationRevision=merchantTaxDigest({protocol:CONTROLLED_COLLECTION_PROTOCOL,collectionId:collection.id,receiptId:receipt.id,source,coverageRevision:coverage.revision,
  physicalEntries,receipt,origin,observationRows,legacyOperations,paymentProofs,creditProofs,feeProofs,receiptFees,rawCash,privacy,outstandingMinor,rawClassificationRevision:rawClassification.revision});
 return{collectionId:collection.id,receiptId:receipt.id,subscriptionId:parent.id,resourceId:resource.id,invoiceId:canonical.invoice.id,outstandingMinor,
  preApplicationRevision,source,coverage,rawClassification,rawCash,physicalEntries};
}

/** Reentrant recheck only after the real caller already acquired this helper's
 * resource→parent prefix. Neither a public DTO nor a session marker supplies
 * the original authorization; the entire genuine evidence is read again. */
export async function recheckControlledCashApplicationParent(ctx:ServiceContext,input:{collectionId:string;receiptId:string;requiredProtocol:typeof CONTROLLED_COLLECTION_PROTOCOL},expectedPreApplicationRevision:string){
 const current=await readControlledCashApplicationParent(ctx,input);
 if(!sha.safeParse(expectedPreApplicationRevision).success||current.preApplicationRevision!==expectedPreApplicationRevision)refuse();return current;
}
