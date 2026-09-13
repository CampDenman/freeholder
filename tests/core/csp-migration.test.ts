// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.19 forward-only schema evidence for bounded CSP diagnostics.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewMigration } from "../../scripts/schema-compat-gate.mjs";

const PATH = "db/migrations/0000_reviewed-baseline.sql";
const migration = readFileSync(PATH, "utf8");

describe("the C1.19 CSP report migration", () => {
  it("adds the bounded diagnostics table and its invariants", () => {
    expect(migration).toContain('CREATE TABLE "csp_violations"');
    expect(migration).toContain('CONSTRAINT "csp_violations_occurrences_positive"');
    expect(migration).toContain('CONSTRAINT "csp_violations_disposition_valid"');
    expect(migration).toContain('CREATE INDEX "csp_violations_expires_at_idx"');
    const table = migration.slice(
      migration.indexOf('CREATE TABLE "csp_violations"'),
      migration.indexOf('CREATE TABLE "csp_violations"') + 1500,
    );
    expect(table).not.toMatch(/user.agent|referrer|script.sample|raw.payload/i);
  });

  it("lives in the reviewed baseline", () => {
    expect(reviewMigration(PATH, migration)).toMatchObject({
      ok: true,
      acknowledged: true,
    });
  });
});
