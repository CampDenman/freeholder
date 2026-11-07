// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Blog structure services: categories, tags, authors and post metadata
// (C2.27, C2.28). UI, HTTP and MCP all reach the blog through these.
//
// Archive paths are addresses people and search engines keep. Changing a
// slug, a parent or deleting a term moves an archive, so the service that
// moves it records the redirect (MASTER.md §5: "slugs never silently break"),
// the same way `cms.updatePage` does for a renamed page.
import { and, asc, desc, eq, inArray, isNull, isNotNull, like, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { checkPlaygroundInsert } from "@/core/demo/playground-inserts";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, getService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { isUniqueViolation } from "@/core/db";
import { users } from "@/core/auth/schema";
import { businessProfile } from "@/core/settings/schema";
import { pages } from "./schema";
import {
  BLOG_TAXONOMIES,
  blogAuthors,
  blogPosts,
  blogPostTerms,
  blogSettings,
  blogTerms,
  type BlogTaxonomy,
} from "./blog-schema";

/* ---------------------------------------------------------------- shapes */

const slugPart = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use lowercase words separated by hyphens");

/** A site path, no leading or trailing slash: "category/glazes". */
const archivePath = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\/+|\/+$/g, "").toLowerCase())
  .refine((value) => /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(value) && !value.includes("//"), "use lowercase words separated by hyphens or slashes");

const archiveSeo = z
  .object({
    title: z.string().trim().max(200).optional(),
    description: z.string().trim().max(320).optional(),
    noindex: z.boolean().optional(),
  })
  .default({});
export type ArchiveSeo = z.infer<typeof archiveSeo>;

const termRow = row({
  id: uuid,
  taxonomy: z.enum(BLOG_TAXONOMIES),
  slug: z.string(),
  path: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  parentId: uuid.nullable(),
  position: z.number().int(),
  seo: z.unknown(),
  source: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const authorRow = row({
  id: uuid,
  slug: z.string(),
  path: z.string(),
  name: z.string(),
  bio: z.string().nullable(),
  email: z.string().nullable(),
  userId: uuid.nullable(),
  seo: z.unknown(),
  source: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const settingsRow = z.object({
  categoryBase: z.string(),
  tagBase: z.string(),
  authorBase: z.string(),
  postsPerPage: z.number().int(),
  commentsEnabled: z.boolean(),
});

export type BlogSettings = z.infer<typeof settingsRow>;

export const DEFAULT_BLOG_SETTINGS: BlogSettings = {
  categoryBase: "blog/category",
  tagBase: "blog/tag",
  authorBase: "blog/author",
  postsPerPage: 12,
  commentsEnabled: true,
};

/* --------------------------------------------------------------- helpers */

/** A slug lookup must authorize this exact row, including legacy locale duplicates. */
export async function isPublicPage(ctx: ServiceContext, page: { id: string; slug: string; locale?: string }): Promise<boolean> {
  const resolved = z.object({ id: uuid }).nullable().parse(await ctx.call(getService("cms.resolvePage"), { slug: page.slug, ...(page.locale ? { locale: page.locale } : {}) }));
  return resolved?.id === page.id;
}

export async function loadBlogSettings(tx: Tx): Promise<BlogSettings> {
  const [found] = await tx.select().from(blogSettings).where(eq(blogSettings.key, "site")).limit(1);
  return found
    ? {
        categoryBase: found.categoryBase,
        tagBase: found.tagBase,
        authorBase: found.authorBase,
        postsPerPage: found.postsPerPage,
        commentsEnabled: found.commentsEnabled,
      }
    : DEFAULT_BLOG_SETTINGS;
}

/** An archive path may not be a page's, or another archive's. */
async function assertPathFree(
  tx: Tx,
  path: string,
  own: { termId?: string; authorId?: string },
): Promise<void> {
  const [page] = await tx
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.slug, path), isNull(pages.trashedAt)))
    .limit(1);
  if (page) throw new ServiceError("conflict", `A page already lives at /${path}.`);
  const [term] = await tx.select({ id: blogTerms.id }).from(blogTerms).where(eq(blogTerms.path, path)).limit(1);
  if (term && term.id !== own.termId) throw new ServiceError("conflict", `Another archive already lives at /${path}.`);
  const [author] = await tx
    .select({ id: blogAuthors.id })
    .from(blogAuthors)
    .where(eq(blogAuthors.path, path))
    .limit(1);
  if (author && author.id !== own.authorId) throw new ServiceError("conflict", `Another archive already lives at /${path}.`);
}

async function moved(ctx: ServiceContext, fromPath: string, toPath: string): Promise<void> {
  if (fromPath === toPath) return;
  await ctx.callAsSystem(getService("seo.recordRedirect"), {
    fromPath,
    toPath,
    source: "slug-change",
  });
}

type TermRecord = typeof blogTerms.$inferSelect;

async function allTerms(tx: Tx, taxonomy?: BlogTaxonomy): Promise<TermRecord[]> {
  return tx
    .select()
    .from(blogTerms)
    .where(taxonomy ? eq(blogTerms.taxonomy, taxonomy) : undefined)
    .orderBy(asc(blogTerms.position), asc(blogTerms.name));
}

function categoryPath(base: string, chain: string[]): string {
  return [base, ...chain].filter(Boolean).join("/");
}

/** Slugs from the root down to `id`, inclusive. */
function chainOf(terms: Map<string, TermRecord>, id: string | null, own?: { id: string; slug: string; parentId: string | null }): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor) {
    if (seen.has(cursor)) throw new ServiceError("validation", "A category cannot be inside itself.");
    seen.add(cursor);
    const term = own && cursor === own.id ? { ...terms.get(cursor)!, ...own } : terms.get(cursor);
    if (!term) break;
    chain.unshift(term.slug);
    cursor = term.parentId;
  }
  return chain;
}

/** Every descendant of a category, for archives that include subcategories. */
export function descendantIds(terms: Array<{ id: string; parentId: string | null }>, rootId: string): string[] {
  const out = [rootId];
  for (let index = 0; index < out.length; index += 1) {
    for (const term of terms) if (term.parentId === out[index] && !out.includes(term.id)) out.push(term.id);
  }
  return out;
}

/**
 * Re-path a category and everything under it after its slug or parent
 * changed, recording a redirect for every archive that moved. A path set
 * explicitly (an imported WordPress archive) keeps its own base.
 */
async function repathCategorySubtree(ctx: ServiceContext, rootId: string): Promise<void> {
  const terms = await allTerms(ctx.tx, "category");
  const byId = new Map(terms.map((term) => [term.id, term]));
  for (const id of descendantIds(terms, rootId)) {
    const term = byId.get(id)!;
    const parent = term.parentId ? byId.get(term.parentId) : undefined;
    const next = parent ? `${parent.path}/${term.slug}` : term.path.replace(/[^/]+$/, term.slug);
    if (next === term.path) continue;
    await assertPathFree(ctx.tx, next, { termId: term.id });
    await ctx.tx.update(blogTerms).set({ path: next }).where(eq(blogTerms.id, term.id));
    await moved(ctx, term.path, next);
    byId.set(id, { ...term, path: next });
  }
}

/* -------------------------------------------------------------- settings */

export const getBlogSettings = defineService({
  name: "cms.blogSettings",
  summary: "Where new blog archives live and how many posts an archive page lists.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  output: settingsRow,
  handler: (_input, ctx) => loadBlogSettings(ctx.tx),
});

export const updateBlogSettings = defineService({
  name: "cms.updateBlogSettings",
  summary:
    "Change where new category, tag and author archives live and how many posts an archive page lists. Existing archives keep their addresses.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    categoryBase: archivePath.optional(),
    tagBase: archivePath.optional(),
    authorBase: archivePath.optional(),
    postsPerPage: z.number().int().min(1).max(50).optional(),
    commentsEnabled: z.boolean().optional(),
  }),
  output: settingsRow,
  handler: async (input, ctx) => {
    const current = await loadBlogSettings(ctx.tx);
    const next = { ...current, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) };
    await ctx.tx
      .insert(blogSettings)
      .values({ key: "site", ...next })
      .onConflictDoUpdate({ target: blogSettings.key, set: { ...next, updatedAt: new Date() } });
    ctx.setSubject("blog_settings", "site");
    return next;
  },
});

/* ----------------------------------------------------------------- terms */

export const listTerms = defineService({
  name: "cms.listTerms",
  summary: "Blog categories and tags, with how many published posts each has.",
  kind: "query",
  permission: "scoped",
  input: z.object({ taxonomy: z.enum(BLOG_TAXONOMIES).optional() }),
  output: listed(termRow.extend({ posts: z.number().int() })),
  handler: async (input, ctx) => {
    const terms = await allTerms(ctx.tx, input.taxonomy);
    const counts = await ctx.tx
      .select({ termId: blogPostTerms.termId, posts: sql<number>`count(*)::int` })
      .from(blogPostTerms)
      .innerJoin(pages, eq(pages.id, blogPostTerms.pageId))
      .where(and(eq(pages.status, "published"), isNull(pages.trashedAt)))
      .groupBy(blogPostTerms.termId);
    const byTerm = new Map(counts.map((count) => [count.termId, Number(count.posts)]));
    return terms.map((term) => ({ ...term, posts: byTerm.get(term.id) ?? 0 }));
  },
});

export const publicBlogCategories = defineService({
  name: "cms.publicBlogCategories", summary: "Public category links with published posts, without draft taxonomy or import metadata.",
  kind: "query", permission: "public", input: z.object({}),
  output: listed(z.object({ slug: z.string(), name: z.string(), path: z.string(), posts: z.number().int() })),
  handler: async (_input, ctx) => {
    const out = [];
    for (const category of await allTerms(ctx.tx, "category")) {
      if (category.parentId) continue;
      const dated = await publishedPostDates(ctx, await postIdsMatching(ctx.tx, { category: category.id }));
      if (dated.length) out.push({ slug: category.slug, name: category.name, path: category.path, posts: dated.length });
    }
    return out;
  },
});

export const saveTerm = defineService({
  name: "cms.saveTerm",
  summary:
    "Create or change a blog category or tag. Changing its slug or parent moves its archive and records a redirect from the old address.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid().optional(),
    taxonomy: z.enum(BLOG_TAXONOMIES),
    name: z.string().trim().min(1).max(200),
    slug: slugPart.optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    seo: archiveSeo.optional(),
    /** An explicit archive address (an imported site keeps its own). */
    path: archivePath.optional(),
    source: z.string().max(100).optional(),
  }),
  output: termRow,
  handler: async (input, ctx) => {
    const settings = await loadBlogSettings(ctx.tx);
    const slug = input.slug ?? slugFromName(input.name);
    if (input.taxonomy === "tag" && input.parentId) {
      throw new ServiceError("validation", "Tags are flat; only categories have parents.");
    }
    const terms = await allTerms(ctx.tx, input.taxonomy);
    const byId = new Map(terms.map((term) => [term.id, term]));
    const before = input.id ? byId.get(input.id) : undefined;
    if (input.id && !before) throw new ServiceError("not_found", "That category or tag is gone.");
    const parentId = input.parentId === undefined ? (before?.parentId ?? null) : input.parentId;
    if (parentId && !byId.has(parentId)) throw new ServiceError("validation", "That parent category does not exist.");

    let path: string;
    if (input.path) {
      path = input.path;
    } else if (input.taxonomy === "category") {
      const parent = parentId ? byId.get(parentId)! : undefined;
      if (parent && before) chainOf(byId, parentId, { id: before.id, slug, parentId });
      path = parent ? `${parent.path}/${slug}` : before ? before.path.replace(/[^/]+$/, slug) : categoryPath(settings.categoryBase, [slug]);
    } else {
      path = before ? before.path.replace(/[^/]+$/, slug) : `${settings.tagBase}/${slug}`;
    }
    if (before && parentId && descendantIds(terms, before.id).includes(parentId)) {
      throw new ServiceError("validation", "A category cannot be inside itself.");
    }
    await assertPathFree(ctx.tx, path, { termId: before?.id });

    const values = {
      taxonomy: input.taxonomy,
      name: input.name,
      slug,
      path,
      description: input.description === undefined ? (before?.description ?? null) : input.description,
      parentId,
      position: input.position ?? before?.position ?? 0,
      seo: input.seo ?? (before?.seo as ArchiveSeo | undefined) ?? {},
      source: before?.source ?? input.source ?? "admin",
    };
    let saved: TermRecord;
    if (!before) await checkPlaygroundInsert(ctx.tx, ctx.actor, "cms.saveTerm");
    try {
      if (before) {
        [saved] = (await ctx.tx.update(blogTerms).set(values).where(eq(blogTerms.id, before.id)).returning()) as [TermRecord];
      } else {
        [saved] = (await ctx.tx.insert(blogTerms).values(values).returning()) as [TermRecord];
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ServiceError("conflict", `Another ${input.taxonomy} already uses the slug "${slug}".`);
      }
      throw error;
    }
    if (before && before.path !== saved.path) {
      await moved(ctx, before.path, saved.path);
      if (saved.taxonomy === "category") await repathCategorySubtree(ctx, saved.id);
    }
    ctx.setSubject("blog_term", saved.id);
    ctx.queueEvent(before ? "cms.termUpdated" : "cms.termCreated", { id: saved.id, taxonomy: saved.taxonomy });
    return saved;
  },
});

export const deleteTerm = defineService({
  name: "cms.deleteTerm",
  writeClass: "destructive",
  summary:
    "Delete a blog category or tag. Its posts stay; subcategories move up a level; its archive redirects to its parent's archive or the blog.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: okResult,
  handler: async (input, ctx) => {
    const [term] = await ctx.tx.select().from(blogTerms).where(eq(blogTerms.id, input.id)).limit(1);
    if (!term) throw new ServiceError("not_found", "That category or tag is gone.");
    const parent = term.parentId
      ? (await ctx.tx.select().from(blogTerms).where(eq(blogTerms.id, term.parentId)).limit(1))[0]
      : undefined;
    const children = await ctx.tx.select().from(blogTerms).where(eq(blogTerms.parentId, term.id));
    await ctx.tx.delete(blogTerms).where(eq(blogTerms.id, term.id));
    for (const childTerm of children) {
      await ctx.tx.update(blogTerms).set({ parentId: parent?.id ?? null }).where(eq(blogTerms.id, childTerm.id));
    }
    for (const childTerm of children) {
      const next = parent ? `${parent.path}/${childTerm.slug}` : term.path.replace(/[^/]+$/, childTerm.slug);
      if (next !== childTerm.path) {
        await assertPathFree(ctx.tx, next, { termId: childTerm.id });
        await ctx.tx.update(blogTerms).set({ path: next }).where(eq(blogTerms.id, childTerm.id));
        await moved(ctx, childTerm.path, next);
        await repathCategorySubtree(ctx, childTerm.id);
      }
    }
    await moved(ctx, term.path, parent?.path ?? "blog");
    ctx.setSubject("blog_term", term.id);
    ctx.queueEvent("cms.termDeleted", { id: term.id, taxonomy: term.taxonomy });
    return { ok: true as const };
  },
});

/* --------------------------------------------------------------- authors */

export function slugFromName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}

export const listAuthors = defineService({
  name: "cms.listAuthors",
  summary: "Blog authors, including private matching email and linked account.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(authorRow.extend({ posts: z.number().int() })),
  handler: async (_input, ctx) => {
    const authors = await ctx.tx.select().from(blogAuthors).orderBy(asc(blogAuthors.name));
    const counts = await ctx.tx
      .select({ authorId: blogPosts.authorId, posts: sql<number>`count(*)::int` })
      .from(blogPosts)
      .groupBy(blogPosts.authorId);
    const byAuthor = new Map(counts.map((count) => [count.authorId, Number(count.posts)]));
    return authors.map((author) => ({ ...author, posts: byAuthor.get(author.id) ?? 0 }));
  },
});

export const saveAuthor = defineService({
  name: "cms.saveAuthor",
  summary:
    "Create or change a blog author: a site account, or a profile that cannot sign in. Changing the slug moves the archive and records a redirect.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200),
    slug: slugPart.optional(),
    bio: z.string().trim().max(4_000).nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
    userId: z.string().uuid().nullable().optional(),
    seo: archiveSeo.optional(),
    path: archivePath.optional(),
    source: z.string().max(100).optional(),
  }),
  output: authorRow,
  handler: async (input, ctx) => {
    const settings = await loadBlogSettings(ctx.tx);
    const [before] = input.id
      ? await ctx.tx.select().from(blogAuthors).where(eq(blogAuthors.id, input.id)).limit(1)
      : [];
    if (input.id && !before) throw new ServiceError("not_found", "That author is gone.");
    if (input.userId) {
      const [account] = await ctx.tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!account) throw new ServiceError("validation", "That account does not exist.");
    }
    const slug = input.slug ?? before?.slug ?? slugFromName(input.name);
    const path = input.path ?? (before ? before.path.replace(/[^/]+$/, slug) : `${settings.authorBase}/${slug}`);
    await assertPathFree(ctx.tx, path, { authorId: before?.id });
    const values = {
      name: input.name,
      slug,
      path,
      bio: input.bio === undefined ? (before?.bio ?? null) : input.bio,
      email: input.email === undefined ? (before?.email ?? null) : input.email,
      userId: input.userId === undefined ? (before?.userId ?? null) : input.userId,
      seo: input.seo ?? (before?.seo as ArchiveSeo | undefined) ?? {},
      source: before?.source ?? input.source ?? "admin",
    };
    let saved: typeof blogAuthors.$inferSelect;
    if (!before) await checkPlaygroundInsert(ctx.tx, ctx.actor, "cms.saveAuthor");
    try {
      [saved] = before
        ? ((await ctx.tx.update(blogAuthors).set(values).where(eq(blogAuthors.id, before.id)).returning()) as [typeof saved])
        : ((await ctx.tx.insert(blogAuthors).values(values).returning()) as [typeof saved]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ServiceError("conflict", "Another author already uses that slug or account.");
      }
      throw error;
    }
    if (before && before.path !== saved.path) await moved(ctx, before.path, saved.path);
    ctx.setSubject("blog_author", saved.id);
    return saved;
  },
});

export const deleteAuthor = defineService({
  name: "cms.deleteAuthor",
  writeClass: "destructive",
  summary: "Delete a blog author profile. Their posts stay, without a byline; the archive redirects to the blog.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: okResult,
  handler: async (input, ctx) => {
    const [author] = await ctx.tx.delete(blogAuthors).where(eq(blogAuthors.id, input.id)).returning();
    if (!author) throw new ServiceError("not_found", "That author is gone.");
    await moved(ctx, author.path, "blog");
    ctx.setSubject("blog_author", author.id);
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------ post meta */

const postMetaRow = z.object({
  pageId: uuid,
  isPost: z.boolean(),
  authorId: uuid.nullable(),
  categoryIds: z.array(uuid),
  tagIds: z.array(uuid),
  commentsEnabled: z.boolean(),
  sourceModifiedAt: timestamp.nullable(),
});

async function readPostMeta(tx: Tx, pageId: string): Promise<z.infer<typeof postMetaRow>> {
  const [post] = await tx.select().from(blogPosts).where(eq(blogPosts.pageId, pageId)).limit(1);
  if (!post) {
    return { pageId, isPost: false, authorId: null, categoryIds: [], tagIds: [], commentsEnabled: true, sourceModifiedAt: null };
  }
  const terms = await tx
    .select({ id: blogTerms.id, taxonomy: blogTerms.taxonomy })
    .from(blogPostTerms)
    .innerJoin(blogTerms, eq(blogTerms.id, blogPostTerms.termId))
    .where(eq(blogPostTerms.pageId, pageId))
    .orderBy(asc(blogPostTerms.position));
  return {
    pageId,
    isPost: true,
    authorId: post.authorId,
    categoryIds: terms.filter((term) => term.taxonomy === "category").map((term) => term.id),
    tagIds: terms.filter((term) => term.taxonomy === "tag").map((term) => term.id),
    commentsEnabled: post.commentsEnabled,
    sourceModifiedAt: post.sourceModifiedAt,
  };
}

export const getPostMeta = defineService({
  name: "cms.getPostMeta",
  summary: "Whether a page is a blog post, and its author, categories, tags and comment switch.",
  kind: "query",
  permission: "scoped",
  input: z.object({ pageId: z.string().uuid() }),
  output: postMetaRow,
  handler: (input, ctx) => readPostMeta(ctx.tx, input.pageId),
});

export const setPostMeta = defineService({
  name: "cms.setPostMeta",
  summary:
    "Make a page a blog post (or not), and set its author, categories, tags and whether it takes comments. Tags named but not yet created are created.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "blocks",
  input: z.object({
    pageId: z.string().uuid(),
    isPost: z.boolean().default(true),
    authorId: z.string().uuid().nullable().optional(),
    categoryIds: z.array(z.string().uuid()).max(50).optional(),
    tagIds: z.array(z.string().uuid()).max(200).optional(),
    tagNames: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
    commentsEnabled: z.boolean().optional(),
    sourceModifiedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    source: z.string().max(100).optional(),
  }),
  output: postMetaRow,
  handler: async (input, ctx) => {
    const [page] = await ctx.tx.select({ id: pages.id }).from(pages).where(eq(pages.id, input.pageId)).limit(1);
    if (!page) throw new ServiceError("not_found", "That page is gone.");
    if (!input.isPost) {
      await ctx.tx.delete(blogPosts).where(eq(blogPosts.pageId, input.pageId));
      ctx.setSubject("page", input.pageId);
      return readPostMeta(ctx.tx, input.pageId);
    }
    if (input.authorId) {
      const [author] = await ctx.tx.select({ id: blogAuthors.id }).from(blogAuthors).where(eq(blogAuthors.id, input.authorId)).limit(1);
      if (!author) throw new ServiceError("validation", "That author does not exist.");
    }
    const before = await readPostMeta(ctx.tx, input.pageId);
    const values = {
      authorId: input.authorId === undefined ? before.authorId : input.authorId,
      commentsEnabled: input.commentsEnabled ?? before.commentsEnabled,
      sourceModifiedAt:
        input.sourceModifiedAt === undefined
          ? before.sourceModifiedAt
          : input.sourceModifiedAt
            ? new Date(input.sourceModifiedAt)
            : null,
    };
    await ctx.tx
      .insert(blogPosts)
      .values({ pageId: input.pageId, ...values, source: input.source ?? "admin" })
      .onConflictDoUpdate({ target: blogPosts.pageId, set: { ...values, updatedAt: new Date() } });

    if (input.categoryIds || input.tagIds || input.tagNames) {
      let tagIds = input.tagIds ?? (input.tagNames ? [] : before.tagIds);
      if (input.tagNames?.length) {
        const settings = await loadBlogSettings(ctx.tx);
        for (const name of input.tagNames) {
          const slug = slugFromName(name);
          const [existing] = await ctx.tx
            .select({ id: blogTerms.id })
            .from(blogTerms)
            .where(and(eq(blogTerms.taxonomy, "tag"), eq(blogTerms.slug, slug)))
            .limit(1);
          if (existing) {
            tagIds = [...tagIds, existing.id];
            continue;
          }
          const path = `${settings.tagBase}/${slug}`;
          await assertPathFree(ctx.tx, path, {});
          await checkPlaygroundInsert(ctx.tx, ctx.actor, "cms.saveTerm");
          const [created] = await ctx.tx
            .insert(blogTerms)
            .values({ taxonomy: "tag", name, slug, path, source: input.source ?? "admin" })
            .returning({ id: blogTerms.id });
          tagIds = [...tagIds, created!.id];
        }
      }
      const categoryIds = input.categoryIds ?? before.categoryIds;
      const wanted = [...new Set([...categoryIds, ...tagIds])];
      if (wanted.length) {
        const found = await ctx.tx
          .select({ id: blogTerms.id, taxonomy: blogTerms.taxonomy })
          .from(blogTerms)
          .where(inArray(blogTerms.id, wanted));
        const kinds = new Map(found.map((term) => [term.id, term.taxonomy]));
        if (categoryIds.some((id) => kinds.get(id) !== "category") || tagIds.some((id) => kinds.get(id) !== "tag")) {
          throw new ServiceError("validation", "One of those categories or tags does not exist.");
        }
      }
      await ctx.tx.delete(blogPostTerms).where(eq(blogPostTerms.pageId, input.pageId));
      const ordered = [...new Set([...categoryIds, ...tagIds])];
      if (ordered.length) {
        await ctx.tx
          .insert(blogPostTerms)
          .values(ordered.map((termId, position) => ({ pageId: input.pageId, termId, position })));
      }
    }
    ctx.setSubject("page", input.pageId);
    ctx.queueEvent("cms.postMetaChanged", { pageId: input.pageId });
    return readPostMeta(ctx.tx, input.pageId);
  },
});

/* ------------------------------------------------------------ public reads */

const publicLink = z.object({ name: z.string(), path: z.string() });

const publicPostMeta = z
  .object({
    pageId: uuid,
    author: publicLink.extend({ bio: z.string().nullable() }).nullable(),
    categories: z.array(publicLink),
    tags: z.array(publicLink),
    commentsEnabled: z.boolean(),
    publishedAt: timestamp.nullable(),
    modifiedAt: timestamp.nullable(),
  })
  .nullable();

/** What a published post shows around its body. Null for anything else. */
export const postMetaAt = defineService({
  name: "cms.postMetaAt",
  summary: "The byline, categories, tags and dates of a published blog post.",
  kind: "query",
  permission: "public",
  input: z.object({ slug: z.string() }),
  output: publicPostMeta,
  handler: async (input, ctx) => {
    const slug = input.slug.replace(/^\/+|\/+$/g, "");
    const resolved = z.object({ id: uuid }).nullable().parse(await ctx.call(getService("cms.resolvePage"), { slug }));
    if (!resolved) return null;
    const [found] = await ctx.tx
      .select({ page: pages, post: blogPosts })
      .from(pages)
      .innerJoin(blogPosts, eq(blogPosts.pageId, pages.id))
      .where(and(eq(pages.id, resolved.id), eq(pages.slug, slug), eq(pages.status, "published"), isNull(pages.trashedAt)))
      .limit(1);
    if (!found) return null;
    const [author] = found.post.authorId
      ? await ctx.tx
          .select({ name: blogAuthors.name, path: blogAuthors.path, bio: blogAuthors.bio })
          .from(blogAuthors)
          .where(eq(blogAuthors.id, found.post.authorId))
          .limit(1)
      : [];
    const terms = await ctx.tx
      .select({ name: blogTerms.name, path: blogTerms.path, taxonomy: blogTerms.taxonomy })
      .from(blogPostTerms)
      .innerJoin(blogTerms, eq(blogTerms.id, blogPostTerms.termId))
      .where(eq(blogPostTerms.pageId, found.page.id))
      .orderBy(asc(blogPostTerms.position));
    return {
      pageId: found.page.id,
      author: author ?? null,
      categories: terms.filter((term) => term.taxonomy === "category").map(({ name, path }) => ({ name, path })),
      tags: terms.filter((term) => term.taxonomy === "tag").map(({ name, path }) => ({ name, path })),
      commentsEnabled: found.post.commentsEnabled,
      publishedAt: found.page.publishedAt,
      modifiedAt: found.post.sourceModifiedAt && found.page.publishedAt && found.post.sourceModifiedAt > found.page.publishedAt
        ? found.post.sourceModifiedAt
        : found.page.publishedAt,
    };
  },
});

/** Published post ids under a category (and its subcategories), tag or author. */
export async function postIdsMatching(
  tx: Tx,
  filter: { category?: string; tag?: string; author?: string },
): Promise<Set<string> | null> {
  let ids: Set<string> | null = null;
  const intersect = (next: string[]) => {
    ids = ids === null ? new Set(next) : new Set(next.filter((id) => ids!.has(id)));
  };
  if (filter.category) {
    const categories = await allTerms(tx, "category");
    const root = categories.find((term) => term.id === filter.category || term.slug === filter.category);
    if (!root) return new Set();
    const rows = await tx
      .select({ pageId: blogPostTerms.pageId })
      .from(blogPostTerms)
      .where(inArray(blogPostTerms.termId, descendantIds(categories, root.id)));
    intersect(rows.map((one) => one.pageId));
  }
  if (filter.tag) {
    const [tag] = await tx
      .select({ id: blogTerms.id })
      .from(blogTerms)
      .where(and(eq(blogTerms.taxonomy, "tag"), sql`(${blogTerms.slug} = ${filter.tag} or ${blogTerms.id}::text = ${filter.tag})`))
      .limit(1);
    if (!tag) return new Set();
    const rows = await tx.select({ pageId: blogPostTerms.pageId }).from(blogPostTerms).where(eq(blogPostTerms.termId, tag.id));
    intersect(rows.map((one) => one.pageId));
  }
  if (filter.author) {
    const [author] = await tx
      .select({ id: blogAuthors.id })
      .from(blogAuthors)
      .where(sql`(${blogAuthors.slug} = ${filter.author} or ${blogAuthors.id}::text = ${filter.author})`)
      .limit(1);
    if (!author) return new Set();
    const rows = await tx.select({ pageId: blogPosts.pageId }).from(blogPosts).where(eq(blogPosts.authorId, author.id));
    intersect(rows.map((one) => one.pageId));
  }
  return ids;
}

const archiveShape = z
  .object({
    kind: z.enum(["category", "tag", "author", "date"]),
    id: z.string(),
    slug: z.string(),
    path: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    seo: z.object({ title: z.string().optional(), description: z.string().optional(), noindex: z.boolean().optional() }),
    /** Ancestors, root first, for a category's breadcrumb. */
    trail: z.array(publicLink),
    posts: z.number().int(),
    updatedAt: timestamp.nullable(),
  })
  .nullable();

async function publishedPostDates(ctx: ServiceContext, ids: Set<string> | null): Promise<Array<{ id: string; publishedAt: Date | null }>> {
  if (ids !== null && ids.size === 0) return [];
  const found = await ctx.tx
    .select({ id: pages.id, slug: pages.slug, locale: pages.locale, publishedAt: pages.publishedAt })
    .from(pages)
    .innerJoin(blogPosts, eq(blogPosts.pageId, pages.id))
    .where(
      and(
        eq(pages.status, "published"),
        isNull(pages.trashedAt),
        ids === null ? undefined : inArray(pages.id, [...ids]),
      ),
    );
  const visible = [];
  for (const post of found) if (await isPublicPage(ctx, post)) visible.push(post);
  return visible;
}

/** A category, tag or author archive at a path, while it has a published post. */
export const resolveBlogArchive = defineService({
  name: "cms.resolveBlogArchive",
  summary: "The blog category, tag or author archive at a path, if it has published posts.",
  kind: "query",
  permission: "public",
  input: z.object({ path: z.string() }),
  output: archiveShape,
  handler: async (input, ctx) => {
    const path = input.path.replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!path) return null;
    const date = /^(\d{4})(?:\/(0[1-9]|1[0-2]))?(?:\/(0[1-9]|[12]\d|3[01]))?$/.exec(path);
    if (date) {
      const dated = (await publishedPostDates(ctx, null)).filter(post => post.publishedAt?.toISOString().startsWith(path.replaceAll("/", "-")));
      if (!dated.length) return null;
      return { kind: "date" as const, id: `date:${path}`, slug: path, path, name: path.replaceAll("/", "-"), description: null, seo: {}, trail: [], posts: dated.length, updatedAt: latest(dated) };
    }
    const [term] = await ctx.tx.select().from(blogTerms).where(eq(blogTerms.path, path)).limit(1);
    if (term) {
      const ids = await postIdsMatching(ctx.tx, term.taxonomy === "category" ? { category: term.id } : { tag: term.id });
      const dated = await publishedPostDates(ctx, ids);
      if (dated.length === 0) return null;
      const trail: Array<{ name: string; path: string }> = [];
      if (term.taxonomy === "category") {
        const categories = new Map((await allTerms(ctx.tx, "category")).map((one) => [one.id, one]));
        let cursor = term.parentId ? categories.get(term.parentId) : undefined;
        while (cursor && trail.length < 20) {
          trail.unshift({ name: cursor.name, path: cursor.path });
          cursor = cursor.parentId ? categories.get(cursor.parentId) : undefined;
        }
      }
      return {
        kind: term.taxonomy,
        id: term.id,
        slug: term.slug,
        path: term.path,
        name: term.name,
        description: term.description,
        seo: archiveSeo.parse(term.seo ?? {}),
        trail,
        posts: dated.length,
        updatedAt: latest(dated),
      };
    }
    const [author] = await ctx.tx.select().from(blogAuthors).where(eq(blogAuthors.path, path)).limit(1);
    if (!author) return null;
    const dated = await publishedPostDates(ctx, await postIdsMatching(ctx.tx, { author: author.id }));
    if (dated.length === 0) return null;
    return {
      kind: "author" as const,
      id: author.id,
      slug: author.slug,
      path: author.path,
      name: author.name,
      description: author.bio,
      seo: archiveSeo.parse(author.seo ?? {}),
      trail: [],
      posts: dated.length,
      updatedAt: latest(dated),
    };
  },
});

function latest(rows: Array<{ publishedAt: Date | null }>): Date | null {
  return rows.reduce<Date | null>((best, one) => (one.publishedAt && (!best || one.publishedAt > best) ? one.publishedAt : best), null);
}

/**
 * Archives for the sitemap (§5): only the ones with a published post, and not
 * the ones an owner (or the imported site) marked noindex.
 */
export const blogArchivePaths = defineService({
  name: "cms.blogArchivePaths",
  summary: "Every blog category, tag and author archive that has a published post, for the sitemap.",
  kind: "query",
  permission: "public",
  input: z.object({ locale: z.string().default("en") }),
  output: listed(
    z.object({
      slug: z.string(),
      title: z.string(),
      description: z.string().optional(),
      kind: z.string(),
      priority: z.number(),
      updatedAt: timestamp.optional(),
    }),
  ),
  handler: async (input, ctx) => {
    // Archives are listed once, in the site's own language: their names and
    // descriptions are not translated, so a /fr/ copy would be a duplicate.
    const [business] = await ctx.tx.select({ defaultLocale: businessProfile.defaultLocale }).from(businessProfile).limit(1);
    if (business && input.locale !== business.defaultLocale) return [];
    const out: Array<{ slug: string; title: string; description?: string; kind: string; priority: number; updatedAt?: Date }> = [];
    for (const term of await allTerms(ctx.tx)) {
      if (archiveSeo.parse(term.seo ?? {}).noindex) continue;
      const ids = await postIdsMatching(ctx.tx, term.taxonomy === "category" ? { category: term.id } : { tag: term.id });
      const dated = await publishedPostDates(ctx, ids);
      if (dated.length === 0) continue;
      out.push({
        slug: term.path,
        title: term.name,
        description: term.description ?? undefined,
        kind: "collection",
        priority: term.taxonomy === "category" ? 0.5 : 0.3,
        updatedAt: latest(dated) ?? undefined,
      });
    }
    for (const author of await ctx.tx.select().from(blogAuthors)) {
      if (archiveSeo.parse(author.seo ?? {}).noindex) continue;
      const dated = await publishedPostDates(ctx, await postIdsMatching(ctx.tx, { author: author.id }));
      if (dated.length === 0) continue;
      out.push({
        slug: author.path,
        title: author.name,
        description: author.bio ?? undefined,
        kind: "collection",
        priority: 0.3,
        updatedAt: latest(dated) ?? undefined,
      });
    }
    return out;
  },
});

export const listPostPages = defineService({
  name: "cms.listPostPages",
  summary: "Blog posts for the owner, including drafts and imported posts at their original addresses.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(z.object({ id: uuid, title: z.string(), slug: z.string(), status: z.string() })),
  handler: (_input, ctx) => ctx.tx.select({ id: pages.id, title: pages.title, slug: pages.slug, status: pages.status })
    .from(pages).leftJoin(blogPosts, eq(blogPosts.pageId, pages.id))
    .where(and(isNull(pages.trashedAt), or(isNotNull(blogPosts.pageId), like(pages.slug, "blog/%"))))
    .orderBy(desc(pages.createdAt)),
});

export const createPost = defineService({
  name: "cms.createPost",
  summary: "Create a draft blog post and its post metadata atomically.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "blocks",
  input: z.object({ title: z.string().trim().min(1).max(200), slug: slugPart, locale: z.string().default("en") }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const page = z.object({ id: uuid }).parse(await ctx.call(getService("cms.createPage"), {
      title: input.title, slug: `blog/${input.slug}`, locale: input.locale,
      blocks: [{ id: "post-title", type: "heading", props: { text: input.title, level: 1 } }, { id: "post-body", type: "text", props: { body: "" } }],
    }));
    const [author] = ctx.actor.kind === "user"
      ? await ctx.tx.select({ id: blogAuthors.id }).from(blogAuthors).where(eq(blogAuthors.userId, ctx.actor.userId)).limit(1)
      : [];
    await ctx.call(setPostMeta, { pageId: page.id, isPost: true, authorId: author?.id ?? null });
    ctx.setSubject("page", page.id);
    return { id: page.id };
  },
});

export const authorAccounts = defineService({
  name: "cms.authorAccounts", summary: "Owner and staff accounts available to link to a blog author; this is a private administration directory.",
  kind: "query", permission: "scoped", input: z.object({}), output: listed(z.object({ id: uuid, email: z.string() })),
  handler: (_input, ctx) => ctx.tx.select({ id: users.id, email: users.email }).from(users).where(inArray(users.role, ["owner", "staff"])).orderBy(asc(users.email)),
});

export const rollbackImportedBlogProfiles = defineService({
  name: "cms.rollbackImportedBlogProfiles",
  summary: "Remove unused blog profiles created by one rolled-back import; profiles used by other posts are retained.",
  kind: "mutation", permission: "scoped", writeClass: "destructive",
  input: z.object({ runId: uuid }), output: okResult,
  handler: async (input, ctx) => {
    const source = `import:${input.runId}`;
    const terms = await allTerms(ctx.tx);
    const referenced = new Set((await ctx.tx.select({ id: blogPostTerms.termId }).from(blogPostTerms)).map(row => row.id));
    const retained = new Set(terms.filter(term => term.source !== source || referenced.has(term.id)).map(term => term.id));
    const byId = new Map(terms.map(term => [term.id, term]));
    for (const id of [...retained]) {
      let parent = byId.get(id)?.parentId;
      while (parent && !retained.has(parent)) { retained.add(parent); parent = byId.get(parent)?.parentId; }
    }
    await ctx.tx.delete(blogTerms).where(and(eq(blogTerms.source, source), retained.size ? notInArray(blogTerms.id, [...retained]) : undefined));
    await ctx.tx.delete(blogAuthors).where(and(eq(blogAuthors.source, source), sql`not exists (select 1 from ${blogPosts} where ${blogPosts.authorId} = ${blogAuthors.id})`));
    ctx.setSubject("import_run", input.runId);
    return { ok: true as const };
  },
});

export default [
  authorAccounts,
  publicBlogCategories,
  listPostPages,
  createPost,
  rollbackImportedBlogProfiles,
  getBlogSettings,
  updateBlogSettings,
  listTerms,
  saveTerm,
  deleteTerm,
  listAuthors,
  saveAuthor,
  deleteAuthor,
  getPostMeta,
  setPostMeta,
  postMetaAt,
  resolveBlogArchive,
  blogArchivePaths,
];
