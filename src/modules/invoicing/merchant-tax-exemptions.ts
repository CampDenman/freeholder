// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C5.03: a verified buyer requests; only the actual business approves.
import {and,desc,eq,gte,inArray,isNull,lt,or,sql} from "drizzle-orm";
import {z} from "zod";
import {contacts} from "@/core/contacts/schema";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {lockMerchantExemptionPolicy} from "@/core/commerce/merchant-exemption-lock";
import {dataRequests} from "@/core/privacy/schema";
import {defineService,getService,ServiceError,type ServiceContext} from "@/core/service";
import {requireCartAccess} from "@/modules/catalog/cart-access";
import {currentOrderCommercialTerms} from "@/modules/catalog/order-commercial-consent";
import {memberPayoutAccounts} from "@/modules/members/schema";
import {merchantTaxAddress} from "./merchant-tax-contract";
import {selectDeclaredMerchantTaxRule} from "./merchant-tax-calculation";
import {memberOwner} from "./merchant-tax-profiles";
import {merchantTaxProfiles,merchantTaxProfileVersions} from "./merchant-tax-schema";
import {allowMerchantTaxWrites} from "./merchant-tax-store";
import {taxExemptions,taxZones} from "./schema";

const kind=z.enum(["reseller","nonprofit","reverse_charge","diplomatic"]);
const status=z.enum(["pending","valid","expired","revoked"]);
const page=z.object({offset:z.number().int().min(0).max(100000).default(0),limit:z.number().int().min(1).max(100).default(50),status:status.optional()});
const view=z.object({id:z.uuid(),contactId:z.uuid(),sellerUserId:z.uuid().nullable(),businessName:z.string().nullable(),businessActive:z.boolean(),customerName:z.string().nullable(),zoneId:z.uuid(),zoneName:z.string(),kind,certificateRef:z.string().nullable(),status,validatedAt:z.date().nullable(),expiresAt:z.date().nullable(),createdAt:z.date(),updatedAt:z.date()});
const listed=z.object({rows:z.array(view),nextOffset:z.number().nullable()});
const result=z.object({id:z.uuid(),status});
const cartInput=z.object({cartId:z.uuid(),cartToken:z.uuid().optional()});
const reviewInput=z.object({id:z.uuid(),expectedStatus:status,decision:z.enum(["valid","revoked"]),confirmEvidence:z.boolean().default(false),expiresAt:z.coerce.date().nullable().default(null)}).refine(value=>value.decision!=="valid"||value.confirmEvidence,{message:"Confirm that you verified the actual customer certificate or VAT number.",path:["confirmEvidence"]});
async function savePrivately<T>(run:()=>Promise<T>):Promise<T>{try{return await run();}catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError("internal","The private customer tax evidence could not be saved. Review its current status before retrying.");}}

async function buyer(ctx:ServiceContext){
 await lockContactIdentityForRead(ctx.tx);
 if(ctx.actor.kind!=="user")throw new ServiceError("permission","Sign in as the customer whose exemption this is.");
 const rows=await ctx.tx.select().from(contacts).where(eq(contacts.userId,ctx.actor.userId)).limit(2);
 if(rows.length!==1||rows[0]!.source==="privacy-erasure")throw new ServiceError("permission","A verified customer contact is required.");
 const person=rows[0]!;
 const[erasure]=await ctx.tx.select({id:dataRequests.id}).from(dataRequests).where(and(eq(dataRequests.contactId,person.id),eq(dataRequests.kind,"erasure"),inArray(dataRequests.status,["verified","in_progress","completed","partially_completed"]))).limit(1);
 if(erasure)throw new ServiceError("conflict","The customer's privacy request prevents new exemption instructions.");
 return person;
}
async function business(ctx:ServiceContext,sellerKey:string){
 const[found]=await ctx.tx.select({profile:merchantTaxProfiles,version:merchantTaxProfileVersions}).from(merchantTaxProfiles)
  .innerJoin(merchantTaxProfileVersions,and(eq(merchantTaxProfileVersions.profileId,merchantTaxProfiles.id),eq(merchantTaxProfileVersions.version,merchantTaxProfiles.currentVersion)))
  .where(eq(merchantTaxProfiles.sellerKey,sellerKey)).limit(1).for("share");
 if(!found||found.profile.state!=="active"||found.version.erasedAt)throw new ServiceError("conflict","That original business tax declaration is not available.");
 if(found.profile.sellerUserId!==null){
  const[owner]=found.profile.contactId?await ctx.tx.select().from(contacts).where(eq(contacts.id,found.profile.contactId)).limit(1):[];
  const[erasure]=owner?await ctx.tx.select({id:dataRequests.id}).from(dataRequests).where(and(eq(dataRequests.contactId,owner.id),eq(dataRequests.kind,"erasure"),inArray(dataRequests.status,["verified","in_progress","completed","partially_completed"]))).limit(1):[];
  if(!owner||owner.userId!==found.profile.sellerUserId||owner.source==="privacy-erasure"||erasure)throw new ServiceError("conflict","The original merchant is not available for new exemption instructions.");
 }
 return found;
}
async function ownBusiness(ctx:ServiceContext,site:boolean){
 await lockContactIdentityForRead(ctx.tx);
 const owner=site?null:await memberOwner(ctx);
 return business(ctx,owner?`seller:${owner.userId}`:"site");
}
async function ownCartTerms(value:z.infer<typeof cartInput>,ctx:ServiceContext,kind:"query"|"mutation"){
 const person=await buyer(ctx),{cart}=await requireCartAccess(ctx,value,"catalog.getCart",kind);
 if(cart.status!=="open"||cart.kind!=="cart"||cart.contactId!==null&&cart.contactId!==person.id)throw new ServiceError("permission","Request an exemption only for your own open cart.");
 const terms=currentOrderCommercialTerms.parse(await ctx.callAsSystem(getService("members.resolveCartCommercialTerms"),{cartId:cart.id}));
 if(terms.model!=="seller_merchant")throw new ServiceError("conflict","This cart does not use business-specific merchant tax declarations.");
 return{person,cart,terms};
}
async function list(value:z.output<typeof page>,ctx:ServiceContext,owner:{contactId:string}|{profileId:string}){
 const now=new Date();
 const condition=value.status==="expired"?or(eq(taxExemptions.status,"expired"),and(eq(taxExemptions.status,"valid"),lt(taxExemptions.expiresAt,now))):value.status==="valid"?and(eq(taxExemptions.status,"valid"),or(isNull(taxExemptions.expiresAt),gte(taxExemptions.expiresAt,now))):value.status?eq(taxExemptions.status,value.status):undefined;
 const rows=await ctx.tx.select({exemption:taxExemptions,profile:merchantTaxProfiles,version:merchantTaxProfileVersions,name:memberPayoutAccounts.merchantName,customerName:contacts.name,zoneName:taxZones.name}).from(taxExemptions)
  .innerJoin(merchantTaxProfiles,eq(merchantTaxProfiles.id,taxExemptions.merchantProfileId))
  .innerJoin(merchantTaxProfileVersions,and(eq(merchantTaxProfileVersions.profileId,merchantTaxProfiles.id),eq(merchantTaxProfileVersions.version,merchantTaxProfiles.currentVersion)))
  .innerJoin(contacts,eq(contacts.id,taxExemptions.contactId)).innerJoin(taxZones,eq(taxZones.id,taxExemptions.zoneId))
  .leftJoin(memberPayoutAccounts,eq(memberPayoutAccounts.userId,merchantTaxProfiles.sellerUserId))
  .where(and("contactId" in owner?eq(taxExemptions.contactId,owner.contactId):eq(taxExemptions.merchantProfileId,owner.profileId),condition))
  .orderBy(desc(taxExemptions.createdAt),desc(taxExemptions.id)).offset(value.offset).limit(value.limit+1);
 return{rows:rows.slice(0,value.limit).map(({exemption,profile,version,name,customerName,zoneName})=>({
  ...exemption,sellerUserId:profile.sellerUserId,businessActive:profile.state==="active"&&!version.erasedAt,
  businessName:profile.state!=="active"||version.erasedAt?null:profile.sellerUserId===null?version.merchantName:name,customerName,zoneName,
 })),nextOffset:rows.length>value.limit?value.offset+value.limit:null};
}

export const requestMerchantTaxExemption=defineService({
 name:"invoicing.requestMerchantTaxExemption",summary:"Request your own customer exemption from an actual business in your authorized merchant cart.",kind:"mutation",permission:"authenticated",
 rateLimit:{limit:10,windowSeconds:3600,message:"Wait before submitting another customer tax exemption request.",subject:(_value,actor)=>actor.kind==="user"?actor.userId:undefined},
 input:z.object({cartId:z.uuid(),cartToken:z.uuid().optional(),sellerUserId:z.uuid().nullable(),destination:merchantTaxAddress,kind,certificateRef:z.string().trim().min(3).max(500)}),output:result,
 auditInputFields:["sellerUserId","kind"],
 handler:async(value,ctx)=>savePrivately(async()=>{
  const{person,terms}=await ownCartTerms(value,ctx,"mutation");
  if(!terms.sellers.some(party=>party.sellerUserId===value.sellerUserId))throw new ServiceError("conflict","This cart does not use that business's merchant tax declaration.");
  const original=await business(ctx,value.sellerUserId===null?"site":`seller:${value.sellerUserId}`);
  const rule=selectDeclaredMerchantTaxRule({origin:merchantTaxAddress.parse(original.version.origin),destination:value.destination},original.version);
  if(!rule)throw new ServiceError("conflict","No business tax jurisdiction applies to this request.");
  // A pending request changes no effective exemption. Serialize it without
  // requiring the customer to stop billing merely to submit their evidence.
  await lockMerchantExemptionPolicy(ctx.tx,original.profile.id,person.id);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-exemption:${original.profile.id}:${person.id}:${rule.zone.id}`}))`);
  const[existing]=await ctx.tx.select().from(taxExemptions).where(and(eq(taxExemptions.merchantProfileId,original.profile.id),eq(taxExemptions.contactId,person.id),eq(taxExemptions.zoneId,rule.zone.id),inArray(taxExemptions.status,["pending","valid"]))).orderBy(sql`case when ${taxExemptions.status}='pending' then 0 else 1 end`,desc(taxExemptions.createdAt)).limit(1).for("update");
  if(existing?.status==="pending"){if(existing.kind!==value.kind||existing.certificateRef!==value.certificateRef)throw new ServiceError("conflict","Withdraw the existing pending request before replacing its evidence.");return{id:existing.id,status:existing.status};}
  const now=new Date();
  if(existing?.status==="valid"&&existing.kind===value.kind&&existing.certificateRef===value.certificateRef&&existing.validatedAt&&existing.validatedAt<=now&&(!existing.expiresAt||existing.expiresAt>now))return{id:existing.id,status:existing.status};
  await allowMerchantTaxWrites(ctx.tx);
  const[created]=await ctx.tx.insert(taxExemptions).values({merchantProfileId:original.profile.id,contactId:person.id,zoneId:rule.zone.id,kind:value.kind,certificateRef:value.certificateRef,status:"pending"}).returning();
  ctx.setSubject("taxExemption",created!.id);
  await ctx.emitTimeline({contactId:person.id,eventType:"merchant_tax.exemption_requested",subjectType:"taxExemption",subjectId:created!.id,payload:{kind:value.kind}});
  return{id:created!.id,status:created!.status};
 }),
});
export const cartMerchantTaxBusinesses=defineService({name:"invoicing.cartMerchantTaxBusinesses",summary:"Choose only actual merchant businesses in your own authorized open cart.",kind:"query",permission:"authenticated",input:cartInput,output:z.array(z.object({sellerUserId:z.uuid().nullable(),merchantName:z.string()})),handler:async(value,ctx)=>{const{terms}=await ownCartTerms(value,ctx,"query");return terms.sellers.map(party=>{if(!party.merchantName)throw new ServiceError("conflict","The business must finish its public payment identity first.");return{sellerUserId:party.sellerUserId,merchantName:party.merchantName};});}});
export const myMerchantTaxExemptions=defineService({name:"invoicing.myMerchantTaxExemptions",summary:"Read only your own customer requests and business exemption decisions.",kind:"query",permission:"authenticated",input:page,output:listed,handler:async(value,ctx)=>list(value,ctx,{contactId:(await buyer(ctx)).id})});
export const withdrawMerchantTaxExemption=defineService({
 name:"invoicing.withdrawMerchantTaxExemption",summary:"Withdraw your own pending exemption request without destroying retained evidence.",kind:"mutation",permission:"authenticated",input:z.object({id:z.uuid()}),output:result,auditInputFields:["id"],
 handler:async({id},ctx)=>{
  const person=await buyer(ctx),[original]=await ctx.tx.select().from(taxExemptions).where(and(eq(taxExemptions.id,id),eq(taxExemptions.contactId,person.id))).limit(1);
  if(!original?.merchantProfileId)throw new ServiceError("conflict","That pending customer request is not available.");
  await lockMerchantExemptionPolicy(ctx.tx,original.merchantProfileId,person.id);
  const[row]=await ctx.tx.select().from(taxExemptions).where(and(eq(taxExemptions.id,id),eq(taxExemptions.contactId,person.id))).limit(1).for("update");
  if(!row||row.merchantProfileId!==original.merchantProfileId||row.status!=="pending")throw new ServiceError("conflict","That pending customer request is not available.");
  await allowMerchantTaxWrites(ctx.tx);await ctx.tx.update(taxExemptions).set({status:"revoked",updatedAt:new Date()}).where(eq(taxExemptions.id,id));ctx.setSubject("taxExemption",id);return{id,status:"revoked" as const};
 },
});
async function review(value:z.output<typeof reviewInput>,ctx:ServiceContext,site:boolean){
 const original=await ownBusiness(ctx,site),[initial]=await ctx.tx.select().from(taxExemptions).where(and(eq(taxExemptions.id,value.id),eq(taxExemptions.merchantProfileId,original.profile.id))).limit(1);
 if(!initial)throw new ServiceError("not_found","That original customer request is not available to this business.");
 await lockMerchantExemptionPolicy(ctx.tx,original.profile.id,initial.contactId);
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-exemption:${original.profile.id}:${initial.contactId}:${initial.zoneId}`}))`);
 const[row]=await ctx.tx.select().from(taxExemptions).where(and(eq(taxExemptions.id,value.id),eq(taxExemptions.merchantProfileId,original.profile.id))).limit(1).for("update");
 if(!row||row.status!==value.expectedStatus||!["pending","valid"].includes(row.status)||value.decision==="valid"&&row.status!=="pending")throw new ServiceError("conflict","That original customer request changed. Review it again.");
 const now=new Date();
 if(!original.version.rulesSnapshot.some(rule=>rule.zone.id===row.zoneId)||value.decision==="valid"&&(!row.certificateRef?.trim()||value.expiresAt&&value.expiresAt<=now))throw new ServiceError("validation","Review the current jurisdiction, actual certificate evidence and future expiry before approving.");
 const[erasure]=await ctx.tx.select({id:dataRequests.id}).from(dataRequests).where(and(eq(dataRequests.contactId,row.contactId),eq(dataRequests.kind,"erasure"),inArray(dataRequests.status,["verified","in_progress","completed","partially_completed"]))).limit(1);
 if(erasure)throw new ServiceError("conflict","The customer's privacy request prevents new exemption decisions.");
 const[customer]=await ctx.tx.select({source:contacts.source}).from(contacts).where(eq(contacts.id,row.contactId)).limit(1);
 if(!customer||customer.source==="privacy-erasure")throw new ServiceError("conflict","The original customer is not available for a new decision.");
 const safe=await ctx.callAsSystem(getService("subscriptions.assertMerchantTaxExemptionRevisionSafe"),{profileId:original.profile.id,contactId:row.contactId});
 if(!z.object({safe:z.literal(true)}).safeParse(safe).success)throw new ServiceError("conflict","The original billing schedules need review before this customer tax policy changes.");
 await allowMerchantTaxWrites(ctx.tx);
 if(value.decision==="valid")await ctx.tx.update(taxExemptions).set({status:"revoked",updatedAt:now}).where(and(eq(taxExemptions.merchantProfileId,original.profile.id),eq(taxExemptions.contactId,row.contactId),eq(taxExemptions.zoneId,row.zoneId),eq(taxExemptions.status,"valid")));
 await ctx.tx.update(taxExemptions).set({status:value.decision,...(value.decision==="valid"?{validatedAt:now,expiresAt:value.expiresAt}:{}),updatedAt:now}).where(eq(taxExemptions.id,row.id));
 ctx.setSubject("taxExemption",row.id);
 await ctx.emitTimeline({contactId:row.contactId,eventType:"merchant_tax.exemption_reviewed",subjectType:"taxExemption",subjectId:row.id,payload:{status:value.decision}});
 return{id:row.id,status:value.decision};
}
export const memberMerchantTaxExemptions=defineService({name:"members.merchantTaxExemptions",summary:"Review customer evidence submitted only to your own business.",kind:"query",permission:"authenticated",input:page,output:listed,handler:async(value,ctx)=>list(value,ctx,{profileId:(await ownBusiness(ctx,false)).profile.id})});
export const reviewMemberMerchantTaxExemption=defineService({name:"members.reviewMerchantTaxExemption",summary:"Record your business's own verified exemption or reverse-charge decision.",kind:"mutation",permission:"authenticated",input:reviewInput,output:result,auditInputFields:["id","expectedStatus","decision","confirmEvidence"],handler:(value,ctx)=>savePrivately(()=>review(value,ctx,false))});
export const siteMerchantTaxExemptions=defineService({name:"invoicing.siteMerchantTaxExemptions",summary:"Review customer evidence submitted to the explicit site tax business.",kind:"query",permission:"scoped",input:page,output:listed,handler:async(value,ctx)=>list(value,ctx,{profileId:(await ownBusiness(ctx,true)).profile.id})});
export const reviewSiteMerchantTaxExemption=defineService({name:"invoicing.reviewSiteMerchantTaxExemption",summary:"Record a verified customer decision only for the site's own tax business.",kind:"mutation",permission:"scoped",input:reviewInput,output:result,auditInputFields:["id","expectedStatus","decision","confirmEvidence"],handler:(value,ctx)=>savePrivately(()=>review(value,ctx,true))});
export const memberMerchantTaxExemptionServices=[memberMerchantTaxExemptions,reviewMemberMerchantTaxExemption];
export const siteMerchantTaxExemptionServices=[cartMerchantTaxBusinesses,requestMerchantTaxExemption,myMerchantTaxExemptions,withdrawMerchantTaxExemption,siteMerchantTaxExemptions,reviewSiteMerchantTaxExemption];
