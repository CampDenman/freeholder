// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Contact services (MASTER.md §2 principle 3, §4.1). The spine's write path:
// every mutation emits a TimelineEvent (modules write events; the CRM reads
// them) and lands in the audit log via the service wrapper. No module gets
// its own notion of "customer" — this is the only door.
import { z } from "zod";
import { and, arrayContains, eq, ilike, or, sql } from "drizzle-orm";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import { isUniqueViolation } from "@/core/db";
import { defineService, ServiceError } from "@/core/service";

const STAGES = ["lead", "prospect", "customer", "repeat"] as const;
const lifecycleStage = z.enum(STAGES);

const contactFields = z.object({
  name: z.string().min(1),
  email: z.string().email().toLowerCase().optional(),
  phone: z.string().optional(),
  orgId: z.string().uuid().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).default([]),
  customFields: z.record(z.string(), z.unknown()).default({}),
  lifecycleStage: lifecycleStage.default("lead"),
  /** BCP-47; customer-facing surfaces follow this (§4.9). */
  preferredLocale: z.string().optional(),
  timezone: z.string().optional(),
  /** ISO-3166-1 alpha-2, uppercased; tax keys off this (§4.10). */
  country: z.string().length(2).toUpperCase().optional(),
  ownerNotes: z.string().optional(),
});

/**
 * The unique email index is the spine's identity rule; hitting it is a conflict
 * with an obvious remedy, not an internal error. Surfacing it that way is what
 * lets the caller choose between resolving and merging.
 */
async function guardDuplicateEmail<T>(
  email: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (email && isUniqueViolation(error, "contacts_email_idx")) {
      throw new ServiceError(
        "conflict",
        `A contact with the email ${email} already exists — resolve it (contacts.resolve) or merge the records (contacts.merge).`,
      );
    }
    throw error;
  }
}

/** Deliberate creation by a human. Automated paths use `contacts.resolve`. */
export const createContact = defineService({
  name: "contacts.create",
  summary: "Add a person or organization member to the spine.",
  kind: "mutation",
  permission: "staff",
  input: contactFields,
  handler: async (input, ctx) => {
    const [contact] = await guardDuplicateEmail(input.email, () =>
      ctx.tx.insert(contacts).values(input).returning(),
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
  permission: "staff",
  input: contactFields.partial().extend({
    email: z.string().email().toLowerCase(),
  }),
  handler: async (input, ctx) => {
    const found = async () =>
      (
        await ctx.tx
          .select()
          .from(contacts)
          .where(eq(contacts.email, input.email))
          .limit(1)
      )[0];

    const existing = await found();
    if (existing) {
      ctx.setSubject("contact", existing.id);
      return { contact: existing, created: false };
    }

    const [inserted] = await ctx.tx
      .insert(contacts)
      .values({
        ...input,
        name: input.name ?? input.email,
        tags: input.tags ?? [],
        customFields: input.customFields ?? {},
        lifecycleStage: input.lifecycleStage ?? "lead",
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
      ctx.setSubject("contact", raced.id);
      return { contact: raced, created: false };
    }

    ctx.setSubject("contact", inserted.id);
    await ctx.emitTimeline({
      contactId: inserted.id,
      eventType: "contact.created",
      subjectType: "contact",
      subjectId: inserted.id,
      payload: { source: input.source ?? "resolve" },
    });
    ctx.queueEvent("contact.created", { contactId: inserted.id });
    return { contact: inserted, created: true };
  },
});

/**
 * Fold a duplicate into the record that survives.
 *
 * ⚠ CONVENTION: every table that references `contacts.id` must be repointed
 * here. A module that adds a `contact_id` column and does not extend this
 * handler leaves rows orphaned on merge — the spine silently forks, which is
 * the exact failure §2 principle 3 exists to prevent. See CLAUDE.md.
 */
export const mergeContacts = defineService({
  name: "contacts.merge",
  summary: "Merge a duplicate contact into the one that survives.",
  kind: "mutation",
  permission: "owner",
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

    // Every contact_id FK in the schema, repointed. Keep this list exhaustive.
    await ctx.tx
      .update(timelineEvents)
      .set({ contactId: surviving.id })
      .where(eq(timelineEvents.contactId, duplicate.id));

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
      updatedAt: sql`now()`,
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
  permission: "staff",
  input: contactFields.partial().extend({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const { id, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "contacts.update: nothing to change");
    }
    const [contact] = await guardDuplicateEmail(changes.email, () =>
      ctx.tx
        .update(contacts)
        .set({ ...changes, updatedAt: sql`now()` })
        .where(eq(contacts.id, id))
        .returning(),
    );
    if (!contact) {
      throw new ServiceError("not_found", `no contact with id ${id}`);
    }
    ctx.setSubject("contact", contact.id);
    await ctx.emitTimeline({
      contactId: contact.id,
      eventType: "contact.updated",
      subjectType: "contact",
      subjectId: contact.id,
      payload: { fields: Object.keys(changes) },
    });
    return contact;
  },
});

export const getContact = defineService({
  name: "contacts.get",
  summary: "Fetch one contact by id.",
  kind: "query",
  permission: "staff",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [contact] = await ctx.tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, input.id))
      .limit(1);
    if (!contact) {
      throw new ServiceError("not_found", `no contact with id ${input.id}`);
    }
    return contact;
  },
});

export const listContacts = defineService({
  name: "contacts.list",
  summary: "Search and page through the spine.",
  kind: "query",
  permission: "staff",
  input: z.object({
    search: z.string().optional(),
    lifecycleStage: lifecycleStage.optional(),
    tag: z.string().optional(),
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
    ].filter((f) => f !== undefined);
    return ctx.tx
      .select()
      .from(contacts)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(contacts.createdAt)
      .limit(input.limit)
      .offset(input.offset);
  },
});

export default [
  createContact,
  resolveContact,
  mergeContacts,
  updateContact,
  getContact,
  listContacts,
];
