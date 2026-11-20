// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C3.47: actual independent process, real fresh session, persisted public phase.
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {afterAll,expect,it,vi} from "vitest";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {db,closeDb} from "@/core/db";
import {createSession} from "@/core/auth/sessions";
import {actorFromToken} from "@/core/http/actor";
import {advanceCrawl} from "@/core/import/crawl-advance";
import {crawlProgress} from "@/core/import/crawl-query";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import * as transport from "@/core/http/pinned-download";

afterAll(async()=>{await stopJobs();await closeDb();});
it("continues an actual saved HTTP index with no producer state or migration",async()=>{
  const id=z.uuid().parse(process.env.FREEHOLDER_CRAWL_INDEX_RUN_ID),generation=z.uuid().parse(process.env.FREEHOLDER_CRAWL_INDEX_GENERATION),userId=z.uuid().parse(process.env.FREEHOLDER_CRAWL_INDEX_USER_ID);
  const phase=z.enum(["prefix500","finish501"]).parse(process.env.FREEHOLDER_CRAWL_INDEX_PHASE),output=z.string().min(1).parse(process.env.FREEHOLDER_CRAWL_INDEX_OUTPUT);
  const source=JSON.parse(await readFile("db/migrations/meta/_journal.json","utf8")) as {entries:Array<{idx:number;when:number;tag:string}>};
  expect(source.entries.some(entry=>entry.idx===81&&entry.tag==="0081_import_crawl_sources")).toBe(true);
  const expected=[];
  for(const entry of source.entries)expected.push({stamp:String(entry.when),hash:createHash("sha256").update(await readFile(`db/migrations/${entry.tag}.sql`)).digest("hex")});
  const before=await db().execute<{stamp:string;hash:string}>(sql`select created_at::text stamp,hash from drizzle.__drizzle_migrations order by created_at`);
  expect([...before]).toEqual(expected);
  await ready();
  const session=await db().transaction(tx=>createSession(tx,userId,{twoFactorVerified:true}));
  const actor=await actorFromToken(session.token);
  if(actor.kind!=="user"||!actor.sessionId)throw new Error("The persisted owner did not resolve through a real fresh session.");
  const download=vi.spyOn(transport,"requestPinnedBytes").mockRejectedValue(new Error("A saved index phase must use its actual stored originals, not fetch again."));
  const initial=await crawlProgress.call({id},actor);expect(initial.generation).toBe(generation);
  const steps:string[]=[];let progress=initial;
  for(let step=0;step<20;step++){
    if(phase==="prefix500"?progress.indexed===500:progress.planReady)break;
    const result=await advanceCrawl.call({id,generation},actor);steps.push(result.step);
    progress=await crawlProgress.call({id},actor);
  }
  expect(steps).toContain("indexed");
  expect(progress).toMatchObject({generation,indexed:phase==="prefix500"?500:501,planReady:phase==="finish501",requests:8,pending:0,recoveryRequired:false});
  expect(download).not.toHaveBeenCalled();download.mockRestore();
  expect([...(await db().execute(sql`select created_at::text stamp,hash from drizzle.__drizzle_migrations order by created_at`))]).toEqual([...before]);
  await writeFile(output,JSON.stringify({pid:process.pid,runId:id,generation,sessionId:actor.sessionId,beforeIndexed:initial.indexed,indexed:progress.indexed,planReady:progress.planReady,steps,journalUnchanged:true,transportCalls:0})+"\n",{flag:"wx",mode:0o600});
},60_000);
