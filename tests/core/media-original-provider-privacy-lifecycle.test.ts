// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED, UNRUN. Actual shared services/private fictional TCP and
// registered privacy sources. No ingress/account/full-erasure acceptance.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {z} from "zod";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {createContact} from "@/core/contacts/service";
import {createDataRequest,verifyDataRequest,fulfillDataRequest,contactPrivacySources} from "@/core/privacy/service";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {putWithReceipt} from "@/core/media/write-ledger";
import {reconcileStorageOperation} from "@/core/media/write-recovery";
import {mediaObjectWrites} from "@/core/media/write-schema";
import {originalProviderEvidencePending,originalProviderEvidenceVersion} from "@/core/media/original-provider-privacy";
import {ordinaryMediaRecoveryProvider} from "../helpers/media-original-provider-recovery";
import {closeDb,failure,hasDatabase,OWNER,CUSTOMER,truncateSpine} from "../helpers/spine";
const key="private/owned-original.bin",foreignKey="foreign/another-subject-secret-name.bin",body=new Uint8Array([0,255,13,10,128,0]);
const evidence=z.object({callers:z.array(z.object({id:z.uuid()})),inventories:z.array(z.object({id:z.uuid()})),resources:z.array(z.object({inventoryId:z.uuid(),keyDigest:z.string(),entryDigest:z.string()}))}).passthrough();
describe.runIf(hasDatabase)("C1.12/C11.08 exact original provider privacy composition",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRecoveryProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();},60000);
 beforeEach(async()=>{await truncateSpine();await db().insert(users).values([{id:OWNER.userId,email:"privacy-proof-owner@example.test",role:"owner"},{id:CUSTOMER.userId,email:"privacy-proof-subject@example.test",role:"customer"}]);provider=await ordinaryMediaRecoveryProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();});
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 async function fixture(){
  const contact=await createContact.call({name:"Original provider subject",email:"privacy-proof-subject@example.test"},OWNER);await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,contact.id));
  const otherUserId=randomUUID();await db().insert(users).values({id:otherUserId,email:"privacy-proof-foreign@example.test",role:"customer"});const other=await createContact.call({name:"Other original subject",email:"privacy-proof-foreign@example.test"},OWNER);await db().update(contacts).set({userId:otherUserId}).where(eq(contacts.id,other.id));
  await putWithReceipt({key:foreignKey,body,contentType:"application/octet-stream",role:"original"},{kind:"user",userId:otherUserId,role:"customer",grants:[]});
  provider.loseNextSourcePutReply();await failure(putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},CUSTOMER));const[row]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.contactId,contact.id));if(!row?.namespace)throw new Error("Actual original privacy receipt missing");
  return{contact,other,row};
 }
 async function recover(row:typeof mediaObjectWrites.$inferSelect){if(!row.namespace)throw new Error("Original namespace missing");return reconcileStorageOperation.call({id:row.id,expectedUpdatedAt:row.updatedAt.toISOString(),originalNamespace:row.namespace,outcome:"applied",providerFinalReference:"synthetic-original-private-result",providerEvidence:"Fictional exact original provider nonce/full-byte read and complete two-pass inventories.",stoppedWriterEvidence:"Manual text supplies no stop proof; retained actual original caller and physical finishes are required.",confirmation:"ORIGINAL STORAGE OUTCOME CONFIRMED"},OWNER);}
 async function exported(contactId:string){const request=await createDataRequest.call({contactId,request:{kind:"export"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Fictional exact original subject verification"},OWNER);const result=await fulfillDataRequest.call({id:request.id},OWNER);return z.object({sources:z.record(z.string(),z.unknown())}).parse(result.artifact.body).sources;}
 it("exports only exact original proof digests without leaking or adopting foreign resources from the actual global inventory",async()=>{
  const{contact,other,row}=await fixture();await recover(row);const sources=await exported(contact.id),proof=z.object({providerEvidence:evidence}).parse(sources["media.storageOperations"]).providerEvidence;
  expect(proof.callers.length).toBeGreaterThan(0);expect(proof.inventories).toHaveLength(1);expect(proof.resources.length).toBeGreaterThan(0);expect(proof.resources.every(resource=>resource.keyDigest===row.keyDigest)).toBe(true);expect(JSON.stringify(proof)).not.toContain(foreignKey);expect(JSON.stringify(proof)).not.toContain(provider.originalRequestTags.get(`/source/${key}`)!.token);
  const foreignSources=await exported(other.id),foreignProof=z.object({providerEvidence:evidence}).parse(foreignSources["media.storageOperations"]).providerEvidence;expect(foreignProof.callers.length).toBeGreaterThan(0);expect(foreignProof.inventories).toEqual([]);expect(foreignProof.resources).toEqual([]);
  const registered=contactPrivacySources().filter(source=>["media.storageOperations","media.multipartOperations"].includes(source.scope));expect(registered).toHaveLength(2);for(const source of registered)expect(source.tables).toEqual(expect.arrayContaining(["media_storage_transfer_calls","media_storage_transfer_request_observations","media_storage_provider_inventory_entries","storage_quota_objects"]));
  expect(provider.objects.get(`/source/${foreignKey}`)?.body).toEqual(body);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60000);
 it("versions new actual immutable provider facts while preserving the first ACK timestamp and keeping unminimized original evidence pending",async()=>{
  const{row}=await fixture(),before=await db().transaction(tx=>originalProviderEvidenceVersion(tx,{receiptIds:[row.id]}));await recover(row);const after=await db().transaction(tx=>originalProviderEvidenceVersion(tx,{receiptIds:[row.id]})),[retained]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,row.id));
  expect(after).not.toBe(before);expect(retained?.observedAcceptedAt).toEqual(row.observedAcceptedAt);expect(await db().transaction(tx=>originalProviderEvidencePending(tx,{receiptIds:[row.id]}))).toBe(true);expect(provider.calls.filter(call=>call.method==="PUT"&&call.key===`/source/${key}`)).toHaveLength(1);expect(provider.calls.filter(call=>call.method==="DELETE")).toHaveLength(0);
 },60000);
});
