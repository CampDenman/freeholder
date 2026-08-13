// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// C1.19 forward-only schema evidence for bounded CSP diagnostics.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewMigration } from "../../scripts/schema-compat-gate.mjs";

const PATH = "db/migrations/0037_tidy_thunderbolts.sql";
const migration = readFileSync(PATH, "utf8");

describe("the C1.19 CSP report migration", () => {
  it("adds the bounded diagnostics table and its invariants", () => {
    expect(migration).toContain('CREATE TABLE "csp_violations"');
    expect(migration).toContain('CONSTRAINT "csp_violations_occurrences_positive"');
    expect(migration).toContain('CONSTRAINT "csp_violations_disposition_valid"');
    expect(migration).toContain('CREATE INDEX "csp_violations_expires_at_idx"');
    expect(migration).not.toMatch(/user.agent|referrer|script.sample|raw.payload/i);
  });

  it("is an additive N-1-compatible forward migration", () => {
    expect(reviewMigration(PATH, migration)).toMatchObject({ ok: true, breaking: [] });
    expect(migration).not.toMatch(/\b(?:DROP|RENAME|TRUNCATE)\b/i);
  });
});
