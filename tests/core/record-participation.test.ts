// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: user-owned (contact-attached) records must participate in merge,
// privacy export/erasure, ownership export, search, audit and restore.
// Remaining product-wide gaps stay named — checking the item without them
// would be a fake close.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import manifests from "@/modules";
import { contacts } from "@/core/contacts/schema";
import { contactReferences } from "@/core/contacts/service";
import { contactPrivacySources } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { listServices } from "@/core/service";

export const C11_14_REMAINING = [
  "Per-record restore is contact-merge undo plus the ownership-drill instance restore; there is no undelete for every entity.",
  "Remaining SEARCH_TABLE_OPT_OUTS cover operational rows, join tables and workflow records reached through their parent; these are not mixed into search.query.",
] as const;

let tables: PgTable[] = [];

beforeAll(async () => {
  await ready();
  const found: PgTable[] = [];
  for (const manifest of manifests) {
    if (!manifest.tables) continue;
    const owned: Record<string, unknown> = await manifest.tables();
    for (const value of Object.values(owned)) {
      if (is(value, PgTable)) found.push(value);
    }
  }
  tables = found;
});

function contactForeignKeys(): Array<{ table: string; column: string }> {
  const contactsTable = getTableConfig(contacts).name;
  const found: Array<{ table: string; column: string }> = [];
  for (const table of tables) {
    const config = getTableConfig(table);
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      if (getTableConfig(reference.foreignTable).name !== contactsTable) continue;
      for (const column of reference.columns) {
        found.push({ table: config.name, column: column.name });
      }
    }
  }
  return found;
}

describe("user-owned record participation (C11.14)", () => {
  it("still finds contact foreign keys by reflection", () => {
    const keys = contactForeignKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContainEqual({ table: "timeline_events", column: "contact_id" });
  });

  it("repoints every contact foreign key in contacts.merge", () => {
    const covered = new Set(contactReferences().map((row) => row.table));
    const missing = [
      ...new Set(
        contactForeignKeys()
          .map((row) => row.table)
          .filter((table) => !covered.has(table)),
      ),
    ];
    expect(missing, missing.join(", ")).toEqual([]);
  });

  it("registers export and erasure for every contact foreign key", () => {
    const covered = new Set(contactPrivacySources().flatMap((source) => source.tables));
    const missing = [
      ...new Set(
        contactForeignKeys()
          .map((row) => row.table)
          .filter((table) => !covered.has(table)),
      ),
    ];
    expect(missing, missing.join(", ")).toEqual([]);
  });

  it("exports the whole schema rather than a hand-maintained table list", () => {
    const source = readFileSync("src/core/portability/ownership-export.mjs", "utf8");
    expect(source).toContain("from information_schema.tables");
    expect(source).toContain("from information_schema.columns");
    expect(source).not.toMatch(/ALLOWLIST_TABLES|ONLY_TABLES/);
  });

  it("restores through the ownership drill pair matrix", () => {
    const drill = readFileSync("scripts/ownership-drill.mjs", "utf8");
    expect(drill).toContain("runOwnershipDrill");
    expect(drill).toContain("--all-pairs");
  });

  it("searches the spine through contacts.list rather than a second customer store", () => {
    expect(listServices().has("contacts.list")).toBe(true);
    const source = readFileSync("src/core/contacts/service.ts", "utf8");
    expect(source).toContain('name: "contacts.list"');
    expect(source).toContain("search: z.string()");
    expect(source).toContain("ilike(contacts.name");
  });

  it("audits mutations through the service wrapper", () => {
    const create = listServices().get("contacts.create");
    expect(create?.def.kind).toBe("mutation");
    expect(create?.def.permission).toBe("scoped");
    const source = readFileSync("src/core/service.ts", "utf8");
    expect(source).toContain("auditLog");
  });

  it("names the remaining product-wide gaps instead of checking C11.14 early", () => {
    const master = readFileSync("MASTER.md", "utf8");
    expect(master).toMatch(/- \[ \] \*\*C11\.14\*\*/);
    for (const gap of C11_14_REMAINING) {
      expect(master, gap).toContain(gap);
    }
  });
});
