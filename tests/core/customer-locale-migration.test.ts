// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.16 forward migration: locale evidence and editable chooser seed data.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewMigration } from "../../scripts/schema-compat-gate.mjs";

const PATH = "db/migrations/0000_reviewed-baseline.sql";
const migration = readFileSync(PATH, "utf8");

describe("the C1.16 locale migration", () => {
  it("adds recipient locale snapshots and an owner-editable header chooser", () => {
    expect(migration).toContain('CREATE TABLE "notification_digests"');
    expect(migration).toContain('CREATE TABLE "notifications"');
    expect(migration).toContain('CREATE TABLE "customer_magic_links"');
    expect(migration).toContain('"preferred_locale"');
    expect(migration).toContain('"enabled_locales"');
  });

  it("lives in the reviewed baseline", () => {
    expect(reviewMigration(PATH, migration)).toMatchObject({
      ok: true,
      acknowledged: true,
    });
  });
});
