// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// C1.18 additive analytics governance and attribution migration.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewMigration } from "../../scripts/schema-compat-gate.mjs";

const PATH = "db/migrations/0036_milky_radioactive_man.sql";
const migration = readFileSync(PATH, "utf8");

describe("the C1.18 analytics migration", () => {
  it("adds attribution, idempotency and reversible classification evidence", () => {
    expect(migration).toContain('CREATE TABLE "analytics_attributions"');
    expect(migration).toContain('ADD COLUMN "event_key"');
    expect(migration).toContain('ADD COLUMN "classification_override"');
    expect(migration).toContain('ADD COLUMN "classification_note"');
    expect(migration).toContain('CREATE UNIQUE INDEX "analytics_event_key_idx"');
    expect(migration).toContain('CREATE INDEX "analytics_effective_kind_at_idx"');
    expect(migration).toContain('CONSTRAINT "analytics_classification_override_valid"');
  });

  it("is an additive N-1-compatible forward migration", () => {
    expect(reviewMigration(PATH, migration)).toMatchObject({ ok: true, breaking: [] });
    expect(migration).not.toMatch(/\b(?:DROP|RENAME|TRUNCATE)\b/i);
  });
});
