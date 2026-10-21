// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.15: release notes have an output, not only the changeset input gate.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  changelogTopVersion,
  collectChangesets,
  renderChangelog,
} from "../../scripts/generate-changelog.mjs";
import { PLATFORM_VERSION } from "@/core/platform";

describe("CHANGELOG.md output (C11.15)", () => {
  it("keeps the full candidate identity rather than accepting a truncated final version", () => {
    expect(changelogTopVersion(renderChangelog("1.0.0-rc.10", []))).toBe("1.0.0-rc.10");
    expect(changelogTopVersion("## 1.0.0-01\n")).toBeNull();
    expect(changelogTopVersion("## 01.0.0\n")).toBeNull();
    expect(changelogTopVersion("## 1.0.0-rc.1 unexpected\n")).toBeNull();
  });
  it("heads the file with the same version health and package.json publish", () => {
    const source = readFileSync("CHANGELOG.md", "utf8");
    expect(changelogTopVersion(source)).toBe(PLATFORM_VERSION);
    expect(PLATFORM_VERSION).not.toBe("0.0.0");
  });

  it("is generated from the changeset inbox without consuming it", () => {
    const entries = collectChangesets();
    expect(entries.length).toBeGreaterThan(0);
    const rendered = renderChangelog(PLATFORM_VERSION, entries);
    expect(rendered).toContain(`## ${PLATFORM_VERSION}`);
    expect(readFileSync("CHANGELOG.md", "utf8")).toBe(rendered);
  });
});
