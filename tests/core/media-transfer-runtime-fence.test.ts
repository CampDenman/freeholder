// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// SOURCE PREPARED, UNRUN: actual PostgreSQL old-session refusal, not owner auth.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseUrl, resetEnvForTests } from "@/core/env";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { boundStorage, resetStorageForTests } from "@/adapters/storage";
import { putWithReceipt } from "@/core/media/write-ledger";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("C1.12/C11.08 cold and warm earlier media-writer ABI", () => {
  let root:string,warm:ReturnType<typeof postgres>;
  const earlier={max:1,connection:{TimeZone:"UTC",options:"-c freeholder.media_runtime_v1=1 -c freeholder.media_transfer_runtime_v1=1"}};
  beforeAll(async()=>{await ready();warm=postgres(databaseUrl(),earlier);expect((await warm`select 1 as connected`)[0]?.connected).toBe(1);},60000);
  beforeEach(async()=>{await truncateSpine();await db().insert(users).values({id:OWNER.userId,email:"media-owner@example.test",role:"owner"});root=await mkdtemp(join(tmpdir(),"freeholder-request-abi-fixture-"));vi.stubEnv("FREEHOLDER_STORAGE","local");vi.stubEnv("LOCAL_STORAGE_ROOT",root);resetEnvForTests();resetStorageForTests();});
  afterEach(async()=>{vi.unstubAllEnvs();resetEnvForTests();resetStorageForTests();await rm(root,{recursive:true,force:true});});
  afterAll(async()=>{await warm?.end({timeout:5});await closeDb();});
  async function refuses(client:ReturnType<typeof postgres>){
    const before=await db().select().from(mediaObjectWrites);
    await expect(client.begin(async tx=>{
      await tx`select set_config('freeholder.media_writes_v1','1',true)`;
      await tx`insert into media_object_writes(operation_kind,object_key,key_digest,storage_namespace,storage_kind,storage_location,sha256,bytes,content_type,actor,state) values('put','synthetic/old-writer.bin',${"a".repeat(64)},${"b".repeat(64)},'s3','{}',${"c".repeat(64)},6,'application/octet-stream','system:synthetic-earlier-writer','started')`;
    })).rejects.toThrow(/verified original request writer/);
    expect(await db().select().from(mediaObjectWrites)).toEqual(before);
  }
  it("refuses a cold process with all earlier media and transfer flags before any intent is admitted",async()=>{const client=postgres(databaseUrl(),earlier);try{await refuses(client);}finally{await client.end({timeout:5});}});
  it("refuses an already-open warm earlier transfer session without treating its connection as stop proof",async()=>{expect((await warm`select current_setting('freeholder.media_transfer_runtime_v1') as earlier`)[0]?.earlier).toBe("1");await refuses(warm);});
  it("admits and retains a genuine new shared writer's exact local fixture bytes and actual finish",async()=>{
    const bytes=new Uint8Array([0,255,13,10,128,0]),captured=await boundStorage();
    await putWithReceipt({key:"synthetic/new-writer.bin",body:bytes,contentType:"application/octet-stream",role:"original"},OWNER,captured);
    const [receipt]=await db().select().from(mediaObjectWrites);
    expect(receipt).toMatchObject({state:"accepted",key:"synthetic/new-writer.bin",namespace:captured.binding.namespace,bytes:6,deletedAt:null});
    expect(receipt?.writerRuntimeId).not.toBeNull();expect(receipt?.writerFinishedAt).toBeInstanceOf(Date);expect(await captured.store.get(receipt!.key)).toEqual(bytes);
  });
});
