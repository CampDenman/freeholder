// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The merge completeness gate (CLAUDE.md non-negotiable, MASTER.md §2
// principle 3).
//
// `contacts.merge` repoints foreign keys from a hand-maintained list, because
// only a human can decide what a merge means for a table whose contact_id sits
// in a unique constraint. The failure mode of a hand-maintained list is that
// somebody forgets — and the symptom is orphaned rows discovered months later
// by an owner merging two duplicates, which is exactly the silent fork of the
// spine that principle 3 exists to prevent.
//
// So the list stays hand-written and this test reflects over the schema to
// prove it is complete. Add a `contact_id` column without adding an entry to
// CONTACT_REFERENCES and the build goes red in the same PR.
//
// This runs against the schema definitions, not a database, so it gates every
// contributor's machine whether or not they have Postgres running.
import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as coreTables from "@/core/tables";
import { contacts } from "@/core/contacts/schema";
import { CONTACT_REFERENCES } from "@/core/contacts/service";

/** The barrel exports tables; anything else in it is not our business. */
function allTables(): PgTable[] {
  const exports: Record<string, unknown> = coreTables;
  return Object.values(exports).filter((value): value is PgTable =>
    is(value, PgTable),
  );
}

const contactsTableName = getTableConfig(contacts).name;

/**
 * Every (table, column) in the schema that points at `contacts.id`, found by
 * reflection rather than by reading the same list the code under test reads —
 * a gate that consults the answer key proves nothing.
 */
function tablesReferencingContacts(): Array<{
  table: string;
  column: string;
}> {
  const found: Array<{ table: string; column: string }> = [];
  for (const table of allTables()) {
    const config = getTableConfig(table);
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      if (getTableConfig(reference.foreignTable).name !== contactsTableName) {
        continue;
      }
      for (const column of reference.columns) {
        found.push({ table: config.name, column: column.name });
      }
    }
  }
  return found;
}

describe("contacts.merge covers the whole spine", () => {
  it("finds the contact_id foreign keys by reflection", () => {
    // Guards the gate itself: a reflection that silently stops seeing foreign
    // keys (a Drizzle upgrade changing the shape, say) would pass every
    // assertion below while checking nothing at all.
    const referencing = tablesReferencingContacts();
    expect(referencing.length).toBeGreaterThan(0);
    expect(referencing).toContainEqual({
      table: "timeline_events",
      column: "contact_id",
    });
  });

  it("repoints every table that references contacts.id", () => {
    const covered = new Set(CONTACT_REFERENCES.map((r) => r.table));
    const missing = [
      ...new Set(
        tablesReferencingContacts()
          .map((r) => r.table)
          .filter((table) => !covered.has(table)),
      ),
    ];

    expect(
      missing,
      missing.length === 0
        ? ""
        : `These tables reference contacts.id but contacts.merge does not repoint them: ` +
            `${missing.join(", ")}.\n\n` +
            `Merging two duplicates would orphan their rows — the spine forks silently, ` +
            `which is the failure MASTER.md §2 principle 3 exists to prevent.\n\n` +
            `Add an entry to CONTACT_REFERENCES in src/core/contacts/service.ts, and decide ` +
            `deliberately what a merge means if contact_id participates in a unique constraint ` +
            `on that table.`,
    ).toEqual([]);
  });

  it("lists no table that has stopped referencing contacts.id", () => {
    // The list rotting in the other direction: a dropped table leaves an entry
    // whose repoint would throw at merge time, on the one code path an owner
    // reaches only when they already have a duplicate problem.
    const referencing = new Set(
      tablesReferencingContacts().map((r) => r.table),
    );
    const stale = CONTACT_REFERENCES.map((r) => r.table).filter(
      (table) => !referencing.has(table),
    );

    expect(
      stale,
      stale.length === 0
        ? ""
        : `CONTACT_REFERENCES lists ${stale.join(", ")}, which no longer reference ` +
            `contacts.id. Remove the stale entries from src/core/contacts/service.ts.`,
    ).toEqual([]);
  });
});
