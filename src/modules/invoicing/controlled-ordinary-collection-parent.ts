// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: discover the exact accepted target before any canonical money lock.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { ServiceError,type Tx } from "@/core/service";
import { merchantTaxDigest } from "./merchant-tax-store";
const target=z.object({collectionId:z.uuid(),quoteId:z.uuid(),resourceId:z.uuid(),subscriptionId:z.uuid(),invoiceId:z.uuid(),kind:z.enum(["period","proration"]),profileId:z.uuid(),profileVersion:z.number().int().positive(),canonicalSourceId:z.string().min(1),sourceId:z.string().min(1),sourceType:z.literal("subscription"),quoteKind:z.enum(["period","proration"])}).strict();
export type ControlledOrdinaryCollectionParent=z.infer<typeof target>;
function refuse():never{throw new ServiceError("conflict","Restore the exact accepted controlled invoice, original resource and subscription owner before another ordinary collection.");}
async function exactTarget(tx:Tx,invoiceId:string){
 const rows=await tx.execute<ControlledOrdinaryCollectionParent>(sql`
  select collection.id::text as "collectionId",quote.id::text as "quoteId",resource.id::text as "resourceId",resource.subscription_id::text as "subscriptionId",
   collection.invoice_id::text as "invoiceId",collection.kind,quote.profile_id::text as "profileId",quote.profile_version as "profileVersion",
   quote.canonical_source_id as "canonicalSourceId",invoice.source_id as "sourceId",invoice.source_type as "sourceType",quote.kind as "quoteKind"
   from subscription_controlled_collections collection left join subscription_controlled_quotes quote on quote.id=collection.quote_id
   left join subscription_controlled_resources resource on resource.id=quote.resource_id
   left join invoices invoice on invoice.id=collection.invoice_id
   where collection.invoice_id=${invoiceId}::uuid order by collection.id limit 2`);
 if(rows.length>1)refuse();if(!rows.length)return null;
 const actual=target.safeParse(rows[0]);if(!actual.success||actual.data.invoiceId!==invoiceId||actual.data.sourceId!==actual.data.canonicalSourceId||actual.data.kind!==actual.data.quoteKind)refuse();return actual.data;
}
/** The returned parent proves lock/identity ownership ONLY. No amount, receipt,
 * paid flag or available balance supplies permission to create another charge.
 * Call before payment/invoice/note locks; current admission is a separate query.
 * No synthetic ServiceContext, registration, bank call or mutation occurs. */
export async function lockControlledOrdinaryCollectionParent(tx:Tx,invoiceId:string):Promise<ControlledOrdinaryCollectionParent|null>{
 await lockContactIdentityForRead(tx);
 const original=await exactTarget(tx,invoiceId);if(!original)return null;
 await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${original.resourceId}`}))`);
 const resources=await tx.execute<{id:string}>(sql`select id::text from subscription_controlled_resources where id=${original.resourceId}::uuid for update`);
 if(resources.length!==1||resources[0]?.id!==original.resourceId)refuse();
 const parents=await tx.execute<{id:string}>(sql`select id::text from subscriptions where id=${original.subscriptionId}::uuid for update`);
 if(parents.length!==1||parents[0]?.id!==original.subscriptionId)refuse();
 const current=await exactTarget(tx,invoiceId);
 if(!current||merchantTaxDigest(current)!==merchantTaxDigest(original))refuse();
 return current;
}
