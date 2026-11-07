// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { htmlMetadata, verifyMigration } from "../../scripts/verify-wordpress-migration.mjs";
const servers: Server[] = [];
async function fixture(mode: "source" | "destination") {
  const server = createServer((request, response) => {
    if (request.url === "/old" || request.url === "/two") { response.writeHead(301, { location: request.url === "/old" ? "/story" : "/old" }).end(); return; }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<html><head><title>A complete original title &amp; its brand</title><meta name="description" content="A description."><link rel="canonical" href="/story"><meta property="og:title" content="A social title"><meta property="og:description" content="A social description"><meta property="og:image" content="https://images.example.test/owned.jpg">${request.url === "/mismatch" && mode === "destination" ? '<meta name="robots" content="noindex">' : ''}<link rel="alternate" hreflang="fr" href="/fr/story"></head><body>Story</body></html>`);
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
});
