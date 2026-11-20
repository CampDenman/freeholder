// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: original commercial identity is private, held and merge-aware.
import {asc,eq,inArray,sql} from "drizzle-orm";
import {z} from "zod";
import {registerContactReference} from "@/core/contacts/service";
import {registerContactPrivacySource} from "@/core/privacy/service";
import {ServiceError,type Tx} from "@/core/service";
import {merchantTaxDigest} from "@/modules/invoicing/merchant-tax-store";
import {orders} from "./schema";
import {orderCommercialPolicies,orderCommercialParties,orderCommercialLines} from "./order-commercial-schema";
async function allow(tx:Tx,privacy=false){await tx.execute(sql`select set_config('freeholder.order_commercial_writes_v1','1',true)`);if(privacy)await tx.execute(sql`select set_config('freeholder.order_commercial_privacy_v1','1',true)`);}
const witness=z.object({id:z.uuid(),contactId:z.uuid().nullable(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)});
async function snapshot(tx:Tx,ids:string[]){
 const rows=await tx.select({id:orderCommercialParties.id,contactId:orderCommercialParties.merchantContactId,material:sql<string>`jsonb_build_object('party',to_jsonb(${orderCommercialParties}),'policy',to_jsonb(${orderCommercialPolicies}),'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.position),'[]'::jsonb) from order_commercial_lines l where l.party_id=${orderCommercialParties.id}))::text`}).from(orderCommercialParties).innerJoin(orderCommercialPolicies,eq(orderCommercialPolicies.orderId,orderCommercialParties.orderId)).where(inArray(orderCommercialParties.merchantContactId,ids)).orderBy(asc(orderCommercialParties.id)).limit(5001);
 return rows.length>5000?null:rows.map(({id,contactId,material})=>({id,contactId,fingerprint:merchantTaxDigest(material)}));
}
registerContactReference({
 table:"order_commercial_parties",columns:["merchant_contact_id"],
 repoint:async(tx,from,to)=>{await allow(tx);await tx.update(orderCommercialParties).set({merchantContactId:to}).where(eq(orderCommercialParties.merchantContactId,from));},
 captureForUndo:async(tx,from,to)=>{const rows=await snapshot(tx,[from,to]);return{state:rows??[],undoable:rows!==null,...(rows===null?{blocker:"Original order commercial ownership exceeds the safe undo limit."}:{})};},
 restoreAfterUndo:async(tx,beforeState,afterState,from,to)=>{const before=witness.array().max(5000).parse(beforeState),after=witness.array().max(5000).parse(afterState),current=await snapshot(tx,[from,to]);if(current===null||JSON.stringify(current)!==JSON.stringify(after))throw new ServiceError("conflict","Original commercial order terms changed after this contact merge.");const moved=before.filter(row=>row.contactId===from).map(row=>row.id);if(moved.length){await allow(tx);await tx.update(orderCommercialParties).set({merchantContactId:from}).where(inArray(orderCommercialParties.id,moved));}},
});
registerContactPrivacySource({
 scope:"catalog.orderCommercial",tables:["order_commercial_parties"],retentionScopes:["catalog.orders","members.merchantIdentity"],requiresLogin:true,eraseOrder:30,
 exportData:async(tx,contactId)=>{
  const owned=await tx.select({orderId:orders.id,model:orderCommercialPolicies.model,taxDestination:orderCommercialPolicies.taxDestination,acceptedQuoteDigest:orderCommercialPolicies.acceptedQuoteDigest}).from(orders).innerJoin(orderCommercialPolicies,eq(orderCommercialPolicies.orderId,orders.id)).where(eq(orders.contactId,contactId));
  const merchant=await tx.select().from(orderCommercialParties).where(eq(orderCommercialParties.merchantContactId,contactId));
  const ids=merchant.map(row=>row.id);
  return{asBuyer:owned,asMerchant:merchant,merchantLines:ids.length?await tx.select().from(orderCommercialLines).where(inArray(orderCommercialLines.partyId,ids)):[]};
 },
 erase:async(tx,contactId)=>{
  await allow(tx,true);
  const buyerOrders=await tx.select({id:orders.id}).from(orders).where(eq(orders.contactId,contactId));
  const erasedBuyer=buyerOrders.length?await tx.update(orderCommercialPolicies).set({taxDestination:null,buyerErasedAt:new Date()}).where(sql`${orderCommercialPolicies.orderId} in (${sql.join(buyerOrders.map(row=>sql`${row.id}::uuid`),sql`,`)}) and ${orderCommercialPolicies.buyerErasedAt} is null`).returning({id:orderCommercialPolicies.orderId}):[];
  const erasedMerchant=await tx.update(orderCommercialParties).set({merchantContactId:null,merchantName:"Erased merchant",merchantSupport:null,merchantErasedAt:new Date()}).where(eq(orderCommercialParties.merchantContactId,contactId)).returning({id:orderCommercialParties.id});
  return{affected:erasedBuyer.length+erasedMerchant.length};
 },
});
