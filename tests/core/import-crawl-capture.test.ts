// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: real TCP originals and private physical receipts; unpublished81 fixture.
import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { importSourceBatches, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { importCrawlEntryOriginals, importCrawlGraphs } from "@/core/import/crawl-graph-schema";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import * as transport from "@/core/http/pinned-download";
import { stopJobs, registerJob, getJob } from "@/core/jobs";
import { crawlJobs } from "@/core/import/crawl-jobs";
import { resolveContact } from "@/core/contacts/service";
import { addRetentionException, removeRetentionException, createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { dataRequestArtifacts } from "@/core/privacy/schema";
import { privacyRetentionSourceMembers, privacyRetentionSourceSnapshots } from "@/core/privacy/retention-schema";
import { retireExpiredCrawls } from "@/core/import/crawl-retirement";
import { deleteCaptureObjects } from "@/core/media/capture";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { assets } from "@/core/media/schema";
import { ready } from "@/core/runtime";
import { advanceCrawl } from "@/core/import/crawl-advance";
import { initializeCrawl } from "@/core/import/crawl-capture";
import { registerCrawlPrivacy, eraseCrawlOriginals, CRAWL_ERASURE_JOB, CRAWL_ERASURE_SCOPE } from "@/core/import/crawl-privacy";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "@/core/import/crawl-schema";
import { startImport, commitImport, reconcileImport, publishImport, rollbackImport } from "@/core/import/service";
import { pages } from "@/modules/cms/schema";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

let server: Server | undefined;
const originalBody = "<title>Actual original page</title><main>PRIVATE_HTTP_ORIGINAL_BODY</main>";
const observed: Array<{ path: string; host: string | undefined; cookie: string | undefined; authorization: string | undefined }> = [];
async function actualOriginalServer(policy: { status: number; body: string | Uint8Array } = { status: 200, body: "User-agent: *\nAllow: /" }, pageBody = originalBody) {
  server = createServer((request, response) => {
    observed.push({ path: request.url!, host: request.headers.host, cookie: request.headers.cookie, authorization: request.headers.authorization });
    response.setHeader("content-type", request.url === "/robots.txt" ? "text/plain" : "text/html");
    if (request.url === "/robots.txt") response.statusCode = policy.status;
    response.end(request.url === "/robots.txt" ? policy.body : pageBody);
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const site = `http://fictional-actual-crawl.example:${(server.address() as AddressInfo).port}/`;
  if (process.env.FREEHOLDER_CRAWL_SERVER_OBSERVATION) await writeFile(process.env.FREEHOLDER_CRAWL_SERVER_OBSERVATION, JSON.stringify({ port: (server.address() as AddressInfo).port }), { mode: 0o600, flag: "wx" });
  const original = transport.requestPinnedBytes;
  // Production retains its private-address refusal. This test-only lookup
  // sends a real pinned request to the owned loopback server, retaining Host.
  vi.spyOn(transport, "requestPinnedBytes").mockImplementation((raw, options) => original(raw, { ...options, allowLocal: true, lookup: async () => [{ address: "127.0.0.1", family: 4 }] }));
  return site;
}
async function actualOwner() {
  await db().insert(users).values({ id: OWNER.userId, email: "fictional-crawl-operator@example.test", role: "owner" });
  await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-crawl-factor" });
  const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
  const actor = await actorFromToken(session.token);
  if (actor.kind !== "user" || !actor.sessionId) throw new Error("The actual owner session was not resolved.");
  return actor;
}

describe.runIf(hasDatabase)("actual saved HTTP response capture (C3.47)", () => {
  beforeAll(async () => { await ready(); registerCrawlPrivacy(); for (const job of crawlJobs) registerJob(job); });
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); observed.length = 0; });
  afterEach(async () => { vi.restoreAllMocks(); if (server) { const current = server; server = undefined; await new Promise<void>((resolve, reject) => current.close(error => error ? reject(error) : resolve())); } });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("captures actual robots and HTML TCP bodies through their exact private receipt before frontier acceptance", async () => {
    const owner = await actualOwner(), site = await actualOriginalServer(), run = await startImport.call({ origin: site, kind: "html" }, owner);
    await initializeCrawl.call({ id: run.id, url: `${site}original` }, owner);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    const input = { id: run.id, generation: source!.generation };
    expect(await advanceCrawl.call(input, owner)).toMatchObject({ step: "captured" });
    expect(await advanceCrawl.call(input, owner)).toMatchObject({ step: "discovered" });
    expect(await advanceCrawl.call(input, owner)).toMatchObject({ step: "captured" });
    const requests = await db().select().from(importCrawlRequests).where(eq(importCrawlRequests.sourceId, source!.id));
    const page = requests.find(row => row.role === "html")!;
    expect(page.state).toBe("accepted");
    const [response] = await db().select().from(importCrawlResponses).where(eq(importCrawlResponses.id, page.acceptedResponseId!));
    expect(response).toMatchObject({ state: "stored", claimedBy: `user:${owner.userId}`, executorIdentity: { kind: "user", id: owner.userId }, facts: { requestedUrl: `${site}original`, role: "html", bytes: Buffer.byteLength(originalBody) } });
    expect(response!.providerAcceptedAt).toBeInstanceOf(Date);
    expect(new TextDecoder().decode(await storage().get(response!.storageKey!))).toBe(originalBody);
    const receipts = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest, response!.keyDigest));
    expect(receipts).toHaveLength(1); expect(receipts[0]).toMatchObject({ operation: "put", state: "accepted", namespace: response!.storageNamespace, bytes: Buffer.byteLength(originalBody) });
    expect(await deleteCaptureObjects([response!.storageKey!])).toEqual({ deleted: 0 });
    expect(await advanceCrawl.call(input, owner)).toMatchObject({ step: "discovered" });
    expect(await advanceCrawl.call(input, owner)).toMatchObject({ step: "indexed" });
    expect(await advanceCrawl.call(input, owner)).toMatchObject({ step: "previewed" });
    expect(observed).toEqual([{ path: "/robots.txt", host: new URL(site).host, cookie: undefined, authorization: undefined }, { path: "/original", host: new URL(site).host, cookie: undefined, authorization: undefined }]);
    const [saved] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, source!.id));
    expect(saved).toMatchObject({ networkRequests: 2, pageCount: 1, reservedBytes: 0, state: "sealed" });
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    expect(graph).toMatchObject({ generation: source!.generation, sourceRevision: saved!.sourceRevision, state: "indexed", planMetadata: { report: { sourceFormat: "http-originals", indexed: 1 } }, cursor: { format: "http-originals", ordinal: 1, requestOrdinal: 2, physicalBytes: Buffer.byteLength(originalBody) } });
    expect(await db().select().from(importCrawlGraphs).where(eq(importCrawlGraphs.graphId, graph!.id))).toMatchObject([{ sourceId: source!.id, sourceGeneration: source!.generation, sourceRevision: saved!.sourceRevision, entryOrdinal: 1, requestOrdinal: 2, physicalBytes: Buffer.byteLength(originalBody) }]);
    const entries = await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, graph!.id));
    expect(entries).toMatchObject([{ ordinal: 0, kind: "page", startByte: 0, endByte: Buffer.byteLength(originalBody), digest: response!.facts!.digest, metadata: { format: "http-originals", original: { sourceId: source!.id, generation: source!.generation, requestId: page.id, responseId: response!.id } } }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.metadata).not.toHaveProperty("wpId");
    expect(await db().select().from(importCrawlEntryOriginals).where(eq(importCrawlEntryOriginals.entryId, entries[0]!.id))).toMatchObject([{ graphId: graph!.id, requestId: page.id, responseId: response!.id }]);
    expect(JSON.stringify([saved, requests, response, graph, entries])).not.toContain("PRIVATE_HTTP_ORIGINAL_BODY");
  });
  it("prepares the actual complete catalog when a saved404 robots error body is non-text", async () => {
    const owner = await actualOwner(), site = await actualOriginalServer({ status: 404, body: new Uint8Array([255, 0, 254]) });
    const run = await startImport.call({ origin: site, kind: "html" }, owner);
    await initializeCrawl.call({ id: run.id, url: `${site}original` }, owner);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    const input = { id: run.id, generation: source!.generation };
    const steps = [];
    for (let phase = 0; phase < 6; phase++) steps.push((await advanceCrawl.call(input, owner)).step);
    expect(steps).toEqual(["captured", "discovered", "captured", "discovered", "indexed", "previewed"]);
    const [saved] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, source!.id));
    const [policy] = await db().select().from(importCrawlResponses).where(eq(importCrawlResponses.id, saved!.robotsResponseId!));
    expect(policy).toMatchObject({ facts: { status: 404, bytes: 3 } });
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    expect(graph).toMatchObject({ state: "indexed", planMetadata: { report: { sourceFormat: "http-originals", indexed: 1 } } });
    expect(observed.map(request => request.path)).toEqual(["/robots.txt", "/original"]);
  });

  it("commits actual response ranges through the real child ledger and preserves publication rollback ownership", async () => {
    const owner = await actualOwner(), site = await actualOriginalServer();
    const run = await startImport.call({ origin: site, kind: "html" }, owner);
    await initializeCrawl.call({ id: run.id, url: `${site}original` }, owner);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    for (let phase = 0; phase < 6; phase++) await advanceCrawl.call({ id: run.id, generation: source!.generation }, owner);
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    const version = { generation: graph!.generation, sourceRevision: graph!.sourceRevision, planRevision: graph!.planRevision };
    const committed = await commitImport.call({ id: run.id, graph: version }, owner);
    expect(committed).toMatchObject({ status: "committed", counts: { pages: 1, media: 0 } });
    expect(await commitImport.call({ id: run.id, graph: version }, owner)).toMatchObject({ id: run.id, status: "committed", counts: { pages: 1 } });
    const [page] = await db().select().from(pages).where(eq(pages.slug, "original"));
    expect(page).toMatchObject({ status: "draft" });
    expect(JSON.stringify(page!.blocks)).toContain("PRIVATE_HTTP_ORIGINAL_BODY");
    expect(await reconcileImport.call({ id: run.id, graph: version }, owner)).toMatchObject({ status: "reconciled" });
    expect(await publishImport.call({ id: run.id, graph: version }, owner)).toMatchObject({ status: "published" });
    expect((await db().select().from(pages).where(eq(pages.id, page!.id)))[0]?.status).toBe("published");
    expect(await rollbackImport.call({ id: run.id, graph: version }, owner)).toMatchObject({ status: "rolled_back" });
    expect(await db().select().from(pages).where(eq(pages.id, page!.id))).toEqual([]);
    expect((await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, source!.id)))[0]?.state).toBe("rolled_back");
    const requests = await db().select().from(importCrawlRequests).where(eq(importCrawlRequests.sourceId, source!.id));
    for (const request of requests) expect((await db().select().from(importCrawlResponses).where(eq(importCrawlResponses.id, request.acceptedResponseId!)))[0]?.state).toBe("retired");
  });

  it("keeps a held zero-response generation's actual URL facts until the real hold is removed", async () => {
    const owner = await actualOwner(), site = await actualOriginalServer();
    const run = await startImport.call({ origin: site, kind: "html" }, owner);
    await initializeCrawl.call({ id: run.id, url: `${site}original` }, owner);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    const reader = (await resolveContact.call({ email: "fictional-zero-response-held-reader@example.test" }, owner)).contact;
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, owner);
    const hold = await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic actual zero-response source generation hold" }, owner);
    const headers = await db().select().from(privacyRetentionSourceSnapshots).where(eq(privacyRetentionSourceSnapshots.exceptionId, hold.id));
    const members = await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId, hold.id));
    expect(headers).toMatchObject([{ sourceScope: "imports.readerSources", memberCount: 1 }]);
    expect(members).toMatchObject([{ sourceId: source!.id, generation: source!.generation }]);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic actual original subject verification" }, owner);
    expect((await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, owner)).request.status).toBe("partially_completed");
    expect((await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, source!.id)))[0]).toMatchObject({ state: "invalidated", siteUrl: site, sourceUrl: `${site}original`, redactedAt: null });
    expect(await db().select().from(privacyRetentionSourceSnapshots).where(eq(privacyRetentionSourceSnapshots.exceptionId, hold.id))).toEqual(headers);
    expect(await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId, hold.id))).toEqual(members);
    await removeRetentionException.call({ id: hold.id }, owner);
    await retireExpiredCrawls.call({ limit: 25 }, { kind: "system" });
    expect((await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, source!.id)))[0]).toMatchObject({ generation: source!.generation, executorIdentity: source!.executorIdentity, siteUrl: null, sourceUrl: null, state: "invalidated" });
    expect(await db().select().from(importCrawlResponses)).toEqual([]);
    expect(await db().select().from(mediaObjectWrites)).toEqual([]);
    expect(observed).toEqual([]);
  });

  it("minimizes an indexed original subject marker after its real HTTP privacy jobs retire the bytes", async () => {
    const privateMarker = "fictional-private-index-reader@example.test";
    const owner = await actualOwner(), site = await actualOriginalServer(undefined, `<title>${privateMarker}</title><main>Actual original indexed input.</main>`);
    const run = await startImport.call({ origin: site, kind: "html" }, owner);
    await initializeCrawl.call({ id: run.id, url: `${site}original` }, owner);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    for (let phase = 0; phase < 6; phase++) await advanceCrawl.call({ id: run.id, generation: source!.generation }, owner);
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    expect(JSON.stringify(await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, graph!.id)))).toContain(privateMarker);
    const reader = (await resolveContact.call({ email: privateMarker }, owner)).contact;
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, owner);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic actual indexed subject verification" }, owner);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, owner);
    // Workers remain disabled. Execute only the registered body on each real
    // recorded privacy job's durable payload, never a manufactured key/context.
    for (let phase = 0; phase < 16; phase++) {
      const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
      const receipt = artifact!.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
      const pending = receipt.outcomes.find(outcome => outcome.scope === CRAWL_ERASURE_SCOPE)?.pendingJobs ?? [];
      if (!pending.length) break;
      const job = await getJob(CRAWL_ERASURE_JOB, pending[0]!);
      if (!job?.data) throw new Error("The actual original HTTP privacy job is missing.");
      await eraseCrawlOriginals(job.data);
    }
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
    const receipt = artifact!.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    expect(receipt.outcomes.find(outcome => outcome.scope === CRAWL_ERASURE_SCOPE)?.pendingJobs ?? []).toEqual([]);
    const originals = await db().select().from(importCrawlResponses);
    expect(originals).toHaveLength(2);
    for (const response of originals) {
      expect(response.redactedAt).toBeInstanceOf(Date);
      expect(await storage().get(response.storageKey!)).toBeUndefined();
    }
    const [retiredGraph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.id, graph!.id));
    const indexed = await db().select({ metadata: importSourceEntries.metadata }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph!.id));
    expect(retiredGraph?.state).toBe("invalidated");
    expect(JSON.stringify({ header: retiredGraph!.headerMetadata, catalog: retiredGraph!.planMetadata, entries: indexed })).not.toContain(privateMarker);
  });

  it("minimizes the actual unaccepted image URL key after original HTTP privacy cleanup", async () => {
    const privateMarker = "fictional-private-media-reader@example.test";
    const owner = await actualOwner(), site = await actualOriginalServer(undefined, `<title>Actual original image reference</title><main>Unaccepted source input.<img src="/${privateMarker}.png" alt="Actual original reference"></main>`);
    const run = await startImport.call({ origin: site, kind: "html" }, owner);
    await initializeCrawl.call({ id: run.id, url: `${site}original` }, owner);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    for (let phase = 0; phase < 6; phase++) await advanceCrawl.call({ id: run.id, generation: source!.generation }, owner);
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    expect(graph?.planDigest).toBeNull();
    expect(await db().select().from(importSourceBatches).where(eq(importSourceBatches.graphId, graph!.id))).toEqual([]);
    expect(await db().select().from(assets)).toEqual([]);
    const originalMedia = await db().select().from(importSourceMedia).where(eq(importSourceMedia.graphId, graph!.id));
    expect(originalMedia).toHaveLength(1); expect(originalMedia[0]?.assetId).toBeNull();
    expect(JSON.stringify(originalMedia)).toContain(privateMarker);
    expect(observed.map(request => request.path)).toEqual(["/robots.txt", "/original"]);
    const reader = (await resolveContact.call({ email: privateMarker }, owner)).contact;
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, owner);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic actual unaccepted original URL subject verification" }, owner);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, owner);
    for (let phase = 0; phase < 16; phase++) {
      const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
      const receipt = artifact!.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
      const pending = receipt.outcomes.find(outcome => outcome.scope === CRAWL_ERASURE_SCOPE)?.pendingJobs ?? [];
      if (!pending.length) break;
      const job = await getJob(CRAWL_ERASURE_JOB, pending[0]!);
      if (!job?.data) throw new Error("The actual original HTTP privacy job is missing.");
      await eraseCrawlOriginals(job.data);
    }
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
    const receipt = artifact!.body as { status: string; outcomes: Array<{ scope: string; outcome: string; pendingJobs?: string[] }> };
    expect(receipt.status).toBe("completed");
    expect(receipt.outcomes.find(outcome => outcome.scope === CRAWL_ERASURE_SCOPE)).toMatchObject({ outcome: "erased" });
    expect(receipt.outcomes.find(outcome => outcome.scope === CRAWL_ERASURE_SCOPE)?.pendingJobs ?? []).toEqual([]);
    for (const response of await db().select().from(importCrawlResponses)) {
      expect(response.redactedAt).toBeInstanceOf(Date);
      expect(await storage().get(response.storageKey!)).toBeUndefined();
    }
    const [retiredGraph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.id, graph!.id));
    const entries = await db().select({ metadata: importSourceEntries.metadata }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph!.id));
    const media = await db().select({ id: importSourceMedia.id, key: importSourceMedia.key, planned: importSourceMedia.planned, assetId: importSourceMedia.assetId, error: importSourceMedia.error }).from(importSourceMedia).where(eq(importSourceMedia.graphId, graph!.id));
    expect(await db().select().from(importSourceBatches).where(eq(importSourceBatches.graphId, graph!.id))).toEqual([]);
    expect(await db().select().from(assets)).toEqual([]);
    expect(JSON.stringify({ header: retiredGraph!.headerMetadata, catalog: retiredGraph!.planMetadata, entries, media })).not.toContain(privateMarker);
  });

  it("keeps an actual admitted image batch pending for reviewed privacy recovery without rekeying its URL", async () => {
    const privateMarker = "fictional-pending-media-reader@example.test";
    const owner = await actualOwner(), site = await actualOriginalServer(undefined, `<main>Actual pending file.<img src="/${privateMarker}.png"></main>`);
    const run = await startImport.call({ origin: site, kind: "html" }, owner);
    await initializeCrawl.call({ id: run.id, url: `${site}original` }, owner);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    for (let phase = 0; phase < 6; phase++) await advanceCrawl.call({ id: run.id, generation: source!.generation }, owner);
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    // This real public commit first admits its immutable plan/batch. The
    // owned HTTP fixture intentionally serves HTML rather than image bytes;
    // either its ordinary failed-file receipt or error is recovery state.
    await Promise.allSettled([commitImport.call({ id: run.id, observed: { generation: graph!.generation, sourceRevision: graph!.sourceRevision, planRevision: graph!.planRevision } }, owner)]);
    const [admitted] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.id, graph!.id));
    expect(admitted?.planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await db().select().from(importSourceBatches).where(eq(importSourceBatches.graphId, graph!.id))).toHaveLength(1);
    const mediaBefore = await db().select().from(importSourceMedia).where(eq(importSourceMedia.graphId, graph!.id));
    expect(mediaBefore).toHaveLength(1); expect(mediaBefore[0]?.key).toContain(privateMarker);
    const reader = (await resolveContact.call({ email: privateMarker }, owner)).contact;
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, owner);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic actual admitted file subject verification" }, owner);
    await expect(fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, owner)).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(importSourceMedia).where(eq(importSourceMedia.graphId, graph!.id))).toEqual(mediaBefore);
    expect(await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id))).toEqual([]);
    for (const response of await db().select().from(importCrawlResponses)) {
      expect(response.retiredAt).toBeNull();
      expect(await storage().get(response.storageKey!)).toBeDefined();
    }
    expect((await db().select().from(mediaObjectWrites)).some(row => row.operation === "delete")).toBe(false);
  });

});
