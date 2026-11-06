// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertFirstPartyPluginRanges,
  assertTagMatchesVersion,
  firstPartyPluginRange,
  parseReleaseTag,
  readAlignedVersion,
  readFirstPartyPluginRanges,
  releaseTag,
  sdkVersionFromSource,
} from "../../scripts/release-packages.mjs";
import { PLATFORM_VERSION } from "@/core/platform";

describe("package release alignment (C3.20)", () => {
  it("keeps every distributable package and the SDK on the platform version", async () => {
    const version = await readAlignedVersion();
    expect(version).toBe(PLATFORM_VERSION);
    expect(version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/);
    expect(version).not.toBe("0.0.0");
    expect(releaseTag(version)).toBe(`v${version}`);
  });

  it("stamps the SDK source from the same version string", () => {
    const source = readFileSync("packages/sdk/src/version.ts", "utf8");
    expect(sdkVersionFromSource(source)).toBe(PLATFORM_VERSION);
  });

  it("refuses a tag that does not match the platform version", () => {
    expect(parseReleaseTag("refs/tags/v0.1.0")).toBe("0.1.0");
    expect(parseReleaseTag("v1.2.3")).toBe("1.2.3");
    expect(parseReleaseTag("main")).toBeNull();
    expect(() => assertTagMatchesVersion("refs/tags/v9.9.9", PLATFORM_VERSION)).toThrow(/does not match/);
    expect(() => assertTagMatchesVersion(`refs/tags/${releaseTag(PLATFORM_VERSION)}`, PLATFORM_VERSION)).not.toThrow();
  });

  it("keeps every first-party plugin range on the platform's major and minor", async () => {
    const expected = firstPartyPluginRange(PLATFORM_VERSION);
    expect(expected).toMatch(/^\^\d+\.\d+\.0$/);
    const ranges = await readFirstPartyPluginRanges();
    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range.pluginJson, `plugins/${range.folder}/plugin.json`).toBe(expected);
      expect(range.manifest, `plugins/${range.folder}/manifest.ts`).toBe(expected);
    }
  });

  it("refuses a release whose first-party plugin ranges were not bumped", async () => {
    expect(firstPartyPluginRange("0.2.0-beta.3")).toBe("^0.2.0");
    expect(firstPartyPluginRange("1.4.2")).toBe("^1.4.0");
    expect(() => firstPartyPluginRange("main")).toThrow(/not semver/);
    expect(() =>
      assertFirstPartyPluginRanges(
        [{ folder: "gift-registry", pluginJson: ">=0.0.0", manifest: ">=0.0.0" }],
        "0.2.0",
      ),
    ).toThrow(/plugins\/gift-registry\/plugin\.json declares freeholder ">=0\.0\.0"; release 0\.2\.0 needs "\^0\.2\.0"/);
    expect(() =>
      assertFirstPartyPluginRanges(
        [{ folder: "voice-video", pluginJson: "^0.2.0", manifest: ">=0.0.0" }],
        "0.2.0",
      ),
    ).toThrow(/plugins\/voice-video\/manifest\.ts/);
    const [major, minor] = PLATFORM_VERSION.split(".").map(Number);
    await expect(
      readFirstPartyPluginRanges().then((ranges) =>
        assertFirstPartyPluginRanges(ranges, `${major}.${(minor ?? 0) + 1}.0`),
      ),
    ).rejects.toThrow(/Bump every first-party plugin range/);
  });
});
