// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The migration journal says what it will actually do (MASTER.md §15.9, §39.5).
//
// Drizzle applies a migration only when its `when` is strictly greater than
// the newest one the database has already run. Two branches that each add a
// migration pick their own `when`, and if they collide, the second to merge is
// skipped — silently, permanently, on every database that already ran the
// first. Nothing fails: `migrate` reports success, the table is simply never
// created, and the breakage surfaces later as a missing relation in
// production.
//
// This test is cheap and needs no database, which is the point: a collision is
// a merge-time accident, so it has to be caught at merge time.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FOLDER = "db/migrations";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function journal(): JournalEntry[] {
  const raw = readFileSync(`${FOLDER}/meta/_journal.json`, "utf8");
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

describe("the migration journal", () => {
  it("orders every migration strictly after the one before it", () => {
    const entries = journal();
    expect(entries.length).toBeGreaterThan(0);
    for (let index = 1; index < entries.length; index++) {
      const previous = entries[index - 1]!;
      const current = entries[index]!;
      // Strictly greater, not merely non-decreasing: equal timestamps are the
      // collision this exists to catch, and a later migration is skipped
      // rather than run out of order.
      expect(
        current.when,
        `${current.tag} would be skipped on any database that has already run ${previous.tag}: give it a later "when" than ${previous.when}`,
      ).toBeGreaterThan(previous.when);
    }
  });

  it("has a file for every entry, and an entry for every file", () => {
    const entries = journal();
    const files = readdirSync(FOLDER)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.replace(/\.sql$/, ""))
      .sort();
    const tags = entries.map((entry) => entry.tag).sort();
    // Both directions. A file with no entry never runs; an entry with no file
    // fails the migrator outright, which is the friendlier of the two.
    expect(tags).toEqual(files);
  });
});
