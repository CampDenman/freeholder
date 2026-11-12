// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: public commercial copies still belong to the member's data rights.
import {createHash} from "node:crypto";
import { and, eq,inArray,isNull,or,sql } from "drizzle-orm";
import {z} from "zod";
import { ERASED_MERCHANT_NAME } from "@/core/commerce/merchant-identity";
import { contacts } from "@/core/contacts/schema";
import {registerContactReference} from "@/core/contacts/service";
import { lockContactIdentity, lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {ServiceError,type Tx} from "@/core/service";
import { invoiceMarketPolicies, invoiceMerchantAllocations } from "@/modules/invoicing/schema";
import { invoiceMerchantCollections } from "@/modules/invoicing/merchant-collection-schema";
import { subscriptionMarketPolicies } from "@/modules/subscriptions/schema";

export async function merchantIdentityErased(tx:Tx,userId:string,contactId?:string|null):Promise<boolean>{
  await lockContactIdentityForRead(tx);
  const [erased]=await tx.select({id:contacts.id}).from(contacts).where(and(or(eq(contacts.userId,userId),contactId?eq(contacts.id,contactId):undefined),eq(contacts.source,"privacy-erasure"))).limit(1);
  return Boolean(erased);
}
async function merchantForContact(tx:Tx,contactId:string):Promise<string|null>{
  const [contact]=await tx.select({userId:contacts.userId}).from(contacts).where(eq(contacts.id,contactId)).limit(1);
  return contact?.userId??null;
}

registerContactPrivacySource({
  scope:"members.merchantIdentity",tables:["invoice_market_policies","subscription_market_policies","invoice_merchant_allocations","invoice_merchant_collections"],
  retentionScopes:["members","commerce.money"],eraseOrder:5,
  exportData:async(tx,contactId)=>{
    const userId=await merchantForContact(tx,contactId);
    return{
      invoices:await tx.select({invoiceId:invoiceMarketPolicies.invoiceId,merchantName:invoiceMarketPolicies.merchantName,merchantSupport:invoiceMarketPolicies.merchantSupport}).from(invoiceMarketPolicies).where(or(eq(invoiceMarketPolicies.merchantContactId,contactId),userId?and(isNull(invoiceMarketPolicies.merchantContactId),eq(invoiceMarketPolicies.sellerUserId,userId)):undefined)),
      // These are retained original financial facts; no profile, routing or
      // unrelated buyer/contact identities are exported here.
      portions:await tx.select({invoiceId:invoiceMerchantAllocations.invoiceId,subtotalMinor:invoiceMerchantAllocations.subtotalMinor,discountMinor:invoiceMerchantAllocations.discountMinor,shippingMinor:invoiceMerchantAllocations.shippingMinor,taxMinor:invoiceMerchantAllocations.taxMinor,totalMinor:invoiceMerchantAllocations.totalMinor,feeMinor:invoiceMerchantAllocations.feeMinor}).from(invoiceMerchantAllocations).where(or(eq(invoiceMerchantAllocations.merchantContactId,contactId),userId?and(isNull(invoiceMerchantAllocations.merchantContactId),eq(invoiceMerchantAllocations.sellerUserId,userId)):undefined)),
      merchantCollections:await tx.select({invoiceId:invoiceMerchantCollections.invoiceId,merchantName:invoiceMerchantCollections.merchantName,merchantSupport:invoiceMerchantCollections.merchantSupport,taxPolicy:invoiceMerchantCollections.taxPolicy})
        .from(invoiceMerchantCollections).innerJoin(invoiceMerchantAllocations,eq(invoiceMerchantAllocations.id,invoiceMerchantCollections.allocationId))
        .where(or(eq(invoiceMerchantAllocations.merchantContactId,contactId),userId?and(isNull(invoiceMerchantAllocations.merchantContactId),eq(invoiceMerchantAllocations.sellerUserId,userId)):undefined)),
      agreements:await tx.select({subscriptionId:subscriptionMarketPolicies.subscriptionId,merchantName:subscriptionMarketPolicies.merchantName,merchantSupport:subscriptionMarketPolicies.merchantSupport}).from(subscriptionMarketPolicies).where(or(eq(subscriptionMarketPolicies.merchantContactId,contactId),userId?and(isNull(subscriptionMarketPolicies.merchantContactId),eq(subscriptionMarketPolicies.sellerUserId,userId)):undefined)),
    };
  },
  erase:async(tx,contactId)=>{
    await lockContactIdentity(tx);
    const userId=await merchantForContact(tx,contactId);
    // Keep original opaque money routing and actor/history identities. Erasure
    // removes commercial personal copies, never rewrites verified money.
    const invoices=await tx.update(invoiceMarketPolicies).set({merchantName:ERASED_MERCHANT_NAME,merchantSupport:null}).where(or(eq(invoiceMarketPolicies.merchantContactId,contactId),userId?and(isNull(invoiceMarketPolicies.merchantContactId),eq(invoiceMarketPolicies.sellerUserId,userId)):undefined)).returning({id:invoiceMarketPolicies.invoiceId});
    const agreements=await tx.update(subscriptionMarketPolicies).set({merchantName:ERASED_MERCHANT_NAME,merchantSupport:null}).where(or(eq(subscriptionMarketPolicies.merchantContactId,contactId),userId?and(isNull(subscriptionMarketPolicies.merchantContactId),eq(subscriptionMarketPolicies.sellerUserId,userId)):undefined)).returning({id:subscriptionMarketPolicies.subscriptionId});
    const collectionRows=await tx.update(invoiceMerchantCollections).set({merchantName:ERASED_MERCHANT_NAME,merchantSupport:null}).where(inArray(invoiceMerchantCollections.allocationId,
      tx.select({id:invoiceMerchantAllocations.id}).from(invoiceMerchantAllocations).where(or(eq(invoiceMerchantAllocations.merchantContactId,contactId),userId?and(isNull(invoiceMerchantAllocations.merchantContactId),eq(invoiceMerchantAllocations.sellerUserId,userId)):undefined)))).returning({id:invoiceMerchantCollections.allocationId});
    return{affected:invoices.length+agreements.length+collectionRows.length};
  },
});

const pointer=z.object({id:z.uuid(),contactId:z.uuid().nullable(),fingerprint:z.string().regex(/^[0-9a-f]{64}$/)});
type Pointer=z.infer<typeof pointer>;
type RawPointer={id:string;contactId:string|null;material:string};
function registerIdentityReference(table:string,read:(tx:Tx,ids:string[])=>Promise<RawPointer[]>,repoint:(tx:Tx,from:string,to:string)=>Promise<unknown>,restore:(tx:Tx,ids:string[],contactId:string)=>Promise<unknown>){
 const snapshot=async(tx:Tx,ids:string[])=>{
  const rows=await read(tx,ids);return rows.length>5000?null:rows.map(({id,contactId,material}):Pointer=>({id,contactId,fingerprint:createHash("sha256").update(material).digest("hex")}));
 };
 registerContactReference({
  table,columns:["merchant_contact_id"],repoint,
  captureForUndo:async(tx,from,to)=>{const state=await snapshot(tx,[from,to]);return{state:state??[],undoable:state!==null,...(state===null?{blocker:"Merchant document ownership exceeds the safe undo limit."}:{})};},
  restoreAfterUndo:async(tx,beforeState,afterState,from,to)=>{
   const before=pointer.array().max(5000).parse(beforeState),after=pointer.array().max(5000).parse(afterState),current=await snapshot(tx,[from,to]);
   if(current===null||JSON.stringify(current)!==JSON.stringify(after))throw new ServiceError("conflict","Merchant document identity changed after the contact merge. Keep its financial ownership together.");
   const moved=before.filter(row=>row.contactId===from).map(row=>row.id);if(moved.length)await restore(tx,moved,from);
  },
 });
}
registerIdentityReference("invoice_market_policies",
 (tx,ids)=>tx.select({id:invoiceMarketPolicies.invoiceId,contactId:invoiceMarketPolicies.merchantContactId,material:sql<string>`to_jsonb(${invoiceMarketPolicies})::text`}).from(invoiceMarketPolicies).where(inArray(invoiceMarketPolicies.merchantContactId,ids)).orderBy(invoiceMarketPolicies.invoiceId).limit(5001),
 (tx,from,to)=>tx.update(invoiceMarketPolicies).set({merchantContactId:to}).where(eq(invoiceMarketPolicies.merchantContactId,from)),
 (tx,ids,contactId)=>tx.update(invoiceMarketPolicies).set({merchantContactId:contactId}).where(inArray(invoiceMarketPolicies.invoiceId,ids)),
);
registerIdentityReference("subscription_market_policies",
 (tx,ids)=>tx.select({id:subscriptionMarketPolicies.subscriptionId,contactId:subscriptionMarketPolicies.merchantContactId,material:sql<string>`to_jsonb(${subscriptionMarketPolicies})::text`}).from(subscriptionMarketPolicies).where(inArray(subscriptionMarketPolicies.merchantContactId,ids)).orderBy(subscriptionMarketPolicies.subscriptionId).limit(5001),
 (tx,from,to)=>tx.update(subscriptionMarketPolicies).set({merchantContactId:to}).where(eq(subscriptionMarketPolicies.merchantContactId,from)),
 (tx,ids,contactId)=>tx.update(subscriptionMarketPolicies).set({merchantContactId:contactId}).where(inArray(subscriptionMarketPolicies.subscriptionId,ids)),
);
registerIdentityReference("invoice_merchant_allocations",
 (tx,ids)=>tx.select({id:invoiceMerchantAllocations.id,contactId:invoiceMerchantAllocations.merchantContactId,material:sql<string>`to_jsonb(${invoiceMerchantAllocations})::text`}).from(invoiceMerchantAllocations).where(inArray(invoiceMerchantAllocations.merchantContactId,ids)).orderBy(invoiceMerchantAllocations.id).limit(5001),
 (tx,from,to)=>tx.update(invoiceMerchantAllocations).set({merchantContactId:to}).where(eq(invoiceMerchantAllocations.merchantContactId,from)),
 (tx,ids,contactId)=>tx.update(invoiceMerchantAllocations).set({merchantContactId:contactId}).where(inArray(invoiceMerchantAllocations.id,ids)),
);

// Collection copies inherit the allocation's existing contact pointer. A
// separate bounded child witness protects undo without a duplicate identity
// column or a second repoint of that original allocation.
const collectionWitness=z.array(z.object({id:z.uuid(),fingerprint:z.string().regex(/^[0-9a-f]{64}$/)})).max(5000);
async function collectionSnapshot(tx:Tx,ids:string[]){
 const rows=await tx.select({id:invoiceMerchantCollections.allocationId,material:sql<string>`to_jsonb(${invoiceMerchantCollections})::text`})
  .from(invoiceMerchantCollections).innerJoin(invoiceMerchantAllocations,eq(invoiceMerchantAllocations.id,invoiceMerchantCollections.allocationId))
  .where(inArray(invoiceMerchantAllocations.merchantContactId,ids)).orderBy(invoiceMerchantCollections.allocationId).limit(5001);
 return rows.length>5000?null:rows.map(({id,material})=>({id,fingerprint:createHash("sha256").update(material).digest("hex")}));
}
registerContactReference({
 table:"invoice_merchant_collections",columns:[],repoint:async()=>undefined,
 captureForUndo:async(tx,from,to)=>{const state=await collectionSnapshot(tx,[from,to]);return{state:state??[],undoable:state!==null,...(state===null?{blocker:"Merchant collection evidence exceeds the safe undo limit."}:{})};},
 restoreAfterUndo:async(tx,_before,after,from,to)=>{
  const expected=collectionWitness.parse(after),current=await collectionSnapshot(tx,[from,to]);
  if(current===null||JSON.stringify(current)!==JSON.stringify(expected))throw new ServiceError("conflict","Original merchant collection evidence changed after the contact merge.");
 },
});
