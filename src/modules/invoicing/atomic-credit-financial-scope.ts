// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: exact connected original credit FKs select the COMPLETE lock prefix.
import {sql} from "drizzle-orm";
import {z} from "zod";
import {ServiceError,type Tx} from "@/core/service";
import {merchantTaxDigest} from "./merchant-tax-store";
const node=z.object({kind:z.enum(["subscription","resource","invoice","payment","note","receipt","proration","funding","reservation","collection"]),id:z.uuid()}).strict();
const namespace=z.object({platform:z.string().min(1),account:z.string().nullable(),intent:z.string().min(1)}).strict();
const list=(values:readonly string[])=>values.length?sql.join(values.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`;
function refuse():never{throw new ServiceError("conflict","Restore the complete bounded actual credit/source/target graph before choosing its source resource and parent locks.");}
/** No locking, principal/fee authority or owner discovery by value. A shared
 * contact/account/profile is NOT an edge. Actual funding/reservation/application
 * FKs keep all borrowed source and target resources represented. */
export async function atomicCreditFinancialScope(tx:Tx,actualPaymentIds:readonly string[]){
 const requested=[...new Set(actualPaymentIds)].sort();if(requested.length>5000||requested.some(id=>!z.uuid().safeParse(id).success))refuse();
 if(!requested.length)return{nodes:[],namespaces:[],inspectionIds:[],resourceIds:[],subscriptionIds:[],paymentIds:[],invoiceIds:[],noteIds:[],revision:merchantTaxDigest([])};
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
  ),adjacent(a_kind,a_id,b_kind,b_id) as(select * from edges union all select b_kind,b_id,a_kind,a_id from edges),
  owned(kind,id) as(select 'payment',p.id from payments p where p.id in(${list(requested)})),
  reachable(kind,id) as(select kind,id from owned union select a.b_kind,a.b_id from reachable r join adjacent a on a.a_kind=r.kind and a.a_id=r.id where a.b_id is not null)
  select kind,id::text from reachable order by kind,id limit 5001`);
 if(raw.length>5000)refuse();const nodes=raw.map(value=>node.parse(value));
 const ids=(kind:z.output<typeof node>["kind"])=>nodes.filter(value=>value.kind===kind).map(value=>value.id).sort();
 if(requested.some(id=>!ids("payment").includes(id)))refuse();
 const namespaces=(await tx.execute<{platform:string;account:string|null;intent:string}>(sql`
  select r.provider_platform_account_id as platform,r.charge_account_id as account,r.provider_payment_intent_ref as intent from subscription_provider_charge_receipts r where r.id in(${list(ids("receipt"))})
  union select m.provider_platform_account_id,m.charge_account_id,m.provider_ref from merchant_payment_observations m where m.payment_id in(${list(ids("payment"))})
  union select r.provider_platform_account_id,r.charge_account_id,r.original_payment_ref from merchant_refund_requests r where r.payment_id in(${list(ids("payment"))}) or r.subscription_charge_receipt_id in(${list(ids("receipt"))})
  union select c.owner->'cash'->>'providerPlatformAccountId',c.owner->'cash'->>'chargeAccountId',c.owner->'cash'->>'providerRef' from original_cash_recoveries c where c.payment_id in(${list(ids("payment"))}) or c.subscription_charge_receipt_id in(${list(ids("receipt"))}) order by 1,2,3 limit 5001`)).map(value=>namespace.parse(value));
 const inspectionIds=(await tx.execute<{id:string}>(sql`select distinct i.id::text from merchant_cash_return_inspections i where i.payment_id in(${list(ids("payment"))}) or i.subscription_charge_receipt_id in(${list(ids("receipt"))})
  or exists(select 1 from subscription_provider_charge_receipts r where r.id in(${list(ids("receipt"))}) and r.provider_platform_account_id=i.provider_platform_account_id and r.charge_account_id is not distinct from i.charge_account_id and r.provider_payment_intent_ref=i.original_payment_ref)
  or exists(select 1 from merchant_payment_observations m where m.payment_id in(${list(ids("payment"))}) and m.provider_platform_account_id=i.provider_platform_account_id and m.charge_account_id is not distinct from i.charge_account_id and m.provider_ref=i.original_payment_ref) order by 1 limit 5001`)).map(value=>z.uuid().parse(value.id));
 if(nodes.length+namespaces.length+inspectionIds.length>5000)refuse();
 const body={nodes,namespaces,inspectionIds};return{...body,resourceIds:ids("resource"),subscriptionIds:ids("subscription"),paymentIds:ids("payment"),invoiceIds:ids("invoice"),noteIds:ids("note"),revision:merchantTaxDigest(body)};
}
