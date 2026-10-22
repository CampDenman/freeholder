// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import { beforeAll, describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import manifests from "@/modules";
import { contacts } from "@/core/contacts/schema";
import {
  contactReferenceColumns,
  contactReferences,
  registerContactReference,
} from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { contactPrivacySources } from "@/core/privacy/service";

/**
 * Every table any installed module owns — not core's barrel alone.
 *
 * The gate read only `@/core/tables` until forms became the first module to
 * add a `contact_id` column, at which point it was checking a list that could
 * no longer contain the answer. The same lesson `truncateSpine` learned:
 * "what does this instance own" is a question for the manifests (§11), and any
 * hand-list of them drifts.
 */
let tables: PgTable[] = [];

beforeAll(async () => {
  // Boot first: a module registers its repoint from its services module, and
  // boot is what imports that.
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

function allTables(): PgTable[] {
  return tables;
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

/**
 * Contact columns the merge deliberately leaves alone, each with the human
 * decision written next to it. An entry here is a documented exception, not
 * an escape hatch — the assertion below fails on any *undocumented* column.
 */
const DELIBERATE_MERGE_EXCLUSIONS: Record<string, string> = {
  "contact_merge_operations.surviving_contact_id":
    "The merge ledger is an immutable audit snapshot: rewriting who merged into whom would falsify history, and undo reads these ids as they were.",
  "contact_merge_operations.duplicate_contact_id":
    "Same ledger, same reason — the duplicate id names a contact that no longer exists, which is the point of the record.",
};

/**
 * Every column *named* like a contact reference, whatever its declaration.
 * The FK-based reflection above only sees `.references()`; a bare
 * `uuid("contact_id")` column would sail through it — this scan is written in
 * the same terms as the CLAUDE.md rule, the column name.
 */
function columnsNamedLikeContactReferences(): Array<{
  table: string;
  column: string;
}> {
  const found: Array<{ table: string; column: string }> = [];
  for (const table of allTables()) {
    const config = getTableConfig(table);
    if (config.name === contactsTableName) continue;
    for (const column of config.columns) {
      if (/(^|_)contact_id$/.test(column.name)) {
        found.push({ table: config.name, column: column.name });
      }
    }
  }
  return found;
}

/** `table.column` for every column a registered repoint covers. */
function repointedColumns(): Set<string> {
  return new Set(
    contactReferences().flatMap((reference) =>
      contactReferenceColumns(reference).map((column) => `${reference.table}.${column}`),
    ),
  );
}

/**
 * Tables that point at a record through a `subject_type` + `subject_id` pair.
 * When the subject can be a contact, `subject_id` is a contact reference no
 * foreign key will ever show — so each such table needs a decision.
 */
function polymorphicSubjectTables(): string[] {
  return allTables()
    .map((table) => getTableConfig(table))
    .filter(
      (config) =>
        config.columns.some((column) => column.name === "subject_type") &&
        config.columns.some((column) => column.name === "subject_id"),
    )
    .map((config) => config.name);
}

/**
 * Polymorphic subject columns the merge leaves alone, with why. Everything
 * else that can name a contact as its subject must declare `subject_id` in
 * its registerContactReference() columns and repoint it.
 */
const POLYMORPHIC_SUBJECT_EXCLUSIONS: Record<string, string> = {
  audit_log:
    "The audit log is an immutable record of what happened to which id; rewriting it would falsify history.",
  timeline_events:
    "A timeline entry's subject records the id the event was about at the time; the entry itself follows its contact_id.",
  demo_records:
    "Demo bookkeeping names the fixture rows it created so a reset removes exactly those; a merged demo contact is removed by its surviving id.",
  content_revisions:
    "CMS revisions are about pages and sections, never contacts.",
  money_state_events:
    "Money state history is an append-only ledger of invoice/payment/refund transitions, never contacts.",
  reviews:
    "A review's subject is the thing reviewed (a product, service or location), never a contact; the reviewer follows contact_id.",
  review_requests:
    "Same as reviews: the subject is what is to be reviewed, never a contact.",
  contract_documents:
    "A contract's subject is the quote, booking, rental or project it governs; the signer follows contact_id.",
};

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
    // And a module's table, so the widening cannot silently regress.
    expect(referencing).toContainEqual({
      table: "form_submissions",
      column: "contact_id",
    });
  });

  it("repoints every column that references contacts.id", () => {
    // Per column, not per table: a table with two contact columns whose
    // repoint covers one of them used to pass because the table was listed.
    const covered = repointedColumns();
    const missing = tablesReferencingContacts()
      .map(({ table, column }) => `${table}.${column}`)
      .filter((column) => !covered.has(column) && !(column in DELIBERATE_MERGE_EXCLUSIONS));

    expect(
      missing,
      missing.length === 0
        ? ""
        : `These columns reference contacts.id but contacts.merge does not repoint them: ` +
            `${missing.join(", ")}.\n\n` +
            `Merging two duplicates would orphan their rows — the spine forks silently, ` +
            `which is the failure MASTER.md §2 principle 3 exists to prevent.\n\n` +
            `Core's tables are listed in src/core/contacts/service.ts; a module registers ` +
            `its own with registerContactReference() from its services module, naming ` +
            `every contact column it repoints in \`columns\`. Decide deliberately what a ` +
            `merge means if the column participates in a unique constraint.`,
    ).toEqual([]);
  });

  it("accounts for every column merely *named* like a contact reference", () => {
    // A `uuid("contact_id")` without `.references()` is invisible to the
    // FK reflection, so the gate would pass while the merge orphaned its
    // rows. Every name-shaped contact column must be either repointed or a
    // documented deliberate exclusion.
    const covered = repointedColumns();
    const unaccounted = columnsNamedLikeContactReferences().filter(
      ({ table, column }) =>
        !covered.has(`${table}.${column}`) &&
        !(`${table}.${column}` in DELIBERATE_MERGE_EXCLUSIONS),
    );

    expect(
      unaccounted,
      unaccounted.length === 0
        ? ""
        : `These columns are named like contact references but are neither repointed by ` +
            `contacts.merge nor documented as deliberate exclusions: ` +
            `${unaccounted.map((c) => `${c.table}.${c.column}`).join(", ")}.\n\n` +
            `Either add .references(() => contacts.id) plus a registerContactReference() ` +
            `entry, or record the human decision in DELIBERATE_MERGE_EXCLUSIONS in this file.`,
    ).toEqual([]);
  });

  it("decides what a merge means for every polymorphic subject that can be a contact", () => {
    const covered = repointedColumns();
    const tables = polymorphicSubjectTables();
    // Guards the reflection itself.
    expect(tables).toContain("commission_events");
    expect(tables).toContain("documents");
    const undecided = tables.filter(
      (table) => !covered.has(`${table}.subject_id`) && !(table in POLYMORPHIC_SUBJECT_EXCLUSIONS),
    );
    expect(
      undecided,
      undecided.length === 0
        ? ""
        : `These tables can name a contact through subject_type/subject_id but contacts.merge ` +
            `neither repoints subject_id nor records why it is left alone: ${undecided.join(", ")}. ` +
            `Repoint subject_id where subject_type = 'contact' (and name it in columns), or ` +
            `document the decision in POLYMORPHIC_SUBJECT_EXCLUSIONS.`,
    ).toEqual([]);
    const stale = Object.keys(POLYMORPHIC_SUBJECT_EXCLUSIONS).filter((table) => !tables.includes(table));
    expect(stale).toEqual([]);
  });

  it("lists no column that has stopped referencing contacts", () => {
    // The list rotting in the other direction: a dropped column leaves an entry
    // whose repoint would throw at merge time, on the one code path an owner
    // reaches only when they already have a duplicate problem.
    const real = new Set([
      ...tablesReferencingContacts().map(({ table, column }) => `${table}.${column}`),
      ...columnsNamedLikeContactReferences().map(({ table, column }) => `${table}.${column}`),
      ...polymorphicSubjectTables().map((table) => `${table}.subject_id`),
    ]);
    const stale = [...repointedColumns()].filter((column) => !real.has(column));

    expect(
      stale,
      stale.length === 0
        ? ""
        : `contacts.merge lists ${stale.join(", ")}, which no longer reference ` +
            `contacts. Remove or correct the stale entries.`,
    ).toEqual([]);
  });

  it("refuses a second registration that would silently cover other columns", () => {
    const existing = contactReferences().find((reference) => reference.table === "commission_events")!;
    expect(() =>
      registerContactReference({ ...existing, columns: ["contact_id"] }),
    ).toThrow(/already has a repoint/);
    // Re-evaluating the same declaration is harmless.
    expect(() => registerContactReference(existing)).not.toThrow();
  });
});

describe("privacy rights cover the whole spine", () => {
  it("registers export and erasure behavior for every contact foreign key", () => {
    const covered = new Set(
      contactPrivacySources().flatMap((source) => source.tables),
    );
    const missing = [
      ...new Set(
        tablesReferencingContacts()
          .map((reference) => reference.table)
          .filter((table) => !covered.has(table)),
      ),
    ];
    expect(
      missing,
      missing.length === 0
        ? ""
        : `These tables can hold contact data but have no export/erasure handler: ${missing.join(", ")}. ` +
          "Register the table with registerContactPrivacySource() beside its service.",
    ).toEqual([]);
  });
});
