// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: parent-owned admission coverage, distinct from erasure quiescence.
import { eq,inArray,or,sql } from "drizzle-orm";
import { z } from "zod";
import { defineService,getService,ServiceError,type ServiceContext } from "@/core/service";
import { controlledProviderCoverage } from "@/modules/subscriptions/controlled-provider-coverage";
import { subscriptionCommercialTerms,subscriptionMerchantScopes,subscriptionProviderChargeReceipts,subscriptions } from "@/modules/subscriptions/schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { invoices,payments,creditNotes } from "./schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantRefundDependencyFingerprints } from "./merchant-refund-dependencies";
import { prorationFinancialWitness } from "./proration-financial-witness";
import { controlledFinancialEntries } from "./controlled-provider-financial-witness";
import { creditNoteDisposition } from "./credit-disposition";

const refuse=():never=>{throw new ServiceError("conflict","Restore this exact original agreement's complete accepted parent, cash/principal, refund/dispute, credit, commission and authentic controlled caller history before new provider admission.");};
const uuidList=(ids:readonly string[])=>ids.length?sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`):sql`null::uuid`;
async function parentFinancialGraph(ctx:ServiceContext,subscriptionId:string){
 const proration=await prorationFinancialWitness(ctx.tx,{kind:"subscription",ids:[subscriptionId]});
 if(proration.incomplete)refuse();
 const sourcePaymentIds=[...new Set(proration.entries.flatMap(row=>row.parents.sourcePaymentId?[row.parents.sourcePaymentId]:[]))];
 const references=await ctx.tx.execute<{id:string}>(sql`
  select e.invoice_id::text as id from subscription_events e where e.subscription_id=${subscriptionId}::uuid and e.invoice_id is not null
  union select p.debit_invoice_id::text from subscription_prorations p where p.subscription_id=${subscriptionId}::uuid and p.debit_invoice_id is not null
  union select p.invoice_id::text from merchant_agreement_payment_routes r join payments p on p.id=r.payment_id where r.subscription_id=${subscriptionId}::uuid order by 1 limit 5001`);
 if(references.length>5000)refuse();
 const invoiceIds=references.map(row=>row.id);
 const money=invoiceIds.length||sourcePaymentIds.length?await ctx.tx.select().from(payments)
  .where(or(...(invoiceIds.length?[inArray(payments.invoiceId,invoiceIds)]:[]),...(sourcePaymentIds.length?[inArray(payments.id,sourcePaymentIds)]:[]))).orderBy(payments.id).limit(5001):[];
 const exactInvoiceIds=[...new Set([...invoiceIds,...money.map(row=>row.invoiceId)])];
 const receipts=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,subscriptionId)).orderBy(subscriptionProviderChargeReceipts.id).limit(5001);
 const aliases=receipts.length||money.length?await ctx.tx.select().from(merchantAgreementPaymentRoutes)
  .where(or(...(receipts.length?[inArray(merchantAgreementPaymentRoutes.originalChargeReceiptId,receipts.map(row=>row.id))]:[]),...(money.length?[inArray(merchantAgreementPaymentRoutes.paymentId,money.map(row=>row.id))]:[]))).orderBy(merchantAgreementPaymentRoutes.paymentId).limit(5001):[];
 const ancestorReceiptIds=[...new Set(aliases.flatMap(row=>row.originalChargeReceiptId&&!receipts.some(receipt=>receipt.id===row.originalChargeReceiptId)?[row.originalChargeReceiptId]:[]))];
 if(ancestorReceiptIds.length){
  const ancestors=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(inArray(subscriptionProviderChargeReceipts.id,ancestorReceiptIds)).limit(5001);
  if(ancestors.length!==ancestorReceiptIds.length)refuse();receipts.push(...ancestors);receipts.sort((a,b)=>a.id.localeCompare(b.id));
 }
 const originalNoteIds=[...new Set(proration.entries.flatMap(row=>row.parents.creditNoteId?[row.parents.creditNoteId]:[]))];
 const notes=invoiceIds.length||originalNoteIds.length?await ctx.tx.select().from(creditNotes)
  .where(or(...(invoiceIds.length?[inArray(creditNotes.invoiceId,invoiceIds)]:[]),...(originalNoteIds.length?[inArray(creditNotes.id,originalNoteIds)]:[]))).orderBy(creditNotes.id).limit(5001):[];
 const fullInvoices=exactInvoiceIds.length?await ctx.tx.select().from(invoices).where(inArray(invoices.id,exactInvoiceIds)).orderBy(invoices.id).limit(5001):[];
 if([money,receipts,aliases,notes,fullInvoices].some(rows=>rows.length>5000)||fullInvoices.length!==exactInvoiceIds.length||sourcePaymentIds.some(id=>!money.some(row=>row.id===id)))refuse();
 const physical=await ctx.tx.execute<{table:string;id:string;fingerprint:string}>(sql`
  select 'subscriptions' as table,s.id::text as id,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') as fingerprint from subscriptions s where s.id=${subscriptionId}::uuid
  union all select 'subscription_commercial_terms',t.id::text,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') from subscription_commercial_terms t where t.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_merchant_scopes',s.subscription_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_merchant_scopes s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_market_policies',s.subscription_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_market_policies s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_schedule_resources',s.subscription_id::text,encode(sha256(convert_to((to_jsonb(s)-'updated_at')::text,'UTF8')),'hex') from subscription_provider_schedule_resources s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_schedule_operations',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_provider_schedule_operations s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_commercial_amendments',s.terms_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_commercial_amendments s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_commercial_resumptions',s.terms_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_commercial_resumptions s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_generations',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_provider_generations s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_charge_observations',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_provider_charge_observations s where s.subscription_id=${subscriptionId}::uuid
  union all select 'merchant_payment_observations',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_payment_observations s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'payment_disputes',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from payment_disputes s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'refunds',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from refunds s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'invoices',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from invoices s where s.id in (${uuidList(exactInvoiceIds)})
  union all select 'payments',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from payments s where s.id in (${uuidList(money.map(row=>row.id))})
  union all select 'credit_notes',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from credit_notes s where s.id in (${uuidList(notes.map(row=>row.id))})
  union all select 'subscription_provider_charge_receipts',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_provider_charge_receipts s where s.id in (${uuidList(receipts.map(row=>row.id))})
  union all select 'merchant_agreement_payment_routes',s.payment_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_agreement_payment_routes s where s.payment_id in (${uuidList(aliases.map(row=>row.paymentId))})
  union all select 'payment_methods',m.id::text,encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') from payment_methods m join subscriptions s on s.payment_method_id=m.id where s.id=${subscriptionId}::uuid
  union all select 'merchant_tax_profiles',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_tax_profiles p where exists(select 1 from subscription_commercial_terms t where t.profile_id=p.id and t.subscription_id=${subscriptionId}::uuid)
  union all select 'merchant_fee_refunds',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_fee_refunds s where s.payment_id in (${uuidList(money.map(row=>row.id))}) or s.original_charge_receipt_id in (${uuidList(receipts.map(row=>row.id))})
  union all select 'merchant_fee_observations',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_fee_observations s join merchant_fee_refunds owner on owner.id=s.operation_id where owner.payment_id in (${uuidList(money.map(row=>row.id))}) or owner.original_charge_receipt_id in (${uuidList(receipts.map(row=>row.id))})
  union all select 'merchant_payment_requests',s.payment_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_payment_requests s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_dispatches',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_payment_dispatches s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_resource_bindings',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_payment_resource_bindings s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_retirement_acks',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_payment_retirement_acks s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_terminal_receipts',s.payment_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_payment_terminal_receipts s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_creation_refusals',s.dispatch_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_payment_creation_refusals s join merchant_payment_dispatches owner on owner.id=s.dispatch_id where owner.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_dispatch_finishes',s.dispatch_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_payment_dispatch_finishes s join merchant_payment_dispatches owner on owner.id=s.dispatch_id where owner.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_dispatch_stops',s.dispatch_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from merchant_payment_dispatch_stops s join merchant_payment_dispatches owner on owner.id=s.dispatch_id where owner.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'subscription_provider_read_tickets',s.read_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_provider_read_tickets s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_read_finishes',s.read_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_provider_read_finishes s join subscription_provider_read_tickets owner on owner.read_id=s.read_id where owner.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_read_stops',s.read_id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_provider_read_stops s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_invoice_observations',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_provider_invoice_observations s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_invoice_lines',s.id::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from subscription_provider_invoice_lines s join subscription_provider_invoice_observations owner on owner.id=s.observation_id where owner.subscription_id=${subscriptionId}::uuid
  order by 1,2 limit 5001`);
 const children=await merchantRefundDependencyFingerprints(ctx.tx,{paymentIds:money.map(row=>row.id),subscriptionChargeReceiptIds:receipts.map(row=>row.id)});
 if(physical.length>5000||children.incomplete||proration.incomplete)refuse();
 return{invoiceIds,money,receipts,aliases,notes,fullInvoices,physical,children,proration};
}
/** Call order is controlled resource → subscription parent → original cash.
 * No controlled resource lock is acquired here, and no provider call occurs.
 * Planning runs before a physical caller exists; runtime holds its exact
 * resource before this query takes the parent lock. Original money readers
 * stay plain and do not re-enter this service or upgrade a contact lock. */
export const controlledProviderFinancialReadiness=defineService({
 name:"invoicing.controlledProviderFinancialReadiness",summary:"Authenticate complete original parent financial coverage before one exact controlled provider admission.",
 kind:"query",permission:"system",external:false,
 input:z.object({subscriptionId:z.uuid(),excludeUnadmittedOperationId:z.uuid().optional()}).strict(),
 output:z.object({ready:z.literal(true),revision:z.string().regex(/^[a-f0-9]{64}$/)}),
 handler:async(input,ctx)=>{
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
  // Canonical writers share payment → invoice → issued-note → cash order.
  // These locks remain held through the caller's actual admission transaction;
  // plain controlled evidence readers never acquire a resource in reverse.
  for(const id of graph.money.map(row=>row.id).sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`);
  for(const id of graph.fullInvoices.map(row=>row.id).sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${id}`}))`);
  for(const id of graph.notes.map(row=>row.id).sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit-note:${id}`}))`);
  const cashNamespaces=await ctx.tx.execute<{platform:string;account:string|null;ref:string}>(sql`
   select r.provider_platform_account_id as platform,r.charge_account_id as account,r.provider_payment_intent_ref as ref
    from subscription_provider_charge_receipts r where r.id in (${uuidList(graph.receipts.map(row=>row.id))})
   union select r.provider_platform_account_id,r.charge_account_id,r.provider_ref from merchant_payment_observations r
    where r.payment_id in (${uuidList(graph.money.map(row=>row.id))}) order by 1,2,3 limit 5001`);
  if(cashNamespaces.length>5000)refuse();
  for(const cash of cashNamespaces)await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription-cash:${cash.platform}:${cash.account??""}:${cash.ref}`}))`);
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
  for(const row of [...graph.physical,...graph.children.entries,...graph.proration.entries,...controlledFinancialEntries(coverage.witness)])add(row.table,row.id,row.fingerprint);
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
