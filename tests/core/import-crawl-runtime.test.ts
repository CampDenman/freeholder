// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: real bootstrap, current owner sessions and actual TCP recovery phases.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { storage, resetStorageForTests } from "@/adapters/storage";
import * as transport from "@/core/http/pinned-download";
import { startImport, previewFromUrl } from "@/core/import/service";
import { advanceCrawl } from "@/core/import/crawl-advance";
import { acceptCrawlObject } from "@/core/import/crawl-capture";
import { crawlProgress } from "@/core/import/crawl-query";
import { recoverCrawlResponse, restartCrawlReview } from "@/core/import/crawl-recovery";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "@/core/import/crawl-schema";
import { resolveContact } from "@/core/contacts/service";
import { addRetentionException, createDataRequest } from "@/core/privacy/service";
import { privacyRetentionSourceMembers, privacyRetentionSourceSnapshots } from "@/core/privacy/retention-schema";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

let server: Server | undefined;
const requests: string[] = [];
async function actualSite() {
  server = createServer((request, response) => {
    requests.push(request.url!); response.setHeader("content-type", request.url === "/robots.txt" ? "text/plain" : "text/html");
    response.end(request.url === "/robots.txt" ? "User-agent: *\nAllow: /" : "<title>Actual recovery original</title><main>Unchanged saved original.</main>");
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const original = transport.requestPinnedBytes;
  vi.spyOn(transport, "requestPinnedBytes").mockImplementation((raw, options) => original(raw, { ...options, allowLocal: true, lookup: async () => [{ address: "127.0.0.1", family: 4 }] }));
  return `http://fictional-live-recovery.example:${(server.address() as AddressInfo).port}/`;
}
async function actualOwner(id = randomUUID()) {
  await db().insert(users).values({ id, email: `fictional-crawl-recovery-${id}@example.test`, role: "owner" });
  await db().insert(totpFactors).values({ userId: id, encryptedSecret: "fictional-recovery-enrolled-factor" });
  return freshOwnerSession(id);
}
async function freshOwnerSession(id: string) {
  const session = await db().transaction(tx => createSession(tx, id, { twoFactorVerified: true }));
  const actor = await actorFromToken(session.token);
  if (actor.kind !== "user" || !actor.sessionId || !actor.security?.stepUpValid) throw new Error("The fixture did not resolve its real freshly verified owner.");
  return actor;
}

describe.runIf(hasDatabase)("ordinary saved-source runtime and actual owner recovery (C3.47)", () => {
  beforeAll(ready);
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); requests.length = 0; });
  afterEach(async () => { vi.restoreAllMocks(); if (server) { const current = server; server = undefined; await new Promise<void>((resolve, reject) => current.close(error => error ? reject(error) : resolve())); } });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("accepts only settled exact originals through a new verified owner after the actual failed wrapper finishes", async () => {
    const originalOwner = await actualOwner(), site = await actualSite();
    const run = await startImport.call({ origin: site, kind: "html" }, originalOwner);
    await previewFromUrl.call({ id: run.id, url: `${site}original` }, originalOwner);
    expect(requests).toEqual([]);
    const initial = await crawlProgress.call({ id: run.id }, originalOwner);
    const apply = vi.spyOn(acceptCrawlObject, "call").mockRejectedValueOnce(new Error("Synthetic lost domain acceptance after actual settled PUT"));
    await expect(advanceCrawl.call({ id: run.id, generation: initial.generation }, originalOwner)).rejects.toMatchObject({ code: "conflict" });
    apply.mockRestore();
    const [before] = await db().select().from(importCrawlResponses);
    expect(before).toMatchObject({ state: "put_unknown", executorIdentity: { kind: "user", id: originalOwner.userId } });
    expect(before!.wrapperFinishedAt).toBeInstanceOf(Date);
    const body = await storage().get(before!.storageKey!); expect(body).toBeDefined();
    const owner = await actualOwner();
    expect(owner.userId).not.toBe(originalOwner.userId);
    const progress = await crawlProgress.call({ id: run.id }, owner);
    expect(progress).toMatchObject({ recoveryRequired: true, recoveryResponseId: before!.id });
    await expect(recoverCrawlResponse.call({ id: run.id, generation: initial.generation, responseId: before!.id, confirmation: "VERIFY ORIGINAL RESPONSE" }, owner)).resolves.toEqual({ recovered: true });
    const [after] = await db().select().from(importCrawlResponses).where(eq(importCrawlResponses.id, before!.id));
    expect(after).toMatchObject({ state: "stored", executorIdentity: before!.executorIdentity, claimedBy: before!.claimedBy, storageKey: before!.storageKey, storageNamespace: before!.storageNamespace, facts: before!.facts, wrapperFinishedAt: before!.wrapperFinishedAt });
    expect(await storage().get(before!.storageKey!)).toEqual(body);
    expect(requests).toEqual(["/robots.txt"]);
    expect((await db().select().from(importCrawlRequests))[0]).toMatchObject({ state: "accepted", acceptedResponseId: before!.id });
    await expect(advanceCrawl.call({ id: run.id, generation: initial.generation }, owner)).resolves.toMatchObject({ step: "discovered" });
  }, 30_000);

  it("starts a distinct explicitly reviewed generation after expiry without adopting the old generation's hold or bytes", async () => {
    const owner = await actualOwner(), site = await actualSite();
    const run = await startImport.call({ origin: site, kind: "html" }, owner);
    await previewFromUrl.call({ id: run.id, url: `${site}original` }, owner);
    const progress = await crawlProgress.call({ id: run.id }, owner);
    for (let phase = 0; phase < 6; phase++) await advanceCrawl.call({ id: run.id, generation: progress.generation }, owner);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    const originalRows = await db().select().from(importCrawlResponses);
    const originalBytes = await Promise.all(originalRows.map(row => storage().get(row.storageKey!)));
    const reader = (await resolveContact.call({ email: "fictional-restart-original-reader@example.test" }, owner)).contact;
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, owner);
    const hold = await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic actual original generation held before explicit new review" }, owner);
    const members = await db().select().from(privacyRetentionSourceMembers), headers = await db().select().from(privacyRetentionSourceSnapshots);
    // All GET/PUT wrappers already returned. Model only the expiry window;
    // this clock shift is not stopped-writer evidence or a provider receipt.
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(source!.expiresAt.getTime() + 1_000);
    try {
      const currentOwner = await freshOwnerSession(owner.userId);
      expect((await crawlProgress.call({ id: run.id }, currentOwner)).expired).toBe(true);
      const created = await restartCrawlReview.call({ id: run.id, generation: progress.generation, origin: site, url: `${site}reviewed-new-original`, confirmation: "START NEW SOURCE REVIEW" }, currentOwner);
      expect(created.id).not.toBe(run.id); expect(created.generation).not.toBe(progress.generation);
      const [newSource] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, created.id));
      expect(newSource).toMatchObject({ recoveryOfSourceId: source!.id, sourceUrl: `${site}reviewed-new-original`, state: "discovering", capturedBytes: 0 });
      expect(await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, source!.id))).toEqual([source]);
      expect(await db().select().from(importCrawlResponses)).toEqual(originalRows);
      expect(await Promise.all(originalRows.map(row => storage().get(row.storageKey!)))).toEqual(originalBytes);
      expect(await db().select().from(privacyRetentionSourceMembers)).toEqual(members);
      expect(await db().select().from(privacyRetentionSourceSnapshots)).toEqual(headers);
      expect(members).toMatchObject([{ exceptionId: hold.id, sourceId: source!.id, generation: source!.generation }]);
      const [facts] = await db().execute<{ old_held: boolean; new_held: boolean }>(sql`select freeholder_crawl_source_held(${source!.id}::uuid,${source!.generation}::uuid) as old_held,freeholder_crawl_source_held(${newSource!.id}::uuid,${newSource!.generation}::uuid) as new_held`);
      expect(facts).toEqual({ old_held: true, new_held: false });
      expect(requests).toEqual(["/robots.txt", "/original"]);
    } finally { vi.useRealTimers(); }
  }, 30_000);
});
