// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Importing a contact list (MASTER.md §4.1, C7.07).
//
// C7.07 names the shape: map → validate → dry-run diff → commit → audit →
// reversible batch, always through contact resolution. Five things this file
// is careful about, and each is a way imports usually go wrong.
//
// **Nothing is guessed silently.** The header guess is a starting point an
// owner corrects. Getting it wrong puts somebody's phone number in the name
// column, and that then propagates through every email the business sends.
//
// **The dry run is the commit, without the writing.** The same code decides
// each row's outcome in both passes, reading the same stored rows — so the
// preview is a promise rather than an estimate. An importer whose preview and
// commit are two implementations eventually shows one and does the other.
//
// **`contacts.resolve`, never `contacts.create`.** §2's spine rule, and the
// reason it exists: an import is precisely the path that mints a second record
// for somebody the business already knows. Resolution also means an import can
// never demote a customer to a lead, because the spine's own merge rules apply.
//
// **Every applied row keeps what it overwrote.** Reversing a batch is restoring
// stored values, not recomputing them from a file that may since have changed.
//
// **Reversing a creation deletes the contact only if nothing else touched
// them.** Somebody who has since placed an order is not "part of the import"
// any more; the import is undone, and the business's later work is not.
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contactRelationships, contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type Tx,
} from "@/core/service";
import { guessDelimiter, guessMapping, IMPORTABLE_FIELDS, parseCsv } from "./csv";
import type { ImportableField } from "./csv";
import {
  CONTACT_IMPORT_OUTCOMES,
  CONTACT_IMPORT_STATUSES,
  contactImportRows,
  contactImports,
} from "./contacts-schema";

export { IMPORTABLE_FIELDS } from "./csv";
export type { ImportableField } from "./csv";

const id = z.string().uuid();

/** A guard against a file nobody meant to upload, not a business rule. */
const MAX_ROWS = 20_000;

/** Imports are a deliberate act by a person; there is no automated path here. */
function requirePerson(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to import contacts.");
  }
  return actor.userId;
}

/** Trusted composition may validate/apply a customer-owned staged batch. */
function requirePersonOrSystem(actor: Actor): void {
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to import contacts.");
  }
}

const importRow = row({
  id: uuid,
  filename: z.string(),
  delimiter: z.string(),
  headers: z.array(z.string()),
  mapping: z.array(z.string()),
  source: z.string(),
  sourceKind: z.enum(["owner_csv", "google", "microsoft", "vcard", "csv", "device"]),
  signupFlow: z.enum(["portal_account"]).nullable(),
  subjectContactId: uuid.nullable(),
  allowedFields: z.array(z.string()),
  status: z.enum(CONTACT_IMPORT_STATUSES),
  counts: z.unknown(),
  error: z.string().nullable(),
  committedAt: timestamp.nullable(),
  revertedAt: timestamp.nullable(),
  createdAt: timestamp,
});

const rowRow = row({
  id: uuid,
  lineNumber: z.number().int(),
  cells: z.array(z.string()),
  email: z.string().nullable(),
  outcome: z.enum(CONTACT_IMPORT_OUTCOMES),
  errors: z.array(z.string()),
  changes: z.unknown(),
  contactId: uuid.nullable(),
  created: z.boolean(),
  relationshipId: uuid.nullable(),
});

/** The contact fields an import may set, as they are stored. */
type Draft = {
  email: string | null;
  name?: string;
  phone?: string;
  country?: string;
  preferredLocale?: string;
  timezone?: string;
  tags: string[];
  customFields: Record<string, string>;
};

/**
 * One parsed line, as the fields it means.
 *
 * Every value is trimmed and the email lower-cased, because the spine's unique
 * index is on the address exactly as stored — an import that let " Rae@x.com "
 * through would create a second record for somebody already there, which is the
 * one failure this whole path exists to prevent.
 */
function draftFrom(headers: string[], mapping: string[], cells: string[]): Draft {
  const draft: Draft = { email: null, tags: [], customFields: {} };
  mapping.forEach((field, index) => {
    const value = (cells[index] ?? "").trim();
    if (value === "") return;
    switch (field as ImportableField) {
      case "email":
        draft.email = value.toLowerCase();
        break;
      case "tags":
        // Commas inside a quoted cell are how every export writes a tag list.
        draft.tags.push(
          ...value
            .split(/[,;]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
        );
        break;
      case "custom":
        draft.customFields[headers[index] ?? `column_${index + 1}`] = value;
        break;
      case "ignore":
        break;
      default:
        draft[field as "name" | "phone" | "country" | "preferredLocale" | "timezone"] = value;
    }
  });
  return draft;
}

/**
 * What was kept before a row overwrote it.
 *
 * Parsed on the way back out rather than trusted: this is jsonb written by an
 * earlier release, and restoring an unexpected shape over a live contact is
 * worse than declining to restore that one row.
 */
const beforeShape = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  country: z.string().nullable(),
  preferredLocale: z.string().nullable(),
  timezone: z.string().nullable(),
  tags: z.array(z.string()),
  customFields: z.record(z.string(), z.unknown()),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What this row would do, and what it would change.
 *
 * The single decision both the dry run and the commit read, so a preview cannot
 * promise something the commit does not do.
 */
async function decide(
  tx: Tx,
  headers: string[],
  mapping: string[],
  cells: string[],
): Promise<{
  email: string | null;
  outcome: (typeof CONTACT_IMPORT_OUTCOMES)[number];
  errors: string[];
  changes: Record<string, { from: unknown; to: unknown }>;
}> {
  const draft = draftFrom(headers, mapping, cells);
  if (!draft.email) {
    // Not an error: a blank line at the end of a spreadsheet is the commonest
    // thing in any export, and calling it a mistake buries the real ones.
    return { email: null, outcome: "skip", errors: [], changes: {} };
  }
  if (!EMAIL.test(draft.email)) {
    return {
      email: draft.email,
      outcome: "error",
      errors: ["That does not look like an email address."],
      changes: {},
    };
  }

  const [existing] = await tx
    .select()
    .from(contacts)
    .where(eq(contacts.email, draft.email))
    .limit(1);
  if (!existing) {
    return {
      email: draft.email,
      outcome: "create",
      errors: [],
      changes: { email: { from: null, to: draft.email } },
    };
  }

  // What resolution would actually change, and nothing else. The spine's own
  // rules apply — first-touch `source` is never rewritten, a placeholder name
  // is replaced only while it is still the email address, empty fields fill in
  // and populated ones do not — so the diff shown here is the diff that
  // happens.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (draft.name && existing.name === existing.email && draft.name !== existing.name) {
    changes.name = { from: existing.name, to: draft.name };
  }
  for (const field of ["phone", "country", "preferredLocale", "timezone"] as const) {
    const value = draft[field];
    if (value && !existing[field]) changes[field] = { from: null, to: value };
  }
  const newTags = draft.tags.filter((tag) => !existing.tags.includes(tag));
  if (newTags.length > 0) {
    changes.tags = { from: existing.tags, to: [...existing.tags, ...newTags] };
  }
  const stored = existing.customFields as Record<string, unknown>;
  const newCustom = Object.entries(draft.customFields).filter(([key]) => !(key in stored));
  if (newCustom.length > 0) {
    changes.customFields = { from: Object.keys(stored), to: newCustom.map(([key]) => key) };
  }

  return {
    email: draft.email,
    outcome: Object.keys(changes).length > 0 ? "update" : "unchanged",
    errors: [],
    changes,
  };
}

export const beginContactImport = defineService({
  name: "contactImports.begin",
  summary: "Read a contact spreadsheet and guess what its columns mean.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    filename: z.string().trim().min(1).max(300),
    csv: z.string().min(1).max(20 * 1024 * 1024),
    source: z.string().trim().min(1).max(100).default("import"),
  }),
  output: importRow,
  handler: async (input, ctx) => {
    const userId = requirePerson(ctx.actor);
    const delimiter = guessDelimiter(input.csv);
    const parsed = parseCsv(input.csv, delimiter);
    if (parsed.length < 2) {
      throw new ServiceError(
        "validation",
        "That file has a header row and nothing else in it.",
      );
    }
    const headers = (parsed[0] ?? []).map((header) => header.trim());
    const body = parsed.slice(1);
    if (body.length > MAX_ROWS) {
      throw new ServiceError(
        "validation",
        `That file has ${body.length} rows; ${MAX_ROWS} is the most this can take at once.`,
      );
    }

    const [created] = await ctx.tx
      .insert(contactImports)
      .values({
        filename: input.filename,
        delimiter,
        headers,
        // A guess an owner corrects, never a decision (C7.07's map step).
        mapping: guessMapping(headers),
        source: input.source,
        createdBy: userId,
      })
      .returning();

    await ctx.tx.insert(contactImportRows).values(
      body.map((cells, index) => ({
        importId: created!.id,
        // Line one is the header, so the first data row is line two — which is
        // what the owner sees when they open the file to fix something.
        lineNumber: index + 2,
        cells,
      })),
    );

    ctx.setSubject("contactImport", created!.id);
    ctx.queueEvent("contactImport.started", { id: created!.id, rows: body.length });
    return created!;
  },
});

/**
 * Set what the columns mean, and work out what the file would do.
 *
 * Mapping and validating are one call because they are one thought: an owner
 * changes a column and immediately wants to know what that changed. Splitting
 * them would leave a stored mapping with a stale dry run beside it.
 */
export const mapContactImport = defineService({
  name: "contactImports.map",
  summary: "Say what each column means, and see what the file would do.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    mapping: z.array(z.enum(IMPORTABLE_FIELDS)).max(200),
    source: z.string().trim().min(1).max(100).optional(),
  }),
  output: importRow,
  handler: async (input, ctx) => {
    requirePersonOrSystem(ctx.actor);
    const batch = await loadImport(ctx.tx, input.id);
    if (batch.status === "committed" || batch.status === "reverted") {
      throw new ServiceError(
        "conflict",
        "This import has already run. Start a new one to import the file differently.",
      );
    }
    if (input.mapping.length !== batch.headers.length) {
      throw new ServiceError(
        "validation",
        "That mapping does not have one entry per column in the file.",
      );
    }
    // A column mapped to "keep as an extra field" has to have a field to go
    // into: custom fields are typed and defined by the owner (C1.06), and a
    // spreadsheet must not be able to invent one. Refused here, naming the
    // column, rather than blowing up halfway through the commit.
    const customHeaders = input.mapping
      .map((field, index) => (field === "custom" ? (batch.headers[index] ?? "") : null))
      .filter((header): header is string => Boolean(header));
    if (customHeaders.length > 0) {
      const defined = (await ctx.call(getService("contacts.listCustomFields"), {
        entity: "contact",
      })) as Array<{ key: string; label: string }>;
      const known = new Set(defined.flatMap((field) => [field.key, field.label]));
      const missing = customHeaders.filter((header) => !known.has(header));
      if (missing.length > 0) {
        throw new ServiceError(
          "validation",
          `There is no field for ${missing.map((one) => `"${one}"`).join(", ")}. Add it under contact fields first, or set the column to be ignored.`,
        );
      }
    }

    if (!input.mapping.includes("email")) {
      // Without an address there is nobody to resolve to, and every row would
      // be skipped — a silent no-op that looks like a broken import.
      throw new ServiceError(
        "validation",
        "One column has to be the email address; it is what identifies a person.",
      );
    }

    const rows = await ctx.tx
      .select()
      .from(contactImportRows)
      .where(eq(contactImportRows.importId, batch.id))
      .orderBy(asc(contactImportRows.lineNumber));

    const counts: Record<string, number> = {
      create: 0,
      update: 0,
      unchanged: 0,
      skip: 0,
      error: 0,
    };
    // Addresses seen earlier in this same file. The second occurrence would
    // resolve to the contact the first one is about to create, so it is an
    // update rather than a create — and saying "create" twice would make the
    // preview promise two people where there is one.
    const seen = new Set<string>();
    for (const line of rows) {
      const decided = await decide(ctx.tx, batch.headers, input.mapping, line.cells);
      let outcome = decided.outcome;
      const errors = [...decided.errors];
      if (decided.email && outcome === "create" && seen.has(decided.email)) {
        outcome = "update";
        errors.push("This address appears earlier in the file.");
      }
      if (decided.email && outcome === "create") seen.add(decided.email);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      await ctx.tx
        .update(contactImportRows)
        .set({
          email: decided.email,
          outcome,
          errors,
          changes: decided.changes,
          updatedAt: sql`now()`,
        })
        .where(eq(contactImportRows.id, line.id));
    }

    const [updated] = await ctx.tx
      .update(contactImports)
      .set({
        mapping: input.mapping,
        ...(input.source ? { source: input.source } : {}),
        status: "validated",
        counts,
        updatedAt: sql`now()`,
      })
      .where(eq(contactImports.id, batch.id))
      .returning();
    ctx.setSubject("contactImport", batch.id);
    return updated!;
  },
});

/**
 * Apply it.
 *
 * Every row goes through `contacts.resolve` — §2's rule, and the reason it
 * exists: an import is exactly the path that would otherwise mint a second
 * record for somebody the business already knows. Everything runs in the one
 * transaction, so a file that fails halfway leaves nothing behind.
 */
export const commitContactImport = defineService({
  name: "contactImports.commit",
  summary: "Apply an import, keeping what each row overwrote.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: importRow,
  handler: async (input, ctx) => {
    requirePersonOrSystem(ctx.actor);
    const batch = await loadImport(ctx.tx, input.id);
    if (batch.status !== "validated") {
      throw new ServiceError(
        "conflict",
        batch.status === "committed"
          ? "This import has already run."
          : "Check what the file would do before applying it.",
      );
    }

    const rows = await ctx.tx
      .select()
      .from(contactImportRows)
      .where(
        and(
          eq(contactImportRows.importId, batch.id),
          inArray(contactImportRows.outcome, ["create", "update"]),
        ),
      )
      .orderBy(asc(contactImportRows.lineNumber));

    let created = 0;
    let updated = 0;
    for (const line of rows) {
      const draft = draftFrom(batch.headers, batch.mapping, line.cells);
      if (!draft.email) continue;

      const [before] = await ctx.tx
        .select()
        .from(contacts)
        .where(eq(contacts.email, draft.email))
        .limit(1);

      // The spine's own door, elevated: the owner triggered this, and
      // resolution is machinery rather than something they perform directly.
      const resolved = (await ctx.callAsSystem(getService("contacts.resolve"), {
        email: draft.email,
        name: draft.name ?? draft.email,
        phone: draft.phone,
        country: draft.country,
        preferredLocale: draft.preferredLocale,
        timezone: draft.timezone,
        tags: draft.tags,
        customFields: draft.customFields,
        source: batch.source,
      })) as { contact: { id: string } };

      if (before) updated += 1;
      else created += 1;

      let relationshipId: string | null = null;
      if (batch.subjectContactId && batch.subjectContactId !== resolved.contact.id) {
        const [existingRelationship] = await ctx.tx
          .select({ id: contactRelationships.id })
          .from(contactRelationships)
          .where(
            and(
              eq(contactRelationships.fromContactId, batch.subjectContactId),
              eq(contactRelationships.toContactId, resolved.contact.id),
              eq(contactRelationships.kind, "contact_book"),
            ),
          )
          .limit(1);
        if (!existingRelationship) {
          const relationship = (await ctx.callAsSystem(
            getService("contacts.createRelationship"),
            {
              fromContactId: batch.subjectContactId,
              toContactId: resolved.contact.id,
              kind: "contact_book",
              notes: `Created by contact import ${batch.id}.`,
            },
          )) as { id: string };
          relationshipId = relationship.id;
        }
      }

      await ctx.tx
        .update(contactImportRows)
        .set({
          contactId: resolved.contact.id,
          created: !before,
          // What it looked like before, so undoing is restoring rather than
          // guessing. Null for a creation: there was nothing to keep.
          beforeState: before
            ? {
                name: before.name,
                phone: before.phone,
                country: before.country,
                preferredLocale: before.preferredLocale,
                timezone: before.timezone,
                tags: before.tags,
                customFields: before.customFields,
            }
            : null,
          relationshipId,
          appliedAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(contactImportRows.id, line.id));
    }

    if (batch.signupFlow) {
      // Exact email matches resolve in the spine. We also rebuild the
      // explainable same-name/phone queue for human review; customer imports
      // never receive authority to merge a pair automatically.
      await ctx.callAsSystem(getService("contacts.scanDuplicates"), {});
    }

    const [done] = await ctx.tx
      .update(contactImports)
      .set({
        status: "committed",
        counts: { ...(batch.counts as Record<string, number>), created, updated },
        committedAt: new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(contactImports.id, batch.id))
      .returning();
    ctx.setSubject("contactImport", batch.id);
    ctx.queueEvent("contactImport.committed", { id: batch.id, created, updated });
    return done!;
  },
});

/**
 * Undo it.
 *
 * Updated contacts are restored from what was kept. Contacts the import created
 * are deleted **only if nothing else references them** — somebody who has since
 * placed an order or been sent a quote is not part of the import any more, and
 * removing them would take the business's later work with them. Those are kept
 * and counted, so the owner is told rather than left to notice.
 */
export const revertContactImport = defineService({
  name: "contactImports.revert",
  summary: "Undo an import, keeping anything that has happened since.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({
    id: uuid,
    restored: z.number().int(),
    deleted: z.number().int(),
    kept: z.number().int(),
  }),
  handler: async (input, ctx) => {
    requirePersonOrSystem(ctx.actor);
    const batch = await loadImport(ctx.tx, input.id);
    if (batch.status !== "committed") {
      throw new ServiceError("conflict", "That import has not been applied.");
    }

    const rows = await ctx.tx
      .select()
      .from(contactImportRows)
      .where(
        and(
          eq(contactImportRows.importId, batch.id),
          sql`${contactImportRows.contactId} is not null`,
        ),
      )
      .orderBy(desc(contactImportRows.lineNumber));

    let restored = 0;
    let deleted = 0;
    let kept = 0;
    for (const line of rows) {
      if (!line.contactId) continue;
      if (line.relationshipId) {
        await ctx.tx
          .delete(contactRelationships)
          .where(eq(contactRelationships.id, line.relationshipId));
        await ctx.tx
          .update(contactImportRows)
          .set({ relationshipId: null, updatedAt: sql`now()` })
          .where(eq(contactImportRows.id, line.id));
      }
      if (line.created) {
        if (await hasOtherHistory(ctx.tx, line.contactId)) {
          kept += 1;
          continue;
        }
        await ctx.tx.delete(contacts).where(eq(contacts.id, line.contactId));
        deleted += 1;
        continue;
      }
      // Parsed rather than cast: the stored state is jsonb, and a shape that
      // is not what this expects means restoring nonsense over a real contact.
      // Refusing that row is the safe direction; the rest of the batch still
      // reverses.
      const before = beforeShape.safeParse(line.beforeState);
      if (!before.success) continue;
      await ctx.tx
        .update(contacts)
        .set({ ...before.data, updatedAt: sql`now()` })
        .where(eq(contacts.id, line.contactId));
      restored += 1;
    }

    await ctx.tx
      .update(contactImports)
      .set({
        status: "reverted",
        counts: { ...(batch.counts as Record<string, number>), restored, deleted, kept },
        revertedAt: new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(contactImports.id, batch.id));
    ctx.setSubject("contactImport", batch.id);
    ctx.queueEvent("contactImport.reverted", { id: batch.id, restored, deleted, kept });
    return { id: batch.id, restored, deleted, kept };
  },
});

export const listContactImports = defineService({
  name: "contactImports.list",
  summary: "Every contact import, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  output: listed(importRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(contactImports)
      .orderBy(desc(contactImports.createdAt))
      .limit(input.limit),
});

export const getContactImport = defineService({
  name: "contactImports.get",
  summary: "One import, with the rows that need a person to look at them.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    id,
    outcome: z.enum(CONTACT_IMPORT_OUTCOMES).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  output: importRow.extend({ rows: listed(rowRow) }).nullable(),
  handler: async (input, ctx) => {
    const [batch] = await ctx.tx
      .select()
      .from(contactImports)
      .where(eq(contactImports.id, input.id))
      .limit(1);
    if (!batch) return null;
    const rows = await ctx.tx
      .select()
      .from(contactImportRows)
      .where(
        and(
          eq(contactImportRows.importId, batch.id),
          ...(input.outcome ? [eq(contactImportRows.outcome, input.outcome)] : []),
        ),
      )
      .orderBy(asc(contactImportRows.lineNumber))
      .limit(input.limit);
    return { ...batch, rows };
  },
});

async function loadImport(tx: Tx, importId: string) {
  const [batch] = await tx
    .select()
    .from(contactImports)
    .where(eq(contactImports.id, importId))
    .limit(1);
  if (!batch) throw new ServiceError("not_found", "That import is not here.");
  return batch;
}

/**
 * Every column in the database that points at `contacts.id`.
 *
 * Asked of Postgres rather than of the hand-maintained merge list, because the
 * question here is "is this row referenced", and the database is the only thing
 * that knows for certain. The merge list is a list of tables and their repoint
 * *behaviour*; it does not say which column holds the reference, and
 * `contact_relationships` has two of them under different names. Reading the
 * catalogue also means a table added by a module is covered the moment its
 * migration runs, with nobody having to remember.
 */
async function contactReferencingColumns(
  tx: Tx,
): Promise<Array<{ table: string; column: string }>> {
  const rows = (await tx.execute(sql`
    select cl.relname as table_name, att.attname as column_name
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    join unnest(c.conkey) as k(attnum) on true
    join pg_attribute att on att.attrelid = c.conrelid and att.attnum = k.attnum
    where c.contype = 'f'
      and c.confrelid = 'contacts'::regclass
      and ns.nspname = current_schema()
  `)) as unknown as Array<{ table_name: string; column_name: string }>;
  return rows.map((entry) => ({ table: entry.table_name, column: entry.column_name }));
}

/**
 * Tables that referencing a contact does *not* count as history.
 *
 * `contact_import_rows` is this import's own ledger: it points at every contact
 * it created, so counting it would mean nothing could ever be undone.
 *
 * `timeline_events` is the contact's own audit trail, and creating them writes
 * one — so counting it would mean nothing could ever be undone either. Nothing
 * is lost by skipping it: every real thing that writes a timeline event also
 * writes its own row against the contact (a booking, a consent record, a magic
 * link), and that row is what this check finds.
 */
const NOT_HISTORY = new Set(["contact_import_rows", "timeline_events"]);

/**
 * Has anything happened to this contact besides the import?
 *
 * Everything counts, including tables whose foreign key would have allowed the
 * delete anyway: a task that merely nulls its `contact_id` still means somebody
 * has done something with this person, and taking them away would be the import
 * undoing more than it did.
 */
async function hasOtherHistory(tx: Tx, contactId: string): Promise<boolean> {
  const columns = await contactReferencingColumns(tx);
  for (const { table, column } of columns) {
    if (NOT_HISTORY.has(table)) continue;
    const found = (await tx.execute(
      sql`select 1 from ${sql.raw(table)} where ${sql.raw(column)} = ${contactId} limit 1`,
    )) as unknown as unknown[];
    if (found.length > 0) return true;
  }
  return false;
}

/**
 * Merge repoints an import's ledger (§4.1).
 *
 * After a merge the two records are one person, so a row that says "this file
 * updated them" still says that. Leaving it pointing at the record that no
 * longer exists would silently break the undo — the very thing this ledger is
 * for.
 */
registerContactReference({
  table: "contact_import_rows",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(contactImportRows)
      .set({ contactId: survivingId })
      .where(eq(contactImportRows.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: contactImportRows.id, contactId: contactImportRows.contactId })
      .from(contactImportRows)
      .where(inArray(contactImportRows.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((line) => line.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(contactImportRows)
        .set({ contactId: duplicateId })
        .where(inArray(contactImportRows.id, moved.map((line) => line.id)));
    }
  },
});

/** The portal member who supplied a signup batch remains the same person after a merge. */
registerContactReference({
  table: "contact_imports",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(contactImports)
      .set({ subjectContactId: survivingId })
      .where(eq(contactImports.subjectContactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: contactImports.id, subjectContactId: contactImports.subjectContactId })
      .from(contactImports)
      .where(inArray(contactImports.subjectContactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), subjectContactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((batch) => batch.subjectContactId === duplicateId);
    if (moved.length) {
      await tx
        .update(contactImports)
        .set({ subjectContactId: duplicateId })
        .where(inArray(contactImports.id, moved.map((batch) => batch.id)));
    }
  },
});

/**
 * What an import's ledger means for the person's own data (§30).
 *
 * The cells *are* their personal data — a row out of somebody's spreadsheet —
 * so they go, along with the address and the state kept for undo. The row
 * itself stays: that the business imported a file of this size on this day, and
 * what each line did, is the business's own record of its own actions, and an
 * import whose audit trail vanished person by person would stop being an audit
 * trail. What survives cannot identify anybody.
 */
registerContactPrivacySource({
  scope: "contact.imports",
  tables: ["contact_import_rows"],
  exportData: async (tx, contactId) =>
    tx
      .select()
      .from(contactImportRows)
      .where(eq(contactImportRows.contactId, contactId))
      .orderBy(asc(contactImportRows.lineNumber)),
  erase: async (tx, contactId) => {
    const cleared = await tx
      .update(contactImportRows)
      .set({
        cells: [],
        email: null,
        contactId: null,
        beforeState: null,
        changes: {},
        updatedAt: sql`now()`,
      })
      .where(eq(contactImportRows.contactId, contactId))
      .returning({ id: contactImportRows.id });
    return { affected: cleared.length };
  },
});

registerContactPrivacySource({
  scope: "contact.signupImports",
  tables: ["contact_imports"],
  exportData: async (tx, contactId) => {
    const batches = await tx
      .select()
      .from(contactImports)
      .where(eq(contactImports.subjectContactId, contactId))
      .orderBy(asc(contactImports.createdAt));
    const ids = batches.map((batch) => batch.id);
    const rows = ids.length
      ? await tx
          .select()
          .from(contactImportRows)
          .where(inArray(contactImportRows.importId, ids))
          .orderBy(asc(contactImportRows.lineNumber))
      : [];
    return { batches, rows };
  },
  erase: async (tx, contactId) => {
    const cleared = await tx
      .update(contactImports)
      .set({ subjectContactId: null, updatedAt: sql`now()` })
      .where(eq(contactImports.subjectContactId, contactId))
      .returning({ id: contactImports.id });
    return { affected: cleared.length };
  },
});

export default [
  beginContactImport,
  mapContactImport,
  commitContactImport,
  revertContactImport,
  listContactImports,
  getContactImport,
];
