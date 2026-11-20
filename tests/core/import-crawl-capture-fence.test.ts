// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: an ordinary writer cannot claim a missing HTTP hold collector ran.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { resolveContact } from "@/core/contacts/service";
import { stopJobs } from "@/core/jobs";
import { initializeCrawl } from "@/core/import/crawl-capture";
import { importCrawlResponses, importCrawlSources } from "@/core/import/crawl-schema";
import { startImport } from "@/core/import/service";
import { addRetentionException, createDataRequest } from "@/core/privacy/service";
import { privacyRetentionExceptions } from "@/core/privacy/schema";
import { privacyRetentionSourceMembers, privacyRetentionSourceSnapshots } from "@/core/privacy/retention-schema";
import { actorString } from "@/core/service";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

// Normal bootstrap now registers the real collector. The direct old-writer
// SQL negative cannot invoke it; the ordinary actual service positive must.
describe.runIf(hasDatabase)("actual HTTP collector compatibility fence (C3.47)", () => {
  beforeEach(truncateSpine);
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("refuses an uncaptured old-writer hold and captures the generation through ordinary runtime bootstrap", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "fictional-no-http-collector-owner@example.test", role: "owner" });
    await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-no-http-collector-factor" });
    const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
    const owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The actual owner session did not resolve.");
    const origin = "https://fictional-missing-http-collector.example/";
    const run = await startImport.call({ kind: "html", origin }, owner);
    await initializeCrawl.call({ id: run.id, url: `${origin}original` }, owner);
    const [original] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    expect(original).toMatchObject({ siteUrl: origin, sourceUrl: `${origin}original`, state: "discovering", capturedBytes: 0, requestCounter: 1 });
    const reader = (await resolveContact.call({ email: "fictional-no-http-collector-reader@example.test" }, owner)).contact;
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, owner);
    let failure: unknown;
    try {
      await db().transaction(async tx => {
        await tx.insert(privacyRetentionExceptions).values({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic actual old SQL writer without collector", createdBy: actorString(owner) });
      });
    } catch (error) { failure = error; }
    const causes: Array<{ code?: string; message?: string }> = [];
    for (let error = failure, depth = 0; error && depth < 8; depth++) {
      causes.push(error);
      error = (error as { cause?: unknown }).cause;
    }
    expect(causes.some(error => error.code === "55000" && /actual hold capture receipt/.test(error.message ?? "")), JSON.stringify(causes)).toBe(true);
    expect(await db().select().from(privacyRetentionExceptions).where(eq(privacyRetentionExceptions.dataRequestId, request.id))).toEqual([]);
    expect(await db().select().from(privacyRetentionSourceSnapshots)).toEqual([]);
    expect(await db().select().from(privacyRetentionSourceMembers)).toEqual([]);
    expect(await db().select().from(importCrawlResponses)).toEqual([]);
    expect(await db().select().from(importCrawlSources).where(and(eq(importCrawlSources.id, original!.id), eq(importCrawlSources.generation, original!.generation)))).toEqual([original]);
    const saved = await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic actual bootstrap collector positive" }, owner);
    expect(await db().select().from(privacyRetentionSourceSnapshots).where(eq(privacyRetentionSourceSnapshots.exceptionId, saved.id))).toMatchObject([{ sourceScope: "imports.readerSources", captureVersion: 1, memberCount: 1 }]);
    expect(await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId, saved.id))).toMatchObject([{ sourceId: original!.id, generation: original!.generation, sourceScope: "imports.readerSources" }]);
  });
});
