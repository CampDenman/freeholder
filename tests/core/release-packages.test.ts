// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertTagMatchesVersion,
  parseReleaseTag,
  readAlignedVersion,
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
});
