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
import { invoiceMarketPolicies, invoiceMerchantAllocations, invoices } from "@/modules/invoicing/schema";
import { invoiceMerchantCollections, merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations, merchantPaymentRoutes } from "@/modules/invoicing/merchant-collection-schema";
import { invoiceMerchantScopes, merchantInvoicePaymentRoutes } from "@/modules/invoicing/merchant-invoice-scope-schema";
import { payments } from "@/modules/invoicing/schema";
import { bookingCommercialSources, bookings } from "@/core/scheduling/schema";
import { bookingMarketPolicies, bookingMerchantScopes } from "./booking-merchant-schema";
import { subscriptionMarketPolicies } from "@/modules/subscriptions/schema";
import { invoiceMerchantDependencyFingerprints } from "@/modules/invoicing/merchant-payment-dependencies";
import { prorationFinancialWitness, type ProrationFinancialEntry } from "@/modules/invoicing/proration-financial-witness";

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
  scope:"members.merchantIdentity",tables:["invoice_market_policies","subscription_market_policies","invoice_merchant_allocations","invoice_merchant_collections","booking_market_policies","booking_merchant_scopes"],
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
      bookingPolicies:await tx.select({bookingId:bookingMarketPolicies.bookingId,merchantName:bookingMarketPolicies.merchantName,merchantSupport:bookingMarketPolicies.merchantSupport})
        .from(bookingMarketPolicies).where(eq(bookingMarketPolicies.merchantContactId,contactId)),
      bookingMerchantIdentity:await tx.select({bookingId:bookingMerchantScopes.bookingId,merchantName:bookingMerchantScopes.merchantName,merchantSupport:bookingMerchantScopes.merchantSupport})
        .from(bookingMerchantScopes).where(eq(bookingMerchantScopes.merchantContactId,contactId)),
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
    const bookingPolicies=await tx.update(bookingMarketPolicies).set({merchantName:ERASED_MERCHANT_NAME,merchantSupport:null}).where(eq(bookingMarketPolicies.merchantContactId,contactId)).returning({id:bookingMarketPolicies.bookingId});
    const bookingScopes=await tx.update(bookingMerchantScopes).set({merchantName:ERASED_MERCHANT_NAME,merchantSupport:null,merchantIdentityErasedAt:sql`coalesce(${bookingMerchantScopes.merchantIdentityErasedAt},now())`}).where(eq(bookingMerchantScopes.merchantContactId,contactId)).returning({id:bookingMerchantScopes.bookingId});
    return{affected:invoices.length+agreements.length+collectionRows.length+bookingPolicies.length+bookingScopes.length};
  },
});

const pointer=z.object({id:z.uuid(),contactId:z.uuid().nullable(),fingerprint:z.string().regex(/^[0-9a-f]{64}$/)});
type Pointer=z.infer<typeof pointer>;
type RawPointer={id:string;contactId:string|null;material:string};
// One exact frozen root at a time keeps ancestry attributable even when a
// source invoice has multiple merchants or credit crosses subscriptions.
// Repeated immutable rows count once across this identity cohort.
async function identityFinancialWitnesses(tx:Tx,kind:"merchant_profile"|"subscription",rootIds:string[],parentCount:number){
 if(!Number.isSafeInteger(parentCount)||parentCount<0||parentCount>5000||!z.array(z.uuid()).max(5000).safeParse(rootIds).success)return null;
 const roots=new Map<string,ProrationFinancialEntry[]>(),distinct=new Map<string,string>();
 for(const rootId of [...new Set(rootIds)].sort()){
  const history=await prorationFinancialWitness(tx,{kind,ids:[rootId]});
  if(history.incomplete)return null;
  for(const entry of history.entries){
   const key=`${entry.table}:${entry.id}`,material=JSON.stringify(entry),previous=distinct.get(key);
   if(previous!==undefined&&previous!==material)return null;
   distinct.set(key,material);
  }
  if(parentCount+distinct.size>5000)return null;
  roots.set(rootId,history.entries);
 }
 return{roots,count:distinct.size};
}
async function subscriptionPolicyPointers(tx:Tx,ids:string[]):Promise<RawPointer[]|null>{
 const rows=await tx.select({id:subscriptionMarketPolicies.subscriptionId,contactId:subscriptionMarketPolicies.merchantContactId,material:sql<string>`to_jsonb(${subscriptionMarketPolicies})::text`})
  .from(subscriptionMarketPolicies).where(inArray(subscriptionMarketPolicies.merchantContactId,ids)).orderBy(subscriptionMarketPolicies.subscriptionId).limit(5001);
 if(rows.length>5000)return null;
 const history=await identityFinancialWitnesses(tx,"subscription",rows.map(row=>row.id),rows.length);
 if(history===null)return null;
 return rows.map(row=>{
  const financial=history.roots.get(row.id)??[];
  return financial.length?{...row,material:JSON.stringify({material:row.material,prorationFinancial:financial})}:row;
 });
}
type CollectionParent={id:string;invoiceId:string;profileId:string;sellerUserId:string|null};
const invoiceParents=["invoiceId","sourceInvoiceId","targetInvoiceId"] as const;
function financialLinks(entry:ProrationFinancialEntry){
 const links=new Set<string>();
 for(const [key,value] of Object.entries(entry.parents)){
  if(!value||["profileId","subscriptionId","invoiceId","sourceInvoiceId","targetInvoiceId","jobId","paymentMethodId"].includes(key))continue;
  const kind=key==="sourceProrationId"||key==="targetProrationId"?"prorationId":key==="sourcePaymentId"?"paymentId":key==="sourceApplicationId"?"applicationId":key;
  links.add(kind==="originalRemittanceId"?`${entry.table}:${value}`:`${kind}:${value}`);
 }
 if(entry.table==="commercial_fee_attestations"||entry.table==="agreement_fee_remittances")links.add(`${entry.table}:${entry.id}`);
 return links;
}
async function collectionFinancialWitnesses(tx:Tx,rows:CollectionParent[]){
 const candidates=await identityFinancialWitnesses(tx,"merchant_profile",rows.map(row=>row.profileId),0);
 if(candidates===null)return null;
 const roots=new Map<string,ProrationFinancialEntry[]>(),distinct=new Map<string,string>();
 const active=rows.filter(row=>candidates.roots.get(row.profileId)?.some(entry=>invoiceParents.some(key=>entry.parents[key]===row.invoiceId)));
 if(!active.length)return{roots,count:0};
 // Actual original allocation/collection pairs establish whether invoice+
 // profile is unique. A shared platform tax profile is not a seller owner.
 const owners=await tx.select({id:invoiceMerchantAllocations.id,invoiceId:invoiceMerchantAllocations.invoiceId,sellerUserId:invoiceMerchantAllocations.sellerUserId,
  collectionInvoiceId:invoiceMerchantCollections.invoiceId,profileId:sql<string>`${invoiceMerchantCollections.taxPolicy}->>'profileId'`})
  .from(invoiceMerchantAllocations).leftJoin(invoiceMerchantCollections,eq(invoiceMerchantCollections.allocationId,invoiceMerchantAllocations.id))
  .where(inArray(invoiceMerchantAllocations.invoiceId,[...new Set(active.map(row=>row.invoiceId))])).orderBy(invoiceMerchantAllocations.id).limit(5001);
 if(owners.length>5000)return null;
 const paymentIds=[...new Set([...candidates.roots.values()].flatMap(entries=>entries.flatMap(entry=>[entry.parents.paymentId,entry.parents.sourcePaymentId].filter((value):value is string=>Boolean(value)))))];
 if(paymentIds.length>5000)return null;
 const routes=paymentIds.length?await tx.select({paymentId:merchantPaymentRoutes.paymentId,allocationId:merchantPaymentRoutes.allocationId,invoiceId:invoiceMerchantAllocations.invoiceId,
  paymentInvoiceId:payments.invoiceId,sellerUserId:invoiceMerchantAllocations.sellerUserId,collectionInvoiceId:invoiceMerchantCollections.invoiceId,
  profileId:sql<string>`${invoiceMerchantCollections.taxPolicy}->>'profileId'`}).from(merchantPaymentRoutes)
  .innerJoin(payments,eq(payments.id,merchantPaymentRoutes.paymentId)).innerJoin(invoiceMerchantAllocations,eq(invoiceMerchantAllocations.id,merchantPaymentRoutes.allocationId))
  .leftJoin(invoiceMerchantCollections,eq(invoiceMerchantCollections.allocationId,invoiceMerchantAllocations.id))
  .where(inArray(merchantPaymentRoutes.paymentId,paymentIds)).orderBy(merchantPaymentRoutes.paymentId).limit(5001):[];
 if(routes.length>5000||new Set(routes.map(route=>route.paymentId)).size!==routes.length||routes.some(route=>route.invoiceId!==route.paymentInvoiceId||route.collectionInvoiceId!==route.invoiceId||!z.uuid().safeParse(route.profileId).success))return null;
 const byPayment=new Map(routes.map(route=>[route.paymentId,route]));
 for(const row of active){
  const siblings=owners.filter(owner=>owner.invoiceId===row.invoiceId),own=siblings.find(owner=>owner.id===row.id);
  if(!own||own.profileId!==row.profileId||own.sellerUserId!==row.sellerUserId||siblings.some(owner=>owner.collectionInvoiceId!==row.invoiceId||!z.uuid().safeParse(owner.profileId).success))return null;
  const unique=siblings.filter(owner=>owner.profileId===row.profileId).length===1,entries=candidates.roots.get(row.profileId)??[];
  const selected=new Map<string,ProrationFinancialEntry>(),excluded=new Set<string>(),links=new Set<string>();
  const key=(entry:ProrationFinancialEntry)=>`${entry.table}:${entry.id}`;
  const add=(entry:ProrationFinancialEntry)=>{selected.set(key(entry),entry);for(const link of financialLinks(entry))links.add(link);};
  for(const entry of entries.filter(entry=>invoiceParents.some(name=>entry.parents[name]===row.invoiceId))){
   const directPayments=[entry.parents.paymentId,entry.parents.sourcePaymentId].filter((value):value is string=>Boolean(value));
   const directRoutes=directPayments.map(paymentId=>byPayment.get(paymentId)).filter((route):route is (typeof routes)[number]=>route!==undefined&&route.invoiceId===row.invoiceId);
   const owned=directRoutes.filter(route=>route.allocationId===row.id),foreign=directRoutes.filter(route=>route.allocationId!==row.id);
   if(owned.length&&foreign.length)return null;
   if(foreign.length){if(unique||foreign.length!==directPayments.length||foreign.some(route=>route.profileId!==row.profileId))return null;excluded.add(key(entry));continue;}
   if(owned.some(route=>route.profileId!==row.profileId||route.sellerUserId!==row.sellerUserId))return null;
   if(!unique&&(!directPayments.length||owned.length!==directPayments.length))return null;
   add(entry);
  }
  // Follow only actual financial FKs, never shared invoice/profile/subscriber
  // membership. This retains genuine credit ancestors and descendants.
  let changed=true;
  while(changed){changed=false;for(const entry of entries){
   if(selected.has(key(entry))||excluded.has(key(entry))||![...financialLinks(entry)].some(link=>links.has(link)))continue;
   for(const paymentId of [entry.parents.paymentId,entry.parents.sourcePaymentId]){
    const route=paymentId?byPayment.get(paymentId):undefined;
    if(route&&(route.invoiceId!==route.paymentInvoiceId||route.collectionInvoiceId!==route.invoiceId||route.profileId!==row.profileId||route.sellerUserId!==row.sellerUserId))return null;
   }
   add(entry);changed=true;
  }}
  // A manual ancestor has no allocation route. Its real payment's original
  // subscription invoice and immutable market-policy seller can prove the
  // same source owner; a profile/amount/current account cannot replace it.
  const manualSources=[...new Set([...selected.values()].flatMap(entry=>[entry.parents.paymentId,entry.parents.sourcePaymentId]
   .filter((paymentId):paymentId is string=>typeof paymentId==="string"&&!byPayment.has(paymentId)&&!invoiceParents.some(name=>entry.parents[name]===row.invoiceId))))];
  if(manualSources.length){
   const originals=await tx.select({paymentId:payments.id,invoiceId:payments.invoiceId,sourceType:invoices.sourceType,sourceId:invoices.sourceId,
    subscriptionId:subscriptionMarketPolicies.subscriptionId,sellerUserId:subscriptionMarketPolicies.sellerUserId}).from(payments)
    .innerJoin(invoices,eq(invoices.id,payments.invoiceId)).leftJoin(subscriptionMarketPolicies,and(eq(invoices.sourceType,"subscription"),sql`split_part(${invoices.sourceId},':',1)=${subscriptionMarketPolicies.subscriptionId}::text`))
    .where(inArray(payments.id,manualSources)).orderBy(payments.id).limit(5001);
   if(originals.length!==manualSources.length||new Set(originals.map(original=>original.paymentId)).size!==manualSources.length
    ||originals.some(original=>!manualSources.includes(original.paymentId)||!(original.invoiceId===row.invoiceId&&unique)
     &&(original.sourceType!=="subscription"||!original.subscriptionId||original.sourceId?.split(":")[0]!==original.subscriptionId||original.sellerUserId!==row.sellerUserId)))return null;
  }
  for(const entry of selected.values())distinct.set(key(entry),JSON.stringify(entry));
  if(rows.length+distinct.size>5000)return null;
  roots.set(row.id,[...selected.values()].sort((left,right)=>left.table.localeCompare(right.table)||left.id.localeCompare(right.id)));
 }
 return{roots,count:distinct.size};
}
function registerIdentityReference(table:string,read:(tx:Tx,ids:string[])=>Promise<RawPointer[]|null>,repoint:(tx:Tx,from:string,to:string)=>Promise<unknown>,restore:(tx:Tx,ids:string[],contactId:string)=>Promise<unknown>){
 const snapshot=async(tx:Tx,ids:string[])=>{
  const rows=await read(tx,ids);return rows===null||rows.length>5000?null:rows.map(({id,contactId,material}):Pointer=>({id,contactId,fingerprint:createHash("sha256").update(material).digest("hex")}));
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
 subscriptionPolicyPointers,
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
 const rows=await tx.select({id:invoiceMerchantCollections.allocationId,invoiceId:invoiceMerchantCollections.invoiceId,profileId:sql<string>`${invoiceMerchantCollections.taxPolicy}->>'profileId'`,sellerUserId:invoiceMerchantAllocations.sellerUserId,material:sql<string>`to_jsonb(${invoiceMerchantCollections})::text`})
  .from(invoiceMerchantCollections).innerJoin(invoiceMerchantAllocations,eq(invoiceMerchantAllocations.id,invoiceMerchantCollections.allocationId))
  .where(inArray(invoiceMerchantAllocations.merchantContactId,ids)).orderBy(invoiceMerchantCollections.allocationId).limit(5001);
 if(rows.length>5000)return null;
 if(!rows.length)return[];
 // The original collection supplies the financial root even if the profile
 // has no contact pointer and there has never been a routed payment.
 const history=await collectionFinancialWitnesses(tx,rows);
 if(history===null)return null;
 const routes=await tx.select({paymentId:merchantPaymentRoutes.paymentId}).from(merchantPaymentRoutes)
  .where(inArray(merchantPaymentRoutes.allocationId,rows.map(row=>row.id))).orderBy(merchantPaymentRoutes.paymentId).limit(5001);
 if(routes.length>5000)return null;
 const dependencies=await invoiceMerchantDependencyFingerprints(tx,[...new Set(rows.map(row=>row.invoiceId))],routes.map(row=>row.paymentId),rows.length+history.count);
 return dependencies===null?null:rows.map(({id,invoiceId,material})=>{
  const financial=history.roots.get(id)??[];
  return{id,fingerprint:createHash("sha256").update(JSON.stringify({material,paymentDependencies:dependencies.get(invoiceId),...(financial.length?{prorationFinancial:financial}:{})})).digest("hex")};
 });
}
registerContactReference({
 table:"invoice_merchant_collections",columns:[],repoint:async()=>undefined,
 captureForUndo:async(tx,from,to)=>{const state=await collectionSnapshot(tx,[from,to]);return{state:state??[],undoable:state!==null,...(state===null?{blocker:"Merchant collection evidence exceeds the safe undo limit."}:{})};},
 restoreAfterUndo:async(tx,_before,after,from,to)=>{
  const expected=collectionWitness.parse(after),current=await collectionSnapshot(tx,[from,to]);
  if(current===null||JSON.stringify(current)!==JSON.stringify(expected))throw new ServiceError("conflict","Original merchant collection evidence changed after the contact merge.");
 },
});

registerIdentityReference("booking_market_policies",
 (tx,ids)=>tx.select({id:bookingMarketPolicies.bookingId,contactId:bookingMarketPolicies.merchantContactId,material:sql<string>`to_jsonb(${bookingMarketPolicies})::text`}).from(bookingMarketPolicies).innerJoin(bookings,eq(bookings.id,bookingMarketPolicies.bookingId)).where(or(inArray(bookingMarketPolicies.merchantContactId,ids),inArray(bookings.contactId,ids))).orderBy(bookingMarketPolicies.bookingId).limit(5001),
 (tx,from,to)=>tx.update(bookingMarketPolicies).set({merchantContactId:to}).where(eq(bookingMarketPolicies.merchantContactId,from)),
 (tx,ids,contactId)=>tx.update(bookingMarketPolicies).set({merchantContactId:contactId}).where(inArray(bookingMarketPolicies.bookingId,ids)),
);
async function bookingScopePointers(tx:Tx,ids:string[]):Promise<RawPointer[]|null>{
 const rows=await tx.select({scope:bookingMerchantScopes,source:bookingCommercialSources}).from(bookingMerchantScopes)
  .innerJoin(bookings,eq(bookings.id,bookingMerchantScopes.bookingId)).leftJoin(bookingCommercialSources,eq(bookingCommercialSources.bookingId,bookingMerchantScopes.bookingId))
  .where(or(inArray(bookingMerchantScopes.merchantContactId,ids),inArray(bookings.contactId,ids))).orderBy(bookingMerchantScopes.bookingId).limit(5001);
 if(rows.length>5000)return null;
 if(!rows.length)return[];
 const invoiceScopes=await tx.select().from(invoiceMerchantScopes).where(inArray(invoiceMerchantScopes.bookingId,rows.map(row=>row.scope.bookingId))).orderBy(invoiceMerchantScopes.invoiceId).limit(5001);
 if(rows.length+invoiceScopes.length>5000)return null;
 const invoiceIds=invoiceScopes.map(row=>row.invoiceId);
 const dependencies=await invoiceMerchantDependencyFingerprints(tx,invoiceIds);
 if(dependencies===null)return null;
 const routes=invoiceIds.length?await tx.select({route:merchantInvoicePaymentRoutes,payment:payments}).from(merchantInvoicePaymentRoutes).innerJoin(payments,eq(payments.id,merchantInvoicePaymentRoutes.paymentId)).where(inArray(merchantInvoicePaymentRoutes.invoiceId,invoiceIds)).orderBy(merchantInvoicePaymentRoutes.paymentId).limit(5001):[];
 if(rows.length+invoiceScopes.length+routes.length>5000)return null;
 const paymentIds=routes.map(row=>row.payment.id);
 const observations=paymentIds.length?await tx.select().from(merchantPaymentObservations).where(inArray(merchantPaymentObservations.paymentId,paymentIds)).orderBy(merchantPaymentObservations.id).limit(5001):[];
 const feeOperations=paymentIds.length?await tx.select().from(merchantFeeRefunds).where(inArray(merchantFeeRefunds.paymentId,paymentIds)).orderBy(merchantFeeRefunds.id).limit(5001):[];
 if(rows.length+invoiceScopes.length+routes.length+observations.length+feeOperations.length>5000)return null;
 const feeObservations=feeOperations.length?await tx.select().from(merchantFeeObservations).where(inArray(merchantFeeObservations.operationId,feeOperations.map(row=>row.id))).orderBy(merchantFeeObservations.id).limit(5001):[];
 if(rows.length+invoiceScopes.length+routes.length+observations.length+feeOperations.length+feeObservations.length>5000)return null;
 return rows.map(({scope,source})=>{
  const ownedInvoices=invoiceScopes.filter(row=>row.bookingId===scope.bookingId),ownedIds=new Set(ownedInvoices.map(row=>row.invoiceId));
  const ownedRoutes=routes.filter(row=>ownedIds.has(row.route.invoiceId)),ownedPayments=new Set(ownedRoutes.map(row=>row.payment.id));
  const ownedFees=feeOperations.filter(row=>ownedPayments.has(row.paymentId)),feeIds=new Set(ownedFees.map(row=>row.id));
  return{id:scope.bookingId,contactId:scope.merchantContactId,material:JSON.stringify({scope,source,invoices:ownedInvoices,paymentDependencies:ownedInvoices.map(invoice=>({invoiceId:invoice.invoiceId,fingerprint:dependencies.get(invoice.invoiceId)})),routes:ownedRoutes,observations:observations.filter(row=>ownedPayments.has(row.paymentId)),feeOperations:ownedFees,feeObservations:feeObservations.filter(row=>feeIds.has(row.operationId))})};
 });
}
registerIdentityReference("booking_merchant_scopes",
 bookingScopePointers,
 (tx,from,to)=>tx.update(bookingMerchantScopes).set({merchantContactId:to}).where(eq(bookingMerchantScopes.merchantContactId,from)),
 (tx,ids,contactId)=>tx.update(bookingMerchantScopes).set({merchantContactId:contactId}).where(inArray(bookingMerchantScopes.bookingId,ids)),
);
