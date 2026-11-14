// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED, UNRUN. Actual shared capture/queue services + private
// fictional TCP; no actual account, ingress or whole-worker acceptance claim.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq,and} from "drizzle-orm";
import {z} from "zod";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {createContact} from "@/core/contacts/service";
import {dataRequestArtifacts} from "@/core/privacy/schema";
import {createDataRequest,verifyDataRequest,addRetentionException,fulfillDataRequest} from "@/core/privacy/service";
import {ready} from "@/core/runtime";
import {getJob,stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {putWithReceipt} from "@/core/media/write-ledger";
import {mediaOriginalErasureScopes} from "@/core/media/erasure-schema";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {eraseMediaStorageOperations,MEDIA_WRITE_ERASURE_JOB} from "@/core/media/write-privacy";
import {ordinaryMediaRecoveryProvider} from "../helpers/media-original-provider-recovery";
import {closeDb,failure,hasDatabase,OWNER,CUSTOMER,truncateSpine} from "../helpers/spine";
const key="private/later-generation.bin",body=new Uint8Array([0,255,13,10,128,0]);
describe.runIf(hasDatabase)("C1.12/C11.08 first original media capture lifecycle",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRecoveryProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values([{id:OWNER.userId,email:"first-capture-owner@example.test",role:"owner"},{id:CUSTOMER.userId,email:"first-capture-subject@example.test",role:"customer"}]);provider=await ordinaryMediaRecoveryProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function subject(){const contact=await createContact.call({name:"Original first-scope subject",email:"first-capture-subject@example.test"},OWNER);await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,contact.id));return contact;}
 it("keeps an actual first empty hold capture unchanged while a separately verified new request captures the later authentic writer birth",async()=>{
  const contact=await subject(),old=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await addRetentionException.call({dataRequestId:old.id,scope:"media.storageOperations",reason:"legal_obligation",legalBasis:"Fictional first empty original media hold capture."},OWNER);
  const[first]=await db().select().from(mediaOriginalErasureScopes).where(and(eq(mediaOriginalErasureScopes.requestId,old.id),eq(mediaOriginalErasureScopes.scope,"media.storageOperations")));expect(first).toMatchObject({complete:true,membership:{receipts:[],resources:[],reservations:[]}});
  await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},CUSTOMER);const[receipt]=await db().select().from(mediaObjectWrites);expect(receipt?.originalReservationId).toBeTruthy();
  const next=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:next.id,method:"Fictional separately verified original subject"},OWNER);await addRetentionException.call({dataRequestId:next.id,scope:"media.storageOperations",reason:"legal_obligation",legalBasis:"Fictional new request independently captures its authentic current resource."},OWNER);
  expect((await db().select().from(mediaOriginalErasureScopes).where(and(eq(mediaOriginalErasureScopes.requestId,old.id),eq(mediaOriginalErasureScopes.scope,"media.storageOperations"))))[0]).toEqual(first);
  const[newScope]=await db().select().from(mediaOriginalErasureScopes).where(and(eq(mediaOriginalErasureScopes.requestId,next.id),eq(mediaOriginalErasureScopes.scope,"media.storageOperations")));expect(newScope?.membership.receipts).toEqual([expect.objectContaining({id:receipt!.id,reservationId:receipt!.originalReservationId})]);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60000);
 it("refuses a mismatched actual queue payload before provider IO and preserves the first capture/erasure receipt",async()=>{
  const contact=await subject();await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},CUSTOMER);const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Fictional original subject verification"},OWNER);const result=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER),parsed=z.object({outcomes:z.array(z.object({scope:z.string(),pendingJobs:z.array(z.uuid()).optional()}))}).parse(result.artifact.body),jobId=parsed.outcomes.find(row=>row.scope==="media.storageOperations")?.pendingJobs?.[0];expect(jobId).toBeTruthy();
  const job=await getJob(MEDIA_WRITE_ERASURE_JOB,jobId!),queued=z.object({requestId:z.uuid(),originalJobId:z.uuid(),ids:z.array(z.uuid())}).parse(job?.data),before=await db().select().from(mediaOriginalErasureScopes),[artifactBefore]=await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id,result.artifact.id)),calls=provider.calls.length;
  expect((await failure(eraseMediaStorageOperations({...queued,ids:[]}))).message).toContain("queued media erasure payload");expect(provider.calls.length).toBe(calls);expect(await db().select().from(mediaOriginalErasureScopes)).toEqual(before);expect(provider.objects.get(`/source/${key}`)?.body).toEqual(body);expect((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id,result.artifact.id)))[0]).toEqual(artifactBefore);
 },60000);
});
