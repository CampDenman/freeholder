// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Translation services (MASTER.md §4.9).
//
// Core owns the table because every module's content is translatable and none
// of them should invent their own way of saying so — the same argument the
// contact spine makes about customers. What core does *not* own is the shape
// of `fields`: a page's translatable fields are cms's business, and core
// stores them without looking inside.
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { defineService, ServiceError } from "@/core/service";
import { entityTranslations } from "@/core/i18n/schema";
import { businessProfile } from "@/core/settings/schema";

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
  permission: "staff",
  input: z.object({
    entityType: z.string().min(1).max(40),
    entityId: z.string().uuid(),
    locale,
    fields: z.record(z.string(), z.unknown()),
    status: z.enum(["draft", "machine", "reviewed"]).default("draft"),
  }),
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
  permission: "staff",
  input: z.object({
    entityType: z.string().min(1).max(40),
    entityId: z.string().uuid(),
  }),
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

export const deleteTranslation = defineService({
  name: "i18n.deleteTranslation",
  summary: "Remove a translation.",
  kind: "mutation",
  permission: "staff",
  input: z.object({ id: z.string().uuid() }),
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

export default [
  setTranslation,
  getTranslation,
  translatedIds,
  listTranslations,
  deleteTranslation,
];
