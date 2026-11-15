// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual admission/GET barrier/FIN and fresh real-TX journal reads.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {z} from "zod";
import emptyInventoryTypes from "../../deploy/controlled-journal-empty-inventory-types-root-continuation-20261114.json";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import {db} from "@/core/db";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {controlledProviderJournal,assertControlledCallersQuiesced,originalControlledCall} from "@/modules/subscriptions/controlled-provider-proof";
import {prepareControlledProviderCalendar,executeControlledOperation} from "@/modules/subscriptions/controlled-provider-execution";
import {retainControlledProviderResource} from "@/modules/subscriptions/controlled-provider-source";
import {planControlledProviderOperation} from "@/modules/subscriptions/controlled-provider-plan";
import {seedActualProviderSubscription80} from "../helpers/merchant-subscription80";
import {controlledPeriodEdge84} from "../helpers/merchant-controlled-period84";
import {OWNER,closeDb,hasDatabase,truncateSpine} from "../helpers/spine";
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
it("keeps all current-row validation local/synchronous and reverses every exact original predicate/body",()=>{
 const data=z.object({existing:z.array(z.object({path:z.string(),beforeSha256:z.string(),afterSha256:z.string(),wholeBefore:z.string(),finiteChanges:z.array(z.object({afterStart:z.number().int(),afterEnd:z.number().int(),before:z.string(),after:z.string()}))}))}).parse(JSON.parse(readFileSync("deploy/controlled-journal-validation84.source-preservation.json","utf8")));
 for(const item of data.existing){let source=readFileSync(item.path,"utf8");if(item.path===emptyInventoryTypes.files[0].path){const exact=emptyInventoryTypes.files[0];expect(hash(source)).toBe(exact.afterSha256);for(const delta of [...exact.finiteDelta].reverse()){expect(source.split(delta.after)).toHaveLength(2);source=source.replace(delta.after,()=>delta.before);}expect(hash(source)).toBe(exact.beforeSha256);}expect(hash(source)).toBe(item.afterSha256);for(const change of [...item.finiteChanges].reverse()){expect(source.slice(change.afterStart,change.afterEnd)).toBe(change.after);source=source.slice(0,change.afterStart)+change.before+source.slice(change.afterEnd);}expect(source).toBe(item.wholeBefore);expect(hash(source)).toBe(item.beforeSha256);}
 const source=readFileSync("src/modules/subscriptions/controlled-provider-proof.ts","utf8"),pass=source.slice(source.indexOf(" const validatedCalls="),source.indexOf(" for(const origin of chargeOrigins)"));expect(pass).not.toMatch(/\bawait\b|\basync\b|\.then\(/);expect(pass).toContain("validated.operation!==operation||validated.call!==call||validated.finish!==finish||!validated.finished");expect(source).toContain("return finishedWithOriginal(operation,call,finish,originalControlledCall(operation,call))");expect(source).toContain("return stoppedWithOriginal(operation,call,stop,originalControlledCall(operation,call))");expect(source.indexOf("const validatedCalls=")).toBeGreaterThan(source.indexOf("export async function controlledProviderJournal"));
 const queries=z.object({parallelQueries:z.array(z.string()).length(6)}).parse(JSON.parse(readFileSync("deploy/controlled-journal-validation84.source-preservation.json","utf8")));expect(source).toContain("[facts,finishes,stops,verifications,chargeOrigins,closures]=await Promise.all([");for(const query of queries.parallelQueries)expect(source).toContain(query);
});
describe.skipIf(!hasDatabase)("genuine current journal revalidation",()=>{
 let original:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{original?.fixture.cleanup();original=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 it("retains a real unfinished GET, then fresh FIN, and never reuses mutated prior fetched objects",async()=>{
  original=await seedActualProviderSubscription80();let hold=false,actualEdgeRequests=0;const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),edge=controlledPeriodEdge84({extra:async(url,init)=>{actualEdgeRequests++;if(hold&&init.method==="GET"&&url.pathname.startsWith("/v1/subscriptions/sub_")){entered.resolve();await release.promise;}return null;}});vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue(edge.provider);
  const resource=await prepareControlledProviderCalendar.call({subscriptionId:original.accepted.subscription.id},OWNER);await stopJobs();const read=()=>db().transaction(tx=>controlledProviderJournal(tx,resource.resourceId)),first=await read(),requestCount=actualEdgeRequests,again=await read();expect(actualEdgeRequests).toBe(requestCount);expect(again).toEqual(first);expect(first.unfinished).toEqual([]);
  const planned=await planControlledProviderOperation.call({resourceId:resource.resourceId,kind:"read_bootstrap"},{kind:"system"});hold=true;const running=executeControlledOperation(planned.operationId,OWNER);
  try{await Promise.race([entered.promise,running.then(()=>{throw Error("The actual original GET must reach the held edge before completion.");})]);const during=await read(),operation=during.operations.find(row=>row.id===planned.operationId),call=during.calls.find(row=>row.operationId===planned.operationId);if(!operation||!call)throw Error("Require actual committed admission before the provider read.");expect(during.unfinished).toEqual([call.id]);expect(during.finishes.some(row=>row.callId===call.id)).toBe(false);expect(originalControlledCall(operation,call)).not.toBeNull();await expect(db().transaction(tx=>assertControlledCallersQuiesced(tx,resource.resourceId))).rejects.toMatchObject({code:"conflict"});}
  finally{release.resolve();await running;}
  hold=false;const finished=await read(),call=finished.calls.find(row=>row.operationId===planned.operationId),operation=finished.operations.find(row=>row.id===planned.operationId);if(!operation||!call)throw Error("Keep exact actual returned caller ancestry.");expect(finished.unfinished).toEqual([]);expect(finished.finishes.filter(row=>row.callId===call.id)).toHaveLength(1);expect(finished.verifications.filter(row=>row.operationId===operation.id)).toHaveLength(1);expect(finished.revision).not.toBe(first.revision);
  operation.originalRequest={...operation.originalRequest,payload:{mutatedOnlyThisFetchedObject:true}};expect(originalControlledCall(operation,call)).toBeNull();const current=await read();expect(current.revision).toBe(finished.revision);expect(current.operations.find(row=>row.id===operation.id)?.originalRequest).not.toEqual(operation.originalRequest);await expect(db().transaction(tx=>assertControlledCallersQuiesced(tx,resource.resourceId))).resolves.toMatchObject({unfinished:[]});
 },180000);
 it("reads a genuinely empty retained resource, then actual children without stale empty/current reuse",async()=>{
  original=await seedActualProviderSubscription80();let actualEdgeRequests=0;const edge=controlledPeriodEdge84({extra:async()=>{actualEdgeRequests++;return null;}});vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue(edge.provider);const resource=await retainControlledProviderResource.call({subscriptionId:original.accepted.subscription.id},{kind:"system"});
  const empty=await db().transaction(tx=>controlledProviderJournal(tx,resource.resourceId));expect(empty).toMatchObject({operations:[],calls:[],facts:[],finishes:[],stops:[],verifications:[],chargeOrigins:[],closures:[],unfinished:[],count:1});expect(actualEdgeRequests).toBe(0);
  const prepared=await prepareControlledProviderCalendar.call({subscriptionId:original.accepted.subscription.id},OWNER);expect(prepared.resourceId).toBe(resource.resourceId);const populated=await db().transaction(tx=>controlledProviderJournal(tx,resource.resourceId));expect(populated.operations.length).toBeGreaterThan(0);expect(populated.calls.length).toBeGreaterThan(0);expect(populated.finishes).toHaveLength(populated.calls.length);expect(populated.unfinished).toEqual([]);expect(populated.revision).not.toBe(empty.revision);
 },180000);

});
