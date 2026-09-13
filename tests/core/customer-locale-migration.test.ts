// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.16: locale snapshots on the right tables, and the header chooser a
// fresh install still gets (now seed data, not a one-shot UPDATE).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultHeader } from "@/modules/cms/defaults";
import { reviewMigration } from "../../scripts/schema-compat-gate.mjs";

const PATH = "db/migrations/0000_reviewed-baseline.sql";
const migration = readFileSync(PATH, "utf8");

function tableSql(name: string): string {
  const start = migration.indexOf(`CREATE TABLE "${name}"`);
  expect(start, name).toBeGreaterThan(-1);
  const end = migration.indexOf("\n--> statement-breakpoint", start);
  return migration.slice(start, end === -1 ? undefined : end);
}

describe("the C1.16 locale migration", () => {
  it("adds recipient locale snapshots and an owner-editable header chooser", () => {
    expect(tableSql("notification_digests")).toContain(
      '"locale" text DEFAULT \'en\' NOT NULL',
    );
    expect(tableSql("notifications")).toContain(
      '"locale" text DEFAULT \'en\' NOT NULL',
    );
    expect(tableSql("customer_magic_links")).toContain('"locale" text');
    const header = JSON.stringify(defaultHeader());
    expect(header).toContain('"id":"header-locales"');
    expect(header).toContain('"type":"locales"');
  });

  it("lives in the reviewed baseline", () => {
    expect(reviewMigration(PATH, migration)).toMatchObject({
      ok: true,
      acknowledged: true,
    });
  });
});
