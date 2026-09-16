// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The help centre / knowledge base (MASTER.md §4.6, C8.12).
//
// There is no article table and no article editor. §4.6: "The help centre is
// the CMS, not a second CMS. A HelpArticle is a Page with a category and a
// helpfulness counter." So an article is written, translated, previewed,
// scheduled, approved and published by exactly the services above it in this
// module, and everything here is about the two things a page does not already
// have: which category it is filed under, and whether it helped.
//
// The reason that matters is stated in §4.6 too — "a business that has to
// learn a second editor to answer 'what are your opening hours' will not write
// the second article, and the platform will have shipped a knowledge base
// nobody fills in."
import { z } from "zod";
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import { helpCategories, pages } from "./schema";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens.");

const category = row({
  id: uuidSchema,
  slug: z.string(),
  locale: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  position: z.number().int(),
  articleCount: z.number().int(),
});

const article = row({
  id: uuidSchema,
  slug: z.string(),
  locale: z.string(),
  title: z.string(),
  categoryId: uuidSchema.nullable(),
  categorySlug: z.string().nullable(),
  categoryName: z.string().nullable(),
  helpfulYes: z.number().int(),
  helpfulNo: z.number().int(),
  updatedAt: z.date(),
});

/**
 * Published, in this locale, and filed under a category.
 *
 * The third condition is what separates the help centre from the rest of the
 * site: a page becomes an article by being filed, so an owner promotes an
 * existing page into the knowledge base by giving it a category rather than
 * by copying it into a second system.
 */
const publishedArticle = (locale: string) =>
  and(
    eq(pages.status, "published"),
    eq(pages.locale, locale),
    isNotNull(pages.helpCategoryId),
  );

/**
 * Every string anywhere in the block tree, matched case-insensitively.
 *
 * §4.6 asks for trigram search "over title and body", and the body is a block
 * tree rather than a column. Rather than denormalise it into a text column
 * that drifts from the blocks it was copied from, this asks Postgres for the
 * strings at query time — it cannot go stale, and there is no write path to
 * remember to update.
 *
 * The cost is that the body half of the search is a scan. That is the right
 * trade at help-centre scale (tens of articles, not millions of rows), and the
 * title half — the half that actually matches what people type — is indexed by
 * `pages_title_search_idx`. If a business ever writes enough articles for this
 * to matter, the fix is a maintained tsvector, and it will be obvious.
 */
const bodyMatches = (pattern: string) =>
  sql`exists (
    select 1
    from jsonb_path_query(${pages.blocks}, '$.**?(@.type() == "string")') as node
    where node #>> '{}' ilike ${pattern}
  )`;

export const helpCategoryList = defineService({
  name: "cms.helpCategories",
  summary: "The help centre's categories, in the owner's order.",
  kind: "query",
  permission: "public",
  input: z.object({ locale: z.string().default("en") }),
  output: listed(category),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: helpCategories.id,
        slug: helpCategories.slug,
        locale: helpCategories.locale,
        name: helpCategories.name,
        description: helpCategories.description,
        position: helpCategories.position,
        // A join and a group, not a correlated subquery: the subquery form
        // silently counted zero here, because a `sql` fragment embedded in a
        // select does not correlate to the outer row the way it reads as
        // though it does. This is both correct and the shape drizzle checks.
        articleCount: sql<number>`count(${pages.id})::int`,
      })
      .from(helpCategories)
      // Published only: a category whose articles are all drafts is empty to
      // a reader, and saying "3 articles" above nothing is a small lie. The
      // condition belongs in the join rather than the where, or a category
      // with no published article would drop out of the list entirely.
      .leftJoin(
        pages,
        and(eq(pages.helpCategoryId, helpCategories.id), eq(pages.status, "published")),
      )
      .where(eq(helpCategories.locale, input.locale))
      .groupBy(helpCategories.id)
      // Ties break by name so a list of same-position categories never
      // reorders itself between two requests.
      .orderBy(asc(helpCategories.position), asc(helpCategories.name));
    return rows;
  },
});

export const helpArticles = defineService({
  name: "cms.helpArticles",
  summary: "Published help articles, newest first, optionally in one category.",
  kind: "query",
  permission: "public",
  input: z.object({
    locale: z.string().default("en"),
    categorySlug: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  output: listed(article),
  handler: async (input, ctx) => {
    const conditions = [publishedArticle(input.locale)];
    if (input.categorySlug) conditions.push(eq(helpCategories.slug, input.categorySlug));
    return ctx.tx
      .select({
        id: pages.id,
        slug: pages.slug,
        locale: pages.locale,
        title: pages.title,
        categoryId: pages.helpCategoryId,
        categorySlug: helpCategories.slug,
        categoryName: helpCategories.name,
        helpfulYes: pages.helpfulYes,
        helpfulNo: pages.helpfulNo,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .innerJoin(helpCategories, eq(helpCategories.id, pages.helpCategoryId))
      .where(and(...conditions))
      .orderBy(asc(helpCategories.position), desc(pages.updatedAt))
      .limit(input.limit);
  },
});

export const searchHelp = defineService({
  name: "cms.searchHelp",
  summary: "Find a help article by a fragment of the problem.",
  kind: "query",
  permission: "public",
  input: z.object({
    q: z.string().trim().min(1).max(120),
    locale: z.string().default("en"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  output: listed(article),
  handler: async (input, ctx) => {
    const pattern = `%${input.q}%`;
    return ctx.tx
      .select({
        id: pages.id,
        slug: pages.slug,
        locale: pages.locale,
        title: pages.title,
        categoryId: pages.helpCategoryId,
        categorySlug: helpCategories.slug,
        categoryName: helpCategories.name,
        helpfulYes: pages.helpfulYes,
        helpfulNo: pages.helpfulNo,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .innerJoin(helpCategories, eq(helpCategories.id, pages.helpCategoryId))
      .where(
        and(
          publishedArticle(input.locale),
          or(sql`${pages.title} ilike ${pattern}`, bodyMatches(pattern)),
        ),
      )
      // A title match is what somebody meant; a body match is what they might
      // have meant. Ordering by that is the whole ranking, and it is enough.
      .orderBy(sql`(${pages.title} ilike ${pattern}) desc`, desc(pages.updatedAt))
      .limit(input.limit);
  },
});

export const rateHelpArticle = defineService({
  name: "cms.rateHelpArticle",
  writeClass: "blocks",
  summary: "Record that an article did or did not help.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    articleId: uuidSchema,
    helpful: z.boolean(),
  }),
  // Not ballot-box-proof, and it does not need to be: nothing is decided by
  // this number. It tells an owner which article to rewrite, so the only
  // threat worth spending anything on is a script running it up in seconds.
  rateLimit: {
    limit: 30,
    windowSeconds: 60 * 60,
    subject: (input) => input.articleId,
    message: "That has been recorded already.",
  },
  output: row({ helpfulYes: z.number().int(), helpfulNo: z.number().int() }),
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(pages)
      .set(
        input.helpful
          ? { helpfulYes: sql`${pages.helpfulYes} + 1` }
          : { helpfulNo: sql`${pages.helpfulNo} + 1` },
      )
      // Only a published article can be rated. A draft has no readers, so a
      // vote on one came from somebody guessing ids.
      .where(
        and(eq(pages.id, input.articleId), eq(pages.status, "published"), isNotNull(pages.helpCategoryId)),
      )
      .returning({ helpfulYes: pages.helpfulYes, helpfulNo: pages.helpfulNo });
    if (!updated) throw new ServiceError("not_found", "There is no such help article.");
    return updated;
  },
});

export const saveHelpCategory = defineService({
  name: "cms.saveHelpCategory",
  writeClass: "blocks",
  summary: "Create or rename a help category.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    slug,
    locale: z.string().default("en"),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(400).nullish(),
    position: z.number().int().min(0).max(9999).default(0),
  }),
  output: row({ id: uuidSchema, slug: z.string() }),
  handler: async (input, ctx) => {
    const clash = await ctx.tx
      .select({ id: helpCategories.id })
      .from(helpCategories)
      .where(and(eq(helpCategories.slug, input.slug), eq(helpCategories.locale, input.locale)));
    if (clash.some((existing) => existing.id !== input.id)) {
      throw new ServiceError(
        "conflict",
        `Another category already uses "${input.slug}" in this language.`,
      );
    }

    const values = {
      slug: input.slug,
      locale: input.locale,
      name: input.name,
      description: input.description ?? null,
      position: input.position,
    };

    if (input.id) {
      const [updated] = await ctx.tx
        .update(helpCategories)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(helpCategories.id, input.id))
        .returning({ id: helpCategories.id, slug: helpCategories.slug });
      if (!updated) throw new ServiceError("not_found", "There is no such category.");
      return updated;
    }

    const [created] = await ctx.tx
      .insert(helpCategories)
      .values(values)
      .returning({ id: helpCategories.id, slug: helpCategories.slug });
    return created!;
  },
});

export const deleteHelpCategory = defineService({
  name: "cms.deleteHelpCategory",
  writeClass: "destructive",
  summary: "Remove a help category. Its articles stay published, uncategorised.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: row({ ok: z.literal(true), uncategorised: z.number().int() }),
  handler: async (input, ctx) => {
    // The FK is ON DELETE SET NULL, so this counts what is about to be
    // orphaned rather than what is about to be destroyed. Deleting a category
    // must never delete the writing in it — that is unrecoverable, and an
    // uncategorised article is not.
    const affected = await ctx.tx
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.helpCategoryId, input.id));
    const [removed] = await ctx.tx
      .delete(helpCategories)
      .where(eq(helpCategories.id, input.id))
      .returning({ id: helpCategories.id });
    if (!removed) throw new ServiceError("not_found", "There is no such category.");
    return { ok: true as const, uncategorised: affected.length };
  },
});

export const fileHelpArticle = defineService({
  name: "cms.fileHelpArticle",
  writeClass: "blocks",
  summary: "File a page under a help category, or take it out of the help centre.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    pageId: uuidSchema,
    // null takes the page out of the help centre without deleting it — it
    // stays a published page at the same URL, which is why this is one field
    // and not a "delete article" service.
    categoryId: uuidSchema.nullable(),
  }),
  output: row({ id: uuidSchema, categoryId: uuidSchema.nullable() }),
  handler: async (input, ctx) => {
    if (input.categoryId) {
      const [exists] = await ctx.tx
        .select({ id: helpCategories.id })
        .from(helpCategories)
        .where(eq(helpCategories.id, input.categoryId));
      if (!exists) throw new ServiceError("not_found", "There is no such category.");
    }
    const [updated] = await ctx.tx
      .update(pages)
      .set({ helpCategoryId: input.categoryId, updatedAt: new Date() })
      .where(eq(pages.id, input.pageId))
      .returning({ id: pages.id, categoryId: pages.helpCategoryId });
    if (!updated) throw new ServiceError("not_found", "There is no such page.");
    return updated;
  },
});

export const helpArticleFeedback = defineService({
  name: "cms.helpArticleFeedback",
  summary: "What readers said about each article, worst ratio first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ locale: z.string().default("en") }),
  output: listed(article),
  handler: async (input, ctx) =>
    ctx.tx
      .select({
        id: pages.id,
        slug: pages.slug,
        locale: pages.locale,
        title: pages.title,
        categoryId: pages.helpCategoryId,
        categorySlug: helpCategories.slug,
        categoryName: helpCategories.name,
        helpfulYes: pages.helpfulYes,
        helpfulNo: pages.helpfulNo,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .innerJoin(helpCategories, eq(helpCategories.id, pages.helpCategoryId))
      .where(and(eq(pages.locale, input.locale), isNotNull(pages.helpCategoryId)))
      // The article people told you was unhelpful, most often, first — that is
      // the one worth an afternoon. Articles nobody rated sort last rather
      // than first, because "no signal" is not "no problem".
      .orderBy(desc(pages.helpfulNo), asc(pages.helpfulYes)),
});

export const helpArticleAt = defineService({
  name: "cms.helpArticleAt",
  summary: "The help article published at a path, or null if that page is not one.",
  kind: "query",
  permission: "public",
  input: z.object({
    slug: z.string().transform((value) => value.replace(/^\/+|\/+$/g, "")),
    locale: z.string().default("en"),
  }),
  // Nullable rather than an error: asking whether a page is an article is a
  // legitimate question about any path, and "no" is an answer, not a fault.
  output: article.nullable(),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select({
        id: pages.id,
        slug: pages.slug,
        locale: pages.locale,
        title: pages.title,
        categoryId: pages.helpCategoryId,
        categorySlug: helpCategories.slug,
        categoryName: helpCategories.name,
        helpfulYes: pages.helpfulYes,
        helpfulNo: pages.helpfulNo,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .innerJoin(helpCategories, eq(helpCategories.id, pages.helpCategoryId))
      .where(and(eq(pages.slug, input.slug), publishedArticle(input.locale)));
    return found ?? null;
  },
});
