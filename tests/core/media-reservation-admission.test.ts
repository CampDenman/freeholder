// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C1.08: a request paused before physical admission cannot outlive erasure.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {createContact} from "@/core/contacts/service";
import {createDataRequest,verifyDataRequest,fulfillDataRequest} from "@/core/privacy/service";
import {dataRequests} from "@/core/privacy/schema";
import {beginUpload,uploadAsset} from "@/core/media/service";
import {resetStorageForTests,storage} from "@/adapters/storage";
import {resetEnvForTests} from "@/core/env";
import {setMalwareScannerForTests,resetMalwareScannerForTests} from "@/adapters/malware";
import {ready} from "@/core/runtime";
import {closeDb,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const UPLOADER={...OWNER,userId:"00000000-0000-4000-8000-000000000003",role:"customer",grants:[]};
describe.runIf(hasDatabase)("original reservation privacy admission (C1.12)",()=>{
 let root:string,release:(()=>void)|undefined,pending:Promise<unknown>|undefined;
 beforeAll(ready,60000);
 beforeEach(async()=>{
  await truncateSpine();await db().insert(users).values([{id:OWNER.userId,email:"owner@example.test",role:"owner"},{id:UPLOADER.userId,email:"original-uploader@example.test",role:"customer"}]);
  root=mkdtempSync(join(tmpdir(),"freeholder-reservation-admission-"));vi.stubEnv("FREEHOLDER_STORAGE","local");vi.stubEnv("LOCAL_STORAGE_ROOT",root);resetEnvForTests();resetStorageForTests();
 });
 afterEach(async()=>{release?.();await pending;vi.restoreAllMocks();vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();resetMalwareScannerForTests();rmSync(root,{recursive:true,force:true});});
 afterAll(closeDb);
 it("refuses a stale uploader's new physical PUT after erasure completes during scanning",async()=>{
  const contact=await createContact.call({name:"Original uploader",email:"original-uploader@example.test"},OWNER);await db().update(contacts).set({userId:UPLOADER.userId}).where(eq(contacts.id,contact.id));
  const bytes=new Uint8Array(Buffer.from("%PDF-1.7\nSynthetic paused reservation.\n%%EOF\n"));
  const reservation=await beginUpload.call({filename:"original.pdf",contentType:"application/pdf",bytes:bytes.byteLength},UPLOADER);
  let entered!:()=>void;const scanning=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  setMalwareScannerForTests({id:"none",scan:async()=>{entered();await gate;return{status:"clean",engine:"synthetic-paused-scanner"};}});
  const put=vi.spyOn(storage(),"put");pending=uploadAsset.call({filename:"original.pdf",contentType:"application/pdf",bytes,uploadId:reservation.id},UPLOADER).then(()=>({accepted:true}),error=>({error}));
  await scanning;
  const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);await verifyDataRequest.call({id:request.id,method:"Synthetic original uploader verification"},OWNER);await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,request.id)))[0]?.status).toBe("completed");
  release!();await pending;expect(put).not.toHaveBeenCalled();
 });
});
