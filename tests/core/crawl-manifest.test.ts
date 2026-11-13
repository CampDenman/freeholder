// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: complete manifests bind distinct actual response facts and refuse gaps.
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sealCrawlManifest, type CrawlManifestRequest } from "@/core/import/crawl-manifest";

const site = "https://fictional-originals.example/";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture(pages = 1) {
  const requests: CrawlManifestRequest[] = Array.from({ length: pages + 1 }, (_, ordinal) => {
    const url = ordinal ? `${site}page-${ordinal}` : `${site}robots.txt`, body = ordinal ? `<title>Original${ordinal}</title><main>PRIVATE_BODY${ordinal}</main>` : "User-agent: *\nAllow: /", responseId = randomUUID();
    const role = ordinal ? "html" : "robots";
    return { id: randomUUID(), ordinal, url, urlDigest: hash(url), role, depth: ordinal ? 1 : 0, restPage: null, state: "accepted", acceptedResponseId: responseId,
      original: { id: responseId, keyDigest: hash(`opaque-${ordinal}`), storageNamespace: hash("original private store"), state: "stored", retiredAt: null, discoveryComplete: true,
        facts: { version: 1, method: "GET", requestedUrl: url, role, status: 200, contentType: ordinal ? "text/html" : "text/plain", contentEncoding: "identity", bytes: Buffer.byteLength(body), digest: hash(body) } } };
  });
  const source = { id: randomUUID(), generation: randomUUID(), kind: "html" as const, siteUrl: site, sourceUrl: `${site}page-1`, robotsResponseId: requests[0]!.acceptedResponseId!, requestCounter: requests.length, networkRequests: requests.length, capturedBytes: requests.reduce((total, row) => total + (row.original!.facts as { bytes: number }).bytes, 0), reservedBytes: 0, pageCount: pages };
  return { source, requests };
}

describe("actual HTTP source manifest (C3.47)", () => {
  it("seals501actual page responses plus robots without copying bodies or inventing an upload", () => {
    const { source, requests } = fixture(501), result = sealCrawlManifest(source, requests);
    expect(result.manifest.requests).toHaveLength(502); expect(result.manifest.pages).toBe(501);
    expect(new Set(result.manifest.requests.flatMap(row => "responseId" in row ? [row.responseId] : [])).size).toBe(502);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_BODY|uploadId|wpId/);
    expect(sealCrawlManifest(source, requests)).toEqual(result);
  });
  it("binds the revision to the original byte digest and original namespace", () => {
    const { source, requests } = fixture(), original = sealCrawlManifest(source, requests).revision;
    const changed = structuredClone(requests); (changed[1]!.original!.facts as { digest: string }).digest = hash("different actual body");
    expect(sealCrawlManifest(source, changed).revision).not.toBe(original);
    changed[1]!.original!.storageNamespace = hash("replacement store");
    expect(sealCrawlManifest(source, changed).revision).not.toBe(sealCrawlManifest(source, requests).revision);
  });
  it("refuses a pending frontier, incomplete discovery and unsettled original PUT", () => {
    for (const mutate of [(rows: CrawlManifestRequest[]) => { rows[1]!.state = "pending"; }, (rows: CrawlManifestRequest[]) => { rows[1]!.original!.discoveryComplete = false; }, (rows: CrawlManifestRequest[]) => { rows[1]!.original!.state = "put_unknown"; }]) {
      const { source, requests } = fixture(); mutate(requests); expect(() => sealCrawlManifest(source, requests)).toThrow(/missing|unresolved/);
    }
    const { source, requests } = fixture(); expect(() => sealCrawlManifest({ ...source, reservedBytes: 1 }, requests)).toThrow(/incomplete/);
  });
  it("refuses gaps, duplicate response objects and contradictory byte/network totals", () => {
    const { source, requests } = fixture(2);
    expect(() => sealCrawlManifest(source, requests.slice(1))).toThrow(/incomplete/);
    const duplicate = structuredClone(requests); duplicate[2]!.original!.keyDigest = duplicate[1]!.original!.keyDigest;
    expect(() => sealCrawlManifest(source, duplicate)).toThrow(/duplicated/);
    expect(() => sealCrawlManifest({ ...source, capturedBytes: source.capturedBytes + 1 }, requests)).toThrow(/totals/);
    expect(() => sealCrawlManifest({ ...source, networkRequests: source.networkRequests - 1 }, requests)).toThrow(/totals/);
  });
  it("records an actual robots refusal without inventing downloaded bytes", () => {
    const { source, requests } = fixture(); requests.push({ id: randomUUID(), ordinal: 2, url: `${site}blocked`, urlDigest: hash(`${site}blocked`), role: "html", depth: 1, restPage: null, state: "blocked", acceptedResponseId: null, original: null }); source.requestCounter += 1;
    const result = sealCrawlManifest(source, requests);
    expect(result.manifest.requests[2]).toMatchObject({ state: "blocked", robotsResponseId: source.robotsResponseId });
    expect(result.manifest.requests[2]).not.toHaveProperty("facts"); expect(result.manifest.bytes).toBe(source.capturedBytes);
    requests[2]!.acceptedResponseId = randomUUID(); expect(() => sealCrawlManifest(source, requests)).toThrow(/invent/);
  });
  it("refuses another same-host WordPress instance's original endpoint", () => {
    const { source, requests } = fixture(); requests[1]!.url = `${site}other/wp-json/wp/v2/pages?per_page=100&page=1&_embed=1&orderby=id&order=asc`; requests[1]!.urlDigest = hash(requests[1]!.url); requests[1]!.role = "rest-pages"; requests[1]!.restPage = 1;
    expect(() => sealCrawlManifest({ ...source, kind: "wordpress-rest", siteUrl: `${site}selected/` }, requests)).toThrow(/instance/);
  });
});
