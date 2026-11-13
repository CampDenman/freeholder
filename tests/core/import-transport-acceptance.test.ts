// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C3.22/C3.46/C3.47/F05: real incoming TCP, typed SDK and MCP import operations.
// SOURCE ONLY until the parent grants a fresh combined-schema native lane.
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createClient, FreeholderError, SERVICE_NAMES } from "../../packages/sdk/src/index";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { CSRF_COOKIE } from "@/core/http/csrf";
import * as pinned from "@/core/http/pinned-download";
import { ready } from "@/core/runtime";
import { stopJobs, reconcileJobDeploymentAdmission } from "@/core/jobs";
import { auditLog } from "@/core/events/schema";
import { importRuns, importSourceBatches, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "@/core/import/crawl-schema";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { ensureDefaults } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import { importTransportHost, importMcpClient, issueTransportKey, humanHttp, authenticatedJson, type SyntheticOwnerSession } from "../helpers/import-transport-host";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const runResult = z.object({ id: z.uuid(), status: z.string(), counts: z.unknown() }).passthrough();
const versionSchema = z.object({ generation: z.uuid(), sourceRevision: z.string(), planRevision: z.number().int() });
const previewResult = z.object({ id: z.uuid(), status: z.string(), counts: z.unknown(), graph: versionSchema.optional() });
const reviewResult = z.object({ version: versionSchema, indexed: z.number(), planReady: z.boolean(), indexComplete: z.boolean(), entries: z.array(z.object({ ordinal: z.number() }).passthrough()), nextOrdinal: z.number().nullable() }).passthrough();
const stepResult = z.object({ id: z.uuid(), generation: z.uuid(), step: z.string() });
const PRIMARY = "fictional-import-transport-primary", MARKER = "fictional-private-original-transport-marker";
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
type Host = Awaited<ReturnType<typeof importTransportHost>>;
type Client = ReturnType<typeof createClient>;
type Mcp = ReturnType<typeof importMcpClient>;
type Version = z.infer<typeof versionSchema>;
let host: Host | undefined, provider: Server | undefined, session: SyntheticOwnerSession;

async function createSyntheticOwner() {
  await db().insert(users).values({ id: OWNER.userId, email: "fictional-transport-owner@example.test", role: "owner" });
  await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "synthetic-transport-factor-not-a-real-owner-secret" });
  const current = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
  const actor = await actorFromToken(current.token);
  if (actor.kind !== "user" || !actor.sessionId || !actor.security?.stepUpValid) throw new Error("The actual fresh synthetic owner session was not resolved.");
  const csrf = randomUUID();
  session = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(current.token)}; ${CSRF_COOKIE}=${csrf}`, csrf };
  await ensureDefaults.call({}, actor);
}

function wxrBytes(count = 501) {
  return new TextEncoder().encode(`<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Fictional transport original</title><link>https://fictional-transport-source.example/</link>${Array.from({ length: count }, (_, index) => `<item><title>Transport original ${index + 1}</title><link>https://fictional-transport-source.example/transport-${index + 1}/</link><wp:post_id>${index + 1}</wp:post_id><wp:post_type>page</wp:post_type><wp:status>${index === count - 1 ? "draft" : "publish"}</wp:status><content:encoded><![CDATA[<p>Original transport body ${index + 1}.</p>${index === 0 ? `<!-- ${MARKER} -->` : ""}]]></content:encoded></item>`).join("")}</channel></rss>`);
}

/** Exact minimal business digests; key last-used/session bookkeeping is not
 * confused with imported content, storage or ownership side effects. */
async function businessStamp() {
  const stamps: Array<{ table: string; count: number; sha256: string }> = [];
  for (const table of ["import_runs", "import_source_graphs", "import_source_entries", "import_source_batches", "import_source_media", "import_crawl_sources", "import_crawl_requests", "import_crawl_responses", "pages", "assets", "media_objects", "media_object_writes"]) {
    const [row] = await db().execute<{ count: number; sha256: string }>(sql.raw(`select count(*)::int count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') sha256 from public.${table} t`));
    if (!row) throw new Error("The minimal business stamp is missing.");
    stamps.push({ table, ...row });
  }
  return stamps;
}

async function assertActualCleanupPayload(keys: string[]) {
  const rows = await db().execute<{ id: string; data: unknown }>(sql`select id,data from pgboss.job where name='core.deleteCaptureObjects'
    and exists(select 1 from jsonb_array_elements_text(data->'keys') item where item in (${sql.join(keys.map(key => sql`${key}`), sql`, `)}))`);
  const payload = z.object({ keys: z.array(z.string()) });
  const queuedKeys = rows.flatMap(row => payload.parse(row.data).keys);
  for (const key of keys) expect(queuedKeys).toContain(key);
  expect(rows.length).toBeGreaterThan(0);
}

async function assertAuditActorAndNoCredential(token: string, runId: string) {
  const rows = await db().select().from(auditLog).where(sql`${auditLog.action} like 'imports.%'`);
  expect(rows.some(row => row.subjectId === runId)).toBe(true);
  expect(rows.length).toBeGreaterThan(0);
  const responses = await db().select({ id: importCrawlResponses.id }).from(importCrawlResponses)
    .innerJoin(importCrawlRequests, eq(importCrawlRequests.id, importCrawlResponses.requestId))
    .innerJoin(importCrawlSources, eq(importCrawlSources.id, importCrawlRequests.sourceId)).where(eq(importCrawlSources.runId, runId));
  const actualWrapperIds = new Set(responses.map(response => response.id));
  expect(rows.every(row => row.action === "imports.recordCrawlWrapperFinish"
    ? row.actor === "system" && row.subjectType === "import_crawl_response" && row.subjectId !== null && actualWrapperIds.has(row.subjectId)
    : row.actor === `agent:${PRIMARY}`)).toBe(true);
  const audit = JSON.stringify(await db().select().from(auditLog));
  expect(audit).not.toContain(token); expect(audit).not.toContain(MARKER);
}

async function reviewAll(client: Client, mcp: Mcp, id: string) {
  const ordinals: number[] = []; let afterOrdinal = -1;
  for (let phase = 0; phase < 12; phase++) {
    const result = phase % 2 === 0 ? await client.api.imports.sourceGraph({ id, afterOrdinal, limit: 50 }) : await mcp.tool("imports_sourceGraph", { id, afterOrdinal, limit: 50 }, reviewResult);
    expect(result.entries.length).toBeLessThanOrEqual(50);
    ordinals.push(...result.entries.map(entry => entry.ordinal));
    const text = JSON.stringify(result);
    for (const privateValue of [MARKER, "uploaderIdentity", "sourcePrivacyHolds", "storageNamespace", "leaseToken"]) expect(text).not.toContain(privateValue);
    if (result.nextOrdinal === null) break;
    afterOrdinal = result.nextOrdinal;
  }
  expect(ordinals).toHaveLength(501); expect(new Set(ordinals).size).toBe(501);
}

async function finishLifecycle(client: Client, mcp: Mcp, token: string, id: string, version: Version, prefix: string, originalDraft: string | null) {
  const baseline = await db().select().from(pages);
  const imported = () => db().select().from(pages).where(sql`${pages.slug} like ${prefix + '%'}`);
  expect(await imported()).toHaveLength(0);
  expect(await client.api.imports.commit({ id, graph: version })).toMatchObject({ status: "previewed" });
  expect(await imported()).toHaveLength(500);
  const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, id));
  expect(graph).toMatchObject({ commitOrdinal: 500, batchCounter: 1, leaseToken: null });
  // A new actual SDK client reauthenticates a new HTTP request from the saved
  // accepted500 boundary; no parser array or ServiceContext crosses requests.
  const resumed = createClient({ baseUrl: host!.origin, token });
  expect(await mcp.tool("imports_commit", { id, graph: version }, runResult)).toMatchObject({ status: "committed", counts: { pages: 501 } });
  const accepted = await db().select().from(importSourceBatches).where(eq(importSourceBatches.graphId, graph!.id));
  expect(accepted).toHaveLength(2);
  expect(await resumed.api.imports.commit({ id, graph: version })).toMatchObject({ status: "committed", counts: { pages: 501 } });
  expect(await db().select().from(importSourceBatches).where(eq(importSourceBatches.graphId, graph!.id))).toEqual(accepted);
  expect((await imported()).every(page => page.status === "draft")).toBe(true);
  const publicClient = createClient({ baseUrl: host!.origin });
  expect(await publicClient.api.cms.resolvePage({ slug: `${prefix}1` })).toBeNull();
  let reconciled = await resumed.api.imports.reconcile({ id, graph: version });
  for (let phase = 0; phase < 6 && reconciled.status === "committed"; phase++) reconciled = await resumed.api.imports.reconcile({ id, graph: version });
  expect(reconciled.status).toBe("reconciled");
  let published = await mcp.tool("imports_publish", { id, graph: version }, runResult);
  for (let phase = 0; phase < 6 && published.status === "reconciled"; phase++) published = await mcp.tool("imports_publish", { id, graph: version }, runResult);
  expect(published.status).toBe("published");
  expect((await imported()).filter(page => page.status === "published")).toHaveLength(originalDraft ? 500 : 501);
  expect(await publicClient.api.cms.resolvePage({ slug: `${prefix}1` })).toMatchObject({ slug: `${prefix}1` });
  if (originalDraft) expect(await publicClient.api.cms.resolvePage({ slug: originalDraft })).toBeNull();
  let reversed = await resumed.api.imports.rollback({ id, graph: version });
  for (let phase = 0; phase < 6 && reversed.status !== "rolled_back"; phase++) reversed = await resumed.api.imports.rollback({ id, graph: version });
  expect(reversed.status).toBe("rolled_back"); expect(await imported()).toHaveLength(0);
  expect(await db().select().from(pages)).toEqual(baseline);
  expect(await publicClient.api.cms.resolvePage({ slug: `${prefix}1` })).toBeNull();
  expect((await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]).toMatchObject({ status: "rolled_back", createdBy: `agent:${PRIMARY}` });
}

describe.runIf(hasDatabase)("actual incoming import transports (C3.22/C3.46/C3.47/F05)", { timeout: 180_000 }, () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); await createSyntheticOwner(); host = await importTransportHost(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (provider) { const current = provider; provider = undefined; current.closeIdleConnections(); await new Promise<void>((resolve, reject) => current.close(error => error ? reject(error) : resolve())); }
    if (host) { const current = host; host = undefined; await current.close(); expect(current.failures).toEqual([]); }
    await stopJobs(); await reconcileJobDeploymentAdmission(); await closeDb();
  });
  afterAll(async () => { await stopJobs(); await reconcileJobDeploymentAdmission(); await closeDb(); });

  it("uploads501 exact WXR originals through HTTP, resumes bounded typedSDK/MCP phases, explicitly publishes and reverses only its content", async () => {
    const key = await issueTransportKey(host!.origin, session, PRIMARY, ["imports.*", "cms.*", "seo.*", "media.*"]);
    const client = createClient({ baseUrl: host!.origin, token: key.token }), mcp = importMcpClient(host!.origin, key.token);
    expect((await mcp.initialize()).error).toBeUndefined();
    const tools = z.object({ tools: z.array(z.object({ name: z.string() }).passthrough()) }).parse((await mcp.rpc("tools/list")).result).tools.map(tool => tool.name);
    expect(tools).toContain("imports_sourceGraph"); expect(tools).toContain("imports_commit"); expect(tools).not.toContain("imports_uploadSourceChunk");
    const contractResponse = await fetch(`${host!.origin}/api/openapi.json`);
    expect(contractResponse.status).toBe(200);
    const contract = z.object({ paths: z.record(z.string(), z.unknown()) }).parse(await contractResponse.json());
    expect(Object.keys(contract.paths)).toContain("/api/v1/imports.start");
    for (const helper of ["imports.claimSourceChunk", "imports.applyUploadedPreview", "imports.claimGraphCommit", "imports.completeOriginalSourceErasure"]) {
      expect(tools).not.toContain(helper.replaceAll(".", "_"));
      expect(Object.keys(contract.paths)).not.toContain(`/api/v1/${helper}`);
      expect([...SERVICE_NAMES]).not.toContain(helper);
    }
    const run = await client.api.imports.start({ origin: "https://fictional-transport-source.example/", kind: "wordpress-wxr" }), bytes = wxrBytes();
    const upload = await client.api.imports.beginSourceUpload({ id: run.id, filename: "fictional-transport.xml", bytes: bytes.byteLength });
    expect(upload.chunkCount).toBe(1);
    const response = await fetch(`${host!.origin}/api/imports/source/chunk?id=${run.id}&uploadId=${upload.uploadId}&index=0`, { method: "POST", headers: { authorization: `Bearer ${key.token}`, "content-type": "application/octet-stream" }, body: bytes });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ complete: true, received: 1, chunks: 1 });
    const originalKey = `imports/${run.id}/${upload.uploadId}/00000.part`;
    expect(await storage().get(originalKey)).toEqual(bytes);
    const [put] = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key, originalKey));
    expect(put).toMatchObject({ operation: "put", state: "accepted", sha256: digest(bytes), bytes: bytes.byteLength });
    expect(put?.namespace).toMatch(/^[a-f0-9]{64}$/); expect(put?.keyDigest).toBe(digest(`freeholder:media-object-key:v1\0${originalKey}`));
    await assertActualCleanupPayload([originalKey]);
    expect(await client.api.imports.previewFromUpload({ id: run.id, uploadId: upload.uploadId })).toMatchObject({ status: "discover" });
    expect(await mcp.tool("imports_previewFromUpload", { id: run.id, uploadId: upload.uploadId }, previewResult)).toMatchObject({ status: "discover", counts: { indexed: 500 } });
    expect(await client.api.imports.sourceGraph({ id: run.id, limit: 1 })).toMatchObject({ indexed: 500, planReady: false, indexComplete: false });
    const resumed = createClient({ baseUrl: host!.origin, token: key.token });
    let staged = await resumed.api.imports.previewFromUpload({ id: run.id, uploadId: upload.uploadId });
    for (let phase = 0; phase < 6 && staged.status === "discover"; phase++) staged = await resumed.api.imports.previewFromUpload({ id: run.id, uploadId: upload.uploadId });
    expect(staged.status).toBe("previewed");
    const review = await client.api.imports.sourceGraph({ id: run.id, limit: 1 });
    expect(review).toMatchObject({ indexed: 501, planReady: true, indexComplete: true });
    await reviewAll(client, mcp, run.id);
    // A real explicit plan review changes its revision before commit.
    await client.api.imports.reviewConflicts({ id: run.id, graph: review.version, conflicts: [{ slug: "transport-1", resolution: "replace" }] });
    const reviewed = await client.api.imports.sourceGraph({ id: run.id, limit: 1 });
    expect(reviewed.version.planRevision).toBe(review.version.planRevision + 1);
    expect(await storage().get(originalKey)).toEqual(bytes);
    await finishLifecycle(client, mcp, key.token, run.id, reviewed.version, "transport-", "transport-501");
    expect(await storage().get(originalKey)).toEqual(bytes); await assertActualCleanupPayload([originalKey]);
    await assertAuditActorAndNoCredential(key.token, run.id);
    expect(host!.requests.some(request => request.path === "/api/mcp")).toBe(true);
    expect(host!.requests.some(request => request.path === "/api/v1/imports.commit")).toBe(true);
    expect(host!.requests.filter(request => request.path === "/api/imports/source/chunk")).toHaveLength(1);
  });

  it("refuses missing scopes, a different uploader, private helpers and revoked credentials through real HTTP/MCP without business writes", async () => {
    const primary = await issueTransportKey(host!.origin, session, PRIMARY, ["imports.*", "cms.*", "seo.*", "media.*"]);
    const narrow = await issueTransportKey(host!.origin, session, "fictional-import-scope-denied", ["imports.start"]);
    const uploader = await issueTransportKey(host!.origin, session, "fictional-other-uploader", ["imports.uploadSourceChunk"]);
    const commitOnly = await issueTransportKey(host!.origin, session, "fictional-import-without-cms", ["imports.commit"]);
    const client = createClient({ baseUrl: host!.origin, token: primary.token }), mcp = importMcpClient(host!.origin, primary.token);
    const run = await client.api.imports.start({ origin: "https://fictional-transport-source.example/refusals", kind: "wordpress-wxr" }), bytes = wxrBytes(1);
    const upload = await client.api.imports.beginSourceUpload({ id: run.id, filename: "fictional-denied.xml", bytes: bytes.byteLength });
    const before = await businessStamp();
    await expect(client.withToken(narrow.token).api.imports.previewFromUpload({ id: run.id, uploadId: upload.uploadId })).rejects.toMatchObject({ status: 403, code: "permission" });
    const wrongUploader = await fetch(`${host!.origin}/api/imports/source/chunk?id=${run.id}&uploadId=${upload.uploadId}&index=0`, { method: "POST", headers: { authorization: `Bearer ${uploader.token}`, "content-type": "application/octet-stream" }, body: bytes });
    expect(wrongUploader.status).toBe(403);
    for (const helper of ["imports.claimSourceChunk", "imports.applyUploadedPreview", "imports.claimGraphCommit", "imports.completeOriginalSourceErasure"]) {
      const response = await fetch(`${host!.origin}/api/v1/${helper}`, { method: "POST", headers: authenticatedJson(primary.token), body: JSON.stringify({ id: run.id }) });
      expect(response.status).toBe(404);
      expect((await mcp.rpc("tools/call", { name: helper.replaceAll(".", "_"), arguments: { id: run.id } })).error).toMatchObject({ code: -32602 });
    }
    expect((await importMcpClient(host!.origin, narrow.token).rpc("tools/call", { name: "imports_commit", arguments: { id: run.id } })).error).toMatchObject({ code: -32602 });
    expect(await businessStamp()).toEqual(before);
    // Independent CMS permission refusal uses the ordinary finite import TX;
    // no claimed graph operation or fake actor is used to supply CMS grants.
    const finite = await client.api.imports.start({ origin: "https://fictional-transport-source.example/finite-denial", kind: "html" });
    await client.api.imports.previewFromSource({ id: finite.id, payload: "<title>Finite refused CMS write</title><h1>Finite refused CMS write</h1><p>Fictional body.</p>" });
    const beforeCms = await businessStamp();
    const denied = client.withToken(commitOnly.token).api.imports.commit({ id: finite.id });
    await expect(denied).rejects.toBeInstanceOf(FreeholderError);
    await expect(denied).rejects.toMatchObject({ status: 403, code: "permission" });
    expect(await businessStamp()).toEqual(beforeCms);
    expect((await humanHttp(host!.origin, session, "apikeys.revoke", { id: narrow.id })).status).toBe(200);
    const beforeRevoked = await businessStamp();
    await expect(client.withToken(narrow.token).api.imports.start({ origin: "https://fictional-transport-source.example/revoked", kind: "html" })).rejects.toMatchObject({ status: 401, code: "permission" });
    expect((await importMcpClient(host!.origin, narrow.token).rpc("tools/call", { name: "imports_start", arguments: { origin: "https://fictional-transport-source.example/revoked", kind: "html" } })).error).toMatchObject({ code: -32602 });
    expect(await businessStamp()).toEqual(beforeRevoked);
    expect(await storage().get(`imports/${run.id}/${upload.uploadId}/00000.part`)).toBeUndefined();
  });

  it("crawls501 real REST records through regenerated typedSDK and MCP over TCP, preserves private originals and reverses publication", async () => {
    // These MUST be generated typed wrappers. Frozen738 lacks the two crawl
    // wrappers; the parent regenerates the complete combined catalog first.
    expect(SERVICE_NAMES).toContain("imports.advanceCrawl"); expect(SERVICE_NAMES).toContain("imports.crawlProgress");
    const key = await issueTransportKey(host!.origin, session, PRIMARY, ["imports.*", "cms.*", "seo.*", "media.*"]);
    const client = createClient({ baseUrl: host!.origin, token: key.token }), mcp = importMcpClient(host!.origin, key.token);
    const seen: Array<{ path: string; cookie: string | undefined; authorization: string | undefined }> = [];
    let site = "";
    provider = createServer((request, response) => {
      seen.push({ path: request.url!, cookie: request.headers.cookie, authorization: request.headers.authorization });
      const url = new URL(request.url!, "http://owned-rest-provider.test");
      if (url.pathname === "/robots.txt") { response.setHeader("content-type", "text/plain"); response.end("User-agent: *\nAllow: /\n"); return; }
      if (!["/wp-json/wp/v2/pages", "/wp-json/wp/v2/posts"].includes(url.pathname)) { response.statusCode = 404; response.end(); return; }
      const total = url.pathname.endsWith("/pages") ? 501 : 0, page = Number(url.searchParams.get("page"));
      if (url.searchParams.get("per_page") !== "100" || !Number.isSafeInteger(page) || page < 1 || page > Math.max(1, Math.ceil(total / 100))) { response.statusCode = 400; response.end(); return; }
      response.setHeader("content-type", "application/json"); response.setHeader("x-wp-total", String(total)); response.setHeader("x-wp-totalpages", String(Math.ceil(total / 100)));
      response.end(JSON.stringify(Array.from({ length: Math.min(100, Math.max(0, total - (page - 1) * 100)) }, (_, index) => {
        const id = (page - 1) * 100 + index + 1;
        return { id, type: "page", status: "publish", slug: `wire-rest-${id}`, link: `${site}wire-rest-${id}/`, date_gmt: "2026-01-01T00:00:00", modified_gmt: "2026-01-01T00:00:00", title: { rendered: `Actual transport REST ${id}` }, excerpt: { rendered: "" }, content: { rendered: `<p>Actual wire body ${id}.</p>` } };
      })));
    });
    await new Promise<void>(resolve => provider!.listen(0, "127.0.0.1", resolve));
    site = `http://fictional-rest-transport.example:${(provider.address() as AddressInfo).port}/`;
    const original = pinned.requestPinnedBytes, lookup = async () => [{ address: "127.0.0.1", family: 4 as const }];
    // Only the owned provider's DNS/test-local allowance is injected. Both
    // ingress and source bytes cross actual sockets; authorization is real.
    vi.spyOn(pinned, "requestPinnedBytes").mockImplementation((url, options) => original(url, { ...options, allowLocal: true, lookup }));
    const run = await client.api.imports.start({ origin: site, kind: "wordpress-rest" });
    expect(await client.api.imports.previewFromUrl({ id: run.id, url: site })).toMatchObject({ status: "discover" }); expect(seen).toEqual([]);
    let progress = await client.api.imports.crawlProgress({ id: run.id });
    expect(progress).toMatchObject({ requests: 0, pending: 1, indexed: 0, planReady: false });
    let saw500 = false;
    for (let phase = 0; phase < 60 && !progress.planReady; phase++) {
      if (phase % 2 === 0) await client.api.imports.advanceCrawl({ id: run.id, generation: progress.generation });
      else await mcp.tool("imports_advanceCrawl", { id: run.id, generation: progress.generation }, stepResult);
      progress = await createClient({ baseUrl: host!.origin, token: key.token }).api.imports.crawlProgress({ id: run.id });
      if (progress.indexed === 500) saw500 = true;
    }
    expect(saw500).toBe(true); expect(progress).toMatchObject({ requests: 8, pending: 0, indexed: 501, planReady: true, recoveryRequired: false });
    expect(seen).toHaveLength(8); expect(seen.every(request => request.cookie === undefined && request.authorization === undefined)).toBe(true);
    const review = await client.api.imports.sourceGraph({ id: run.id, limit: 1 });
    await reviewAll(client, mcp, run.id);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    expect(source).toMatchObject({ state: "sealed", networkRequests: 8, pageCount: 501, reservedBytes: 0 });
    const requests = await db().select().from(importCrawlRequests).where(eq(importCrawlRequests.sourceId, source!.id));
    const keys: string[] = [];
    for (const request of requests) {
      const [response] = await db().select().from(importCrawlResponses).where(eq(importCrawlResponses.id, request.acceptedResponseId!));
      if (!response?.storageKey || !response.facts) throw new Error("The actual accepted private HTTP original was not retained.");
      const bytes = await storage().get(response.storageKey); if (!bytes) throw new Error("The accepted original response bytes are absent.");
      expect(response).toMatchObject({ state: "stored", claimedBy: `agent:${PRIMARY}`, executorIdentity: { kind: "key", id: key.id } });
      expect(digest(bytes)).toBe(response.facts.digest); expect(bytes.byteLength).toBe(response.facts.bytes); keys.push(response.storageKey);
    }
    expect(keys).toHaveLength(8);
    await finishLifecycle(client, mcp, key.token, run.id, review.version, "wire-rest-", null);
    await assertActualCleanupPayload(keys);
    expect((await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, source!.id)))[0]?.state).toBe("rolled_back");
    for (const request of requests) expect((await db().select().from(importCrawlResponses).where(eq(importCrawlResponses.id, request.acceptedResponseId!)))[0]?.state).toBe("retired");
    expect(await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, (await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id)))[0]!.id))).toHaveLength(501);
    await assertAuditActorAndNoCredential(key.token, run.id);
  });
});
