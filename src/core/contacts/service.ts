// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Contact services (MASTER.md §2 principle 3, §4.1). The spine's write path:
// every mutation emits a TimelineEvent (modules write events; the CRM reads
// them) and lands in the audit log via the service wrapper. No module gets
// its own notion of "customer" — this is the only door.
import { z } from "zod";
import {
  and,
  arrayContains,
  count,
  desc,
  eq,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import {
  contacts,
  customerMagicLinks,
  organizations,
  timelineEvents,
} from "@/core/contacts/schema";
import { applyCustomFieldPatch } from "@/core/contacts/custom-fields";
import { repointContactRelationships } from "@/core/contacts/relationships";
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
  /** BCP-47; customer-facing surfaces follow this (§4.9). */
  preferredLocale: localeValue.nullable().optional(),
  timezone: timezoneValue.nullable().optional(),
  /** ISO-3166-1 alpha-2, uppercased; tax keys off this (§4.10). */
  country: countryValue.nullable().optional(),
  ownerNotes: z.string().max(10_000).nullable().optional(),
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

/** Deliberate creation by a human. Automated paths use `contacts.resolve`. */
export const createContact = defineService({
  name: "contacts.create",
  summary: "Add a person or organization member to the spine.",
  kind: "mutation",
  permission: "scoped",
  input: contactFields,
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
 * (§4.6: a form's destination is contact_create *or update*).
 *
 * The governing rule is that automated data fills blanks and never overwrites.
 * A returning visitor typing a phone number into a form should not be able to
 * replace the number the owner corrected by hand last week, and a second form
 * submission must not relabel where the contact originally came from. So:
 *
 * - blank fields are filled;
 * - `source` is first-touch and therefore never rewritten — overwriting it
 *   would destroy the attribution the analytics funnel is built on;
 * - `name` is replaced only while it is still the placeholder `resolve` itself
 *   wrote (the email address), so "someone@example.com" becomes "Sam Okonjo"
 *   the first time a real name arrives, and never changes again;
 * - `lifecycleStage` only moves forward, as it does in a merge — a newsletter
 *   signup from an existing customer must not demote them back to a lead;
 * - `tags` union, `customFields` merge with the stored value winning;
 * - `ownerNotes` is never touched by an automated path at all.
 *
 * Returns the columns that actually changed, so an unchanged contact costs no
 * UPDATE — `updated_at` is a change cursor now, and bumping it on every form
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
 * by a returning visitor, an affiliate signup — all of them mean "this email
 * address is the person," and none of them may mint a second spine record for
 * someone the business already knows (§2 principle 3). Anonymous surfaces reach
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
  /** Physical table name — what the completeness gate matches against. */
  table: string;
  repoint: (
    tx: Tx,
    duplicateId: string,
    survivingId: string,
  ) => Promise<unknown>;
}

/**
 * Every table that references `contacts.id`.
 *
 * ⚠ CONVENTION (CLAUDE.md): a module that adds a `contact_id` column adds its
 * entry here in the same PR. Rows left pointing at a deleted duplicate are the
 * silent fork of the spine that §2 principle 3 exists to prevent.
 *
 * The list is hand-maintained rather than reflected off the schema on purpose.
 * A generic `UPDATE ... SET contact_id` would corrupt any table whose
 * contact_id sits in a unique constraint — a per-contact subscription row, say,
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
  },
  {
    // A bearer link sent for the duplicate identity must not silently become a
    // credential for the survivor after a merge. Invalidate it by deletion.
    table: "customer_magic_links",
    repoint: (tx, duplicateId) =>
      tx
        .delete(customerMagicLinks)
        .where(eq(customerMagicLinks.contactId, duplicateId)),
  },
  {
    table: "timeline_events",
    repoint: (tx, duplicateId, survivingId) =>
      tx
        .update(timelineEvents)
        .set({ contactId: survivingId })
        .where(eq(timelineEvents.contactId, duplicateId)),
  },
];

/**
 * How a *module* declares what a merge means for its own table.
 *
 * Core cannot import a module's schema (§11), so a module that adds a
 * contact_id column registers its repoint from its own services module, which
 * boot imports exactly when the module is installed. The decision stays with
 * the people who know what their table means — which is the whole argument for
 * the list being hand-written — while the obligation to make one is still
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

/** Fold a duplicate into the record that survives. */
export const mergeContacts = defineService({
  name: "contacts.merge",
  summary: "Merge a duplicate contact into the one that survives.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    survivingId: z.string().uuid(),
    duplicateId: z.string().uuid(),
  }),
  handler: async (input, ctx) => {
    if (input.survivingId === input.duplicateId) {
      throw new ServiceError(
        "validation",
        "contacts.merge: a contact cannot be merged into itself",
      );
    }
    const load = async (id: string) => {
      const [row] = await ctx.tx
        .select()
        .from(contacts)
        .where(eq(contacts.id, id))
        .limit(1);
      if (!row) throw new ServiceError("not_found", `no contact with id ${id}`);
      return row;
    };
    const surviving = await load(input.survivingId);
    const duplicate = await load(input.duplicateId);

    // Two contacts, two logins, one survivor: `contacts.user_id` is unique and
    // 1:1, so the merge can keep only one of them. Every way of choosing
    // silently is wrong — the loser's `users` row would outlive the contact it
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
        `Both contacts can sign in — ${surviving.email ?? "the survivor"} and ` +
          `${duplicate.email ?? "the duplicate"} each have their own login. ` +
          `Remove one of the two logins first, then merge.`,
      );
    }

    // Every contact_id FK in the schema, repointed — core's and every
    // installed module's. See contactReferences().
    for (const reference of contactReferences()) {
      await reference.repoint(ctx.tx, duplicate.id, surviving.id);
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
    });
    return result!;
  },
});

export const updateContact = defineService({
  name: "contacts.update",
  summary: "Change spine fields on a contact.",
  kind: "mutation",
  permission: "scoped",
  input: contactFields.partial().extend({ id: z.string().uuid() }),
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
    // holds one page — a caller cannot page through what it cannot size.
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
 * The CRM timeline for one contact (§4.1). A *view* over the spine rather than
 * a separate store: modules write TimelineEvents as things happen, and this
 * reads them back. Nothing here knows what a quote or a booking is — that is
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
 * loading rows and measuring the array — a contact list that outgrows one page
 * must not turn the dashboard into a full table scan in application memory.
 */
export const contactStats = defineService({
  name: "contacts.stats",
  summary: "How many contacts there are, and where they are in the lifecycle.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
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
  updateContact,
  getContact,
  listContacts,
  listContactTags,
  contactTimeline,
  contactStats,
];
