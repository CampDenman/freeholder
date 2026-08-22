// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A route that asks the registry a question must boot it first.
//
// This exists because the opposite shipped, twice over. C6.06's two `/ics`
// routes reached `getService("calendars.feed")` without `await ready()`, and
// the registry a cold process starts with is empty — so `getService` threw and
// a perfectly valid feed token answered 500. Nothing caught it: the services
// were registered, the tests called the service objects directly, and the
// failure only appears in a process that has not booted for another reason.
//
// The check is deliberately structural rather than behavioural. Booting a
// Next route handler in a test is more machinery than the bug is worth, and
// the rule itself is simple enough to read off the file: if you name the
// registry, you name `ready` too.
import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Every route handler and page under app/. */
async function routeFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.tsx?$/.test(entry.name)) found.push(path);
    }
  }
  await walk(root);
  return found;
}

describe("routes that use the service registry", () => {
  it("boot it before asking it anything", async () => {
    const files = await routeFiles("app");
    expect(files.length).toBeGreaterThan(20);

    const missing: string[] = [];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      // `getService` is the door that **throws** on an empty registry, which is
      // what turns a missing boot into a 500 rather than a degraded answer.
      // `listServices` returns a possibly-empty map and every caller already
      // has to handle a name it does not know — `describeAction` falls back to
      // derived prose for audit rows naming a service that has since been
      // removed — so it is not covered here.
      //
      // Importing a service object directly needs no boot at all, which is why
      // the rest of `app/` is untouched by this rule.
      if (!/\bgetService\s*\(/.test(source)) continue;
      if (!/\bready\s*\(\s*\)/.test(source)) missing.push(path);
    }

    // Named exactly: "a route is missing boot" is not actionable.
    expect(missing).toEqual([]);
  });
});
