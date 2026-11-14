// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: one complete pair-wide prefix before merge-undo preimages.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { ServiceError, type Tx } from "@/core/service";
import { merchantTaxDigest } from "./merchant-tax-store";

const nodeSchema = z.object({ kind: z.enum(["subscription", "resource", "invoice", "payment", "note", "receipt", "proration", "funding", "reservation", "collection"]), id: z.uuid() }).strict();
const namespaceSchema = z.object({ platform: z.string().min(1), account: z.string().nullable(), intent: z.string().min(1) }).strict();
const list = (ids: readonly string[]) => ids.length ? sql.join(ids.map(id => sql`${id}::uuid`), sql`,`) : sql`null::uuid`;
function refuse(): never { throw new ServiceError("conflict", "Restore the bounded complete original financial ownership graph before undoing this contact merge."); }

/** Real FKs and the existing exact original bank namespace select locks.
 * Reserved source links additionally require the actual target invoice FK.
 * These identities select
 * locks, never payment/credit authority. In particular, no amount, creation
 * date or current merchant account is an ownership edge. */
async function discover(tx: Tx, contactIds: readonly string[]) {
 const raw = await tx.execute<{kind: string; id: string}>(sql`
  with recursive edges(a_kind,a_id,b_kind,b_id) as (
   select 'subscription',e.subscription_id,'invoice',e.invoice_id from subscription_events e where e.invoice_id is not null
   union all select 'subscription',r.subscription_id,'resource',r.id from subscription_controlled_resources r
   union all select 'subscription',r.subscription_id,'receipt',r.id from subscription_provider_charge_receipts r
   union all select 'subscription',r.subscription_id,'payment',r.payment_id from merchant_agreement_payment_routes r
   union all select 'payment',r.payment_id,'receipt',r.original_charge_receipt_id from merchant_agreement_payment_routes r where r.original_charge_receipt_id is not null
   union all select 'subscription',p.subscription_id,'proration',p.id from subscription_prorations p
   union all select 'proration',p.id,'invoice',p.original_invoice_id from subscription_prorations p where p.original_invoice_id is not null
   union all select 'proration',p.id,'invoice',p.debit_invoice_id from subscription_prorations p where p.debit_invoice_id is not null
   union all select 'proration',p.id,'note',p.credit_note_id from subscription_prorations p where p.credit_note_id is not null
   union all select 'proration',p.proration_id,'payment',p.source_payment_id from subscription_proration_principal p
   union all select 'invoice',p.invoice_id,'payment',p.id from payments p
   union all select 'invoice',n.invoice_id,'note',n.id from credit_notes n
   union all select 'resource',q.resource_id,'collection',c.id from subscription_controlled_collections c join subscription_controlled_quotes q on q.id=c.quote_id
   union all select 'collection',c.id,'invoice',c.invoice_id from subscription_controlled_collections c where c.invoice_id is not null
   union all select 'collection',c.id,'proration',c.proration_id from subscription_controlled_collections c where c.proration_id is not null
   union all select 'collection',c.id,'note',c.credit_note_id from subscription_controlled_collections c where c.credit_note_id is not null
   union all select 'funding',f.id,'proration',f.proration_id from invoice_credit_funding f
   union all select 'funding',f.id,'invoice',f.source_invoice_id from invoice_credit_funding f
   union all select 'funding',f.id,'payment',f.source_payment_id from invoice_credit_funding f
   union all select 'funding',f.id,'note',f.credit_note_id from invoice_credit_funding f
   union all select 'funding',f.id,'reservation',f.source_application_id from invoice_credit_funding f where f.source_application_id is not null
   union all select 'funding',r.funding_id,'reservation',r.id from invoice_credit_reservations r
   union all select 'reservation',a.reservation_id,'invoice',a.invoice_id from invoice_credit_applications a
   union all select 'reservation',r.id,'proration',p.id from invoice_credit_reservations r
    join invoices i on i.source_type='subscription' and i.source_id=r.target_source_id
    join subscription_prorations p on p.debit_invoice_id=i.id and r.target_source_id=p.subscription_id::text||':proration:'||p.id::text
   union all select 'receipt',r.id,'payment',m.payment_id from subscription_provider_charge_receipts r join merchant_payment_observations m
    on m.provider_platform_account_id=r.provider_platform_account_id and m.charge_account_id is not distinct from r.charge_account_id
     and m.provider_ref=r.provider_payment_intent_ref
  ), adjacent(a_kind,a_id,b_kind,b_id) as (
   select * from edges union all select b_kind,b_id,a_kind,a_id from edges
  ), owned(kind,id) as (
   select 'subscription',s.id from subscriptions s where s.contact_id in (${list(contactIds)})
   union select 'invoice',i.id from invoices i where i.contact_id in (${list(contactIds)})
   union select 'note',n.id from credit_notes n join invoices i on i.id=n.invoice_id where i.contact_id in (${list(contactIds)})
  ), reachable(kind,id) as (
   select kind,id from owned union select a.b_kind,a.b_id from reachable r join adjacent a on a.a_kind=r.kind and a.a_id=r.id where a.b_id is not null
  ) select kind,id::text from reachable order by kind,id limit 5001`);
 if (raw.length > 5000) refuse();
 const nodes = raw.map(row => nodeSchema.parse(row));
 const ids = (kind: z.output<typeof nodeSchema>["kind"]) => nodes.filter(row => row.kind === kind).map(row => row.id);
 const namespaces = (await tx.execute<{platform: string; account: string | null; intent: string}>(sql`
  select r.provider_platform_account_id as platform,r.charge_account_id as account,r.provider_payment_intent_ref as intent
   from subscription_provider_charge_receipts r where r.id in (${list(ids("receipt"))})
  union select m.provider_platform_account_id,m.charge_account_id,m.provider_ref from merchant_payment_observations m where m.payment_id in (${list(ids("payment"))})
  union select r.provider_platform_account_id,r.charge_account_id,r.original_payment_ref from merchant_refund_requests r
   where r.payment_id in (${list(ids("payment"))}) or r.subscription_charge_receipt_id in (${list(ids("receipt"))})
  union select c.owner->'cash'->>'providerPlatformAccountId',c.owner->'cash'->>'chargeAccountId',c.owner->'cash'->>'providerRef' from original_cash_recoveries c
   where c.payment_id in (${list(ids("payment"))}) or c.subscription_charge_receipt_id in (${list(ids("receipt"))})
  order by 1,2,3 limit 5001`)).map(row => namespaceSchema.parse(row));
 const inspections = (await tx.execute<{id: string}>(sql`select id::text from merchant_cash_return_inspections
  where payment_id in (${list(ids("payment"))}) or subscription_charge_receipt_id in (${list(ids("receipt"))}) order by id limit 5001`))
  .map(row => z.uuid().parse(row.id));
 if (nodes.length + namespaces.length + inspections.length > 5000) refuse();
 return { nodes, namespaces, inspections };
}

/** A single provider function is shared by invoice and subscription references.
 * Core invokes that same function identity ONCE before all prepareUndo hooks.
 * Direct restore also acquires this genuine prefix; no cached/public marker
 * replaces the locks. Identity first prevents ordinary ownership writers;
 * namespace locks also fence independently committed signed raw callbacks. */
export async function lockContactFinancialUndo(tx: Tx, duplicateId: string, survivingId: string): Promise<void> {
 await lockContactIdentity(tx);
 const contacts = [...new Set([z.uuid().parse(duplicateId), z.uuid().parse(survivingId)])].sort();
 const before = await discover(tx, contacts);
 const ids = (kind: z.output<typeof nodeSchema>["kind"]) => before.nodes.filter(row => row.kind === kind).map(row => row.id).sort();
 for (const id of ids("resource")) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${id}`}))`);
  await tx.execute(sql`select id from subscription_controlled_resources where id=${id}::uuid for update`);
 }
 for (const id of ids("subscription")) await tx.execute(sql`select id from subscriptions where id=${id}::uuid for update`);
 for (const [kind, prefix] of [["payment", "payment"], ["invoice", "invoice"], ["note", "credit-note"]] as const)
  for (const id of ids(kind)) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${prefix}:${id}`}))`);
 const namespaces = [...new Set(before.namespaces.map(row => `subscription-cash:${row.platform}:${row.account ?? ""}:${row.intent}`))].sort();
 for (const namespace of namespaces) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${namespace}))`);
 // Bare returned-state/finish writers also serialize on this read key.
 // Refund callbacks can hold read→cash, so NEVER block cash→read here.
 // A live callback is refusal; an acquired key fences its later append.
 for (const id of before.inspections) {
  const [read] = await tx.execute<{locked: boolean}>(sql`select pg_try_advisory_xact_lock(hashtext(${`merchant-return-read:${id}`})) as locked`);
  if (read?.locked !== true) refuse();
 }
 // Tracked fee callbacks are also bound to the actual payment. Never wait
 // on their private callback key after taking canonical/cash locks.
 for (const id of ids("payment")) {
  const [fee] = await tx.execute<{locked: boolean}>(sql`select pg_try_advisory_xact_lock(hashtext(${`merchant-fee-invocation:${id}`})) as locked`);
  if (fee?.locked !== true) refuse();
 }
 // A new edge/namespace discovered while acquiring the prefix is refusal,
 // never a late acquisition of an earlier lock category.
 if (merchantTaxDigest(await discover(tx, contacts)) !== merchantTaxDigest(before)) refuse();
}
