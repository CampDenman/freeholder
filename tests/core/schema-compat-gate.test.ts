// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The schema-compatibility gate (MASTER.md §15.9, §39.5).
//
// A gate is worth exactly as much as the proof that it can fail, and this one
// guards a promise — that rolling back is an image swap rather than a restore —
// which is invisible until the day somebody needs it. So its detector is
// tested directly, including the ways it must *not* fire: a gate that cries
// wolf on every additive migration gets bypassed within a month, and a
// bypassed gate protects nothing.
import { describe, expect, it } from "vitest";
import {
  acknowledgement,
  findBreakingStatements,
  reviewMigration,
  stripComments,
} from "../../scripts/schema-compat-gate.mjs";

const ids = (sql: string) =>
  findBreakingStatements(sql).map((b: { id: string }) => b.id);

describe("what breaks the previous release", () => {
  it("catches the statements that leave old code reading something gone", () => {
    expect(ids('DROP TABLE "redirects";')).toContain("drop-table");
    expect(ids('ALTER TABLE "pages" DROP COLUMN "legacy_ref";')).toContain(
      "drop-column",
    );
    expect(ids('ALTER TABLE "pages" RENAME COLUMN "a" TO "b";')).toContain(
      "rename",
    );
    expect(
      ids('ALTER TABLE "pages" ALTER COLUMN "views" SET DATA TYPE bigint;'),
    ).toContain("retype-column");
  });

  it("catches a NOT NULL the previous release cannot satisfy", () => {
    // The old code inserts rows without this column, so every write it makes
    // fails the moment the constraint lands.
    expect(
      ids('ALTER TABLE "contacts" ALTER COLUMN "country" SET NOT NULL;'),
    ).toContain("not-null-without-default");
    expect(
      ids('ALTER TABLE "contacts" ADD COLUMN "region" text NOT NULL;'),
    ).toContain("add-required-column");
  });

  it("is quiet about everything expand-then-contract asks for", () => {
    // This is the half that keeps the gate credible. Each of these is the
    // *recommended* shape, and firing on them would teach people to skip it.
    const additive = [
      'CREATE TABLE "loyalty_accounts" ("id" uuid PRIMARY KEY);',
      'ALTER TABLE "contacts" ADD COLUMN "nickname" text;',
      `ALTER TABLE "contacts" ADD COLUMN "tier" text DEFAULT 'lead' NOT NULL;`,
      'CREATE INDEX "contacts_email_idx" ON "contacts" ("email");',
      'ALTER TABLE "contacts" ALTER COLUMN "email" DROP NOT NULL;',
      'DROP INDEX "contacts_stale_idx";',
    ];
    for (const sql of additive) {
      expect({ sql, breaking: ids(sql) }).toEqual({ sql, breaking: [] });
    }
  });

  it("does not read SQL that is only a comment", () => {
    // Somebody explaining the rule in a migration must not trip it.
    const sql = `-- We deliberately do not DROP COLUMN here; see §39.5.
      ALTER TABLE "pages" ADD COLUMN "summary" text;`;
    expect(ids(sql)).toEqual([]);
    expect(stripComments("/* DROP TABLE x */ SELECT 1;")).not.toMatch(/DROP/i);
  });
});

describe("the acknowledgement", () => {
  const drop = 'ALTER TABLE "pages" DROP COLUMN "legacy_ref";';

  it("fails an unacknowledged break", () => {
    const review = reviewMigration("0009_x.sql", drop);
    expect(review.ok).toBe(false);
    expect(review.breaking.map((b: { id: string }) => b.id)).toEqual([
      "drop-column",
    ]);
  });

  it("passes when somebody said why, and reports it", () => {
    const review = reviewMigration(
      "0009_x.sql",
      `-- freeholder:schema-breaking drops pages.legacy_ref, expanded in 1.3\n${drop}`,
    );
    expect(review.ok).toBe(true);
    expect(review.acknowledged).toBe(true);
    expect(review.reason).toContain("legacy_ref");
  });

  it("refuses an acknowledgement that says nothing", () => {
    // "-- freeholder:schema-breaking" alone is a checkbox, not a decision.
    const review = reviewMigration(
      "0009_x.sql",
      `-- freeholder:schema-breaking\n${drop}`,
    );
    expect(review.ok).toBe(false);
    expect(review.empty).toBe(true);
  });

  it("finds nothing to acknowledge in an ordinary migration", () => {
    expect(acknowledgement('ALTER TABLE "x" ADD COLUMN "y" text;')).toBeNull();
  });
});

describe("the migrations already in the tree", () => {
  // Everything up to and including this file predates the gate. They are not
  // exempt because they are innocent — 0001 retypes a column — but because a
  // migration's hash is recorded in the journal of every database that has run
  // it, so editing one to add an acknowledgement would break every existing
  // deployment. The baseline is written down here rather than implied.
  const PRE_GATE = "0005";

  it("everything written since the gate keeps the previous release readable", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = "db/migrations";
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => f.slice(0, 4) > PRE_GATE);

    const offenders = files
      .map((f) => reviewMigration(f, readFileSync(`${dir}/${f}`, "utf8")))
      .filter((r: { ok: boolean }) => !r.ok)
      .map((r: { path: string }) => r.path);
    expect(offenders).toEqual([]);
  });

  it("would have caught the one pre-gate migration that breaks N-1", async () => {
    // Proof the detector fires on real SQL and not only on fixtures: 0001
    // contains `ALTER COLUMN ... SET DATA TYPE`. It was harmless then — there
    // was no previous release to break — and it is the reason the baseline
    // exists rather than a claim that the history was always compliant.
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("db/migrations/0001_business-profile.sql", "utf8");
    expect(ids(sql)).toContain("retype-column");
  });
});
