// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: deliberate business declarations on the real member/contact spine.
import {and,asc,eq,ilike,inArray,sql} from "drizzle-orm";
import {z} from "zod";
import {publicMerchantSupport} from "@/core/commerce/merchant-identity";
import {contacts} from "@/core/contacts/schema";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {defineService,getService,ServiceError,type ServiceContext,type Tx} from "@/core/service";
import {dataRequests} from "@/core/privacy/schema";
import {memberProfiles} from "@/modules/members/schema";
import {taxCategories,taxRates,taxRegistrations,taxZones} from "./schema";
import {merchantTaxProfiles,merchantTaxProfileVersions} from "./merchant-tax-schema";
import {merchantTaxAddress,merchantTaxRegistrationInput,merchantTaxRuleSnapshot} from "./merchant-tax-contract";
import {allowMerchantTaxWrites,merchantTaxDigest} from "./merchant-tax-store";
import {taxTemplate} from "./tax-templates";

const config=z.object({
 expectedVersion:z.number().int().min(0).max(2147483646),idempotencyKey:z.uuid(),acceptPolicy:z.literal(true),
 origin:merchantTaxAddress,collectionStatus:z.enum(["registered","not_registered"]),
 nonCollectionReason:z.string().trim().min(3).max(1000).nullable().default(null),
 registrations:z.array(merchantTaxRegistrationInput).max(100),acknowledgeTemplateLimitations:z.boolean().default(false),
});
const memberInput=config.extend({liability:z.literal("seller")});
const siteInput=config.extend({liability:z.literal("platform"),merchantName:z.string().trim().min(1).max(200).refine(value=>!/[\u0000-\u001f\u007f]/u.test(value)),merchantSupport:publicMerchantSupport});
const saved=z.object({profileId:z.uuid(),profileVersion:z.number().int().positive(),liability:z.enum(["platform","seller"]),replayed:z.boolean()});
type Config=z.output<typeof config>&{liability:"platform"|"seller";merchantName?:string;merchantSupport?:z.infer<typeof publicMerchantSupport>};
const zoneView=merchantTaxRuleSnapshot.shape.zone.extend({configurationDigest:z.string(),activationLimitation:z.string().nullable(),rates:merchantTaxRuleSnapshot.shape.rates});
const profileView=z.object({
 profileId:z.uuid(),profileVersion:z.number().int(),state:z.enum(["active","erased"]),
 configuration:z.object({origin:merchantTaxAddress,liability:z.enum(["platform","seller"]),collectionStatus:z.enum(["registered","not_registered"]),nonCollectionReason:z.string().nullable(),
  merchantName:z.string().nullable(),merchantSupport:publicMerchantSupport.nullable(),rulesSnapshot:z.array(merchantTaxRuleSnapshot)}).nullable(),
});

async function memberOwner(ctx:ServiceContext){
 if(ctx.actor.kind!=="user")throw new ServiceError("permission","Sign in as the member whose tax business this is.");
 const userId=ctx.actor.userId;
 await lockContactIdentityForRead(ctx.tx);
 const[member]=await ctx.tx.select({id:memberProfiles.userId}).from(memberProfiles).where(and(eq(memberProfiles.userId,userId),eq(memberProfiles.status,"active"))).for("share");
 const people=await ctx.tx.select({id:contacts.id,source:contacts.source}).from(contacts).where(eq(contacts.userId,userId)).limit(2);
 if(!member||people.length!==1||people[0]!.source==="privacy-erasure")throw new ServiceError("permission","An active member with verified contact ownership is required.");
 const[erasure]=await ctx.tx.select({id:dataRequests.id}).from(dataRequests).where(and(eq(dataRequests.contactId,people[0]!.id),eq(dataRequests.kind,"erasure"),inArray(dataRequests.status,["verified","in_progress","completed","partially_completed"]))).limit(1);
 if(erasure)throw new ServiceError("conflict","The original member's privacy request prevents new business tax declarations.");
 return{userId,contactId:people[0]!.id};
}
async function zoneConfiguration(tx:Tx,id:string,locked=false){
 const query=tx.select().from(taxZones).where(eq(taxZones.id,id)).limit(1);
 const[zone]=locked?await query.for("share"):await query;
 if(!zone||!zone.active)throw new ServiceError("conflict","That declared tax zone is not active.");
 const rateQuery=tx.select().from(taxRates).where(eq(taxRates.zoneId,id)).orderBy(asc(taxRates.id));
 const rows=locked?await rateQuery.for("share"):await rateQuery;
 const ids=[...new Set(rows.flatMap(row=>row.categoryId?[row.categoryId]:[]))];
 const categoryQuery=ids.length?tx.select({id:taxCategories.id,code:taxCategories.code}).from(taxCategories).where(inArray(taxCategories.id,ids)).orderBy(asc(taxCategories.id)):null;
 const categories=categoryQuery?(locked?await categoryQuery.for("share"):await categoryQuery):[];
 const rates=rows.map(row=>({id:row.id,name:row.name,jurisdiction:row.jurisdiction,ratePpm:row.ratePpm,compound:row.compound,priority:row.priority,appliesToShipping:row.appliesToShipping,
  categoryCode:row.categoryId?categories.find(category=>category.id===row.categoryId)?.code??null:null,active:row.active,effectiveFrom:row.effectiveFrom,effectiveTo:row.effectiveTo}));
 const shape=merchantTaxRuleSnapshot.shape.zone.parse(zone);
 const activationLimitation=zone.templateKey?taxTemplate(zone.templateKey)?.activationLimitation??null:null;
 return{...shape,rates,activationLimitation,configurationDigest:merchantTaxDigest({zone:shape,rates,activationLimitation})};
}
async function profileFor(tx:Tx,sellerKey:string){
 const[profile]=await tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.sellerKey,sellerKey)).limit(1);
 if(!profile)return null;
 const[version]=await tx.select().from(merchantTaxProfileVersions).where(and(eq(merchantTaxProfileVersions.profileId,profile.id),eq(merchantTaxProfileVersions.version,profile.currentVersion))).limit(1);
 return{profileId:profile.id,profileVersion:profile.currentVersion,state:profile.state,configuration:!version||version.erasedAt?null:{origin:merchantTaxAddress.parse(version.origin),liability:version.liability,collectionStatus:version.collectionStatus,nonCollectionReason:version.nonCollectionReason,merchantName:version.merchantName,merchantSupport:version.merchantSupport,rulesSnapshot:version.rulesSnapshot}};
}

async function saveProfile(input:Config,ctx:ServiceContext,owner:{userId:string;contactId:string}|null){
 await lockContactIdentityForRead(ctx.tx);
 const sellerKey=owner?`seller:${owner.userId}`:"site";
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-tax:${sellerKey}`}))`);
 await allowMerchantTaxWrites(ctx.tx);
 if(input.collectionStatus==="not_registered"&&!input.nonCollectionReason)throw new ServiceError("validation","Record the business's explicit reason for not collecting tax.");
 if(input.collectionStatus==="not_registered"&&input.registrations.some(row=>row.status==="active"))throw new ServiceError("validation","A non-collecting declaration cannot activate a tax registration.");
 let[profile]=await ctx.tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.sellerKey,sellerKey)).limit(1).for("update");
 const{idempotencyKey:_requestKey,expectedVersion:_expectedVersion,acknowledgeTemplateLimitations:_acknowledgement,...declaration}=input;
 const digest=merchantTaxDigest({sellerKey,...declaration,registrations:declaration.registrations.map(row=>({...row,rateIds:[...row.rateIds].sort()})).sort((a,b)=>a.zoneId.localeCompare(b.zoneId)||a.rateIds.join(',').localeCompare(b.rateIds.join(',')))});
 if(profile){
  if(profile.state!=="active"||profile.contactId!==(owner?.contactId??null))throw new ServiceError("conflict","The original tax business ownership needs review before a new declaration.");
  const[replay]=await ctx.tx.select().from(merchantTaxProfileVersions).where(and(eq(merchantTaxProfileVersions.profileId,profile.id),eq(merchantTaxProfileVersions.requestKey,input.idempotencyKey))).limit(1);
  if(replay){if(replay.declarationDigest!==digest)throw new ServiceError("conflict","That tax declaration request key was used for different contents.");return{profileId:profile.id,profileVersion:replay.version,liability:replay.liability,replayed:true};}
  const[current]=await ctx.tx.select().from(merchantTaxProfileVersions).where(and(eq(merchantTaxProfileVersions.profileId,profile.id),eq(merchantTaxProfileVersions.version,profile.currentVersion))).limit(1);
  if(current?.declarationDigest===digest)return{profileId:profile.id,profileVersion:current.version,liability:current.liability,replayed:true};
 }
 if((profile?.currentVersion??0)!==input.expectedVersion)throw new ServiceError("conflict","The tax configuration changed. Review its current version before saving.");
 if(profile?.currentVersion){
  const guard=getService("subscriptions.assertMerchantTaxRevisionSafe");
  if(!guard)throw new ServiceError("conflict","Tax policy changes are unavailable until billing safety can be verified.");
  const result=await ctx.callAsSystem(guard,{profileId:profile.id});
  if(!z.object({safe:z.literal(true)}).safeParse(result).success)throw new ServiceError("conflict","The original billing schedules need review before this tax policy can change.");
 }
 if(!profile){[profile]=await ctx.tx.insert(merchantTaxProfiles).values({sellerUserId:owner?.userId??null,sellerKey,contactId:owner?.contactId??null,currentVersion:0}).returning();}
 const business=profile!,byZone=new Map<string,Awaited<ReturnType<typeof zoneConfiguration>>>();
 for(const id of [...new Set(input.registrations.map(row=>row.zoneId))].sort())byZone.set(id,await zoneConfiguration(ctx.tx,id,true));
 const assignments=new Set<string>();
 for(const registration of input.registrations){
  const zone=byZone.get(registration.zoneId)!;
  if(zone.configurationDigest!==registration.configurationDigest)throw new ServiceError("conflict","The declared zone or rate changed. Review it again before collecting tax.");
  if(registration.status==="active"&&zone.activationLimitation&&!input.acknowledgeTemplateLimitations)throw new ServiceError("validation","Review the selected tax starter's activation limitations before collecting.");
  if(registration.thresholdMinor>0&&!registration.thresholdCurrency)throw new ServiceError("validation","A tax threshold needs its declared currency.");
  if(new Set(registration.rateIds).size!==registration.rateIds.length||registration.rateIds.some(id=>!zone.rates.some(rate=>rate.id===id)))throw new ServiceError("validation","Each registration must name only distinct rates from its declared zone.");
  for(const id of registration.rateIds){if(assignments.has(id))throw new ServiceError("validation","A tax rate cannot have two competing business registration declarations.");assignments.add(id);}
 }
 for(const zone of byZone.values())if(zone.rates.some(rate=>rate.active&&!assignments.has(rate.id)))throw new ServiceError("validation","Declare collecting or monitoring ownership for every active rate in a selected zone.");
 await ctx.tx.delete(taxRegistrations).where(eq(taxRegistrations.merchantProfileId,business.id));
 const snapshots:z.infer<typeof merchantTaxRuleSnapshot>[]=[];
 for(const [zoneId,zone]of byZone){
  const registrations=[];
  for(const declaration of input.registrations.filter(row=>row.zoneId===zoneId)){
   const{rateIds,configurationDigest,...values}=declaration;
   const[created]=await ctx.tx.insert(taxRegistrations).values({...values,merchantProfileId:business.id}).returning();
   registrations.push({...declaration,id:created!.id,rateIds,configurationDigest});
  }
  snapshots.push(merchantTaxRuleSnapshot.parse({zone,registrations,rates:zone.rates}));
 }
 const version=input.expectedVersion+1;
 await ctx.tx.insert(merchantTaxProfileVersions).values({profileId:business.id,version,requestKey:input.idempotencyKey,liability:input.liability,origin:input.origin,collectionStatus:input.collectionStatus,nonCollectionReason:input.nonCollectionReason,
  rulesSnapshot:snapshots,merchantName:owner?null:input.merchantName,merchantSupport:owner?null:input.merchantSupport,declarationDigest:digest});
 await ctx.tx.update(merchantTaxProfiles).set({currentVersion:version}).where(eq(merchantTaxProfiles.id,business.id));
 if(owner)await ctx.emitTimeline({contactId:owner.contactId,eventType:"merchant_tax.profile_saved",subjectType:"merchantTaxProfile",subjectId:business.id,payload:{version,liability:input.liability}});
 ctx.queueEvent("merchant_tax.profile_saved",{profileId:business.id,version,liability:input.liability});ctx.setSubject("merchantTaxProfile",business.id);
 return{profileId:business.id,profileVersion:version,liability:input.liability,replayed:false};
}
async function saveSafely(input:Config,ctx:ServiceContext,owner:{userId:string;contactId:string}|null){
 try{return await saveProfile(input,ctx,owner);}catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError("internal","The tax declaration could not be saved. Retry with the same request key.");}
}
export const myMerchantTaxProfile=defineService({name:"members.myMerchantTaxProfile",summary:"Read your own explicitly declared business tax configuration.",kind:"query",permission:"authenticated",input:z.object({}),output:profileView.nullable(),handler:async(_input,ctx)=>{const owner=await memberOwner(ctx);return profileFor(ctx.tx,`seller:${owner.userId}`);}});
export const saveMyMerchantTaxProfile=defineService({name:"members.saveMerchantTaxProfile",summary:"Version your own business's explicit tax collection declaration.",kind:"mutation",permission:"authenticated",input:memberInput,output:saved,auditInputFields:["expectedVersion","acceptPolicy","acknowledgeTemplateLimitations"],handler:async(input,ctx)=>saveSafely(input,ctx,await memberOwner(ctx))});
export const siteMerchantTaxProfile=defineService({name:"invoicing.siteMerchantTaxProfile",summary:"Read the site's deliberate tax business identity and configuration.",kind:"query",permission:"scoped",input:z.object({}),output:profileView.nullable(),handler:(_input,ctx)=>profileFor(ctx.tx,"site")});
export const saveSiteMerchantTaxProfile=defineService({name:"invoicing.saveSiteMerchantTaxProfile",summary:"Version the site's explicit tax and public invoice-business declaration.",kind:"mutation",permission:"scoped",input:siteInput,output:saved,auditInputFields:["expectedVersion","acceptPolicy","acknowledgeTemplateLimitations"],handler:(input,ctx)=>saveSafely(input,ctx,null)});
export const merchantTaxZoneConfiguration=defineService({name:"members.merchantTaxZoneConfiguration",summary:"Read a tax zone and its exact current rate-version digest before declaring your business registrations.",kind:"query",permission:"authenticated",input:z.object({zoneId:z.uuid()}),output:zoneView,handler:async({zoneId},ctx)=>{await memberOwner(ctx);return zoneConfiguration(ctx.tx,zoneId);}});
const zoneSearchInput=z.object({country:z.string().regex(/^[A-Z]{2}$/).optional(),q:z.string().trim().max(100).optional(),offset:z.number().int().min(0).max(100000).default(0),limit:z.number().int().min(1).max(100).default(50)});
const zoneSearchOutput=z.object({rows:z.array(z.object({id:z.uuid(),name:z.string(),country:z.string()})),nextOffset:z.number().nullable()});
async function searchZones(tx:Tx,input:z.output<typeof zoneSearchInput>){const rows=await tx.select({id:taxZones.id,name:taxZones.name,country:taxZones.country}).from(taxZones).where(and(eq(taxZones.active,true),input.country?eq(taxZones.country,input.country):undefined,input.q?ilike(taxZones.name,`%${input.q.replace(/[\\%_]/g,char=>`\\${char}`)}%`):undefined)).orderBy(asc(taxZones.country),asc(taxZones.name),asc(taxZones.id)).offset(input.offset).limit(input.limit+1);return{rows:rows.slice(0,input.limit),nextOffset:rows.length>input.limit?input.offset+input.limit:null};}
export const listMerchantTaxZones=defineService({name:"members.merchantTaxZones",summary:"Find active tax jurisdictions without exposing another business's registrations or customer exemptions.",kind:"query",permission:"authenticated",input:zoneSearchInput,output:zoneSearchOutput,handler:async(input,ctx)=>{await memberOwner(ctx);return searchZones(ctx.tx,input);}});
export const siteMerchantTaxZones=defineService({name:"invoicing.merchantTaxZones",summary:"Find active jurisdictions for the site's deliberate business tax declaration.",kind:"query",permission:"scoped",input:zoneSearchInput,output:zoneSearchOutput,handler:(input,ctx)=>searchZones(ctx.tx,input)});
export const siteMerchantTaxZoneConfiguration=defineService({name:"invoicing.merchantTaxZoneConfiguration",summary:"Read the exact current rate-version digest before declaring the site's business registrations.",kind:"query",permission:"scoped",input:z.object({zoneId:z.uuid()}),output:zoneView,handler:({zoneId},ctx)=>zoneConfiguration(ctx.tx,zoneId)});

export const memberMerchantTaxServices=[myMerchantTaxProfile,saveMyMerchantTaxProfile,merchantTaxZoneConfiguration,listMerchantTaxZones];
export const siteMerchantTaxServices=[siteMerchantTaxProfile,saveSiteMerchantTaxProfile,siteMerchantTaxZones,siteMerchantTaxZoneConfiguration];
