// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CHANNELS, channelReceives, RELEASE_CHANNELS } from "@/core/update/channels";
import {
  canApplyFrom,
  parseReleaseMetadata,
  ReleaseMetadataError,
  severityForCvss,
} from "@/core/update/release";
import { describeRelease } from "@/core/update/service";
import { THIS_RELEASE } from "@/core/update/this-release";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

function sample(over: Record<string, unknown> = {}): unknown {
  return {
    version: "1.2.4",
    channel: "stable",
    minFromVersion: "1.2.0",
    schemaRisk: "compatible",
    cvss: null,
    severity: "none",
    manualSteps: [],
    pluginApi: "1.2.0",
    ...over,
  };
}

describe("release channels (C10.02)", () => {
  it("names stable, security and edge", () => {
    expect(RELEASE_CHANNELS).toEqual(["stable", "security", "edge"]);
    expect(CHANNELS.map((channel) => channel.id)).toEqual([...RELEASE_CHANNELS]);
  });

  it("offers security to stable subscribers and everything to edge", () => {
    expect(channelReceives("stable", "security")).toBe(true);
    expect(channelReceives("stable", "edge")).toBe(false);
    expect(channelReceives("security", "stable")).toBe(false);
    expect(channelReceives("security", "security")).toBe(true);
    expect(channelReceives("edge", "stable")).toBe(true);
    expect(channelReceives("edge", "security")).toBe(true);
    expect(channelReceives("edge", "edge")).toBe(true);
  });
});

describe("release metadata (C10.02)", () => {
  it("parses a complete declaration", () => {
    expect(parseReleaseMetadata(sample())).toMatchObject({
      version: "1.2.4",
      channel: "stable",
      schemaRisk: "compatible",
    });
  });

  it("refuses to infer schema risk from a patch bump", () => {
    const missing = sample();
    delete (missing as { schemaRisk?: string }).schemaRisk;
    expect(() => parseReleaseMetadata(missing)).toThrow(ReleaseMetadataError);
    expect(() => parseReleaseMetadata(missing)).toThrow(/will not infer/i);
  });

  it("refuses to infer minFromVersion from the version number", () => {
    const missing = sample();
    delete (missing as { minFromVersion?: string }).minFromVersion;
    expect(() => parseReleaseMetadata(missing)).toThrow(/will not infer/i);
  });

  it("refuses a security-channel release without a CVSS score", () => {
    expect(() =>
      parseReleaseMetadata(sample({ channel: "security" })),
    ).toThrow(/CVSS score/i);
  });

  it("refuses a security-channel release that breaks schema", () => {
    expect(() =>
      parseReleaseMetadata(
        sample({ channel: "security", cvss: 7.5, severity: "high", schemaRisk: "breaking" }),
      ),
    ).toThrow(/cannot break schema/i);
  });

  it("refuses a CVSS score whose severity band does not match", () => {
    expect(() =>
      parseReleaseMetadata(sample({ cvss: 9.1, severity: "low" })),
    ).toThrow(/does not match CVSS/i);
    expect(severityForCvss(9.1)).toBe("critical");
  });

  it("applies from minFromVersion, not from a patch looking close enough", () => {
    const release = parseReleaseMetadata(sample({ version: "1.0.1", minFromVersion: "1.0.1" }));
    expect(canApplyFrom("1.0.0", release).ok).toBe(false);
    expect(canApplyFrom("1.0.1", release).ok).toBe(true);
  });

  it("records a breaking patch instead of assuming a patch is compatible", () => {
    const release = parseReleaseMetadata(
      sample({ version: "1.2.4", minFromVersion: "1.2.0", schemaRisk: "breaking" }),
    );
    expect(release.schemaRisk).toBe("breaking");
    expect(canApplyFrom("1.2.3", release).ok).toBe(true);
  });
});

describe.runIf(hasDatabase)("platform.describeRelease (C10.02)", { timeout: 60_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("returns this build's declared metadata and refuses anonymous callers", async () => {
    const report = await describeRelease.call({}, OWNER);
    expect(report.version).toBe(THIS_RELEASE.version);
    expect(report.channel).toBe("edge");
    expect(report.schemaRisk).toBe("compatible");
    expect(report.cvss).toBeNull();
    expect(report.channels.map((channel) => channel.id)).toEqual(["stable", "security", "edge"]);
    const fromHere = await describeRelease.call({ fromVersion: THIS_RELEASE.minFromVersion }, OWNER);
    expect(fromHere.apply?.ok).toBe(true);
    const denied = await failure(describeRelease.call({}, ANONYMOUS));
    expect(denied.code).toBe("permission");
  });
});
