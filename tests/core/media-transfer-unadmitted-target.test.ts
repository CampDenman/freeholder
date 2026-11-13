// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED, UNRUN. Actual shared services and fictional private TCP
// storage. No transport auth, real provider or whole-job completion claim.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createContact } from "@/core/contacts/service";
import { createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { dataRequests } from "@/core/privacy/schema";
import { putWithReceipt } from "@/core/media/write-ledger";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { mediaStorageTransferCalls, mediaStorageTransferObjects } from "@/core/media/transfer-schema";
import { planStorageTransfer } from "@/core/media/transfer-service";
import { eraseStorageTransferLineage } from "@/core/media/transfer-erasure";
import { resetEnvForTests } from "@/core/env";
import { resetStorageForTests } from "@/adapters/storage";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { mediaTransferInventoryProvider } from "../helpers/media-transfer-inventory-provider";
import { closeDb, hasDatabase, OWNER, CUSTOMER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("C1.12/C11.08 foreign target collision is outside original erasure lineage",()=>{
 let provider:Awaited<ReturnType<typeof mediaTransferInventoryProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();},60000);
 beforeEach(async()=>{
  await truncateSpine();await db().insert(users).values([{id:OWNER.userId,email:"owner@example.test",role:"owner"},{id:CUSTOMER.userId,email:"subject@example.test",role:"customer"}]);
  provider=await mediaTransferInventoryProvider();
  for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",MEDIA_TRANSFER_TARGET_STORAGE:"s3",MEDIA_TRANSFER_TARGET_S3_ENDPOINT:provider.endpoint,MEDIA_TRANSFER_TARGET_S3_REGION:"fixture",MEDIA_TRANSFER_TARGET_S3_BUCKET:"target",MEDIA_TRANSFER_TARGET_S3_ACCESS_KEY_ID:"synthetic",MEDIA_TRANSFER_TARGET_S3_SECRET_ACCESS_KEY:"synthetic"}))vi.stubEnv(name,value);
  resetEnvForTests();resetStorageForTests();
 });
 afterEach(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();});afterAll(closeDb);
 it("preserves an identically hashed pre-existing target without reading, adopting or deleting it, while erasing only the actual original source",async()=>{
  const contact=await createContact.call({name:"Original subject",email:"subject@example.test"},OWNER);await db().update(contacts).set({userId:CUSTOMER.userId}).where(eq(contacts.id,contact.id));
  const body=new Uint8Array([0,255,13,10,128,0]),key="private/original.bin";
  await putWithReceipt({key,body,contentType:"application/octet-stream",role:"original"},CUSTOMER);
  const original=(await db().select().from(mediaObjectWrites))[0]!,plan=await planStorageTransfer.call({requestKey:randomUUID(),confirmation:"COPY ADOPT AND RETIRE ORIGINAL STORAGE"},OWNER);
  const object=(await db().select().from(mediaStorageTransferObjects))[0]!,etag='"'+createHash("sha256").update(body).digest("hex")+'"';
  const foreign={body:new Uint8Array(body),type:"application/octet-stream",etag};provider.objects.set(`/target/${object.targetKey}`,foreign);
  const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic exact original subject verification"},OWNER);await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  expect(await eraseStorageTransferLineage.call({id:plan.id,objectId:object.id},{kind:"system"})).toEqual({ok:true});
  expect(provider.objects.get(`/target/${object.targetKey}`)).toEqual(foreign);expect(provider.calls.filter(call=>call.key.startsWith("/target"))).toHaveLength(0);
  expect(provider.objects.has(`/source/${key}`)).toBe(false);
  const calls=await db().select().from(mediaStorageTransferCalls);expect(calls.some(call=>call.kind==="target_put"||call.kind==="privacy_delete")).toBe(false);
  const [retired]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,original.id));expect(retired).toMatchObject({id:original.id,key:original.key,namespace:original.namespace,sha256:original.sha256});expect(retired?.deletedAt).toBeInstanceOf(Date);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).not.toBe("completed");
 },60000);
});
