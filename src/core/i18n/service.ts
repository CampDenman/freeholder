// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Translation services (MASTER.md §4.9).
//
// Core owns the table because every module's content is translatable and none
// of them should invent their own way of saying so — the same argument the
// contact spine makes about customers. What core does *not* own is the shape
// of `fields`: a page's translatable fields are cms's business, and core
// stores them without looking inside.
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";

const translationRow = row({
  id: uuid,
  entityType: z.string(),
  entityId: uuid,
  locale: z.string(),
  fields: z.unknown(),
  status: z.enum(["draft", "machine", "reviewed"]),
  translatedBy: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const localePolicy = row({
  defaultLocale: z.string(),
  enabledLocales: z.array(z.string()),
  locale: z.string(),
});
import { entityTranslations } from "@/core/i18n/schema";
import { businessProfile } from "@/core/settings/schema";
import { contacts } from "@/core/contacts/schema";
import {
  customerLocalePolicy,
  localeForUser,
  resolveEnabledLocale,
} from "@/core/i18n/customer";

const locale = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/, "Use a language tag like fr or fr-CA.");

/**
 * A translation an owner or an agent wrote.
 *
 * The locale is checked against what the instance actually publishes, because
 * a translation into a language the site does not offer is invisible work — and
 * silently accepting it is how somebody spends an afternoon translating into a
 * locale nobody will ever be served.
 */
export const setTranslation = defineService({
  name: "i18n.setTranslation",
  summary: "Write a translation of one entity into one locale.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    entityType: z.string().min(1).max(40),
    entityId: z.string().uuid(),
    locale,
    fields: z.record(z.string(), z.unknown()),
    status: z.enum(["draft", "machine", "reviewed"]).default("draft"),
  }),
  output: translationRow,
  handler: async (input, ctx) => {
    const [business] = await ctx.tx
      .select({
        enabled: businessProfile.enabledLocales,
        fallback: businessProfile.defaultLocale,
      })
      .from(businessProfile)
      .limit(1);

    if (business && !business.enabled.includes(input.locale)) {
      throw new ServiceError(
        "validation",
        `This site does not publish ${input.locale}. Add it in settings first.`,
      );
    }
    if (business && input.locale === business.fallback) {
      // The default locale is not a translation of itself; editing it means
      // editing the page. Allowing both would give one language two homes and
      // no rule about which wins.
      throw new ServiceError(
        "validation",
        `${input.locale} is this site's own language — edit the page itself.`,
      );
    }

    const actor =
      ctx.actor.kind === "user" ? `user:${ctx.actor.userId}` : ctx.actor.kind;

    const [row] = await ctx.tx
      .insert(entityTranslations)
      .values({ ...input, translatedBy: actor })
      .onConflictDoUpdate({
        target: [
          entityTranslations.entityType,
          entityTranslations.entityId,
          entityTranslations.locale,
        ],
        set: { fields: input.fields, status: input.status, translatedBy: actor },
      })
      .returning();

    ctx.setSubject("entity_translation", row!.id);
    ctx.queueEvent("i18n.translated", {
      entityType: input.entityType,
      entityId: input.entityId,
      locale: input.locale,
    });
    return row!;
  },
});

/**
 * The translated fields for one entity, or null.
 *
 * Public, because rendering a page for a visitor needs it. Machine drafts are
 * excluded unless asked for: §4.9 says machine translation may draft and may
 * never publish silently, and the honest place to enforce that is the read
 * path — anywhere else, somebody eventually renders one by accident.
 */
export const getTranslation = defineService({
  name: "i18n.getTranslation",
  summary: "The translated fields for one entity in one locale.",
  kind: "query",
  permission: "public",
  input: z.object({
    entityType: z.string().min(1).max(40),
    entityId: z.string().uuid(),
    locale,
    includeUnreviewed: z.boolean().default(false),
  }),
  output: translationRow.nullable(),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(entityTranslations)
      .where(
        and(
          eq(entityTranslations.entityType, input.entityType),
          eq(entityTranslations.entityId, input.entityId),
          eq(entityTranslations.locale, input.locale),
        ),
      )
      .limit(1);

    if (!row) return null;
    if (!input.includeUnreviewed && row.status !== "reviewed") return null;
    return row;
  },
});

/** Which entities of a type have a usable translation. For sitemaps. */
export const translatedIds = defineService({
  name: "i18n.translatedIds",
  summary: "Which entities are translated into a locale.",
  kind: "query",
  permission: "public",
  input: z.object({
    entityType: z.string().min(1).max(40),
    locale,
    ids: z.array(z.string().uuid()).max(5000).optional(),
  }),
  output: listed(uuid),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({ entityId: entityTranslations.entityId })
      .from(entityTranslations)
      .where(
        and(
          eq(entityTranslations.entityType, input.entityType),
          eq(entityTranslations.locale, input.locale),
          eq(entityTranslations.status, "reviewed"),
          input.ids ? inArray(entityTranslations.entityId, input.ids) : undefined,
        ),
      );
    return rows.map((row) => row.entityId);
  },
});

export const listTranslations = defineService({
  name: "i18n.listTranslations",
  summary: "Every translation of one entity, for the admin.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    entityType: z.string().min(1).max(40),
    entityId: z.string().uuid(),
  }),
  output: listed(translationRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(entityTranslations)
      .where(
        and(
          eq(entityTranslations.entityType, input.entityType),
          eq(entityTranslations.entityId, input.entityId),
        ),
      ),
});

/**
 * Every translation of one type, across locales — the admin's index.
 *
 * One query rather than one per entity per locale, because the screen this
 * feeds asks the same question about everything at once: what is missing.
 * `fields` is deliberately not selected; the index needs to know a translation
 * exists and how far along it is, not what it says.
 */
export const translationIndex = defineService({
  name: "i18n.translationIndex",
  summary: "Which entities have a translation, and how far along it is.",
  kind: "query",
  permission: "scoped",
  input: z.object({ entityType: z.string().min(1).max(40) }),
  output: listed(
    row({
      id: uuid,
      entityId: uuid,
      locale: z.string(),
      status: z.enum(["draft", "machine", "reviewed"]),
      updatedAt: timestamp,
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: entityTranslations.id,
        entityId: entityTranslations.entityId,
        locale: entityTranslations.locale,
        status: entityTranslations.status,
        updatedAt: entityTranslations.updatedAt,
      })
      .from(entityTranslations)
      .where(eq(entityTranslations.entityType, input.entityType)),
});

export const deleteTranslation = defineService({
  name: "i18n.deleteTranslation",
  summary: "Remove a translation.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: okResult,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .delete(entityTranslations)
      .where(eq(entityTranslations.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "That translation is gone.");
    ctx.setSubject("entity_translation", input.id);
    return { ok: true };
  },
});

/** The locale policy that drives this signed-in customer's portal. */
export const getMyLocale = defineService({
  name: "i18n.getMyLocale",
  summary: "Resolve the signed-in customer's enabled locale and fallback policy.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: localePolicy,
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "A customer locale requires a signed-in person.");
    }
    return localeForUser(ctx.tx, ctx.actor.userId);
  },
});

/**
 * Change the linked Contact fact directly from the customer portal. Only an
 * enabled instance locale is accepted, so the next page, template and
 * notification all have the same answer immediately.
 */
export const setMyLocale = defineService({
  name: "i18n.setMyLocale",
  summary: "Set the signed-in customer's preferred locale.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ locale }),
  output: localePolicy,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "A customer locale requires a signed-in person.");
    }
    const [contact] = await ctx.tx
      .select({ id: contacts.id, preferredLocale: contacts.preferredLocale })
      .from(contacts)
      .where(eq(contacts.userId, ctx.actor.userId))
      .limit(1);
    if (!contact) {
      throw new ServiceError("permission", "This account is not linked to a customer profile.");
    }
    const policy = await customerLocalePolicy(ctx.tx);
    if (!policy.enabledLocales.some(
      (enabled) => enabled.toLowerCase() === input.locale.toLowerCase(),
    )) {
      throw new ServiceError("validation", "Choose a language this site publishes.");
    }
    const selected = resolveEnabledLocale(input.locale, policy);
    if (contact.preferredLocale === selected) {
      ctx.setSubject("contact", contact.id);
      return { ...policy, locale: selected };
    }
    await ctx.tx
      .update(contacts)
      .set({ preferredLocale: selected })
      .where(eq(contacts.id, contact.id));
    ctx.setSubject("contact", contact.id);
    await ctx.emitTimeline({
      contactId: contact.id,
      eventType: "contact.localeChanged",
      subjectType: "contact",
      subjectId: contact.id,
      payload: { locale: selected },
    });
    return { ...policy, locale: selected };
  },
});

export default [
  setTranslation,
  getTranslation,
  translatedIds,
  listTranslations,
  translationIndex,
  deleteTranslation,
  getMyLocale,
  setMyLocale,
];
