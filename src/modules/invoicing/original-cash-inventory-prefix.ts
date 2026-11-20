// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: exact source-connected v2 money-entry prefix, never late locks.
import {sql} from "drizzle-orm";
import {z} from "zod";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {ServiceError,type ServiceContext,type Tx} from "@/core/service";
import {originalCashRecoveryOperation,originalCashRecoveryOwner} from "./original-cash-recovery-store";
import {originalInventoryComparison} from "./original-cash-inventory-causal-contract";
import {cashNamespaceKey} from "./original-cash-recovery-proof";
import {merchantTaxDigest} from "./merchant-tax-store";
const node=z.object({kind:z.enum(["subscription","resource","invoice","payment","note","receipt","proration","funding","reservation","collection"]),id:z.uuid()}).strict();
const namespace=z.object({platform:z.string().min(1),account:z.string().nullable(),intent:z.string().min(1)}).strict();
const list=(values:readonly string[])=>values.length?sql.join(values.map(id=>sql`${id}::uuid`),sql`,`):sql`null::uuid`;
function refuse():never{throw new ServiceError("conflict","Restore the complete exact original controlled source prefix before a new money claim or current closure; a missing earlier lock category cannot be acquired late.");}
async function actualV2(tx:Tx,input:{recoveryId:string;operationId:string}){
 const operation=await originalCashRecoveryOperation(tx,input.operationId);
 if(operation.recoveryId!==input.recoveryId)refuse();
 if(operation.request.inventoryComparison===undefined)return null; // exact old path
 const parsed=originalInventoryComparison.safeParse(operation.request.inventoryComparison);if(!parsed.success)refuse();const comparison=parsed.data;
 const owner=await originalCashRecoveryOwner(tx,input.recoveryId);
 if(operation.kind!=="inspection"||operation.request.auxiliaryOperationId||comparison.recoveryId!==owner.id||comparison.operationId!==operation.id
  ||comparison.callerId!==operation.caller.id||comparison.nonceHash!==operation.nonceHash||comparison.namespaceKey!==owner.namespaceKey||owner.namespaceKey!==cashNamespaceKey(owner.owner.cash)
  ||comparison.sourceCashDigest!==merchantTaxDigest(owner.owner.cash)||comparison.sourceRevision!==operation.request.sourceRevision)refuse();
 return{owner,operation,comparison};
}
/** Discovery is seeded only by the authenticated actual cash source. Sharing
 * a contact/profile/account/amount is never an edge. Connected original credit
 * ancestors and real target links belong in the same prefix before any cash. */
export async function discoverOriginalInventoryPrefix(tx:Tx,input:{recoveryId:string;operationId:string}){
 const original=await actualV2(tx,input);if(!original)return null;
 const raw=await tx.execute<{kind:string;id:string}>(sql`
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
   union all select 'reservation',r.id,'invoice',i.id from invoice_credit_reservations r
    join invoices i on i.source_type='subscription' and i.source_id=r.target_source_id
  ), adjacent(a_kind,a_id,b_kind,b_id) as (
   select * from edges union all select b_kind,b_id,a_kind,a_id from edges
  ), owned(kind,id) as (
   select 'payment',p.id from payments p where p.id=${original.owner.paymentId}::uuid
   union select 'receipt',r.id from subscription_provider_charge_receipts r where r.id=${original.owner.subscriptionChargeReceiptId}::uuid
  ), reachable(kind,id) as (
   select kind,id from owned union select a.b_kind,a.b_id from reachable r join adjacent a on a.a_kind=r.kind and a.a_id=r.id where a.b_id is not null
  ) select kind,id::text from reachable order by kind,id limit 5001`);
 if(!raw.length||raw.length>5000)refuse();const nodes=raw.map(value=>node.parse(value));
 const ids=(kind:z.output<typeof node>["kind"])=>nodes.filter(value=>value.kind===kind).map(value=>value.id).sort();
 const namespaces=(await tx.execute<{platform:string;account:string|null;intent:string}>(sql`
  select r.provider_platform_account_id as platform,r.charge_account_id as account,r.provider_payment_intent_ref as intent from subscription_provider_charge_receipts r where r.id in(${list(ids("receipt"))})
  union select m.provider_platform_account_id,m.charge_account_id,m.provider_ref from merchant_payment_observations m where m.payment_id in(${list(ids("payment"))})
  union select r.provider_platform_account_id,r.charge_account_id,r.original_payment_ref from merchant_refund_requests r where r.payment_id in(${list(ids("payment"))}) or r.subscription_charge_receipt_id in(${list(ids("receipt"))})
  union select c.owner->'cash'->>'providerPlatformAccountId',c.owner->'cash'->>'chargeAccountId',c.owner->'cash'->>'providerRef' from original_cash_recoveries c where c.payment_id in(${list(ids("payment"))}) or c.subscription_charge_receipt_id in(${list(ids("receipt"))})
  order by 1,2,3 limit 5001`)).map(value=>namespace.parse(value));
 const inspections=(await tx.execute<{id:string}>(sql`select distinct i.id::text from merchant_cash_return_inspections i where i.payment_id in(${list(ids("payment"))}) or i.subscription_charge_receipt_id in(${list(ids("receipt"))})
  or exists(select 1 from subscription_provider_charge_receipts r where r.id in(${list(ids("receipt"))}) and r.provider_platform_account_id=i.provider_platform_account_id and r.charge_account_id is not distinct from i.charge_account_id and r.provider_payment_intent_ref=i.original_payment_ref)
  or exists(select 1 from merchant_payment_observations m where m.payment_id in(${list(ids("payment"))}) and m.provider_platform_account_id=i.provider_platform_account_id and m.charge_account_id is not distinct from i.charge_account_id and m.provider_ref=i.original_payment_ref)
  order by 1 limit 5001`)).map(value=>z.uuid().parse(value.id));
 if(nodes.length+namespaces.length+inspections.length>5000)refuse();
 if(!namespaces.some(value=>value.platform===original.owner.owner.cash.providerPlatformAccountId&&value.account===original.owner.owner.cash.chargeAccountId&&value.intent===original.owner.owner.cash.providerRef))refuse();
 return{ownerId:original.owner.id,operationId:original.operation.id,operationDigest:original.operation.digest,nodes,namespaces,inspections};
}
/** Must be called at the real service entry BEFORE bound/canonical/cash.
 * This grants no bank/fee/refund/closure authority. That proof runs afterward
 * under these locks. A known malformed v2 request never falls back to v1. */
export async function lockOriginalInventoryPrefix(ctx:ServiceContext,input:{recoveryId:string;operationId:string}){
 const original=await actualV2(ctx.tx,input);if(!original)return false;
 await lockContactIdentityForRead(ctx.tx);
 const before=await discoverOriginalInventoryPrefix(ctx.tx,input);if(!before)refuse();
 const ids=(kind:z.output<typeof node>["kind"])=>before.nodes.filter(value=>value.kind===kind).map(value=>value.id).sort();
 for(const id of ids("resource")){await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${id}`}))`);await ctx.tx.execute(sql`select id from subscription_controlled_resources where id=${id}::uuid for update`);}
 for(const id of ids("subscription"))await ctx.tx.execute(sql`select id from subscriptions where id=${id}::uuid for update`);
 for(const[kind,prefix]of[["payment","payment"],["invoice","invoice"],["note","credit-note"]] as const)for(const id of ids(kind))await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${prefix}:${id}`}))`);
 for(const key of [...new Set(before.namespaces.map(value=>`subscription-cash:${value.platform}:${value.account??""}:${value.intent}`))].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
 for(const id of before.inspections){const[value]=await ctx.tx.execute<{locked:boolean}>(sql`select pg_try_advisory_xact_lock(hashtext(${`merchant-return-read:${id}`})) as locked`);if(value?.locked!==true)refuse();}
 for(const id of ids("payment")){const[value]=await ctx.tx.execute<{locked:boolean}>(sql`select pg_try_advisory_xact_lock(hashtext(${`merchant-fee-invocation:${id}`})) as locked`);if(value?.locked!==true)refuse();}
 if(merchantTaxDigest(await discoverOriginalInventoryPrefix(ctx.tx,input))!==merchantTaxDigest(before))refuse();
 return true;
}
