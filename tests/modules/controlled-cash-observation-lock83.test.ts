// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual PG lock encoding/transaction lifetime, no financial row
// or fake parent authority. Checks both signed hash domains and foreign keys.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService } from "@/core/service";
import { requireHeldControlledCashResource } from "@/modules/invoicing/controlled-cash-inspection-observation-context";
import { closeDb,hasDatabase } from "../helpers/spine";
const probe=defineService({name:"invoicing.testObservationHeldResource83",summary:"Check the actual held controlled resource key without granting any financial operation.",kind:"query",permission:"system",external:false,
 input:z.object({resourceId:z.uuid(),hold:z.enum(["none","resource","foreign","resource_without_contact"])}),output:z.literal(true),handler:async(input,ctx)=>{if(input.hold!=="resource_without_contact")await lockContactIdentityForRead(ctx.tx);if(input.hold!=="none")await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.hold!=="foreign"?"controlled-provider:":"payment:"}${input.resourceId}`}))`);await requireHeldControlledCashResource(ctx,input.resourceId);return true as const;}});
describe.runIf(hasDatabase)("real controlled cash observation resource lock ownership",{timeout:60000},()=>{
 beforeAll(ready,60000);afterAll(async()=>{await stopJobs();await closeDb();});
 it("accepts only this actual controlled namespace in this transaction for positive and negative bigint key halves",async()=>{
  const candidates=await db().execute<{id:string;negative:boolean}>(sql`select distinct on (hashtext('controlled-provider:'||c.id)<0) c.id,hashtext('controlled-provider:'||c.id)<0 as negative from (select '00000000-0000-4000-8000-'||lpad(n::text,12,'0') as id from generate_series(1,1000) n) c order by (hashtext('controlled-provider:'||c.id)<0),c.id`);
  expect(candidates.map(row=>row.negative).sort()).toEqual([false,true]);
  for(const candidate of candidates){const source={resourceId:candidate.id};await expect(probe.call({...source,hold:"none"},{kind:"system"})).rejects.toMatchObject({code:"conflict"});await expect(probe.call({...source,hold:"foreign"},{kind:"system"})).rejects.toMatchObject({code:"conflict"});await expect(probe.call({...source,hold:"resource_without_contact"},{kind:"system"})).rejects.toMatchObject({code:"conflict"});expect(await probe.call({...source,hold:"resource"},{kind:"system"})).toBe(true);await expect(probe.call({...source,hold:"none"},{kind:"system"})).rejects.toMatchObject({code:"conflict"});}
 });
});
