// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { previousFeedTag } from "../../scripts/release-history.mjs";
import { assertActiveSigningKey, buildReleaseEntry, previousReleases, signFeed } from "../../scripts/release-feed.mjs";

describe("signed release history (C10.03)", () => {
  it("rejects a mismatched or retiring publication key before image promotion", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const keys = [{ id: "current", status: "active", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() }];
    expect(() => assertActiveSigningKey(pem, "current", keys)).not.toThrow();
    expect(() => assertActiveSigningKey(other.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "current", keys)).toThrow(/not signed by a trusted/);
    expect(() => assertActiveSigningKey(pem, "current", [{ ...keys[0]!, status: "retiring" }])).toThrow(/active trusted/);
  });
  it("finds a newer candidate feed even when GitHub latest names an older final release", () => {
    const release = (tag: string, published: string, extra = {}) => ({
      tag_name: tag, published_at: published, draft: false,
      assets: [{ name: "releases.json" }], ...extra,
    });
    expect(previousFeedTag([
      [release("v1.0.0", "2026-10-01T00:00:00Z"), release("v1.1.0-rc.1", "2026-10-02T00:00:00Z")],
      [release("v1.1.0-rc.2", "2026-10-03T00:00:00Z", { prerelease: true }),
        release("v1.1.0", "2026-10-04T00:00:00Z", { draft: true }),
        release("v2.0.0", "2026-10-05T00:00:00Z", { assets: [] })],
    ])).toBe("v1.1.0-rc.2");
    expect(previousFeedTag([[]])).toBe("");
    expect(() => previousFeedTag([[release("v1.0.0", "invalid")]])).toThrow(/publication time/);
  });

  it("refuses to re-sign unsigned or tampered previous release history", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const keys = [{ id: "history", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() }];
    const entry = buildReleaseEntry({ version: "1.0.0-rc.1", channel: "edge", minFromVersion: "0.1.0",
      schemaRisk: "compatible", cvss: null, severity: "none", manualSteps: [], pluginApi: "0.1.0",
      digest: `sha256:${"a".repeat(64)}`, image: "ghcr.io/campdenman/freeholder",
      notesUrl: "https://example.test/rc.1", publishedAt: "2026-10-01T00:00:00Z",
      provenance: { repository: "CampDenman/freeholder", workflow: "Publish image" } });
    const signed = signFeed({ releases: [entry] }, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "history");
    expect(previousReleases(signed, keys)).toEqual([entry]);
    expect(() => previousReleases({ releases: [entry] }, keys)).toThrow(/signature|Freeholder release feed/);
    expect(() => previousReleases({ ...signed, releases: [{ ...entry, digest: `sha256:${"b".repeat(64)}` }] }, keys)).toThrow(/not signed by a trusted/);
    expect(() => previousReleases(signed, [])).toThrow(/unknown key/);
  });
});
