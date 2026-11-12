// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: original business privacy, exact merge witnesses and real jobs.
import {and,eq,gt,inArray,isNull,or,sql} from "drizzle-orm";
import {z} from "zod";
import {registerContactReference} from "@/core/contacts/service";
import {completeErasureJob,erasureArtifactIsIntact,reopenErasureJob,registerContactPrivacySource} from "@/core/privacy/service";
import {dataRequestArtifacts,dataRequests,privacyRetentionExceptions} from "@/core/privacy/schema";
import {lockContactIdentity} from "@/core/contacts/identity-lock";
import {defineService,getService,ServiceError,type ServiceContext,type Tx} from "@/core/service";
import {merchantTaxProfiles,merchantTaxProfileVersions} from "./merchant-tax-schema";
import {taxExemptions,taxRegistrations} from "./schema";
import {allowMerchantTaxWrites,merchantTaxDigest} from "./merchant-tax-store";

const scope="commerce.merchantTax";
export const MERCHANT_TAX_ERASURE_JOB="subscriptions.quiesceMerchantSchedules";
const witness=z.object({id:z.uuid(),contactId:z.uuid().nullable(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)});
async function snapshot(tx:Tx,ids:string[]){
 const rows=await tx.select({id:merchantTaxProfiles.id,contactId:merchantTaxProfiles.contactId,
  material:sql<string>`jsonb_build_object('profile',to_jsonb(${merchantTaxProfiles}),'versions',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(v) order by v.version),'[]'::jsonb)::text,'UTF8')),'hex') from merchant_tax_profile_versions v where v.profile_id=${merchantTaxProfiles.id}),'registrations',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb)::text,'UTF8')),'hex') from tax_registrations r where r.merchant_profile_id=${merchantTaxProfiles.id}),'exemptions',(select encode(sha256(convert_to(coalesce(jsonb_agg((to_jsonb(e)-'contact_id')||jsonb_build_object('contact_id',case when e.contact_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) then 'merged-subject' else e.contact_id::text end) order by e.id),'[]'::jsonb)::text,'UTF8')),'hex') from tax_exemptions e where e.merchant_profile_id=${merchantTaxProfiles.id}))::text`,
 }).from(merchantTaxProfiles).where(inArray(merchantTaxProfiles.contactId,ids)).orderBy(merchantTaxProfiles.id).limit(5001);
 return rows.length>5000?null:rows.map(({id,contactId,material})=>({id,contactId,fingerprint:merchantTaxDigest(material)}));
}
registerContactReference({
 table:"merchant_tax_profiles",
 repoint:async(tx,from,to)=>{await allowMerchantTaxWrites(tx);await tx.update(merchantTaxProfiles).set({contactId:to}).where(eq(merchantTaxProfiles.contactId,from));},
 captureForUndo:async(tx,from,to)=>{const rows=await snapshot(tx,[from,to]);return{state:rows??[],undoable:rows!==null,...(rows===null?{blocker:"Original business tax ownership exceeds the safe undo limit."}:{})};},
 restoreAfterUndo:async(tx,beforeState,afterState,from,to)=>{
  const before=witness.array().max(5000).parse(beforeState),after=witness.array().max(5000).parse(afterState),current=await snapshot(tx,[from,to]);
  if(current===null||JSON.stringify(current)!==JSON.stringify(after))throw new ServiceError("conflict","Original tax business declarations changed after this contact merge.");
  const moved=before.filter(row=>row.contactId===from).map(row=>row.id);
  if(moved.length){await allowMerchantTaxWrites(tx);await tx.update(merchantTaxProfiles).set({contactId:from}).where(inArray(merchantTaxProfiles.id,moved));}
 },
});

async function prepareExternalErasure(profileId:string,requestId:string,service:ServiceContext){
 const prepare=getService("subscriptions.prepareMerchantTaxErasure");
 if(!prepare)throw new ServiceError("conflict","Original billing schedule recovery is required before minimizing a merchant's tax policy.");
 const result=await service.callAsSystem(prepare,{profileId,requestId});
 return z.object({pendingJobs:z.array(z.string().min(1))}).parse(result).pendingJobs;
}
async function minimize(tx:Tx,profileId:string){
 await allowMerchantTaxWrites(tx,true);
 const[profile]=await tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,profileId)).limit(1).for("update");
 if(!profile||profile.state==="erased")return 0;
 const now=new Date();
 const versions=await tx.update(merchantTaxProfileVersions).set({origin:{},rulesSnapshot:[],nonCollectionReason:null,merchantName:null,merchantSupport:null,erasedAt:now}).where(and(eq(merchantTaxProfileVersions.profileId,profileId),sql`${merchantTaxProfileVersions.erasedAt} is null`)).returning({id:merchantTaxProfileVersions.id});
 await tx.delete(taxRegistrations).where(eq(taxRegistrations.merchantProfileId,profileId));
 await tx.update(taxExemptions).set({certificateRef:null,status:"revoked"}).where(eq(taxExemptions.merchantProfileId,profileId));
 await tx.update(merchantTaxProfiles).set({state:"erased",contactId:null,erasedAt:now}).where(eq(merchantTaxProfiles.id,profileId));
 return versions.length+1;
}
export const completeMerchantTaxErasure=defineService({
 name:"invoicing.completeMerchantTaxErasure",summary:"Minimize the original merchant tax declaration after actual billing schedules are quiescent.",kind:"mutation",permission:"system",external:false,
 input:z.object({profileId:z.uuid(),requestId:z.uuid(),jobId:z.uuid()}),output:z.object({affected:z.number().int().nonnegative(),pendingJobs:z.array(z.uuid()),settled:z.boolean(),recoveryRequired:z.boolean()}),
 auditInputFields:["profileId","requestId","jobId"],
 handler:async({profileId,requestId,jobId},ctx)=>{
  await lockContactIdentity(ctx.tx);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${requestId}`}))`);
  const[request]=await ctx.tx.select().from(dataRequests).where(eq(dataRequests.id,requestId)).limit(1).for("update");
  const[profile]=await ctx.tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,profileId)).limit(1);
  if(!request||request.kind!=="erasure"||!profile||!request.verifiedAt||!["in_progress","completed","partially_completed"].includes(request.status)||profile.state!=="erased"&&profile.contactId!==request.contactId)throw new ServiceError("permission","That original tax business is not owned by this applied verified erasure request.");
  const[artifact]=await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,requestId)).limit(1).for("update");
  const receipt=z.object({format:z.literal("freeholder.erasure-receipt"),outcomes:z.array(z.object({scope:z.string(),outcome:z.string(),pendingJobs:z.array(z.uuid()).optional()}).passthrough())}).passthrough().safeParse(artifact?.body);
  const outcome=receipt.success?receipt.data.outcomes.find(item=>item.scope===scope):undefined;
  if(!erasureArtifactIsIntact(artifact)||!receipt.success||!outcome){
   // The actual running task remains debt. On a bad artifact the shared
   // reopen operation commits recovery state without inventing another task.
   await ctx.callAsSystem(reopenErasureJob,{requestId,scope,jobName:MERCHANT_TAX_ERASURE_JOB,jobData:{profileId},idempotencyKey:`merchant-tax-artifact:${jobId}`});
   return{affected:0,pendingJobs:[jobId],settled:false,recoveryRequired:true};
  }
  if(outcome.outcome==="erased"&&profile.state==="erased")return{affected:0,pendingJobs:[],settled:true,recoveryRequired:false};
  if(outcome.outcome!=="pending"||!outcome.pendingJobs?.includes(jobId))return{affected:0,pendingJobs:[jobId],settled:false,recoveryRequired:true};
  const[hold]=await ctx.tx.select({id:privacyRetentionExceptions.id}).from(privacyRetentionExceptions).innerJoin(dataRequests,eq(dataRequests.id,privacyRetentionExceptions.dataRequestId)).where(and(eq(dataRequests.contactId,request.contactId),eq(privacyRetentionExceptions.scope,scope),or(isNull(privacyRetentionExceptions.expiresAt),gt(privacyRetentionExceptions.expiresAt,new Date())))).limit(1);
  if(hold)return{affected:0,pendingJobs:[jobId],settled:false,recoveryRequired:false};
  const pendingJobs=await prepareExternalErasure(profileId,requestId,ctx);
  if(pendingJobs.length)return{affected:0,pendingJobs,settled:false,recoveryRequired:false};
  const affected=await minimize(ctx.tx,profileId);
  await ctx.callAsSystem(completeErasureJob,{requestId,scope,jobId});
  ctx.setSubject("dataRequest",requestId);
  return{affected,pendingJobs:[],settled:true,recoveryRequired:false};
 },
});
registerContactPrivacySource({
 scope,tables:["merchant_tax_profiles"],requiresLogin:true,eraseOrder:35,
 exportData:async(tx,contactId)=>{
  const profiles=await tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.contactId,contactId));
  const ids=profiles.map(profile=>profile.id);
  return{profiles,versions:ids.length?await tx.select().from(merchantTaxProfileVersions).where(inArray(merchantTaxProfileVersions.profileId,ids)):[],registrations:ids.length?await tx.select().from(taxRegistrations).where(inArray(taxRegistrations.merchantProfileId,ids)):[]};
 },
 erase:async(tx,contactId,context)=>{
  const profiles=await tx.select({id:merchantTaxProfiles.id}).from(merchantTaxProfiles).where(eq(merchantTaxProfiles.contactId,contactId));
  if(!profiles.length)return{affected:0,pendingJobs:[]};
  if(!context.service)throw new ServiceError("conflict","Merchant tax erasure needs the actual shared privacy service context.");
  let affected=0;const pendingJobs:string[]=[];
  for(const profile of profiles){const pending=await prepareExternalErasure(profile.id,context.requestId,context.service);pendingJobs.push(...pending);if(!pending.length)affected+=await minimize(tx,profile.id);}
  return{affected,pendingJobs:[...new Set(pendingJobs)]};
 },
});
