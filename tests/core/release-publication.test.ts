// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exercise the publication boundary and verify signed metadata reaches runtime.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { publicationPlan, assertStableCompletion } from "../../scripts/release-publication.mjs";
import { buildReleaseEntry, signFeed } from "../../scripts/release-feed.mjs";
import { parseReleaseMetadata } from "@/core/update/release";
import { verifyReleaseFeed } from "@/core/update/feed";
import { compareVersions, missingReleases } from "@/core/update/fork";
import { THIS_RELEASE } from "@/core/update/this-release";

const declaration = { version: "1.0.0-rc.1", channel: "edge", minFromVersion: "0.1.0", schemaRisk: "breaking", cvss: null, severity: "none", manualSteps: [{ id: "restore-backup", summary: "Rehearse backup restoration before migration." }], pluginApi: "0.1.0" };
const input = { event: "push", ref: "refs/tags/v1.0.0-rc.1", sha: "a".repeat(40), image: "ghcr.io/campdenman/freeholder", declaration };
const completed = "- [x] **C11.10** Reviewed.\n- [x] **C11.17** Accepted.\n| Owner signature | Tony Aly, acceptance SHA recorded |\n";

describe("release publication (C3.20/C10.02/C10.03)", () => {
  it("keeps candidates out of stable/latest image and npm tags", () => {
    const plan = publicationPlan(input);
    expect(plan.tags).toEqual([`${input.image}:1.0.0-rc.1`, `${input.image}:sha-${input.sha.slice(0, 12)}`]);
    expect(plan).toMatchObject({ prerelease: true, stable: false, npmTag: "next" });
    expect(() => publicationPlan({ ...input, declaration: { ...declaration, channel: "stable" } })).toThrow(/prerelease/);
  });

  it("refuses unsigned/incomplete stable publication before changing any tags", () => {
    const stable = { ...input, ref: "refs/tags/v1.0.0", declaration: { ...declaration, version: "1.0.0", channel: "stable" } };
    expect(() => publicationPlan(stable)).toThrow(/completed MASTER/);
    expect(() => assertStableCompletion(completed.replace("Tony Aly, acceptance SHA recorded", "_unsigned"))).toThrow(/signature/);
    const plan = publicationPlan({ ...stable, master: completed });
    expect(plan).toMatchObject({ prerelease: false, stable: true, npmTag: "latest" });
    expect(plan.tags).toContain(`${input.image}:stable`);
    expect(plan.tags).toContain(`${input.image}:latest`);
    expect(() => assertStableCompletion(`${completed}\n- [ ] **F01** Per-feature definition template.`)).not.toThrow();
  });

  it("refuses mismatched tags, nonfinal edge tags and missing breaking recovery steps", () => {
    expect(() => publicationPlan({ ...input, ref: "refs/tags/v1.0.0-rc.2" })).toThrow(/does not match/);
    expect(() => publicationPlan({ ...input, ref: "refs/tags/v1.0.0", declaration: { ...declaration, version: "1.0.0" } })).toThrow(/prerelease version/);
    expect(() => publicationPlan({ ...input, declaration: { ...declaration, manualSteps: [] } })).toThrow(/recovery/);
    const plan = publicationPlan({ ...input, event: "workflow_run", declaration: THIS_RELEASE });
    expect(plan.tags).toContain(`${input.image}:edge`);
    expect(plan.tags).not.toContain(`${input.image}:latest`);
  });

  it("round-trips the exact declared risk and manual steps through a signed feed", () => {
    const plan = publicationPlan(input);
    const entry = buildReleaseEntry({ ...plan.release, digest: `sha256:${"b".repeat(64)}`, image: input.image, notesUrl: "https://example.test/releases/v1.0.0-rc.1", publishedAt: "2026-10-04T00:00:00Z", provenance: { repository: "CampDenman/freeholder", workflow: "Publish image" } });
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const signed = signFeed({ releases: [entry] }, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "acceptance");
    const verified = verifyReleaseFeed(signed, [{ id: "acceptance", status: "active", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() }]);
    expect(parseReleaseMetadata(verified.releases[0])).toEqual(plan.release);
    expect(missingReleases({ currentVersion: "0.1.0", channel: "stable", releases: verified.releases })).toEqual([]);
    expect(missingReleases({ currentVersion: "0.1.0", channel: "edge", releases: verified.releases })).toHaveLength(1);
  });

  it("orders candidates numerically and offers the final release after a candidate", () => {
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc.10", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0-beta.2")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha-beta", "1.0.0-alpha-beta")).toBe(0);
    expect(compareVersions("1.0.0-01", "1.0.0")).toBeNull();
    expect(compareVersions("01.0.0", "1.0.0")).toBeNull();
  });

  it("uses the same declaration in the current image and tag publisher", () => {
    expect(JSON.parse(readFileSync("src/core/update/release-declaration.json", "utf8"))).toEqual(THIS_RELEASE);
  });
});
