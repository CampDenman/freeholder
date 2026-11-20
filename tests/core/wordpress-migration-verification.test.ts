// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { htmlMetadata, verifyMigration } from "../../scripts/verify-wordpress-migration.mjs";
const servers: Server[] = [];
async function fixture(mode: "source" | "destination") {
  const server = createServer((request, response) => {
    if (request.url === "/old" || request.url === "/two") { response.writeHead(301, { location: request.url === "/old" ? "/story" : "/old" }).end(); return; }
    if (request.url === "/temporary") { response.writeHead(302, { location: "/story" }).end(); return; }
    if (request.url === "/story/") { response.writeHead(301, { location: "/story" }).end(); return; }
    if (request.url === "/no-location") { response.writeHead(301).end(); return; }
    if (request.url === "/wrong-type") { response.writeHead(200, { "content-type": "application/json" }).end('{"error":"Page unavailable"}'); return; }
    if (request.url === "/?feed=rss2") { response.writeHead(301, { location: "/feeds/blog.xml" }).end(); return; }
    if (request.url === "/feeds/blog.xml") { response.writeHead(200, { "content-type": "application/atom+xml; charset=utf-8" }).end('<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title></feed>'); return; }
    const defaultCanonical = request.url === "/" ? "/" : "/story";
    const canonicalPath = request.url === "/legacy-story" ? "/old" : defaultCanonical;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<html><head><title>A complete original title &amp; its brand</title><meta name="description" content="A description."><link rel="canonical" href="${canonicalPath}"><meta property="og:title" content="A social title"><meta property="og:description" content="A social description"><meta property="og:image" content="https://images.example.test/owned.jpg">${request.url === "/mismatch" && mode === "destination" ? '<meta name="robots" content="noindex">' : ''}<link rel="alternate" hreflang="fr" href="/fr/story"></head><body>Story</body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); servers.push(server);
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port.");
  return `http://127.0.0.1:${address.port}`;
}
afterAll(async () => { await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });

describe("WordPress migration HTTP acceptance report", () => {
  it("reads entities and metadata from parsed HTML", () => {
    expect(htmlMetadata('<title>Full &amp; exact</title><meta name="robots" content="noindex"><link rel="alternate" hreflang="ar" href="/ar/story">')).toMatchObject({ title: "Full & exact", robots: "noindex", hreflang: { ar: "/ar/story" } });
  });
  it("accepts preserved pages and one literal301 alias, but fails two-hop redirects and unresolved source decisions", async () => {
    const source = await fixture("source"), destination = await fixture("destination");
    const plan = { sourceOrigin: source, status: "published", warnings: [] as string[], checks: [
      { sourceUrl: `${source}/story`, requestPath: "/story", destinationPath: "/story", redirect: false, expected: { title: "A complete original title & its brand" } },
      { sourceUrl: `${source}/old`, requestPath: "/old", destinationPath: "/story", redirect: true, expected: {} },
    ] };
    expect(await verifyMigration(plan, destination)).toMatchObject({ accepted: true });
    const failed = await verifyMigration({ ...plan, checks: [{ ...plan.checks[1]!, requestPath: "/two" }] }, destination);
    expect(failed.accepted).toBe(false);
    expect(failed.rows[0]!.errors.join(" ")).toContain("301");
    expect(await verifyMigration({ ...plan, warnings: ["Choose a destination for an orphan attachment."] }, destination)).toMatchObject({ accepted: false });
    const changed = await verifyMigration({ ...plan, checks: [{ ...plan.checks[0]!, sourceUrl: `${source}/mismatch`, requestPath: "/mismatch" }] }, destination);
    expect(changed.accepted).toBe(false);
    expect(changed.rows[0]!.errors).toContain("noindex changed from the source.");
  });

  it("fails incomplete or empty published plans instead of reporting coverage", async () => {
    const source = await fixture("source"), destination = await fixture("destination");
    const check = { sourceUrl: `${source}/story`, requestPath: "/story", destinationPath: "/story", redirect: false, expected: {} };
    const plan = { sourceOrigin: source, status: "published", checks: [check], warnings: [] };
    expect(await verifyMigration({ ...plan, checks: [] }, destination)).toMatchObject({ accepted: false });
    expect(await verifyMigration({ ...plan, nextOrdinal: 30 }, destination)).toMatchObject({ accepted: false });
    expect(await verifyMigration({ ...plan, nextOrdinal: null }, destination)).toMatchObject({ accepted: false });
    expect(await verifyMigration(plan, destination)).toMatchObject({ accepted: true });
  });

  it("accepts a continuous graph sequence and refuses missing, reordered or mixed windows", async () => {
    const source = await fixture("source"), destination = await fixture("destination");
    const check = { sourceUrl: `${source}/story`, requestPath: "/story", destinationPath: "/story", redirect: false, expected: {} };
    const feed = { sourceUrl: source, requestPath: "/?feed=rss2", destinationPath: "/feeds/blog.xml", redirect: true, expected: {} };
    const identity = { runId: "96dc85db-50a4-4eb3-a7e8-c599db608c53", generation: "4efb751f-da89-47de-abb0-bb6dd3f4255a", planDigest: "a".repeat(64) };
    const common = { sourceOrigin: source, status: "published", warnings: [] };
    const first = { ...common, checks: [feed], window: { ...identity, afterOrdinal: -1 }, nextOrdinal: 3 };
    const last = { ...common, checks: [check], window: { ...identity, afterOrdinal: 3 }, nextOrdinal: null };
    expect(await verifyMigration([first, last], destination)).toMatchObject({ accepted: true, rows: [{ requestPath: feed.requestPath }, { requestPath: check.requestPath }], windowSequence: { ...identity, count: 2 } });
    await expect(verifyMigration([first], destination)).rejects.toThrow("cursor");
    await expect(verifyMigration([last], destination)).rejects.toThrow("cursor");
    await expect(verifyMigration([last, first], destination)).rejects.toThrow("cursor");
    await expect(verifyMigration([first, { ...last, window: { ...last.window, afterOrdinal: 4 } }], destination)).rejects.toThrow("cursor");
    await expect(verifyMigration([first, { ...last, window: { ...last.window, planDigest: "b".repeat(64) } }], destination)).rejects.toThrow("different import, plan or publication state");
    expect(await verifyMigration([first, { ...last, warnings: ["An original alias remains unresolved."] }], destination)).toMatchObject({ accepted: false, unresolved: ["An original alias remains unresolved."] });
  });

  it("keeps the homepage canonical when a later Atom alias uses the same source origin", async () => {
    const source = await fixture("source"), destination = await fixture("destination");
    const home = { sourceUrl: `${source}/`, requestPath: "/", destinationPath: "/", redirect: false, expected: {} };
    const feed = { sourceUrl: `${source}/`, requestPath: "/?feed=rss2", destinationPath: "/feeds/blog.xml", redirect: true, expected: {} };
    const firstWindow = {
      sourceOrigin: source, status: "published", warnings: [], checks: [home, feed], nextOrdinal: null,
      window: { runId: "96dc85db-50a4-4eb3-a7e8-c599db608c53", generation: "4efb751f-da89-47de-abb0-bb6dd3f4255a", planDigest: "a".repeat(64), afterOrdinal: -1 },
    };
    expect(await verifyMigration([firstWindow], destination)).toMatchObject({
      accepted: true,
      rows: [{ requestPath: "/", errors: [], destinationMeta: { canonical: "/" } }, { requestPath: "/?feed=rss2", errors: [] }],
    });
  });

  it("maps a rendered source canonical that names a redirect-only alias", async () => {
    const source = await fixture("source"), destination = await fixture("destination");
    const landed = { sourceUrl: `${source}/legacy-story`, requestPath: "/story", destinationPath: "/story", redirect: false, expected: {} };
    const alias = { sourceUrl: `${source}/old`, requestPath: "/old", destinationPath: "/story", redirect: true, expected: {} };
    const plan = { sourceOrigin: source, status: "published", warnings: [], checks: [landed, alias] };
    expect(await verifyMigration(plan, destination)).toMatchObject({ accepted: true, rows: [{ errors: [] }, { errors: [] }] });
  });

  it("requires a literal 301 to a real target and the final route's expected media type", async () => {
    const source = await fixture("source"), destination = await fixture("destination");
    const story = { sourceUrl: `${source}/story`, requestPath: "/story/", destinationPath: "/story", redirect: false, expected: {} };
    const feed = { sourceUrl: source, requestPath: "/?feed=rss2", destinationPath: "/feeds/blog.xml", redirect: true, expected: {} };
    const plan = { sourceOrigin: source, status: "published", checks: [story, feed], warnings: [] };
    expect(await verifyMigration(plan, destination)).toMatchObject({ accepted: true });
    const temporary = await verifyMigration({ ...plan, checks: [{ ...story, requestPath: "/temporary" }] }, destination);
    expect(temporary).toMatchObject({ accepted: false, rows: [{ errors: [expect.stringContaining("302")] }] });
    const missingTarget = await verifyMigration({ ...plan, checks: [{ ...story, requestPath: "/no-location" }] }, destination);
    expect(missingTarget).toMatchObject({ accepted: false, rows: [{ errors: [expect.stringContaining("Location")] }] });
    const wrongType = await verifyMigration({ ...plan, checks: [{ ...story, requestPath: "/wrong-type", destinationPath: "/wrong-type" }] }, destination);
    expect(wrongType).toMatchObject({ accepted: false, rows: [{ errors: [expect.stringContaining("text/html")] }] });
  });
});
