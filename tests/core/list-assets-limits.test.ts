// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A page that asks media.list for more rows than the service allows gets a
// validation error, which the admin's domainOrNull turns into an empty list.
// Found in the C3.39 rehearsal: the project page's Deliver picker and image
// picker were always empty because they asked for 500 rows (the cap is 100).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("media.list callers", () => {
  it("never ask for more rows than the service accepts", () => {
    const offenders: string[] = [];
    for (const file of [...files(join(process.cwd(), "app")), ...files(join(process.cwd(), "src"))]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/listAssets\.call\(\{[^}]*limit:\s*(\d+)/g)) {
        if (Number(match[1]) > 100) offenders.push(`${file}: limit ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
