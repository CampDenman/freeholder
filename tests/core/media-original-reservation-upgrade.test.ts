// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED, UNRUN. Requires a genuine ordinary0-81 BEFORE reservation
// from the separate fixture SQL, then final82 in that SAME fresh database.
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {resetEnvForTests} from "@/core/env";
import {resetStorageForTests} from "@/adapters/storage";
import {mediaObjects,mediaUploads} from "@/core/media/schema";
import {beginUpload} from "@/core/media/service";
import {allowMediaReceiptWrites} from "@/core/media/write-ledger";
import {ordinaryMediaRecoveryProvider} from "../helpers/media-original-provider-recovery";
import {closeDb,failure,hasDatabase,OWNER} from "../helpers/spine";
const legacyKey="upgrade/original-media-birth-before82.bin",prepared=process.env.FREEHOLDER_TEST_MEDIA_LEGACY_BEFORE82==="true";
describe.runIf(hasDatabase&&prepared)("C1.12/C11.08 genuine pre82 legacy NULL reservation upgrade prerequisite",()=>{
 let provider:Awaited<ReturnType<typeof ordinaryMediaRecoveryProvider>>;
 beforeAll(async()=>{await ready();await stopJobs();await db().insert(users).values({id:OWNER.userId,email:"birth-upgrade-owner@example.test",role:"owner"}).onConflictDoNothing();provider=await ordinaryMediaRecoveryProvider();for(const[name,value]of Object.entries({NODE_ENV:"test",FREEHOLDER_STORAGE:"s3",S3_ENDPOINT:provider.endpoint,S3_REGION:"fixture",S3_BUCKET:"source",S3_ACCESS_KEY_ID:"synthetic",S3_SECRET_ACCESS_KEY:"synthetic",FREEHOLDER_STORAGE_QUOTA_BYTES:"100",FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY:"false"}))vi.stubEnv(name,value);resetEnvForTests();resetStorageForTests();},60000);
 afterAll(async()=>{await provider?.close();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();await closeDb();});
 it("preserves a genuine old NULL through ordinary82 and refuses random or authentic newer target-reservation adoption without provider IO",async()=>{
  const[before]=await db().select().from(mediaObjects).where(eq(mediaObjects.key,legacyKey));expect(before).toBeTruthy();expect(before?.reservationId).toBeNull();
  expect(await failure(db().transaction(async tx=>{await allowMediaReceiptWrites(tx);return tx.update(mediaObjects).set({reservationId:randomUUID()}).where(eq(mediaObjects.key,legacyKey));}))).toMatchObject({cause:{code:"23514"}});
  const tracked=await beginUpload.call({filename:"tracked.png",contentType:"image/png",bytes:1},OWNER),[upload]=await db().select().from(mediaUploads).where(eq(mediaUploads.id,tracked.id)),[pointer]=await db().select().from(mediaObjects).where(eq(mediaObjects.uploadId,tracked.id));expect(tracked.strategy).toBe("proxy");expect(upload).toBeTruthy();expect(pointer?.reservationId).toBeTruthy();
  expect(await failure(db().transaction(async tx=>{await allowMediaReceiptWrites(tx);return tx.update(mediaObjects).set({reservationId:pointer!.reservationId}).where(eq(mediaObjects.key,legacyKey));}))).toMatchObject({cause:{code:"23514"}});
  expect((await db().select().from(mediaObjects).where(eq(mediaObjects.key,legacyKey)))[0]).toEqual(before);expect(provider.calls).toEqual([]);
 },60000);
});
