// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// CMS services (MASTER.md §11, §32).
//
// The module's only entry points. The public route, the admin, the REST API
// and MCP all arrive here, which is what makes "structure is a database write"
// safe: an agent rearranging a page goes through the same validation,
// permission check, audit row and revision history a human does.
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { defineService, ServiceError } from "@/core/service";
import { isUniqueViolation } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { recordRedirect } from "@/core/seo/service";
import { contentRevisions, pages, sections } from "./schema";
import { blockTreeSchema, parseBlockTree } from "./blocks/registry";
import type { BlockNode } from "./blocks/types";
import {
  defaultFooter,
  defaultHeader,
  defaultHome,
  FOOTER_KEY,
  HEADER_KEY,
} from "./defaults";

/** No leading or trailing slash; the home page is the empty string. */
const slug = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\/+|\/+$/g, ""))
  .refine((value) => !value.includes("//"), "a path cannot contain //")
  .refine(
    (value) => value === "" || /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(value),
    "use lowercase words separated by hyphens or slashes",
  );

/**
 * The read side takes any string.
 *
 * `slug` above is the *write* rule, and it is right to be strict there. Using
 * it for lookups was wrong: a visitor's URL is untrusted input, so a request
 * for `/favicon.ico` or `/wp-admin.php` failed validation and answered 500
 * where the honest answer is "no such page". Any string is a legitimate
 * question; the answer is simply null.
 */
const lookupSlug = z
  .string()
  .transform((value) => value.replace(/^\/+|\/+$/g, ""));

const seo = z
  .object({
    title: z.string().max(60).optional(),
    description: z.string().max(155).optional(),
  })
  .default({});

/* ------------------------------------------------------------------ pages */

/**
 * The page behind a path, for the public surface.
 *
 * Public, and *only* published rows — a draft must not be readable by URL,
 * because "unlisted" is not a permission model. The admin preview path reads
 * through `cms.getPage`, which is staff-only and can see drafts.
 */
export const resolvePage = defineService({
  name: "cms.resolvePage",
  summary: "The published page at a path, or null.",
  kind: "query",
  permission: "public",
  input: z.object({ slug: lookupSlug, locale: z.string().default("en") }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.slug, input.slug),
          eq(pages.locale, input.locale),
          eq(pages.status, "published"),
        ),
      )
      .limit(1);
    return page ?? null;
  },
});

export const getPage = defineService({
  name: "cms.getPage",
  summary: "One page by id, including drafts.",
  kind: "query",
  permission: "staff",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .select()
      .from(pages)
      .where(eq(pages.id, input.id))
      .limit(1);
    if (!page) throw new ServiceError("not_found", `no page with id ${input.id}`);
    return page;
  },
});

export const listPages = defineService({
  name: "cms.listPages",
  summary: "Every page, newest first.",
  kind: "query",
  permission: "staff",
  input: z.object({}),
  handler: (_input, ctx) =>
    ctx.tx.select().from(pages).orderBy(desc(pages.updatedAt)),
});

/**
 * Published pages as paths — the sitemap source this module contributes (§5).
 *
 * Public because a sitemap is public. It returns only what is already readable
 * at a URL, so it cannot leak a draft.
 */
export const publishedPaths = defineService({
  name: "cms.publishedPaths",
  summary: "Every published page's path, for sitemaps and navigation.",
  kind: "query",
  permission: "public",
  input: z.object({ locale: z.string().default("en") }),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        slug: pages.slug,
        title: pages.title,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .where(and(eq(pages.locale, input.locale), eq(pages.status, "published")))
      .orderBy(pages.slug),
});

const duplicateSlug = (slugValue: string) =>
  new ServiceError(
    "conflict",
    slugValue === ""
      ? "There is already a home page for this language."
      : `Another page already lives at /${slugValue}.`,
  );

export const createPage = defineService({
  name: "cms.createPage",
  summary: "Add a page.",
  kind: "mutation",
  permission: "staff",
  input: z.object({
    slug,
    locale: z.string().default("en"),
    title: z.string().min(1),
    blocks: blockTreeSchema("page").default([]),
    seo,
  }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .insert(pages)
      .values(input)
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "pages_slug_locale_idx")) {
          throw duplicateSlug(input.slug);
        }
        throw error;
      });
    ctx.setSubject("page", page!.id);
    ctx.queueEvent("cms.pageCreated", { pageId: page!.id, slug: page!.slug });
    return page!;
  },
});

/**
 * Save a page, keeping the previous version.
 *
 * The revision is written *before* the update, inside the same transaction, so
 * "restore" always has somewhere to go back to and a failed save cannot leave a
 * revision describing a state that never existed (§2 principle 12).
 */
export const updatePage = defineService({
  name: "cms.updatePage",
  summary: "Change a page's content or settings.",
  kind: "mutation",
  permission: "staff",
  input: z.object({
    id: z.string().uuid(),
    slug: slug.optional(),
    title: z.string().min(1).optional(),
    blocks: blockTreeSchema("page").optional(),
    seo: seo.optional(),
  }),
  handler: async (input, ctx) => {
    const { id, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "cms.updatePage: nothing to change");
    }

    const [before] = await ctx.tx
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);
    if (!before) throw new ServiceError("not_found", `no page with id ${id}`);

    await ctx.tx.insert(contentRevisions).values({
      subjectType: "page",
      subjectId: before.id,
      title: before.title,
      blocks: before.blocks,
      actor: ctx.actor.kind === "user" ? `user:${ctx.actor.userId}` : "system",
    });

    const [page] = await ctx.tx
      .update(pages)
      .set(changes)
      .where(eq(pages.id, id))
      .returning()
      .catch((error: unknown) => {
        if (changes.slug !== undefined && isUniqueViolation(error, "pages_slug_locale_idx")) {
          throw duplicateSlug(changes.slug);
        }
        throw error;
      });

    // §5: "automatic redirect creation on slug change — slugs never silently
    // break". Renaming a page is a normal editorial act; every link anyone
    // ever shared to the old address breaking is not, and the platform is the
    // only party that can see the rename happen.
    //
    // Elevated because an owner renaming a page has not asked for a redirect
    // and should not have to; it rides the same transaction, so a page that
    // moved and a redirect that records it commit together or not at all.
    if (changes.slug !== undefined && changes.slug !== before.slug) {
      await ctx.callAsSystem(recordRedirect, {
        fromPath: before.slug,
        toPath: page!.slug,
        locale: before.locale,
        source: "slug-change",
      });
    }

    ctx.setSubject("page", page!.id);
    ctx.queueEvent("cms.pageUpdated", { pageId: page!.id, slug: page!.slug });
    return page!;
  },
});

export const publishPage = defineService({
  name: "cms.publishPage",
  summary: "Make a page live, or take it back to draft.",
  kind: "mutation",
  permission: "staff",
  input: z.object({ id: z.string().uuid(), published: z.boolean() }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .update(pages)
      .set({
        status: input.published ? "published" : "draft",
        publishedAt: input.published ? sql`now()` : null,
      })
      .where(eq(pages.id, input.id))
      .returning();
    if (!page) throw new ServiceError("not_found", `no page with id ${input.id}`);
    ctx.setSubject("page", page.id);
    ctx.queueEvent(input.published ? "cms.pagePublished" : "cms.pageUnpublished", {
      pageId: page.id,
      slug: page.slug,
    });
    return page;
  },
});

/* --------------------------------------------------------------- sections */

/**
 * A chrome section by key, for the layout. Public: the header and footer are
 * on every page a visitor can already see.
 */
export const getSection = defineService({
  name: "cms.getSection",
  summary: "One section by key — the header, the footer, a saved arrangement.",
  kind: "query",
  permission: "public",
  input: z.object({ key: z.string().min(1), locale: z.string().default("en") }),
  handler: async (input, ctx) => {
    const [section] = await ctx.tx
      .select()
      .from(sections)
      .where(and(eq(sections.key, input.key), eq(sections.locale, input.locale)))
      .limit(1);
    return section ?? null;
  },
});

export const listSections = defineService({
  name: "cms.listSections",
  summary: "Every section, chrome first.",
  kind: "query",
  permission: "staff",
  input: z.object({}),
  handler: (_input, ctx) =>
    ctx.tx.select().from(sections).orderBy(sections.kind, sections.name),
});

export const updateSection = defineService({
  name: "cms.updateSection",
  summary: "Change a section's content.",
  kind: "mutation",
  permission: "staff",
  input: z.object({
    key: z.string().min(1),
    locale: z.string().default("en"),
    name: z.string().min(1).optional(),
    blocks: blockTreeSchema("chrome"),
  }),
  handler: async (input, ctx) => {
    const [before] = await ctx.tx
      .select()
      .from(sections)
      .where(and(eq(sections.key, input.key), eq(sections.locale, input.locale)))
      .limit(1);
    if (!before) {
      throw new ServiceError("not_found", `no section named "${input.key}"`);
    }

    await ctx.tx.insert(contentRevisions).values({
      subjectType: "section",
      subjectId: before.id,
      title: before.name,
      blocks: before.blocks,
      actor: ctx.actor.kind === "user" ? `user:${ctx.actor.userId}` : "system",
    });

    const [section] = await ctx.tx
      .update(sections)
      .set({ blocks: input.blocks, ...(input.name ? { name: input.name } : {}) })
      .where(eq(sections.id, before.id))
      .returning();

    ctx.setSubject("section", section!.id);
    ctx.queueEvent("cms.sectionUpdated", { key: section!.key });
    return section!;
  },
});

/* -------------------------------------------------------------- revisions */

export const listRevisions = defineService({
  name: "cms.listRevisions",
  summary: "Earlier versions of a page or section.",
  kind: "query",
  permission: "staff",
  input: z.object({
    subjectType: z.enum(["page", "section"]),
    subjectId: z.string().uuid(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(contentRevisions)
      .where(
        and(
          eq(contentRevisions.subjectType, input.subjectType),
          eq(contentRevisions.subjectId, input.subjectId),
        ),
      )
      .orderBy(desc(contentRevisions.createdAt))
      .limit(input.limit),
});

/**
 * Put a page or section back to an earlier version.
 *
 * Restoring is itself a change, so it writes a revision of the *current* state
 * first — §37 requires every change to be "reversible within one action", and
 * an undo you cannot undo only half satisfies that.
 */
export const restoreRevision = defineService({
  name: "cms.restoreRevision",
  summary: "Put a page or section back to an earlier version.",
  kind: "mutation",
  permission: "staff",
  input: z.object({ revisionId: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [revision] = await ctx.tx
      .select()
      .from(contentRevisions)
      .where(eq(contentRevisions.id, input.revisionId))
      .limit(1);
    if (!revision) {
      throw new ServiceError("not_found", "that version no longer exists");
    }

    const actor =
      ctx.actor.kind === "user" ? `user:${ctx.actor.userId}` : "system";

    if (revision.subjectType === "page") {
      const [before] = await ctx.tx
        .select()
        .from(pages)
        .where(eq(pages.id, revision.subjectId))
        .limit(1);
      if (!before) throw new ServiceError("not_found", "that page is gone");

      await ctx.tx.insert(contentRevisions).values({
        subjectType: "page",
        subjectId: before.id,
        title: before.title,
        blocks: before.blocks,
        actor,
      });
      const [page] = await ctx.tx
        .update(pages)
        .set({
          blocks: parseBlockTree(revision.blocks, "page"),
          ...(revision.title ? { title: revision.title } : {}),
        })
        .where(eq(pages.id, before.id))
        .returning();
      ctx.setSubject("page", page!.id);
      return { subjectType: "page" as const, id: page!.id };
    }

    const [before] = await ctx.tx
      .select()
      .from(sections)
      .where(eq(sections.id, revision.subjectId))
      .limit(1);
    if (!before) throw new ServiceError("not_found", "that section is gone");

    await ctx.tx.insert(contentRevisions).values({
      subjectType: "section",
      subjectId: before.id,
      title: before.name,
      blocks: before.blocks,
      actor,
    });
    const [section] = await ctx.tx
      .update(sections)
      .set({ blocks: parseBlockTree(revision.blocks, "chrome") })
      .where(eq(sections.id, before.id))
      .returning();
    ctx.setSubject("section", section!.id);
    return { subjectType: "section" as const, id: section!.id };
  },
});

/* ---------------------------------------------------------------- defaults */

/**
 * Give a fresh instance a site (§32: "day one still looks designed").
 *
 * Idempotent by construction — every insert is `onConflictDoNothing` against
 * the natural key — so it is safe to call on every setup completion, on a
 * re-run, and from an admin button that repairs a site somebody emptied.
 *
 * Owner-permission, because creating a site's chrome is not a routine staff
 * edit. The setup-completion listener is not a user and has nobody to act as,
 * so it calls as `system` — which `permits()` allows past every check. That is
 * the one elevation in this module, it is named `onSetupCompleted`, and it is
 * greppable, which is the whole reason elevation is spelled out rather than
 * implied (§11).
 */
export const ensureDefaults = defineService({
  name: "cms.ensureDefaults",
  summary: "Create the starting header, footer and home page if absent.",
  kind: "mutation",
  permission: "owner",
  input: z.object({ locale: z.string().default("en") }),
  handler: async (input, ctx) => {
    const [business] = await ctx.tx
      .select({ name: businessProfile.name, tagline: businessProfile.tagline })
      .from(businessProfile)
      .limit(1);
    const name = business?.name ?? "Freeholder";

    const created: string[] = [];

    const chrome: Array<{ key: string; name: string; blocks: BlockNode[] }> = [
      { key: HEADER_KEY, name: "Header", blocks: defaultHeader() },
      { key: FOOTER_KEY, name: "Footer", blocks: defaultFooter(name) },
    ];
    for (const piece of chrome) {
      const inserted = await ctx.tx
        .insert(sections)
        .values({
          key: piece.key,
          locale: input.locale,
          name: piece.name,
          kind: "chrome",
          blocks: parseBlockTree(piece.blocks, "chrome"),
        })
        .onConflictDoNothing({ target: [sections.key, sections.locale] })
        .returning({ key: sections.key });
      if (inserted.length > 0) created.push(`section:${piece.key}`);
    }

    const home = defaultHome({ name, tagline: business?.tagline ?? null });
    const insertedHome = await ctx.tx
      .insert(pages)
      .values({
        slug: "",
        locale: input.locale,
        title: home.title,
        blocks: parseBlockTree(home.blocks, "page"),
        status: "published",
        publishedAt: sql`now()`,
      })
      .onConflictDoNothing({ target: [pages.slug, pages.locale] })
      .returning({ id: pages.id });
    if (insertedHome.length > 0) created.push("page:home");

    ctx.setSubject("module", "cms");
    return { created };
  },
});

/**
 * Seed the site the moment setup finishes.
 *
 * The first module event listener in the codebase, and the reason the bus
 * exists: core's settings module announces that a business now exists, and cms
 * responds without either module importing the other (§11 — "modules
 * communicate only via the event bus and core services").
 */
export async function onSetupCompleted(): Promise<void> {
  await ensureDefaults.call({}, { kind: "system" });
}

export default [
  resolvePage,
  getPage,
  listPages,
  publishedPaths,
  createPage,
  updatePage,
  publishPage,
  getSection,
  listSections,
  updateSection,
  listRevisions,
  restoreRevision,
  ensureDefaults,
];
