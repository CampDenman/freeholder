// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C3.47/C11.08: a dependent-domain failure cannot erase a physical fact.
import { randomUUID } from "node:crypto";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { allowMediaReceiptWrites,objectKeyDigest,observeStorageOperation } from "@/core/media/write-ledger";
import { registerStorageObservationReconciler } from "@/core/media/observation-hooks";
import { closeDb,hasDatabase,truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("physical storage observation commit boundary",()=>{
 let remove:(()=>void)|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{remove?.();remove=undefined;});afterAll(closeDb);
 it("commits the original positive receipt before any dependent callback and preserves it on callback failure",async()=>{
  const id=randomUUID(),key=`test/retained-physical/${id}`;
  // Explicit prior physical-dispatch fixture, not an asserted provider result.
  await db().transaction(async tx=>{
   await allowMediaReceiptWrites(tx);
   await tx.insert(mediaObjectWrites).values({id,operation:"put",key,keyDigest:objectKeyDigest(key),namespace:"a".repeat(64),storageKind:"s3",storageLocation:{endpoint:"https://synthetic.example.test",bucket:"original"},sha256:"b".repeat(64),bytes:3,contentType:"text/plain",actor:"system:observation-fixture",state:"started"});
  });
  const seen:Array<{id:string;state:string;accepted:boolean}>=[];
  remove=registerStorageObservationReconciler("test.committedStorage",async receiptId=>{
   // This read is outside the observer's completed transaction.
   const [row]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,receiptId));
   seen.push({id:receiptId,state:row?.state??"missing",accepted:Boolean(row?.observedAcceptedAt)});
   throw new Error("Synthetic dependent recovery failure with private data");
  });
  await expect(observeStorageOperation(id,true)).rejects.toThrow("The physical storage observation was retained; dependent recovery is still pending.");
  expect(seen).toEqual([{id,state:"accepted",accepted:true}]);
  const [retained]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,id));
  expect(retained).toMatchObject({state:"accepted",key,namespace:"a".repeat(64),sha256:"b".repeat(64),bytes:3});
  expect(retained!.observedAcceptedAt).not.toBeNull();
  remove();remove=undefined;
  await observeStorageOperation(id,false);
  const [after]=await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,id));
  expect(after!.state).toBe("accepted");expect(after!.observedAcceptedAt).toEqual(retained!.observedAcceptedAt);
 });
});
