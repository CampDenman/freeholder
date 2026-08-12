// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// C1.16 forward migration: locale evidence and editable chooser seed data.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewMigration } from "../../scripts/schema-compat-gate.mjs";

const PATHS = [
  "db/migrations/0034_furry_ozymandias.sql",
  "db/migrations/0035_slim_wiccan.sql",
] as const;
const migrations = PATHS.map((path) => [path, readFileSync(path, "utf8")] as const);
const migration = migrations.map(([, sql]) => sql).join("\n");

describe("the C1.16 locale migration", () => {
  it("adds recipient locale snapshots and an owner-editable header chooser", () => {
    expect(migration).toContain('"notification_digests" ADD COLUMN "locale"');
    expect(migration).toContain('"notifications" ADD COLUMN "locale"');
    expect(migration).toContain('"customer_magic_links" ADD COLUMN "locale"');
    expect(migration).toContain('"preferred_locale" = ANY("business"."enabled_locales")');
    expect(migration).toContain('"type":"locales"');
    expect(migration).toContain("jsonb_path_exists");
  });

  it("is an additive N-1-compatible forward migration", () => {
    for (const [path, sql] of migrations) {
      expect(reviewMigration(path, sql)).toMatchObject({ ok: true, breaking: [] });
    }
    expect(migration).not.toMatch(/\b(?:DROP|RENAME|TRUNCATE)\b/i);
  });
});
