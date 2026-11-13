// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: no reset/migration; only an explicitly new work clone may be reviewed.
import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ready } from "@/core/runtime";
import { getJob, registerJob, stopJobs } from "@/core/jobs";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { erasureArtifactIsIntact } from "@/core/privacy/service";
import { importCrawlResponseErasures, importCrawlResponses, importCrawlSources } from "@/core/import/crawl-schema";
import { initializeCrawl } from "@/core/import/crawl-capture";
import { startImport } from "@/core/import/service";
import { crawlJobs } from "@/core/import/crawl-jobs";
import { CRAWL_ERASURE_JOB, CRAWL_ERASURE_SCOPE, eraseCrawlOriginals, reconcileCrawlOriginalObservation, registerCrawlPrivacy } from "@/core/import/crawl-privacy";
import { OWNER, closeDb, hasDatabase } from "../helpers/spine";

type Outcome = { scope: string; outcome: string; pendingJobs?: string[] };
function outcomes(body: unknown): Outcome[] {
  if (!body || typeof body !== "object" || !("outcomes" in body) || !Array.isArray(body.outcomes)) throw new Error("The actual original artifact is unavailable.");
  return body.outcomes as Outcome[];
}
const workDatabase = "freeholder_crawl81_index_leak_review_work_test_20261112";
async function historySchemaStamp(): Promise<string> {
  const [row] = await db().execute<{ stamp: string }>(sql`select md5(jsonb_build_object(
    'journal',(select jsonb_agg(jsonb_build_object('hash',hash,'created_at',created_at) order by created_at) from drizzle.__drizzle_migrations),
    'columns',(select jsonb_agg(to_jsonb(item) order by table_schema,table_name,ordinal_position) from (select table_schema,table_name,ordinal_position,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema in ('public','pgboss','drizzle')) item),
    'constraints',(select jsonb_agg(to_jsonb(item) order by schema_name,table_name,name) from (select n.nspname as schema_name,c.relname as table_name,con.conname as name,pg_get_constraintdef(con.oid) as definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','pgboss','drizzle')) item),
    'triggers',(select jsonb_agg(to_jsonb(item) order by schema_name,table_name,name) from (select n.nspname as schema_name,c.relname as table_name,t.tgname as name,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','pgboss','drizzle')) item),
    'functions',(select jsonb_agg(to_jsonb(item) order by name,arguments) from (select p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'freeholder_%') item)
  )::text) as stamp`);
  if (!row?.stamp) throw new Error("The actual historical schema/journal stamp is unavailable.");
  return row.stamp;
}


describe.runIf(hasDatabase)("actual historical HTTP receipt recovery review", () => {
  beforeAll(async () => {
    if (![workDatabase, "freeholder_crawl81_index_leak_review_after_test_20261112"].includes(new URL(process.env.DATABASE_URL!).pathname.slice(1))) throw new Error("Only the explicitly NEW review work clone is allowed; never the golden clone.");
    const beforeReady = await historySchemaStamp();
    await ready();
    const afterReady = await historySchemaStamp();
    if (process.env.FREEHOLDER_CRAWL_HISTORY_PREFLIGHT) await writeFile(process.env.FREEHOLDER_CRAWL_HISTORY_PREFLIGHT, JSON.stringify({ beforeReady, afterReady, unchanged: beforeReady === afterReady }, null, 2), { mode: 0o600, flag: "wx" });
    if (beforeReady !== afterReady) throw new Error("Real readiness changed the historical schema/journal; no domain oracle ran.");
    registerCrawlPrivacy(); for (const job of crawlJobs) registerJob(job);
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("reports missing original completion as recovery and reopens only actual retired membership", async () => {
    const [availability] = await db().execute<{ missing: boolean }>(sql`select to_regclass('public.import_crawl_erasure_scopes') is null and to_regclass('public.import_crawl_erasure_sources') is null as missing`);
    expect(availability?.missing).toBe(true);
    const cohorts = await db().select({ cohort: importCrawlResponseErasures, response: importCrawlResponses }).from(importCrawlResponseErasures).innerJoin(importCrawlResponses, eq(importCrawlResponses.id, importCrawlResponseErasures.responseId));
    expect(cohorts).toHaveLength(2);
    const requestId = cohorts[0]!.cohort.requestId;
    expect(cohorts.every(row => row.cohort.requestId === requestId && row.response.retiredAt && row.response.redactedAt)).toBe(true);
    const [beforeRequest] = await db().select().from(dataRequests).where(eq(dataRequests.id, requestId));
    const [beforeArtifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
    expect(beforeRequest?.status).toBe("completed");
    expect(erasureArtifactIsIntact(beforeArtifact)).toBe(true);
    expect(outcomes(beforeArtifact!.body).find(row => row.scope === CRAWL_ERASURE_SCOPE)).toMatchObject({ outcome: "erased" });
    const originalResponseIds = cohorts.map(row => row.response.id).sort();
    const originalMembers = await db().select({ id: importCrawlSources.id, generation: importCrawlSources.generation }).from(importCrawlSources);
    expect(originalMembers).toHaveLength(1);
    const beforePhysical = await db().execute(sql`select id,operation_kind,state,deleted_at from media_object_writes order by id`);
    expect(await db().execute(sql`select count(*)::integer as count from media_objects`)).toEqual([{ count: 0 }]);

    // The later generation is created through actual owner services on ONLY
    // this new work clone. It must not become an old receipt's inferred scope.
    const [ownerRow] = await db().select({ id: users.id, role: users.role }).from(users).where(eq(users.id, OWNER.userId));
    expect(ownerRow?.role).toBe("owner");
    const session = await db().transaction(tx => createSession(tx, ownerRow!.id, { twoFactorVerified: true }));
    const owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The actual synthetic review owner session is unavailable.");
    const laterRun = await startImport.call({ origin: "https://fictional-later-review.example/", kind: "html" }, owner);
    await initializeCrawl.call({ id: laterRun.id, url: "https://fictional-later-review.example/later-original" }, owner);
    const [laterSource] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, laterRun.id));
    expect(laterSource).toMatchObject({ state: "discovering", sourceUrl: "https://fictional-later-review.example/later-original" });
    expect(laterSource?.generation).toBeTypeOf("string");
    const result = await reconcileCrawlOriginalObservation.call({}, { kind: "system" });
    const [afterRequest] = await db().select().from(dataRequests).where(eq(dataRequests.id, requestId));
    const [afterArtifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
    const outcome = outcomes(afterArtifact!.body).find(row => row.scope === CRAWL_ERASURE_SCOPE)!;
    const jobs = await Promise.all((outcome.pendingJobs ?? []).map(id => getJob(CRAWL_ERASURE_JOB, id)));
    const admittedResponses = jobs.flatMap(job => {
      if (!job?.data || job.data.requestId !== requestId || !Array.isArray(job.data.responseIds)) throw new Error("Only the original request's actual durable job payloads are admissible.");
      return job.data.responseIds as string[];
    }).sort();
    const afterCohorts = await db().select().from(importCrawlResponseErasures);
    const observation = { result, status: afterRequest?.status, originalMembers, laterSourceId: laterSource!.id, originalResponseIds, admittedResponses, cohortCount: afterCohorts.length, completeCaptureMissing: availability?.missing, artifactIntact: erasureArtifactIsIntact(afterArtifact) };
    if (process.env.FREEHOLDER_CRAWL_HISTORY_OBSERVATION) await writeFile(process.env.FREEHOLDER_CRAWL_HISTORY_OBSERVATION, JSON.stringify(observation, null, 2), { mode: 0o600, flag: "wx" });
    expect(afterRequest?.status).toBe("in_progress");
    expect(admittedResponses).toEqual(originalResponseIds);
    expect(afterCohorts.map(row => row.responseId).sort()).toEqual(originalResponseIds);
    expect(result.recoveryRequired, JSON.stringify(observation)).toBeGreaterThan(0);
    // This calls the real registered body on one actual durable payload. A
    // missing original-scope/schema witness must prevent final acknowledgement.
    await expect(eraseCrawlOriginals(jobs[0]!.data)).rejects.toThrow(/recovery|guarded/);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, requestId)))[0]?.status).toBe("in_progress");
    expect(await db().execute(sql`select id,operation_kind,state,deleted_at from media_object_writes order by id`)).toEqual(beforePhysical);
    expect((await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, laterSource!.id)))[0]).toMatchObject({ state: "discovering", generation: laterSource!.generation, sourceUrl: laterSource!.sourceUrl, redactedAt: null });
    expect(await db().execute(sql`select to_regclass('public.import_crawl_erasure_scopes') is null and to_regclass('public.import_crawl_erasure_sources') is null as missing`)).toEqual([{ missing: true }]);
  });
});
