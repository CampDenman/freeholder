// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: ordinary complete parent graph; no collector, service registration or bank I/O.
import { eq,inArray,or,sql } from "drizzle-orm";
import { ServiceError,type ServiceContext,type Tx } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { invoices,payments,creditNotes } from "./schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantRefundDependencyFingerprints } from "./merchant-refund-dependencies";
import { prorationFinancialWitness } from "./proration-financial-witness";
import { controlledFinancialWitness } from "./controlled-provider-financial-witness";
function refuse():never{throw new ServiceError("conflict","Restore the complete exact original parent financial graph before another controlled operation.");}
const uuidList=(ids:readonly string[])=>ids.length?sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`):sql`null::uuid`;
export async function parentFinancialGraph(ctx:ServiceContext,subscriptionId:string){return parentFinancialGraphForTx(ctx.tx,subscriptionId);}
export async function parentFinancialGraphForTx(tx:Tx,subscriptionId:string){
 const proration=await prorationFinancialWitness(tx,{kind:"subscription",ids:[subscriptionId]});
 if(proration.incomplete)refuse();
 const sourcePaymentIds=[...new Set(proration.entries.flatMap(row=>row.parents.sourcePaymentId?[row.parents.sourcePaymentId]:[]))];
 const references=await tx.execute<{id:string}>(sql`
  select e.invoice_id::text as id from subscription_events e where e.subscription_id=${subscriptionId}::uuid and e.invoice_id is not null
  union select p.debit_invoice_id::text from subscription_prorations p where p.subscription_id=${subscriptionId}::uuid and p.debit_invoice_id is not null
  union select p.invoice_id::text from merchant_agreement_payment_routes r join payments p on p.id=r.payment_id where r.subscription_id=${subscriptionId}::uuid order by 1 limit 5001`);
 if(references.length>5000)refuse();
 const controlled=await controlledFinancialWitness(tx,{subscriptionIds:[subscriptionId]});
 if(controlled.incomplete)refuse();
 const invoiceIds=[...new Set([...references.map(row=>row.id),...(controlled.targets?.collections.flatMap(row=>row.invoiceId?[row.invoiceId]:[])??[])])].sort();
 if(invoiceIds.length>5000)refuse();
 const money=invoiceIds.length||sourcePaymentIds.length?await tx.select().from(payments)
  .where(or(...(invoiceIds.length?[inArray(payments.invoiceId,invoiceIds)]:[]),...(sourcePaymentIds.length?[inArray(payments.id,sourcePaymentIds)]:[]))).orderBy(payments.id).limit(5001):[];
 const exactInvoiceIds=[...new Set([...invoiceIds,...money.map(row=>row.invoiceId)])];
 const receipts=await tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,subscriptionId)).orderBy(subscriptionProviderChargeReceipts.id).limit(5001);
 const aliases=receipts.length||money.length?await tx.select().from(merchantAgreementPaymentRoutes)
  .where(or(...(receipts.length?[inArray(merchantAgreementPaymentRoutes.originalChargeReceiptId,receipts.map(row=>row.id))]:[]),...(money.length?[inArray(merchantAgreementPaymentRoutes.paymentId,money.map(row=>row.id))]:[]))).orderBy(merchantAgreementPaymentRoutes.paymentId).limit(5001):[];
 const ancestorReceiptIds=[...new Set(aliases.flatMap(row=>row.originalChargeReceiptId&&!receipts.some(receipt=>receipt.id===row.originalChargeReceiptId)?[row.originalChargeReceiptId]:[]))];
 if(ancestorReceiptIds.length){
  const ancestors=await tx.select().from(subscriptionProviderChargeReceipts).where(inArray(subscriptionProviderChargeReceipts.id,ancestorReceiptIds)).limit(5001);
  if(ancestors.length!==ancestorReceiptIds.length)refuse();receipts.push(...ancestors);receipts.sort((a,b)=>a.id.localeCompare(b.id));
 }
 const originalNoteIds=[...new Set(proration.entries.flatMap(row=>row.parents.creditNoteId?[row.parents.creditNoteId]:[]))];
 const notes=invoiceIds.length||originalNoteIds.length?await tx.select().from(creditNotes)
  .where(or(...(invoiceIds.length?[inArray(creditNotes.invoiceId,invoiceIds)]:[]),...(originalNoteIds.length?[inArray(creditNotes.id,originalNoteIds)]:[]))).orderBy(creditNotes.id).limit(5001):[];
 const fullInvoices=exactInvoiceIds.length?await tx.select().from(invoices).where(inArray(invoices.id,exactInvoiceIds)).orderBy(invoices.id).limit(5001):[];
 if([money,receipts,aliases,notes,fullInvoices].some(rows=>rows.length>5000)||fullInvoices.length!==exactInvoiceIds.length||sourcePaymentIds.some(id=>!money.some(row=>row.id===id)))refuse();
 const physical=await tx.execute<{table:string;id:string;fingerprint:string}>(sql`
  select 'subscriptions' as table,s.id::text as id,freeholder_financial_row_fingerprint('subscriptions',s.id) as fingerprint from subscriptions s where s.id=${subscriptionId}::uuid
  union all select 'subscription_commercial_terms',t.id::text,freeholder_financial_row_fingerprint('subscription_commercial_terms',t.id) from subscription_commercial_terms t where t.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_merchant_scopes',s.subscription_id::text,freeholder_financial_row_fingerprint('subscription_merchant_scopes',s.subscription_id) from subscription_merchant_scopes s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_market_policies',s.subscription_id::text,freeholder_financial_row_fingerprint('subscription_market_policies',s.subscription_id) from subscription_market_policies s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_schedule_resources',s.subscription_id::text,freeholder_financial_row_fingerprint('subscription_provider_schedule_resources',s.subscription_id) from subscription_provider_schedule_resources s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_schedule_operations',s.id::text,freeholder_financial_row_fingerprint('subscription_provider_schedule_operations',s.id) from subscription_provider_schedule_operations s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_commercial_amendments',s.terms_id::text,freeholder_financial_row_fingerprint('subscription_commercial_amendments',s.terms_id) from subscription_commercial_amendments s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_commercial_resumptions',s.terms_id::text,freeholder_financial_row_fingerprint('subscription_commercial_resumptions',s.terms_id) from subscription_commercial_resumptions s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_generations',s.id::text,freeholder_financial_row_fingerprint('subscription_provider_generations',s.id) from subscription_provider_generations s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_charge_observations',s.id::text,freeholder_financial_row_fingerprint('subscription_provider_charge_observations',s.id) from subscription_provider_charge_observations s where s.subscription_id=${subscriptionId}::uuid
  union all select 'merchant_payment_observations',s.id::text,freeholder_financial_row_fingerprint('merchant_payment_observations',s.id) from merchant_payment_observations s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'payment_disputes',s.id::text,freeholder_financial_row_fingerprint('payment_disputes',s.id) from payment_disputes s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'refunds',s.id::text,freeholder_financial_row_fingerprint('refunds',s.id) from refunds s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'invoices',s.id::text,freeholder_financial_row_fingerprint('invoices',s.id) from invoices s where s.id in (${uuidList(exactInvoiceIds)})
  union all select 'payments',s.id::text,freeholder_financial_row_fingerprint('payments',s.id) from payments s where s.id in (${uuidList(money.map(row=>row.id))})
  union all select 'credit_notes',s.id::text,freeholder_financial_row_fingerprint('credit_notes',s.id) from credit_notes s where s.id in (${uuidList(notes.map(row=>row.id))})
  union all select 'subscription_provider_charge_receipts',s.id::text,freeholder_financial_row_fingerprint('subscription_provider_charge_receipts',s.id) from subscription_provider_charge_receipts s where s.id in (${uuidList(receipts.map(row=>row.id))})
  union all select 'merchant_agreement_payment_routes',s.payment_id::text,freeholder_financial_row_fingerprint('merchant_agreement_payment_routes',s.payment_id) from merchant_agreement_payment_routes s where s.payment_id in (${uuidList(aliases.map(row=>row.paymentId))})
  union all select 'payment_methods',m.id::text,freeholder_financial_row_fingerprint('payment_methods',m.id) from payment_methods m join subscriptions s on s.payment_method_id=m.id where s.id=${subscriptionId}::uuid
  union all select 'merchant_tax_profiles',p.id::text,freeholder_financial_row_fingerprint('merchant_tax_profiles',p.id) from merchant_tax_profiles p where exists(select 1 from subscription_commercial_terms t where t.profile_id=p.id and t.subscription_id=${subscriptionId}::uuid)
  union all select 'merchant_fee_refunds',s.id::text,freeholder_financial_row_fingerprint('merchant_fee_refunds',s.id) from merchant_fee_refunds s where s.payment_id in (${uuidList(money.map(row=>row.id))}) or s.original_charge_receipt_id in (${uuidList(receipts.map(row=>row.id))})
  union all select 'merchant_fee_observations',s.id::text,freeholder_financial_row_fingerprint('merchant_fee_observations',s.id) from merchant_fee_observations s join merchant_fee_refunds owner on owner.id=s.operation_id where owner.payment_id in (${uuidList(money.map(row=>row.id))}) or owner.original_charge_receipt_id in (${uuidList(receipts.map(row=>row.id))})
  union all select 'merchant_payment_requests',s.payment_id::text,freeholder_financial_row_fingerprint('merchant_payment_requests',s.payment_id) from merchant_payment_requests s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_dispatches',s.id::text,freeholder_financial_row_fingerprint('merchant_payment_dispatches',s.id) from merchant_payment_dispatches s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_resource_bindings',s.id::text,freeholder_financial_row_fingerprint('merchant_payment_resource_bindings',s.id) from merchant_payment_resource_bindings s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_retirement_acks',s.id::text,freeholder_financial_row_fingerprint('merchant_payment_retirement_acks',s.id) from merchant_payment_retirement_acks s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_terminal_receipts',s.payment_id::text,freeholder_financial_row_fingerprint('merchant_payment_terminal_receipts',s.payment_id) from merchant_payment_terminal_receipts s where s.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_creation_refusals',s.dispatch_id::text,freeholder_financial_row_fingerprint('merchant_payment_creation_refusals',s.dispatch_id) from merchant_payment_creation_refusals s join merchant_payment_dispatches owner on owner.id=s.dispatch_id where owner.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_dispatch_finishes',s.dispatch_id::text,freeholder_financial_row_fingerprint('merchant_payment_dispatch_finishes',s.dispatch_id) from merchant_payment_dispatch_finishes s join merchant_payment_dispatches owner on owner.id=s.dispatch_id where owner.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'merchant_payment_dispatch_stops',s.dispatch_id::text,freeholder_financial_row_fingerprint('merchant_payment_dispatch_stops',s.dispatch_id) from merchant_payment_dispatch_stops s join merchant_payment_dispatches owner on owner.id=s.dispatch_id where owner.payment_id in (${uuidList(money.map(row=>row.id))})
  union all select 'subscription_provider_read_tickets',s.read_id::text,freeholder_financial_row_fingerprint('subscription_provider_read_tickets',s.read_id) from subscription_provider_read_tickets s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_read_finishes',s.read_id::text,freeholder_financial_row_fingerprint('subscription_provider_read_finishes',s.read_id) from subscription_provider_read_finishes s join subscription_provider_read_tickets owner on owner.read_id=s.read_id where owner.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_read_stops',s.read_id::text,freeholder_financial_row_fingerprint('subscription_provider_read_stops',s.read_id) from subscription_provider_read_stops s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_invoice_observations',s.id::text,freeholder_financial_row_fingerprint('subscription_provider_invoice_observations',s.id) from subscription_provider_invoice_observations s where s.subscription_id=${subscriptionId}::uuid
  union all select 'subscription_provider_invoice_lines',s.id::text,freeholder_financial_row_fingerprint('subscription_provider_invoice_lines',s.id) from subscription_provider_invoice_lines s join subscription_provider_invoice_observations owner on owner.id=s.observation_id where owner.subscription_id=${subscriptionId}::uuid
  union all select 'invoice_lines',s.id::text,freeholder_financial_row_fingerprint('invoice_lines',s.id) from invoice_lines s where s.invoice_id in (${uuidList(exactInvoiceIds)})
  union all select 'invoice_market_policies',s.invoice_id::text,freeholder_financial_row_fingerprint('invoice_market_policies',s.invoice_id) from invoice_market_policies s where s.invoice_id in (${uuidList(invoiceIds)})
  union all select 'invoice_merchant_tax_quotes',s.id::text,freeholder_financial_row_fingerprint('invoice_merchant_tax_quotes',s.id) from invoice_merchant_tax_quotes s where s.invoice_id in (${uuidList(invoiceIds)})
  union all select 'invoice_merchant_tax_quote_lines',s.invoice_line_id::text,freeholder_financial_row_fingerprint('invoice_merchant_tax_quote_lines',s.invoice_line_id) from invoice_merchant_tax_quote_lines s join invoice_lines line on line.id=s.invoice_line_id where line.invoice_id in (${uuidList(invoiceIds)})
  union all select 'invoice_credit_applications',s.reservation_id::text,freeholder_financial_row_fingerprint('invoice_credit_applications',s.reservation_id) from invoice_credit_applications s where s.invoice_id in (${uuidList(invoiceIds)})
  union all select 'invoice_credit_reservations',s.id::text,freeholder_financial_row_fingerprint('invoice_credit_reservations',s.id) from invoice_credit_reservations s join invoice_credit_applications app on app.reservation_id=s.id where app.invoice_id in (${uuidList(invoiceIds)})
  union all select 'invoice_credit_funding',s.id::text,freeholder_financial_row_fingerprint('invoice_credit_funding',s.id) from invoice_credit_funding s where exists(select 1 from invoice_credit_reservations r join invoice_credit_applications app on app.reservation_id=r.id where r.funding_id=s.id and app.invoice_id in (${uuidList(invoiceIds)}))
  order by 1,2 limit 5001`);
 const children=await merchantRefundDependencyFingerprints(tx,{paymentIds:money.map(row=>row.id),subscriptionChargeReceiptIds:receipts.map(row=>row.id)});
 if(physical.length>5000||children.incomplete||proration.incomplete)refuse();
 return{invoiceIds,money,receipts,aliases,notes,fullInvoices,physical,children,proration,controlled};
}
export async function lockControlledParentMoney(ctx:ServiceContext,graph:Awaited<ReturnType<typeof parentFinancialGraph>>){
  // Canonical writers share payment → invoice → issued-note → cash order.
  // These locks remain held through the caller's actual admission transaction;
  // plain controlled evidence readers never acquire a resource in reverse.
  const keys=[...graph.money.map(row=>`payment:${row.id}`).sort(),...graph.fullInvoices.map(row=>`invoice:${row.id}`).sort(),...graph.notes.map(row=>`credit-note:${row.id}`).sort()];
  const cashNamespaces=await ctx.tx.execute<{platform:string;account:string|null;ref:string}>(sql`
   select r.provider_platform_account_id as platform,r.charge_account_id as account,r.provider_payment_intent_ref as ref
    from subscription_provider_charge_receipts r where r.id in (${uuidList(graph.receipts.map(row=>row.id))})
   union select r.provider_platform_account_id,r.charge_account_id,r.provider_ref from merchant_payment_observations r
    where r.payment_id in (${uuidList(graph.money.map(row=>row.id))}) order by 1,2,3 limit 5001`);
  if(cashNamespaces.length>5000)refuse();
  keys.push(...cashNamespaces.map(cash=>`subscription-cash:${cash.platform}:${cash.account??""}:${cash.ref}`));
  if(keys.length)await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(lock_key)) from unnest(array[${sql.join(keys.map(key=>sql`${key}`),sql`,`)}]) with ordinality as ordered(lock_key,position) order by position`);

}

import type { OriginalInventoryProjectionContext } from "./original-cash-inventory-causal-proof";

/** Explicit comparison-only companion; no default graph is ever projected. */
export async function parentFinancialGraphForOriginalInventory(tx: Tx, subscriptionId: string,
  context: OriginalInventoryProjectionContext) {
  const full = await parentFinancialGraphForTx(tx, subscriptionId);
  const { merchantRefundDependencyFingerprintsForOriginalInventory } = await import("./merchant-refund-dependencies");
  const children = await merchantRefundDependencyFingerprintsForOriginalInventory(tx,
    { paymentIds: full.money.map(row => row.id), subscriptionChargeReceiptIds: full.receipts.map(row => row.id) }, context, full.children);
  return { ...full, children };
}
