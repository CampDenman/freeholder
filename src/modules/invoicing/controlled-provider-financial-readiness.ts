// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: parent-owned admission coverage, distinct from erasure quiescence.
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { defineService,getService,ServiceError,type ServiceContext } from "@/core/service";
import { controlledCollectionCoverage } from "@/modules/subscriptions/controlled-provider-collection-coverage";
import { CONTROLLED_FINANCIAL_PROTOCOL, requireControlledFinancialProtocol } from "./controlled-provider-financial-protocol";
import { controlledProviderCoverage } from "@/modules/subscriptions/controlled-provider-coverage";
import { subscriptionCommercialTerms,subscriptionMerchantScopes,subscriptions } from "@/modules/subscriptions/schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { parentFinancialGraph,lockControlledParentMoney } from "./controlled-provider-financial-parent";
import { controlledFinancialEntries } from "./controlled-provider-financial-witness";
import { creditNoteDisposition } from "./credit-disposition";

function refuse():never{throw new ServiceError("conflict","Restore this exact original agreement's complete accepted parent, cash/principal, refund/dispute, credit, commission and authentic controlled caller history before new provider admission.");}
/** Call order is controlled resource → subscription parent → original cash.
 * No controlled resource lock is acquired here, and no provider call occurs.
 * Planning runs before a physical caller exists; runtime holds its exact
 * resource before this query takes the parent lock. Original money readers
 * stay plain and do not re-enter this service or upgrade a contact lock. */
export const controlledProviderFinancialReadiness=defineService({
 name:"invoicing.controlledProviderFinancialReadiness",summary:"Authenticate complete original parent financial coverage before one exact controlled provider admission.",
 kind:"query",permission:"system",external:false,
 input:z.object({subscriptionId:z.uuid(),excludeUnadmittedOperationId:z.uuid().optional(),requiredProtocol:z.literal(CONTROLLED_FINANCIAL_PROTOCOL).optional()}).strict(),
 output:z.object({ready:z.literal(true),revision:z.string().regex(/^[a-f0-9]{64}$/)}),
 handler:async(input,ctx)=>{
  if(input.requiredProtocol){
   await requireControlledFinancialProtocol(ctx.tx);
   if(!getService("invoicing.controlledProviderCollectionAuthority"))refuse();
   const coverage=await controlledCollectionCoverage(ctx.tx,input);
   const[parent]=await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,input.subscriptionId)).limit(1).for("update");if(!parent)refuse();
   const graph=await parentFinancialGraph(ctx,parent.id);await lockControlledParentMoney(ctx,graph);
   const entries=new Map<string,string>();
   for(const row of [...graph.physical,...graph.children.entries,...graph.proration.entries,...graph.controlled.entries]){
    const key=`${row.table}:${row.id}`,previous=entries.get(key);if(previous&&previous!==row.fingerprint)refuse();entries.set(key,row.fingerprint);
   }
   if(input.excludeUnadmittedOperationId)entries.delete(`subscription_controlled_operations:${input.excludeUnadmittedOperationId}`);
   if(entries.size>5000)refuse();
   const after=await controlledCollectionCoverage(ctx.tx,input),current=await parentFinancialGraph(ctx,parent.id);
   if(after.revision!==coverage.revision||merchantTaxDigest(current)!==merchantTaxDigest(graph))refuse();
   // Authenticated complete coverage includes debt and every own quote. It
   // does not authorize current target collection; that separate query must
   // prove actual original money/consent/calendar/credit/commission safety.
   ctx.setSubject("subscription",parent.id);
   return{ready:true as const,revision:merchantTaxDigest({protocol:CONTROLLED_FINANCIAL_PROTOCOL,coverageRevision:coverage.revision,entries:[...entries].sort(([a],[b])=>a.localeCompare(b))})};
  }
  const coverage=await controlledProviderCoverage(ctx.tx,input);
  if(coverage.unfinishedCalls.length||coverage.rawCashReviewFactIds.length)refuse();
  const[parent]=await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,input.subscriptionId)).limit(1).for("update");
  if(!parent||parent.provider!=="stripe"||parent.merchantScopeVersion!==1||parent.billingMode!=="provider"||parent.signupPending||parent.cancelledAt||parent.cancelAtPeriodEnd||!["active","trialing"].includes(parent.status))refuse();
  const[scope]=await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId,parent.id)).limit(1);
  const terms=await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.subscriptionId,parent.id)).orderBy(subscriptionCommercialTerms.revision).limit(5001);
  if(!scope||!terms.length||terms.length>5000||terms.some(row=>row.profileId!==scope.taxProfileId))refuse();
  // Reuse the existing original accepted calendar/consent/phase/tax/period
  // authority. Its fresh quote is a safety check, not stable revision input.
  const horizon=getService("subscriptions.quoteMerchantProviderHorizon");if(!horizon)refuse();
  const accepted=z.object({termsId:z.uuid()}).passthrough().parse(await ctx.callAsSystem(horizon,{subscriptionId:parent.id,additionalPeriods:1}));
  const actualTerms=terms.find(row=>row.id===accepted.termsId);if(!actualTerms)refuse();
  const[privacy]=await ctx.tx.execute<{ready:boolean}>(sql`select exists(select 1 from merchant_tax_profiles p
   join contacts buyer on buyer.id=${parent.contactId}::uuid join contacts seller on seller.id=p.contact_id
   where p.id=${actualTerms.profileId}::uuid and p.state='active' and p.current_version=${actualTerms.profileVersion}
    and buyer.source is distinct from 'privacy-erasure' and seller.source is distinct from 'privacy-erasure'
    and not exists(select 1 from data_requests r where r.contact_id in(buyer.id,seller.id) and r.kind='erasure' and r.verified_at is not null
     and r.status in('verified','in_progress','completed','partially_completed'))
    and not exists(select 1 from privacy_retention_exceptions h join data_requests r on r.id=h.data_request_id
     where r.contact_id in(buyer.id,seller.id) and h.scope in('commerce.money','commerce.merchantTax','subscriptions.agreements','privacy.records')
      and(h.expires_at is null or h.expires_at>clock_timestamp()))) as ready`);
  if(!privacy?.ready)refuse();
  const graph=await parentFinancialGraph(ctx,parent.id);
  await lockControlledParentMoney(ctx,graph);
  if(merchantTaxDigest(await parentFinancialGraph(ctx,parent.id))!==merchantTaxDigest(graph))refuse();
  const principal=getService("invoicing.originalPrincipalAuthority"),debt=getService("invoicing.merchantPaymentRecoveryDebt");
  if(!principal||!debt)refuse();
  for(const payment of graph.money){
   const state=z.object({pending:z.boolean()}).passthrough().parse(await ctx.callAsSystem(debt,{paymentId:payment.id}));if(state.pending)refuse();
   if(payment.status==="succeeded"){
    const actual=z.object({principalSafe:z.boolean(),financialDebtPending:z.boolean()}).passthrough().parse(await ctx.callAsSystem(principal,{paymentId:payment.id}));
    if(!actual.principalSafe||actual.financialDebtPending)refuse();
   }
  }
  for(const receipt of graph.receipts){
   const applied=graph.aliases.filter(row=>row.originalChargeReceiptId===receipt.id);
   if(applied.length!==1||applied[0]!.subscriptionId!==receipt.subscriptionId||!graph.money.some(payment=>payment.id===applied[0]!.paymentId&&payment.status==="succeeded"
    &&payment.providerRef===receipt.providerPaymentIntentRef&&payment.amountMinor===receipt.amountMinor&&payment.currency===receipt.currency))refuse();
  }
  for(const note of graph.notes)if(note.status==="issued"&&(await creditNoteDisposition(ctx.tx,note.id)).reviewRequired)refuse();
  const entries=new Map<string,string>();
  const add=(table:string,id:string,fingerprint:string)=>{const key=`${table}:${id}`,old=entries.get(key);if(old&&old!==fingerprint)refuse();entries.set(key,fingerprint);};
  for(const row of [...graph.physical,...graph.children.entries,...graph.proration.entries,...graph.controlled.entries,...controlledFinancialEntries(coverage.witness)])add(row.table,row.id,row.fingerprint);
  if(input.excludeUnadmittedOperationId)entries.delete(`subscription_controlled_operations:${input.excludeUnadmittedOperationId}`);
  if(entries.size>5000)refuse();
  const afterCoverage=await controlledProviderCoverage(ctx.tx,input),afterGraph=await parentFinancialGraph(ctx,parent.id);
  if(afterCoverage.revision!==coverage.revision||merchantTaxDigest(afterGraph)!==merchantTaxDigest(graph))refuse();
  // Exclusion diagnostics deliberately do not enter this revision. The exact
  // same empty planned operation is absent from both authenticated coverage
  // and the generic child projection, retaining every prior real occurrence.
  ctx.setSubject("subscription",parent.id);
  return{ready:true as const,revision:merchantTaxDigest({subscriptionId:parent.id,coverageRevision:coverage.revision,entries:[...entries].sort(([a],[b])=>a.localeCompare(b))})};
 }
});
export default [controlledProviderFinancialReadiness];
