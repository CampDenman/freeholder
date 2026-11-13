// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: reuse the actual old80-refused verified request; never reset/infer history.
import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ready } from "@/core/runtime";
import { registerJob, stopJobs } from "@/core/jobs";
import { auditLog } from "@/core/events/schema";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { erasureArtifactIsIntact, fulfillDataRequest } from "@/core/privacy/service";
import { importCrawlErasureScopes, importCrawlErasureSources } from "@/core/import/crawl-erasure-schema";
import { importCrawlResponseErasures, importCrawlResponses, importCrawlSources } from "@/core/import/crawl-schema";
import { crawlJobs } from "@/core/import/crawl-jobs";
import { CRAWL_ERASURE_SCOPE, registerCrawlPrivacy } from "@/core/import/crawl-privacy";
import { OWNER, closeDb, hasDatabase } from "../helpers/spine";

describe.runIf(hasDatabase)("actual current empty HTTP original capture", () => {
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL!).pathname !== "/freeholder_crawl81_current_terms_syntax_test_20261112_v7") throw new Error("Only the actual paired old-empty v7 request is admissible.");
    await ready(); registerCrawlPrivacy(); for (const job of crawlJobs) registerJob(job);
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("completes a real initial empty capture for the unchanged old-refused verified request", async () => {
    expect(await db().select().from(importCrawlSources)).toEqual([]);
    expect(await db().select().from(importCrawlResponses)).toEqual([]);
    expect(await db().select().from(importCrawlErasureScopes)).toEqual([]);
    expect(await db().select().from(importCrawlErasureSources)).toEqual([]);
    const requests = await db().select().from(dataRequests);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request).toMatchObject({ kind: "erasure", status: "verified", verificationMethod: "Synthetic actual old80 empty-scope subject verification" });
    expect(request.verifiedAt).toBeInstanceOf(Date);
    expect(await db().select().from(dataRequestArtifacts)).toEqual([]);
    expect(await db().select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, "contacts.fulfillDataRequest"), eq(auditLog.subjectType, "dataRequest"), eq(auditLog.subjectId, request.id)))).toEqual([]);
    const [ownerRow] = await db().select({ id: users.id, role: users.role }).from(users).where(eq(users.id, OWNER.userId));
    expect(ownerRow?.role).toBe("owner");
    const session = await db().transaction(tx => createSession(tx, ownerRow!.id, { twoFactorVerified: true }));
    const owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The actual synthetic current owner session is unavailable.");
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, owner);
    expect(result.request).toMatchObject({ id: request.id, status: "completed" });
    expect(await db().select().from(importCrawlErasureScopes)).toMatchObject([{ requestId: request.id, captureVersion: 1, sourceCount: 0, responseCount: 0 }]);
    expect(await db().select().from(importCrawlErasureSources)).toEqual([]);
    expect(await db().select().from(importCrawlResponseErasures)).toEqual([]);
    expect(await db().execute(sql`select freeholder_crawl_erasure_scope_complete(${request.id}::uuid) as complete`)).toEqual([{ complete: true }]);
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
    expect(erasureArtifactIsIntact(artifact)).toBe(true);
    const receipt = artifact!.body as { outcomes: Array<{ scope: string; outcome: string; pendingJobs?: string[] }> };
    const outcome = receipt.outcomes.find(row => row.scope === CRAWL_ERASURE_SCOPE);
    expect(outcome).toMatchObject({ outcome: "erased" });
    expect(outcome?.pendingJobs ?? []).toEqual([]);
    expect(await db().execute(sql`select count(*)::integer as count from media_object_writes`)).toEqual([{ count: 0 }]);
    expect(await db().execute(sql`select count(*)::integer as count from media_objects`)).toEqual([{ count: 0 }]);
    if (process.env.FREEHOLDER_CRAWL_CURRENT_EMPTY_OBSERVATION) await writeFile(process.env.FREEHOLDER_CRAWL_CURRENT_EMPTY_OBSERVATION, JSON.stringify({ requestId: request.id, actualFirstFulfillment: true, originalVerifiedAt: request.verifiedAt, status: result.request.status, captureVersion: 1, sourceCount: 0, responseCount: 0, complete: true, outcome, artifactIntact: erasureArtifactIsIntact(artifact) }, null, 2), { mode: 0o600, flag: "wx" });
  });
});
