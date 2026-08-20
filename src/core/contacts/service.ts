// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Contact services (MASTER.md Â§2 principle 3, Â§4.1). The spine's write path:
// every mutation emits a TimelineEvent (modules write events; the CRM reads
// them) and lands in the audit log via the service wrapper. No module gets
// its own notion of "customer" â€” this is the only door.
import { z } from "zod";
import {
  and,
  arrayContains,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import {
  contactMergeOperations,
  contacts,
  customerMagicLinks,
  mergeCandidates,
  organizations,
  timelineEvents,
} from "@/core/contacts/schema";
import { applyCustomFieldPatch } from "@/core/contacts/custom-fields";
import {
  captureContactRelationships,
  repointContactRelationships,
  restoreContactRelationships,
} from "@/core/contacts/relationships";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import { defineService, ServiceError, type Tx } from "@/core/service";

const STAGES = ["lead", "prospect", "customer", "repeat"] as const;
const lifecycleStage = z.enum(STAGES);

const localeValue = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, "Enter a valid locale such as en, fr-CA, or es-MX.")
  .transform((value) => Intl.getCanonicalLocales(value)[0]!);

const timezoneValue = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid IANA time zone such as America/Vancouver.");

const countryValue = z
  .string()
  .trim()
  .length(2)
  .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code.")
  .transform((value) => value.toUpperCase());

const contactTags = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(50)
      .transform((value) => value.toLowerCase()),
  )
  .max(50)
  .transform((values) => [...new Set(values)]);

const contactFields = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().toLowerCase().nullable().optional(),
  phone: z.string().trim().max(100).nullable().optional(),
  orgId: z.string().uuid().nullable().optional(),
  source: z.string().trim().max(200).nullable().optional(),
  tags: contactTags.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  lifecycleStage: lifecycleStage.optional(),
  /** BCP-47; customer-facing surfaces follow this (Â§4.9). */
  preferredLocale: localeValue.nullable().optional(),
  timezone: timezoneValue.nullable().optional(),
  /** ISO-3166-1 alpha-2, uppercased; tax keys off this (Â§4.10). */
  country: countryValue.nullable().optional(),
  ownerNotes: z.string().max(10_000).nullable().optional(),
});

const contactRow = row({
  id: uuid,
  userId: uuid.nullable(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  orgId: uuid.nullable(),
  source: z.string().nullable(),
  tags: z.array(z.string()),
  customFields: z.unknown(),
  lifecycleStage,
  preferredLocale: z.string().nullable(),
  timezone: z.string().nullable(),
  country: z.string().nullable(),
  ownerNotes: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const resolvedContact = z.object({
  contact: contactRow,
  created: z.boolean(),
  updated: z.boolean(),
});
const mergedContact = contactRow.and(row({ mergeOperationId: uuid }));
const timelineEventRow = row({
  id: uuid,
  contactId: uuid,
  actor: z.string(),
  eventType: z.string(),
  subjectType: z.string(),
  subjectId: z.string().nullable(),
  payload: z.unknown(),
  occurredAt: timestamp,
});

/**
 * The unique email index is the spine's identity rule; hitting it is a conflict
 * with an obvious remedy, not an internal error. Surfacing it that way is what
 * lets the caller choose between resolving and merging.
 */
async function guardDuplicateEmail<T>(
  email: string | null | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (email && isUniqueViolation(error, "contacts_email_idx")) {
      // Plain English: this message reaches a business owner's screen, and
      // "use contacts.resolve" is a sentence only its author can act on.
      throw new ServiceError(
        "conflict",
        `${email} is already on another contact. Open that contact instead, or merge the two records.`,
      );
    }
    throw error;
  }
}

async function ensureOrganization(
  tx: Tx,
  id: string | null | undefined,
): Promise<void> {
  if (!id) return;
  const [organization] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  if (!organization) {
    throw new ServiceError("not_found", "That organization no longer exists.");
  }
}

/**
 * Deliberate creation by a human. Automated paths use `contacts.resolve` —
 * and CLAUDE.md counts agents among the automated paths, so this is closed
 * to API-key and MCP callers: the unique email index would catch an
 * email-keyed fork, but nothing would stop an agent from freely duplicating
 * email-less contacts.
 */
export const createContact = defineService({
  name: "contacts.create",
  summary: "Add a person or organization member to the spine.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  input: contactFields,
  output: contactRow,
  handler: async (input, ctx) => {
    await ensureOrganization(ctx.tx, input.orgId);
    const customFields = await applyCustomFieldPatch(
      ctx.tx,
      "contact",
      input.customFields ?? {},
    );
    const [contact] = await guardDuplicateEmail(input.email, () =>
      ctx.tx.insert(contacts).values({ ...input, customFields }).returning(),
    );
    ctx.setSubject("contact", contact!.id);
    await ctx.emitTimeline({
      contactId: contact!.id,
      eventType: "contact.created",
      subjectType: "contact",
      subjectId: contact!.id,
      payload: { source: input.source ?? "manual" },
    });
    ctx.queueEvent("contact.created", { contactId: contact!.id });
    return contact!;
  },
});

type ContactRow = typeof contacts.$inferSelect;
type ResolveInput = Partial<z.output<typeof contactFields>>;

/**
 * What an automated path is allowed to change about a contact it already knows
 * (Â§4.6: a form's destination is contact_create *or update*).
 *
 * The governing rule is that automated data fills blanks and never overwrites.
 * A returning visitor typing a phone number into a form should not be able to
 * replace the number the owner corrected by hand last week, and a second form
 * submission must not relabel where the contact originally came from. So:
 *
 * - blank fields are filled;
 * - `source` is first-touch and therefore never rewritten â€” overwriting it
 *   would destroy the attribution the analytics funnel is built on;
 * - `name` is replaced only while it is still the placeholder `resolve` itself
 *   wrote (the email address), so "someone@example.com" becomes "Sam Okonjo"
 *   the first time a real name arrives, and never changes again;
 * - `lifecycleStage` only moves forward, as it does in a merge â€” a newsletter
 *   signup from an existing customer must not demote them back to a lead;
 * - `tags` union, `customFields` merge with the stored value winning;
 * - `ownerNotes` is never touched by an automated path at all.
 *
 * Returns the columns that actually changed, so an unchanged contact costs no
 * UPDATE â€” `updated_at` is a change cursor now, and bumping it on every form
 * view would make it useless for exactly the sync and export paths that read it.
 */
function incomingChanges(
  existing: ContactRow,
  input: ResolveInput,
): Partial<ContactRow> {
  const changes: Partial<ContactRow> = {};

  if (input.name && existing.name === existing.email) {
    changes.name = input.name;
  }
  for (const field of [
    "phone",
    "orgId",
    "preferredLocale",
    "timezone",
    "country",
  ] as const) {
    const value = input[field];
    if (value && !existing[field]) changes[field] = value;
  }
  if (input.source && !existing.source) changes.source = input.source;

  if (input.tags?.length) {
    const merged = [...new Set([...existing.tags, ...input.tags])];
    if (merged.length !== existing.tags.length) changes.tags = merged;
  }

  if (input.customFields && Object.keys(input.customFields).length > 0) {
    const stored = existing.customFields as Record<string, unknown>;
    const incoming = Object.entries(input.customFields).filter(
      ([key]) => !(key in stored),
    );
    if (incoming.length > 0) {
      changes.customFields = { ...Object.fromEntries(incoming), ...stored };
    }
  }

  if (
    input.lifecycleStage &&
    STAGES.indexOf(input.lifecycleStage) > STAGES.indexOf(existing.lifecycleStage)
  ) {
    changes.lifecycleStage = input.lifecycleStage;
  }

  return changes;
}

/**
 * The door every automated path uses. A form submission, an import, a checkout
 * by a returning visitor, an affiliate signup â€” all of them mean "this email
 * address is the person," and none of them may mint a second spine record for
 * someone the business already knows (Â§2 principle 3). Anonymous surfaces reach
 * this through `ctx.callAsSystem`; they never create contacts directly.
 */
export const resolveContact = defineService({
  name: "contacts.resolve",
  summary: "Find the contact for an email address, creating it only if new.",
  kind: "mutation",
  permission: "scoped",
  input: contactFields.partial().extend({
    email: z.string().trim().email().toLowerCase(),
  }),
  output: resolvedContact,
  handler: async (input, ctx) => {
    await ensureOrganization(ctx.tx, input.orgId);
    const resolvedInput: ResolveInput = {
      ...input,
      customFields: await applyCustomFieldPatch(
        ctx.tx,
        "contact",
        input.customFields ?? {},
      ),
    };
    const found = async () =>
      (
        await ctx.tx
          .select()
          .from(contacts)
          .where(eq(contacts.email, input.email))
          .limit(1)
      )[0];

    /** Fill blanks on a contact the business already knows (see above). */
    const enrich = async (existing: ContactRow) => {
      ctx.setSubject("contact", existing.id);
      const changes = incomingChanges(existing, resolvedInput);
      if (Object.keys(changes).length === 0) {
        return { contact: existing, created: false, updated: false };
      }
      const [updated] = await ctx.tx
        .update(contacts)
        .set(changes)
        .where(eq(contacts.id, existing.id))
        .returning();
      const changedFields = Object.keys(changes).filter(
        (field) => field !== "lifecycleStage",
      );
      if (changedFields.length > 0) {
        await ctx.emitTimeline({
          contactId: existing.id,
          eventType: "contact.updated",
          subjectType: "contact",
          subjectId: existing.id,
          payload: {
            fields: changedFields,
            via: resolvedInput.source ?? "resolve",
          },
        });
      }
      if (changes.lifecycleStage) {
        await ctx.emitTimeline({
          contactId: existing.id,
          eventType: "contact.lifecycleChanged",
          subjectType: "contact",
          subjectId: existing.id,
          payload: {
            from: existing.lifecycleStage,
            to: changes.lifecycleStage,
            via: resolvedInput.source ?? "resolve",
          },
        });
        ctx.queueEvent("contact.lifecycleChanged", {
          contactId: existing.id,
          from: existing.lifecycleStage,
          to: changes.lifecycleStage,
        });
      }
      return { contact: updated!, created: false, updated: true };
    };

    const existing = await found();
    if (existing) return enrich(existing);

    const [inserted] = await ctx.tx
      .insert(contacts)
      .values({
        ...resolvedInput,
        name: resolvedInput.name ?? input.email,
        tags: resolvedInput.tags ?? [],
        customFields: resolvedInput.customFields ?? {},
        lifecycleStage: resolvedInput.lifecycleStage ?? "lead",
      })
      .onConflictDoNothing({ target: contacts.email })
      .returning();

    // Two callers resolving the same address at once: the unique index picks a
    // winner and the loser reads the winner's row rather than failing. Doing
    // nothing on conflict (instead of erroring) is what keeps the surrounding
    // transaction usable for that second read.
    if (!inserted) {
      const raced = await found();
      if (!raced) {
        throw new ServiceError(
          "conflict",
          `contacts.resolve: could not resolve ${input.email}`,
        );
      }
      return enrich(raced);
    }

    ctx.setSubject("contact", inserted.id);
    await ctx.emitTimeline({
      contactId: inserted.id,
      eventType: "contact.created",
      subjectType: "contact",
      subjectId: inserted.id,
      payload: { source: resolvedInput.source ?? "resolve" },
    });
    ctx.queueEvent("contact.created", { contactId: inserted.id });
    return { contact: inserted, created: true, updated: false };
  },
});

/** One table that references `contacts.id`, and how a merge repoints it. */
export interface ContactReference {
  /** Physical table name â€” what the completeness gate matches against. */
  table: string;
  repoint: (
    tx: Tx,
    duplicateId: string,
    survivingId: string,
  ) => Promise<unknown>;
  /** State before/after repointing, plus whether exact recovery is safe. */
  captureForUndo: (
    tx: Tx,
    duplicateId: string,
    survivingId: string,
  ) => Promise<{ state: unknown; undoable: boolean; blocker?: string }>;
  /** Restore `before` after verifying the table still matches `after`. */
  restoreAfterUndo: (
    tx: Tx,
    before: unknown,
    after: unknown,
    duplicateId: string,
    survivingId: string,
  ) => Promise<void>;
}

interface ContactPointer {
  id: string;
  contactId: string | null;
}

function pointerCapture(state: ContactPointer[]): {
  state: ContactPointer[];
  undoable: true;
} {
  return { state, undoable: true };
}

function assertPointerState(
  current: ContactPointer[],
  expectedState: unknown,
  label: string,
): ContactPointer[] {
  const parsed = z
    .array(z.object({ id: z.string(), contactId: z.string().uuid().nullable() }))
    .parse(expectedState);
  const byId = new Map(current.map((row) => [row.id, row.contactId]));
  if (
    current.length !== parsed.length ||
    parsed.some((row) => byId.get(row.id) !== row.contactId)
  ) {
    throw new ServiceError(
      "conflict",
      `${label} changed after this merge. Restore that record first or leave the merge in place.`,
    );
  }
  return parsed;
}

/**
 * Every table that references `contacts.id`.
 *
 * âš  CONVENTION (CLAUDE.md): a module that adds a `contact_id` column adds its
 * entry here in the same PR. Rows left pointing at a deleted duplicate are the
 * silent fork of the spine that Â§2 principle 3 exists to prevent.
 *
 * The list is hand-maintained rather than reflected off the schema on purpose.
 * A generic `UPDATE ... SET contact_id` would corrupt any table whose
 * contact_id sits in a unique constraint â€” a per-contact subscription row, say,
 * where the survivor may already hold the very row being repointed onto it.
 * Those tables need a decision (merge? drop? keep the survivor's?), and a
 * reflection cannot make one.
 *
 * What is *not* left to memory is noticing an omission:
 * `tests/core/merge-completeness.test.ts` reflects over the schema and fails
 * when a `contact_id` column has no entry here. The list is hand-written; the
 * obligation to write it is enforced.
 */
const references: ContactReference[] = [
  {
    table: "contact_relationships",
    repoint: repointContactRelationships,
    captureForUndo: async (tx, duplicateId, survivingId) => ({
      state: await captureContactRelationships(tx, duplicateId, survivingId),
      undoable: true,
    }),
    restoreAfterUndo: (tx, before, after) =>
      restoreContactRelationships(tx, before, after),
  },
  {
    // A bearer link sent for the duplicate identity must not silently become a
    // credential for the survivor after a merge. Invalidate it by deletion.
    table: "customer_magic_links",
    repoint: (tx, duplicateId) =>
      tx
        .delete(customerMagicLinks)
        .where(eq(customerMagicLinks.contactId, duplicateId)),
    captureForUndo: async (tx, duplicateId) => {
      const rows = await tx
        .select({ id: customerMagicLinks.id })
        .from(customerMagicLinks)
        .where(eq(customerMagicLinks.contactId, duplicateId));
      return {
        state: rows,
        undoable: rows.length === 0,
        blocker:
          rows.length > 0
            ? "A customer sign-in link was invalidated for security and cannot be restored."
            : undefined,
      };
    },
    // An empty capture is safe; a non-empty capture marks the whole operation
    // non-undoable before this callback can ever run.
    restoreAfterUndo: async () => undefined,
  },
  {
    // Candidate rows are derived review metadata. The selected row is marked
    // merged before this runs; every other open suspicion touching the deleted
    // identity is retired and can be rediscovered by the next scan after undo.
    table: "merge_candidates",
    repoint: (tx, duplicateId) =>
      tx
        .update(mergeCandidates)
        .set({ status: "dismissed", dismissedAt: new Date() })
        .where(
          and(
            eq(mergeCandidates.status, "open"),
            or(
              eq(mergeCandidates.contactAId, duplicateId),
              eq(mergeCandidates.contactBId, duplicateId),
            ),
          ),
        ),
    captureForUndo: async () => ({ state: [], undoable: true }),
    restoreAfterUndo: async () => undefined,
  },
  {
    table: "timeline_events",
    repoint: (tx, duplicateId, survivingId) =>
      tx
        .update(timelineEvents)
        .set({ contactId: survivingId })
        .where(eq(timelineEvents.contactId, duplicateId)),
    captureForUndo: async (tx, duplicateId, survivingId) =>
      pointerCapture(
        await tx
          .select({ id: timelineEvents.id, contactId: timelineEvents.contactId })
          .from(timelineEvents)
          .where(inArray(timelineEvents.contactId, [duplicateId, survivingId])),
      ),
    restoreAfterUndo: async (tx, before, after, duplicateId) => {
      const expected = z
        .array(z.object({ id: z.string(), contactId: z.string().uuid().nullable() }))
        .parse(after);
      const ids = expected.map((row) => row.id);
      const current = ids.length
        ? await tx
            .select({ id: timelineEvents.id, contactId: timelineEvents.contactId })
            .from(timelineEvents)
            .where(inArray(timelineEvents.id, ids))
        : [];
      const prior = assertPointerState(current, after, "Contact history");
      const moved = z
        .array(z.object({ id: z.string(), contactId: z.string().uuid().nullable() }))
        .parse(before)
        .filter((row) => row.contactId === duplicateId);
      if (moved.length) {
        await tx
          .update(timelineEvents)
          .set({ contactId: duplicateId })
          .where(inArray(timelineEvents.id, moved.map((row) => row.id)));
      }
      void prior;
    },
  },
];

/**
 * How a *module* declares what a merge means for its own table.
 *
 * Core cannot import a module's schema (Â§11), so a module that adds a
 * contact_id column registers its repoint from its own services module, which
 * boot imports exactly when the module is installed. The decision stays with
 * the people who know what their table means â€” which is the whole argument for
 * the list being hand-written â€” while the obligation to make one is still
 * enforced by the completeness gate.
 *
 * Idempotent per table, because boot is a precondition rather than a one-shot
 * event and a module graph may be asked to boot twice.
 */
export function registerContactReference(reference: ContactReference): void {
  const existing = references.find((r) => r.table === reference.table);
  if (existing) return;
  references.push(reference);
}

/** Every table that references `contacts.id`, core's and every module's. */
export function contactReferences(): readonly ContactReference[] {
  return references;
}

/** @deprecated Read through `contactReferences()` so modules are included. */
export const CONTACT_REFERENCES: readonly ContactReference[] = references;

const contactSnapshotSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  orgId: z.string().uuid().nullable(),
  source: z.string().nullable(),
  tags: z.array(z.string()),
  customFields: z.record(z.string(), z.unknown()),
  lifecycleStage,
  preferredLocale: z.string().nullable(),
  timezone: z.string().nullable(),
  country: z.string().nullable(),
  ownerNotes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
type ContactSnapshot = z.infer<typeof contactSnapshotSchema>;

function contactSnapshot(row: ContactRow): ContactSnapshot {
  return {
    ...row,
    customFields: row.customFields as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function contactSnapshotValues(snapshot: ContactSnapshot) {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}

const storedReferenceStateSchema = z.array(
  z.object({
    table: z.string(),
    before: z.unknown(),
    after: z.unknown(),
  }),
);

/** Fold a duplicate into the record that survives. */
export const mergeContacts = defineService({
  name: "contacts.merge",
  writeClass: "destructive",
  summary: "Merge a duplicate contact into the one that survives.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    survivingId: z.string().uuid(),
    duplicateId: z.string().uuid(),
    candidateId: z.string().uuid().optional(),
  }),
  output: mergedContact,
  handler: async (input, ctx) => {
    if (input.survivingId === input.duplicateId) {
      throw new ServiceError(
        "validation",
        "A contact cannot be merged into itself.",
      );
    }
    // Lock in canonical id order so reverse merge requests cannot deadlock.
    const pair = await ctx.tx
      .select()
      .from(contacts)
      .where(inArray(contacts.id, [input.survivingId, input.duplicateId]))
      .orderBy(contacts.id)
      .for("update");
    const byId = new Map(pair.map((row) => [row.id, row]));
    const surviving = byId.get(input.survivingId);
    const duplicate = byId.get(input.duplicateId);
    if (!surviving || !duplicate) {
      throw new ServiceError("not_found", "One of those contacts no longer exists.");
    }

    const canonicalIds = [surviving.id, duplicate.id].sort();
    const [candidate] = input.candidateId
      ? await ctx.tx
          .select()
          .from(mergeCandidates)
          .where(eq(mergeCandidates.id, input.candidateId))
          .limit(1)
          .for("update")
      : await ctx.tx
          .select()
          .from(mergeCandidates)
          .where(
            and(
              eq(mergeCandidates.status, "open"),
              eq(mergeCandidates.contactAId, canonicalIds[0]!),
              eq(mergeCandidates.contactBId, canonicalIds[1]!),
            ),
          )
          .limit(1)
          .for("update");
    if (
      input.candidateId &&
      (!candidate ||
        candidate.status !== "open" ||
        candidate.contactAId !== canonicalIds[0] ||
        candidate.contactBId !== canonicalIds[1])
    ) {
      throw new ServiceError(
        "conflict",
        "That duplicate candidate is no longer open for these contacts.",
      );
    }
    if (candidate) {
      await ctx.tx
        .update(mergeCandidates)
        .set({ status: "merged", mergedAt: new Date(), dismissedAt: null })
        .where(eq(mergeCandidates.id, candidate.id));
    }

    // Two contacts, two logins, one survivor: `contacts.user_id` is unique and
    // 1:1, so the merge can keep only one of them. Every way of choosing
    // silently is wrong â€” the loser's `users` row would outlive the contact it
    // described, leaving a credential that still signs in and resolves to
    // nobody, and deleting it instead would destroy a password and every
    // session belonging to a real person on the strength of one click.
    //
    // So it refuses, and says which two addresses are in the way. Today this
    // can only happen between staff logins; when the portal gives customers
    // accounts it will be common, and the answer there is an explicit "which
    // login survives" step, not a default hidden in this handler.
    if (
      surviving.userId &&
      duplicate.userId &&
      surviving.userId !== duplicate.userId
    ) {
      throw new ServiceError(
        "conflict",
        `Both contacts can sign in â€” ${surviving.email ?? "the survivor"} and ` +
          `${duplicate.email ?? "the duplicate"} each have their own login. ` +
          `Remove one of the two logins first, then merge.`,
      );
    }

    const referenceState: Array<{
      table: string;
      before: unknown;
      after: unknown;
    }> = [];
    const undoBlockers: string[] = [];

    // Every contact_id FK in the schema, repointed â€” core's and every
    // installed module's, with an explicit recovery boundary.
    for (const reference of contactReferences()) {
      const before = await reference.captureForUndo(
        ctx.tx,
        duplicate.id,
        surviving.id,
      );
      if (!before.undoable) {
        undoBlockers.push(
          before.blocker ?? `${reference.table} cannot be restored safely.`,
        );
      }
      await reference.repoint(ctx.tx, duplicate.id, surviving.id);
      referenceState.push({ table: reference.table, before: before.state, after: null });
    }

    // The survivor keeps what it has and inherits what it lacks; no field the
    // owner entered is thrown away by a merge.
    const keep = <T>(mine: T | null, theirs: T | null): T | null =>
      mine ?? theirs;
    const merged = {
      userId: keep(surviving.userId, duplicate.userId),
      email: keep(surviving.email, duplicate.email),
      phone: keep(surviving.phone, duplicate.phone),
      orgId: keep(surviving.orgId, duplicate.orgId),
      source: keep(surviving.source, duplicate.source),
      preferredLocale: keep(
        surviving.preferredLocale,
        duplicate.preferredLocale,
      ),
      timezone: keep(surviving.timezone, duplicate.timezone),
      country: keep(surviving.country, duplicate.country),
      ownerNotes: [surviving.ownerNotes, duplicate.ownerNotes]
        .filter(Boolean)
        .join("\n\n") || null,
      tags: [...new Set([...surviving.tags, ...duplicate.tags])],
      customFields: {
        ...(duplicate.customFields as Record<string, unknown>),
        ...(surviving.customFields as Record<string, unknown>),
      },
      // Lifecycle only ever moves forward.
      lifecycleStage:
        STAGES.indexOf(duplicate.lifecycleStage) >
        STAGES.indexOf(surviving.lifecycleStage)
          ? duplicate.lifecycleStage
          : surviving.lifecycleStage,
    };

    // Delete before update: email and user_id are unique, so the survivor can
    // only inherit them once the duplicate no longer holds them.
    await ctx.tx.delete(contacts).where(eq(contacts.id, duplicate.id));
    const [result] = await ctx.tx
      .update(contacts)
      .set(merged)
      .where(eq(contacts.id, surviving.id))
      .returning();

    for (const state of referenceState) {
      const reference = contactReferences().find((item) => item.table === state.table)!;
      state.after = (
        await reference.captureForUndo(ctx.tx, duplicate.id, surviving.id)
      ).state;
    }

    const [operation] = await ctx.tx
      .insert(contactMergeOperations)
      .values({
        candidateId: candidate?.id,
        survivingContactId: surviving.id,
        duplicateContactId: duplicate.id,
        survivorBefore: contactSnapshot(surviving),
        duplicateBefore: contactSnapshot(duplicate),
        survivorAfter: contactSnapshot(result!),
        referenceState,
        undoable: undoBlockers.length === 0,
        undoBlockers: [...new Set(undoBlockers)],
      })
      .returning();

    ctx.setSubject("contact", surviving.id);
    await ctx.emitTimeline({
      contactId: surviving.id,
      eventType: "contact.merged",
      subjectType: "contact",
      subjectId: surviving.id,
      payload: {
        mergedFrom: duplicate.id,
        mergedEmail: duplicate.email,
        mergedName: duplicate.name,
        mergeOperationId: operation!.id,
      },
    });
    if (result!.lifecycleStage !== surviving.lifecycleStage) {
      await ctx.emitTimeline({
        contactId: surviving.id,
        eventType: "contact.lifecycleChanged",
        subjectType: "contact",
        subjectId: surviving.id,
        payload: {
          from: surviving.lifecycleStage,
          to: result!.lifecycleStage,
          via: "merge",
        },
      });
      ctx.queueEvent("contact.lifecycleChanged", {
        contactId: surviving.id,
        from: surviving.lifecycleStage,
        to: result!.lifecycleStage,
      });
    }
    ctx.queueEvent("contact.merged", {
      contactId: surviving.id,
      mergedFrom: duplicate.id,
      mergeOperationId: operation!.id,
    });
    return { ...result!, mergeOperationId: operation!.id };
  },
});

/** Restore two identities only while every merge-owned value is untouched. */
export const undoContactMerge = defineService({
  name: "contacts.undoMerge",
  summary: "Undo a contact merge when no later change would be overwritten.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ operationId: z.string().uuid() }),
  output: z.object({
    operationId: uuid,
    survivingContact: contactRow,
    restoredContact: contactRow,
  }),
  handler: async (input, ctx) => {
    const [operation] = await ctx.tx
      .select()
      .from(contactMergeOperations)
      .where(eq(contactMergeOperations.id, input.operationId))
      .limit(1)
      .for("update");
    if (!operation) {
      throw new ServiceError("not_found", "That merge record no longer exists.");
    }
    if (operation.undoneAt) {
      throw new ServiceError("conflict", "That merge has already been undone.");
    }
    if (!operation.undoable) {
      throw new ServiceError(
        "conflict",
        operation.undoBlockers[0] ?? "That merge cannot be restored safely.",
      );
    }
    const survivorBefore = contactSnapshotSchema.parse(operation.survivorBefore);
    const duplicateBefore = contactSnapshotSchema.parse(operation.duplicateBefore);
    const survivorAfter = contactSnapshotSchema.parse(operation.survivorAfter);
    const [current] = await ctx.tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, operation.survivingContactId))
      .limit(1)
      .for("update");
    if (!current) {
      throw new ServiceError(
        "conflict",
        "The surviving contact no longer exists, so this merge cannot be undone.",
      );
    }
    if (JSON.stringify(contactSnapshot(current)) !== JSON.stringify(survivorAfter)) {
      throw new ServiceError(
        "conflict",
        "The surviving contact changed after this merge. Undo would overwrite newer work.",
      );
    }
    const [duplicateExists] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, operation.duplicateContactId))
      .limit(1);
    if (duplicateExists) {
      throw new ServiceError(
        "conflict",
        "The deleted contact identifier is already in use again.",
      );
    }

    const { id: _survivorId, ...survivorValues } =
      contactSnapshotValues(survivorBefore);
    await ctx.tx
      .update(contacts)
      .set(survivorValues)
      .where(eq(contacts.id, survivorBefore.id));
    await ctx.tx.insert(contacts).values(contactSnapshotValues(duplicateBefore));

    for (const state of storedReferenceStateSchema.parse(operation.referenceState)) {
      const reference = contactReferences().find((item) => item.table === state.table);
      if (!reference) {
        throw new ServiceError(
          "conflict",
          `${state.table} is not available, so its merge changes cannot be restored.`,
        );
      }
      await reference.restoreAfterUndo(
        ctx.tx,
        state.before,
        state.after,
        duplicateBefore.id,
        survivorBefore.id,
      );
    }

    if (operation.candidateId) {
      const pair = [survivorBefore.id, duplicateBefore.id].sort();
      await ctx.tx
        .update(mergeCandidates)
        .set({
          contactAId: pair[0],
          contactBId: pair[1],
          status: "open",
          dismissedAt: null,
          mergedAt: null,
        })
        .where(eq(mergeCandidates.id, operation.candidateId));
    }
    await ctx.tx
      .update(contactMergeOperations)
      .set({ undoneAt: new Date() })
      .where(eq(contactMergeOperations.id, operation.id));

    ctx.setSubject("merge", operation.id);
    for (const contactId of [survivorBefore.id, duplicateBefore.id]) {
      await ctx.emitTimeline({
        contactId,
        eventType: "contact.mergeUndone",
        subjectType: "merge",
        subjectId: operation.id,
        payload: {
          survivingContactId: survivorBefore.id,
          restoredContactId: duplicateBefore.id,
        },
      });
    }
    ctx.queueEvent("contact.mergeUndone", {
      mergeOperationId: operation.id,
      survivingContactId: survivorBefore.id,
      restoredContactId: duplicateBefore.id,
    });
    return {
      operationId: operation.id,
      survivingContact: contactSnapshotValues(survivorBefore),
      restoredContact: contactSnapshotValues(duplicateBefore),
    };
  },
});

export const updateContact = defineService({
  name: "contacts.update",
  writeClass: "write",
  summary: "Change spine fields on a contact.",
  kind: "mutation",
  permission: "scoped",
  input: contactFields.partial().extend({ id: z.string().uuid() }),
  output: contactRow,
  handler: async (input, ctx) => {
    const { id, ...requested } = input;
    if (Object.keys(requested).length === 0) {
      throw new ServiceError("validation", "Choose something to change.");
    }
    const [existing] = await ctx.tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .limit(1);
    if (!existing) {
      throw new ServiceError("not_found", "That contact no longer exists.");
    }
    await ensureOrganization(ctx.tx, requested.orgId);
    const changes = {
      ...requested,
      customFields:
        requested.customFields === undefined
          ? undefined
          : await applyCustomFieldPatch(
              ctx.tx,
              "contact",
              requested.customFields,
              existing.customFields as Record<string, unknown>,
            ),
    };
    const [contact] = await guardDuplicateEmail(requested.email, () =>
      ctx.tx
        .update(contacts)
        .set(changes)
        .where(eq(contacts.id, id))
        .returning(),
    );
    if (!contact) {
      throw new ServiceError("not_found", "That contact no longer exists.");
    }
    ctx.setSubject("contact", contact.id);
    const changedFields = Object.keys(changes).filter(
      (field) => field !== "lifecycleStage" && changes[field as keyof typeof changes] !== undefined,
    );
    if (changedFields.length > 0) {
      await ctx.emitTimeline({
        contactId: contact.id,
        eventType: "contact.updated",
        subjectType: "contact",
        subjectId: contact.id,
        payload: { fields: changedFields },
      });
    }
    if (
      requested.lifecycleStage !== undefined &&
      requested.lifecycleStage !== existing.lifecycleStage
    ) {
      await ctx.emitTimeline({
        contactId: contact.id,
        eventType: "contact.lifecycleChanged",
        subjectType: "contact",
        subjectId: contact.id,
        payload: {
          from: existing.lifecycleStage,
          to: requested.lifecycleStage,
        },
      });
      ctx.queueEvent("contact.lifecycleChanged", {
        contactId: contact.id,
        from: existing.lifecycleStage,
        to: requested.lifecycleStage,
      });
    }
    return contact;
  },
});

export const getContact = defineService({
  name: "contacts.get",
  summary: "Fetch one contact by id.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: contactRow,
  handler: async (input, ctx) => {
    const [contact] = await ctx.tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, input.id))
      .limit(1);
    if (!contact) {
      throw new ServiceError("not_found", "That contact no longer exists.");
    }
    return contact;
  },
});

export const listContacts = defineService({
  name: "contacts.list",
  summary: "Search and page through the spine.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    search: z.string().trim().max(200).optional(),
    lifecycleStage: lifecycleStage.optional(),
    tag: z.string().trim().toLowerCase().max(50).optional(),
    organizationId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).default(0),
  }),
  output: z.object({
    rows: listed(contactRow),
    total: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const filters = [
      input.search
        ? or(
            ilike(contacts.name, `%${input.search}%`),
            ilike(contacts.email, `%${input.search}%`),
          )
        : undefined,
      input.lifecycleStage
        ? eq(contacts.lifecycleStage, input.lifecycleStage)
        : undefined,
      input.tag ? arrayContains(contacts.tags, [input.tag]) : undefined,
      input.organizationId ? eq(contacts.orgId, input.organizationId) : undefined,
    ].filter((f) => f !== undefined);
    const where = filters.length ? and(...filters) : undefined;

    const rows = await ctx.tx
      .select()
      .from(contacts)
      .where(where)
      // Newest first: the contact somebody is looking for is far more often
      // the one that just arrived than the one from three years ago.
      .orderBy(desc(contacts.createdAt))
      .limit(input.limit)
      .offset(input.offset);

    // Counted separately rather than by measuring `rows`, which only ever
    // holds one page â€” a caller cannot page through what it cannot size.
    const [totals] = await ctx.tx
      .select({ n: count() })
      .from(contacts)
      .where(where);

    return { rows, total: totals?.n ?? 0 };
  },
});

export const listContactTags = defineService({
  name: "contacts.listTags",
  summary: "List the canonical tags currently used on contacts.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(z.string()),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx.execute<{ tag: string }>(sql`
      select distinct unnest(${contacts.tags}) as tag
      from ${contacts}
      order by tag
    `);
    return rows.map((row) => row.tag);
  },
});

/**
 * The CRM timeline for one contact (Â§4.1). A *view* over the spine rather than
 * a separate store: modules write TimelineEvents as things happen, and this
 * reads them back. Nothing here knows what a quote or a booking is â€” that is
 * the point of the integration contract.
 */
export const contactTimeline = defineService({
  name: "contacts.timeline",
  summary: "Everything that has happened to one contact, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    contactId: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(timelineEventRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.contactId, input.contactId))
      .orderBy(desc(timelineEvents.occurredAt))
      .limit(input.limit),
});

/**
 * The shape of the spine at a glance. Counted in the database rather than by
 * loading rows and measuring the array â€” a contact list that outgrows one page
 * must not turn the dashboard into a full table scan in application memory.
 */
export const contactStats = defineService({
  name: "contacts.stats",
  summary: "How many contacts there are, and where they are in the lifecycle.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    total: z.number().int(),
    byStage: z.object({
      lead: z.number().int(),
      prospect: z.number().int(),
      customer: z.number().int(),
      repeat: z.number().int(),
    }),
  }),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({ stage: contacts.lifecycleStage, n: count() })
      .from(contacts)
      .groupBy(contacts.lifecycleStage);

    const byStage = Object.fromEntries(
      STAGES.map((stage) => [stage, 0]),
    ) as Record<(typeof STAGES)[number], number>;
    let total = 0;
    for (const row of rows) {
      byStage[row.stage] = row.n;
      total += row.n;
    }
    return { total, byStage };
  },
});

export default [
  createContact,
  resolveContact,
  mergeContacts,
  undoContactMerge,
  updateContact,
  getContact,
  listContacts,
  listContactTags,
  contactTimeline,
  contactStats,
];
