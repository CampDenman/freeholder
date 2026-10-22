// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// UTF-8 text that was once decoded as Windows-1252 and saved again turns "·"
// into "Â·" and "—" into "â€”". It reached owners' invoices that way, so the
// tracked tree is checked for the tell-tale sequences.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MOJIBAKE = /Â[·°©®«» ]|â€[\u0080-ÿ–—‘-„†-•…‰‹›€™]|Ã[©¨¢ ]/;

// Files that quote the corruption on purpose, to explain what they prevent.
const DELIBERATE = new Set([
  "src/core/reporting/csv.ts",
  "tests/core/text-encoding.test.ts",
]);

const TEXT = /\.(ts|tsx|mjs|cjs|js|json|md|yml|yaml|css|sql|sh|py)$/;

describe("text encoding", () => {
  it("has no doubly-encoded UTF-8 in tracked source and docs", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter((path) => TEXT.test(path) && !DELIBERATE.has(path))
      .filter((path) => path !== "CHANGELOG.md" && path !== "pnpm-lock.yaml");
    const offenders: string[] = [];
    for (const path of files) {
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (MOJIBAKE.test(line)) offenders.push(`${path}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
