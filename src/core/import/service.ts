// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner import studio ledger (C3.22, C3.23).
//
// A run moves discover → preview → (conflict review) → commit → reconcile →
// publish, and can be rolled back from any step after preview. Commit writes
// drafts only; nothing is public until publish.
//
// A WordPress commit also fetches media. Provider I/O never happens inside a
// service transaction (CLAUDE.md), so `imports.commit` is an orchestrator:
// a short read (`imports.commitSource`), one pinned download and media upload
// per file, each recorded in its own short write (`imports.recordMedia`), and
// then one transaction that writes the pages, redirects and report
// (`imports.commitApply`). A commit interrupted halfway resumes from the
// files already recorded.
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  actorString,
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";
import { importRuns } from "@/core/plugins/schema";
import { getPinnedBytes, PinnedDownloadError } from "@/core/http/pinned-download";
import { uploadAsset } from "@/core/media/service";
import { mergeNavMenu, NAV_SECTION_KEYS } from "@/modules/cms/chrome-nav";
import { navigationLinkSchema } from "@/modules/cms/navigation-schema";
import { removeNavigation, type NavigationLink } from "@/modules/cms/navigation-tree";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { assertPublicHttpUrl, DEFAULT_IMPORTER_LIMITS } from "./contract";
import { crawlPublicSource, type CrawlKind } from "./crawl";
import { assertSourceStageable, assertNoPendingSourceUpload } from "./source-lifecycle";
import {
  discoverFromPublicOrigin,
  parseRssOrAtom,
  parseSemanticHtml,
  parseSitemap,
  type ParsedPage,
} from "./parsers";
import {
  parseWordpressExport,
  planWordpressImport,
  toCmsSlug,
  WORDPRESS_MEDIA_LIMITS,
  wordpressBodyToBlocks,
  wordpressExportFromRest,
  wordpressPath,
  type ImageMatch,
  type WordpressExport,
  type WordpressComment,
  type WordpressSeo,
} from "./wordpress";

const HTML_MARKUP_MAX = 20_000;
const REPORT_LIST_MAX = 100;


type PreviewPage = {
  url: string;
  slug: string;
  title: string;
  body: string;
  kind: "page" | "post";
  /** WordPress only: a draft, private or scheduled item stays a draft at publish. */
  status?: "publish" | "draft";
  publishedAt?: string;
  modifiedAt?: string;
  redirectFrom?: string;
  seo?: WordpressSeo;
  author?: string;
  categories?: string[];
  tags?: string[];
  categorySlugs?: string[];
  tagSlugs?: string[];
  featuredMedia?: string;
  wpId?: string;
  comments?: number;
  readerComments?: WordpressComment[];
};

type ConflictDecision = {
  slug: string;
  resolution: "keep-existing" | "replace" | "rename";
  renamedSlug?: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;
}

function previewPages(preview: unknown): PreviewPage[] {
  if (!preview || typeof preview !== "object") return [];
  const pages = (preview as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  const out: PreviewPage[] = [];
  for (const page of pages) {
    if (!page || typeof page !== "object") continue;
    const row = page as Record<string, unknown>;
    if (typeof row.slug !== "string" || typeof row.title !== "string") continue;
    const seo = row.seo && typeof row.seo === "object" ? (row.seo as Record<string, unknown>) : undefined;
    out.push({
      url: typeof row.url === "string" ? row.url : "",
      slug: row.slug,
      title: row.title,
      body: typeof row.body === "string" ? row.body : "",
      kind: row.kind === "post" ? "post" : "page",
      status: row.status === "draft" ? "draft" : row.status === "publish" ? "publish" : undefined,
      publishedAt: optionalString(row.publishedAt),
      modifiedAt: optionalString(row.modifiedAt),
      redirectFrom: optionalString(row.redirectFrom),
      seo: seo ? { title: optionalString(seo.title), description: optionalString(seo.description), preserveTitle: seo.preserveTitle === true, preserveDescription: seo.preserveDescription === true, noindex: seo.noindex === true, nofollow: seo.nofollow === true, canonical: optionalString(seo.canonical), ogTitle: optionalString(seo.ogTitle), ogDescription: optionalString(seo.ogDescription), ogImage: optionalString(seo.ogImage) } : undefined,
      author: optionalString(row.author),
      categories: stringList(row.categories),
      tags: stringList(row.tags),
      categorySlugs: stringList(row.categorySlugs),
      tagSlugs: stringList(row.tagSlugs),
      featuredMedia: optionalString(row.featuredMedia),
      wpId: optionalString(row.wpId),
      comments: typeof row.comments === "number" ? row.comments : undefined,
      readerComments: Array.isArray(row.readerComments) ? row.readerComments as WordpressComment[] : undefined,
    });
  }
  return out;
}

const plannedMediaSchema = z.object({
  key: z.string(),
  sourceUrl: z.string(),
  filename: z.string(),
  altText: z.string().optional(),
  caption: z.string().optional(),
  wpId: z.string().optional(),
  aliases: z.array(z.string()),
  referenced: z.boolean(),
});

const wordpressPreviewSchema = z.object({
  site: z.object({
    title: z.string(),
    url: z.string(),
    hosts: z.array(z.string()),
    basePath: z.string(),
  }),
  media: z.array(plannedMediaSchema),
  menus: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      items: z.array(
        z.object({
          label: z.string(),
          depth: z.number(),
          targetWpId: z.string().optional(),
          href: z.string().optional(),
          note: z.string().optional(),
          fragment: z.string().optional(),
        }),
      ),
    }),
  ),
  authors: z.array(
    z.object({
      login: z.string(),
      displayName: z.string().optional(),
      email: z.string().optional(),
      posts: z.number(),
    }),
  ),
  taxonomy: z.object({
    categories: z.array(z.object({ slug: z.string(), name: z.string(), posts: z.number(), parentSlug: z.string().optional(), description: z.string().optional() })),
    tags: z.array(z.object({ slug: z.string(), name: z.string(), posts: z.number(), description: z.string().optional() })),
  }),
  attachments: z.array(z.object({ wpId: z.string().optional(), parentWpId: z.string().optional(), path: z.string().optional() })).default([]),
  report: z.record(z.string(), z.unknown()),
});
type WordpressPreview = z.infer<typeof wordpressPreviewSchema>;

function wordpressPreview(preview: unknown): WordpressPreview | null {
  if (!preview || typeof preview !== "object") return null;
  const parsed = wordpressPreviewSchema.safeParse((preview as { wordpress?: unknown }).wordpress);
  return parsed.success ? parsed.data : null;
}

const cmsPageRef = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  blocks: z.unknown(),
  seo: z.unknown(),
  status: z.enum(["draft", "published"]),
  publishedAt: z.coerce.date().nullable().optional(),
  workingTitle: z.string().nullable().optional(),
  workingBlocks: z.unknown().optional(),
  workingSeo: z.unknown().optional(),
});
type CmsPageRef = z.infer<typeof cmsPageRef>;

function listedCmsPages(value: unknown): CmsPageRef[] {
  const parsed = z.array(cmsPageRef).safeParse(value);
  if (!parsed.success) {
    throw new ServiceError("internal", "cms.listPages returned an unexpected shape.");
  }
  return parsed.data;
}

function createdCmsPage(value: unknown): { id: string; slug: string } {
  const parsed = cmsPageRef.pick({ id: true, slug: true }).safeParse(value);
  if (!parsed.success) {
    throw new ServiceError("internal", "cms.createPage returned an unexpected shape.");
  }
  return parsed.data;
}

function conflictDecisions(value: unknown): Map<string, ConflictDecision> {
  const map = new Map<string, ConflictDecision>();
  if (!Array.isArray(value)) return map;
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.slug !== "string") continue;
    if (item.resolution !== "keep-existing" && item.resolution !== "replace" && item.resolution !== "rename") {
      continue;
    }
    const decision: ConflictDecision = {
      slug: item.slug,
      resolution: item.resolution,
      renamedSlug: typeof item.renamedSlug === "string" ? item.renamedSlug : undefined,
    };
    map.set(item.slug, decision);
    map.set(cmsSlug(item.slug), decision);
  }
  return map;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function checkpointOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function pageIdsFrom(checkpoint: unknown): string[] {
  return stringIds(checkpointOf(checkpoint).pageIds);
}

function createdPageIdsFrom(checkpoint: unknown): string[] {
  const created = stringIds(checkpointOf(checkpoint).createdPageIds);
  if (created.length > 0) return created;
  const replaced = new Set(replacedPagesFrom(checkpoint).map((page) => page.id));
  return pageIdsFrom(checkpoint).filter((id) => !replaced.has(id));
}

function replacedPagesFrom(checkpoint: unknown): CmsPageRef[] {
  const parsed = z.array(cmsPageRef).safeParse(checkpointOf(checkpoint).replacedPages);
  return parsed.success ? parsed.data : [];
}

const mediaRecordSchema = z.object({
  key: z.string(),
  sourceUrl: z.string(),
  assetId: z.string().uuid().optional(),
  error: z.string().optional(),
});
type MediaRecord = z.infer<typeof mediaRecordSchema>;

function mediaRecordsFrom(checkpoint: unknown): MediaRecord[] {
  const parsed = z.array(mediaRecordSchema).safeParse(checkpointOf(checkpoint).media);
  return parsed.success ? parsed.data : [];
}

const redirectSnapshot = z.object({
  fromPath: z.string(),
  toPath: z.string(),
  status: z.enum(["301", "302"]),
  locale: z.string(),
  source: z.string(),
});

const navAppliedSchema = z.object({
  key: z.string(),
  locale: z.string(),
  menu: z.string(),
  blockId: z.string().optional(),
  links: z.array(navigationLinkSchema),
});

const resolvedMenusSchema = z.array(
  z.object({
    slug: z.string(),
    name: z.string(),
    links: z.array(navigationLinkSchema),
    nested: z.number(),
    unresolved: z.number(),
  }),
);
type ResolvedMenu = z.infer<typeof resolvedMenusSchema>[number];

function withImportPages(
  checkpoint: unknown,
  createdPageIds: string[],
  replacedPages: CmsPageRef[],
): Record<string, unknown> {
  const previous = checkpointOf(checkpoint);
  previous.createdPageIds = createdPageIds;
  previous.replacedPages = replacedPages;
  previous.pageIds = [...createdPageIds, ...replacedPages.map((page) => page.id)];
  return previous;
}

/** Empty stays empty: that is the CMS home page, not `/page`. */
function cmsSlug(value: string): string {
  return toCmsSlug(value);
}

async function restoreReplacedPage(ctx: ServiceContext, snapshot: CmsPageRef): Promise<void> {
  let current: CmsPageRef;
  try {
    current = cmsPageRef.parse(await ctx.call(getService("cms.getPage"), { id: snapshot.id }));
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") return;
    throw error;
  }
  if (current.status === "published" && snapshot.status === "draft") {
    await ctx.call(getService("cms.publishPage"), { id: snapshot.id, published: false });
  }
  await ctx.call(getService("cms.updatePage"), {
    id: snapshot.id,
    title: snapshot.title,
    blocks: snapshot.blocks,
    seo: snapshot.seo ?? {},
  });
  if (snapshot.status === "published") {
    await ctx.call(getService("cms.publishPage"), { id: snapshot.id, published: true, ...(snapshot.publishedAt ? { publishedAt: snapshot.publishedAt.toISOString() } : {}) });
    if (snapshot.workingTitle != null || snapshot.workingBlocks != null || snapshot.workingSeo != null) {
      await ctx.call(getService("cms.updatePage"), { id: snapshot.id, title: snapshot.workingTitle ?? snapshot.title, blocks: snapshot.workingBlocks ?? snapshot.blocks, seo: snapshot.workingSeo ?? snapshot.seo ?? {} });
    }
  }
}

function importedBlocks(slug: string, title: string, body: string) {
  const safe = slug.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "page";
  const heading = {
    id: `import-${safe}-heading`,
    type: "heading",
    props: { text: title || slug || "Imported page", level: 1 as const, align: "start" as const },
  };
  const markup = body.trim().slice(0, HTML_MARKUP_MAX);
  if (!markup) return [heading];
  return [
    heading,
    {
      id: `import-${safe}-html`,
      type: "html",
      props: { markup },
    },
  ];
}

function blogIndexBlock(id: string): BlockNode {
  return { id, type: "blogIndex", props: { prefix: "blog", limit: 12 } };
}

const runRow = row({
  id: uuid,
  source: z.string(),
  status: z.enum([
    "discover",
    "mapped",
    "previewed",
    "committed",
    "reconciled",
    "published",
    "rolled_back",
    "failed",
  ]),
  checkpoint: z.unknown(),
  preview: z.unknown(),
  counts: z.unknown(),
  error: z.string().nullable(),
  createdBy: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const startImport = defineService({
  name: "imports.start",
  summary: "Open a resumable import run against a public origin.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    origin: z.string().url(),
    kind: z.enum(["wordpress-rest", "wordpress-wxr", "sitemap", "rss", "atom", "html", "archive"]),
  }),
  output: runRow,
  handler: async (input, ctx) => {
    let url: URL;
    try {
      url = assertPublicHttpUrl(input.origin);
    } catch (error) {
      throw new ServiceError(
        "validation",
        error instanceof Error ? error.message : "That origin is not allowed.",
      );
    }
    const [row] = await ctx.tx
      .insert(importRuns)
      .values({
        source: `${input.kind}:${url.origin}`,
        origin: url.origin,
        kind: input.kind,
        status: "discover",
        checkpoint: { origin: url.origin, kind: input.kind, limits: DEFAULT_IMPORTER_LIMITS },
        createdBy: actorString(ctx.actor),
      })
      .returning();
    ctx.setSubject("import_run", row!.id);
    ctx.queueEvent("import.started", { id: row!.id, source: row!.source });
    return row!;
  },
});

export const previewImport = defineService({
  name: "imports.preview",
  summary: "Record a staged preview for an import run.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    pages: z.array(
      z.object({
        url: z.string(),
        slug: z.string(),
        title: z.string(),
        body: z.string().optional(),
        kind: z.enum(["page", "post"]).optional(),
      }),
    ),
  }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!before) throw new ServiceError("not_found", "No such import run.");
    assertSourceStageable(before);
    const [row] = await ctx.tx
      .update(importRuns)
      .set({
        status: "previewed",
        preview: { pages: input.pages },
        counts: { pages: input.pages.length },
      })
      .where(eq(importRuns.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such import run.");
    ctx.setSubject("import_run", row.id);
    return row;
  },
});

/* ------------------------------------------------------------------ commit */

const mediaToFetch = z.object({
  key: z.string(),
  sourceUrl: z.string(),
  filename: z.string(),
  altText: z.string().optional(),
  wpId: z.string().optional(),
});

/** The read half of a commit: what still has to be fetched. */
const commitSource = defineService({
  name: "imports.commitSource",
  orchestratedBy: "imports.commit",
  summary: "List the media a previewed import still has to fetch.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: z.object({ id: z.string().uuid() }),
  output: z.object({ media: z.array(mediaToFetch), delayMs: z.number().int().nonnegative() }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!run) throw new ServiceError("not_found", "No such import run.");
    assertNoPendingSourceUpload(run);
    if (run.status !== "previewed") {
      throw new ServiceError("conflict", "Preview the import before committing it.");
    }
    const wordpress = wordpressPreview(run.preview);
    const done = new Set(
      mediaRecordsFrom(run.checkpoint)
        .filter((record) => record.assetId)
        .map((record) => record.key),
    );
    return {
      media: (wordpress?.media ?? [])
        .filter((media) => !done.has(media.key))
        .map(({ key, sourceUrl, filename, altText, wpId }) => ({ key, sourceUrl, filename, altText, wpId })),
      delayMs: Math.ceil(1000 / DEFAULT_IMPORTER_LIMITS.requestsPerSecond),
    };
  },
});

/** One fetched (or refused) file, recorded so a retried commit resumes. */
const recordImportMedia = defineService({
  name: "imports.recordMedia",
  orchestratedBy: "imports.commit",
  summary: "Record one media file fetched for an import run.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  input: z.object({
    id: z.string().uuid(),
    key: z.string().min(1),
    assetId: z.string().uuid().optional(),
    error: z.string().max(500).optional(),
  }),
  output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx
      .select()
      .from(importRuns)
      .where(eq(importRuns.id, input.id))
      .limit(1)
      .for("update");
    if (!run) throw new ServiceError("not_found", "No such import run.");
    if (run.status !== "previewed") {
      throw new ServiceError("conflict", "This import is no longer waiting to be committed.");
    }
    const planned = wordpressPreview(run.preview)?.media.find((media) => media.key === input.key);
    if (!planned) throw new ServiceError("validation", "That file is not part of this import.");
    const records = mediaRecordsFrom(run.checkpoint).filter((record) => record.key !== input.key);
    records.push({
      key: input.key,
      sourceUrl: planned.sourceUrl,
      ...(input.assetId ? { assetId: input.assetId } : { error: input.error ?? "The file could not be fetched." }),
    });
    await ctx.tx
      .update(importRuns)
      .set({ checkpoint: { ...checkpointOf(run.checkpoint), media: records } })
      .where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { ok: true as const };
  },
});

function fetchFailure(error: unknown): string {
  if (error instanceof PinnedDownloadError) {
    return error.code === "too_large"
      ? `The file is larger than ${WORDPRESS_MEDIA_LIMITS.maxBytesPerFile / 1024 / 1024} MB.`
      : error.code === "timeout"
        ? "The download timed out."
        : "The file could not be reached.";
  }
  if (error instanceof ServiceError) return error.message.slice(0, 500);
  if (error instanceof Error && /prohibited network address|not resolve|returned no addresses|not allowed|public/i.test(error.message)) {
    return "The file is not on a public address.";
  }
  return "The file could not be fetched.";
}

/**
 * Download one file through the address-pinned transport and hand it to the
 * ordinary media upload, which validates type and size by content, scans it
 * and builds the AVIF/WebP renditions.
 */
async function fetchImportMedia(
  item: z.infer<typeof mediaToFetch>,
  actor: Actor,
): Promise<{ assetId: string } | { error: string }> {
  try {
    assertPublicHttpUrl(item.sourceUrl);
    const downloaded = await getPinnedBytes(item.sourceUrl, {
      maxBytes: WORDPRESS_MEDIA_LIMITS.maxBytesPerFile,
      timeoutMs: WORDPRESS_MEDIA_LIMITS.timeoutMs,
      allowLocal: false,
      headers: { accept: "image/avif,image/webp,image/*,video/*,audio/*,application/pdf;q=0.8,*/*;q=0.1" },
    });
    if (downloaded.status < 200 || downloaded.status >= 300) {
      return { error: `The old site answered HTTP ${downloaded.status}.` };
    }
    if (downloaded.bytes.byteLength === 0) return { error: "The old site sent an empty file." };
    const asset = await uploadAsset.call(
      {
        filename: item.filename,
        // The bytes decide the type; a server's Content-Type is not trusted.
        contentType: "application/octet-stream",
        bytes: downloaded.bytes,
        altText: item.altText,
        source: "import",
        provenance: {
          ...(item.sourceUrl.length <= 2_048 ? { sourceUrl: item.sourceUrl } : {}),
          note: item.wpId ? `WordPress attachment ${item.wpId}` : "WordPress import",
        },
        metadata: {},
      },
      actor,
    );
    return { assetId: asset.id };
  } catch (error) {
    return { error: fetchFailure(error) };
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Placement = {
  page: PreviewPage;
  slug: string;
  action: "create" | "replace" | "keep";
  current?: CmsPageRef;
};

function chooseMenu(menus: ResolvedMenu[]): ResolvedMenu | undefined {
  const usable = menus.filter((menu) => menu.links.length > 0);
  return (
    usable.find((menu) => /primary|main|header|top|nav/i.test(`${menu.slug} ${menu.name}`)) ??
    [...usable].sort((a, b) => b.links.length - a.links.length)[0]
  );
}

/** The write half of a commit: one transaction for pages, redirects and report. */
const pendingBlogPost = z.object({ pageId: uuid, key: z.string(), meta: z.record(z.string(), z.unknown()), comments: z.array(z.object({ id: z.string(), parentId: z.string().optional(), name: z.string(), email: z.string().nullable(), body: z.string(), status: z.enum(["pending", "approved", "spam", "trash"]), createdAt: z.string().optional() })) });

async function importPostComments(ctx: ServiceContext, runId: string, pageId: string, key: string, entries: WordpressComment[]): Promise<number> {
  const remaining = [...entries], ids = new Map<string, string>();
  for (let pass = 0; remaining.length && pass <= entries.length; pass += 1) {
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const comment = remaining[index]!;
      if (comment.parentId && remaining.some(parent => parent.id === comment.parentId)) continue;
      const saved = z.object({ id: uuid }).parse(await ctx.call(getService("cms.importReaderComment"), {
        runId, externalId: `${key}:${comment.id}`, pageId, parentId: comment.parentId ? ids.get(comment.parentId) ?? null : null,
        name: comment.name, email: comment.email, body: comment.body, status: comment.status,
        ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
      }));
      ids.set(comment.id, saved.id); remaining.splice(index, 1);
    }
  }
  if (remaining.length) throw new ServiceError("validation", "The imported comment thread contains a cycle.");
  return entries.length;
}

const commitApply = defineService({
  name: "imports.commitApply",
  orchestratedBy: "imports.commit",
  summary: "Write a previewed import into the CMS as drafts, with redirects and a report.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  input: z.object({ id: z.string().uuid() }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx
      .select()
      .from(importRuns)
      .where(eq(importRuns.id, input.id))
      .limit(1)
      .for("update");
    if (!before) throw new ServiceError("not_found", "No such import run.");
    assertNoPendingSourceUpload(before);
    if (before.status !== "previewed") {
      throw new ServiceError("conflict", "Preview the import before committing it.");
    }
    const staged = previewPages(before.preview);
    const wordpress = wordpressPreview(before.preview);
    const decisions = conflictDecisions(before.conflicts);
    const existing = listedCmsPages(await ctx.call(getService("cms.listPages"), {}));
    const bySlug = new Map(existing.map((page) => [page.slug, page]));
    const used = new Set(bySlug.keys());

    // Where each staged item lands, after the owner's conflict decisions.
    const placements: Placement[] = [];
    for (const page of staged) {
      let slug = cmsSlug(page.slug);
      const decision = decisions.get(slug) ?? decisions.get(page.slug);
      if (bySlug.has(slug) && decision?.resolution === "keep-existing") {
        placements.push({ page, slug, action: "keep" });
        continue;
      }
      if (bySlug.has(slug) && decision?.resolution === "rename") {
        slug = cmsSlug(decision.renamedSlug?.trim() || `${page.slug}-imported`);
      }
      if (bySlug.has(slug) && decision?.resolution === "replace") {
        if (wordpress && page.status === "draft" && bySlug.get(slug)!.status === "published") throw new ServiceError("conflict", "A WordPress draft cannot replace a live page. Rename the imported draft or keep the live page.");
        placements.push({ page, slug, action: "replace", current: bySlug.get(slug)! });
        continue;
      }
      if (used.has(slug)) {
        throw new ServiceError(
          "conflict",
          slug === ""
            ? "There is already a home page. Review conflicts before committing."
            : `Another page already lives at /${slug}. Review conflicts before committing.`,
        );
      }
      used.add(slug);
      placements.push({ page, slug, action: "create" });
    }
    const written = placements.filter((placement) => placement.action !== "keep");
    // Real blog records, shared by owner screens, the API and the public archives.
    const blogSource = `import:${before.id}`;
    const authorIds = new Map<string, string>();
    const categoryIds = new Map<string, string>();
    const tagIds = new Map<string, string>();
    const categoryPaths = new Map<string, string>();
    const archiveAliases: Array<{ fromPath: string; toPath: string }> = [];
    const postSnapshots: unknown[] = [];
    const pendingBlogPosts: z.infer<typeof pendingBlogPost>[] = [];
    const directoryRows = z.array(z.object({ id: z.string(), slug: z.string(), email: z.string().nullable().optional() }));
    if (wordpress) {
      const existingAuthors = directoryRows.element.extend({ path: z.string() }).array().parse(await ctx.call(getService("cms.listAuthors"), {}));
      for (const author of wordpress.authors) {
        const slug = toCmsSlug(author.login).replaceAll("/", "-") || "author";
        const existing = existingAuthors.find(row => row.slug === slug || (author.email && row.email?.toLowerCase() === author.email.toLowerCase()));
        const saved = existing ?? z.object({ id: z.string() }).parse(await ctx.call(getService("cms.saveAuthor"), {
          name: author.displayName || author.login, slug, email: author.email ?? null, path: `author/${slug}`, source: blogSource,
        }));
        authorIds.set(author.login, saved.id);
        if (existing && existing.path !== `author/${slug}`) archiveAliases.push({ fromPath: `author/${slug}`, toPath: existing.path });
      }
      const existingTerms = z.array(z.object({ id: z.string(), slug: z.string(), taxonomy: z.string(), path: z.string() })).parse(await ctx.call(getService("cms.listTerms"), {}));
      for (const taxonomy of ["category", "tag"] as const) {
        const items = taxonomy === "category" ? wordpress.taxonomy.categories : wordpress.taxonomy.tags;
        const ids = taxonomy === "category" ? categoryIds : tagIds;
        const remaining = [...items];
        for (let pass = 0; remaining.length && pass <= items.length; pass += 1) {
          for (let index = remaining.length - 1; index >= 0; index -= 1) {
            const term = remaining[index]!;
            const parentSlug = taxonomy === "category" ? (term as { parentSlug?: string }).parentSlug : undefined;
            if (parentSlug && items.some(row => row.slug === parentSlug) && !ids.has(parentSlug)) continue;
            const slug = toCmsSlug(term.slug).replaceAll("/", "-");
            const path = parentSlug && categoryPaths.has(parentSlug) ? `${categoryPaths.get(parentSlug)}/${slug}` : `${taxonomy}/${slug}`;
            const existing = existingTerms.find(row => row.taxonomy === taxonomy && row.slug === slug);
            const saved = existing ?? z.object({ id: z.string() }).parse(await ctx.call(getService("cms.saveTerm"), {
              taxonomy, name: term.name || slug, slug, description: term.description ?? null,
              parentId: parentSlug ? ids.get(parentSlug) ?? null : null,
              // WordPress archive addresses are kept, independent of Freeholder's defaults.
              path, source: blogSource,
            }));
            ids.set(term.slug, saved.id);
            if (taxonomy === "category") categoryPaths.set(term.slug, path);
            if (existing && existing.path !== path) archiveAliases.push({ fromPath: path, toPath: existing.path });
            remaining.splice(index, 1);
          }
        }
        if (remaining.length) throw new ServiceError("validation", "The imported category hierarchy contains a cycle. Correct the export before committing.");
      }
    }

    // Media and links, for WordPress bodies.
    const records = mediaRecordsFrom(before.checkpoint);
    const assetByKey = new Map(
      records.filter((record) => record.assetId).map((record) => [record.key, record.assetId!]),
    );
    const plannedMedia = wordpress?.media ?? [];
    const keyByAlias = new Map<string, string>();
    const keyByWpId = new Map<string, string>();
    for (const media of plannedMedia) {
      for (const alias of media.aliases) if (!keyByAlias.has(alias)) keyByAlias.set(alias, media.key);
      if (media.wpId) keyByWpId.set(media.wpId, media.key);
    }
    const altByKey = new Map(plannedMedia.map((media) => [media.key, media.altText]));
    const hosts = wordpress?.site.hosts ?? [];
    const basePath = wordpress?.site.basePath ?? "";
    const resolveMediaKey = (src: string, wpId?: string): string | undefined => {
      if (wpId && keyByWpId.has(wpId)) return keyByWpId.get(wpId);
      let key: string | undefined;
      try {
        const parsed = new URL(src, `https://${hosts[0] ?? "invalid.invalid"}/`);
        const base = `${parsed.host.toLowerCase()}${parsed.pathname}`;
        const sized = base.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, "$1");
        for (const alias of [base, sized, sized.replace(/-(?:scaled|rotated)(\.[a-z0-9]+)$/i, "$1")]) {
          key ??= keyByAlias.get(alias);
        }
      } catch {
        return undefined;
      }
      return key;
    };
    const resolveImage = (src: string, wpId?: string): ImageMatch | null => {
      const key = resolveMediaKey(src, wpId);
      const assetId = key ? assetByKey.get(key) : undefined;
      return assetId ? { assetId, alt: key ? altByKey.get(key) : undefined } : null;
    };
    const linkMap = new Map<string, string>(archiveAliases.map(alias => [alias.fromPath, alias.toPath]));
    for (const { page, slug } of placements) {
      const target = slug;
      if (page.redirectFrom) linkMap.set(page.redirectFrom, target);
      const path = wordpressPath(page.url, hosts, basePath);
      if (path !== null) linkMap.set(path, target);
    }
    const rewriteHref = (href: string): string => {
      if (!wordpress) return href;
      const path = wordpressPath(href, hosts, basePath);
      if (path === null) return href;
      let hash = "";
      try {
        hash = new URL(href, `https://${hosts[0] ?? "invalid.invalid"}/`).hash;
      } catch {
        /* keep no fragment */
      }
      const mapped = linkMap.get(path);
      return `/${mapped ?? path}${hash}`;
    };
    const hasPosts = written.some((placement) => placement.page.kind === "post");

    const createdPageIds: string[] = [];
    const replacedPages: CmsPageRef[] = [];
    const draftPageIds: string[] = [];
    const publishedAt: Record<string, string> = {};
    const skippedPages: Array<{ url: string; slug: string; reason: string }> = [];
    const unresolvedImages: string[] = [];
    const slugByWpId = new Map<string, string>();
    let droppedEmbeds = 0;
    let flattenedHtml = 0;
    let posts = 0;
    let commentsImported = 0;
    const landed: Placement[] = [];

    for (const placement of placements) {
      const { page, slug } = placement;
      if (placement.action === "keep") {
        if (page.wpId) slugByWpId.set(page.wpId, slug);
        continue;
      }
      let blocks: unknown[];
      let seo: WordpressSeo = {};
      if (wordpress) {
        const featuredKey = page.featuredMedia;
        const featuredAsset = featuredKey ? assetByKey.get(featuredKey) : undefined;
        const converted = wordpressBodyToBlocks(page.body, {
          slug,
          title: page.title,
          featured: featuredAsset ? { assetId: featuredAsset, alt: altByKey.get(featuredKey!) } : undefined,
          resolveImage,
          rewriteHref,
        });
        if (converted.overBudget) {
          skippedPages.push({ url: page.url, slug, reason: converted.overBudget });
          continue;
        }
        blocks = converted.blocks;
        if (slug === "blog" && hasPosts && !converted.blocks.some((block) => block.type === "blogIndex")) {
          blocks = [...converted.blocks, blogIndexBlock("import-blog-index")];
        }
        unresolvedImages.push(...converted.unresolvedImages);
        droppedEmbeds += converted.droppedEmbeds;
        flattenedHtml += converted.flattenedHtml;
        seo = Object.fromEntries(
          Object.entries(page.seo ?? {}).filter(([, value]) => (typeof value === "string" && value !== "") || value === true),
        );
        if (seo.canonical) seo.canonical = rewriteHref(seo.canonical);
        page.seo = seo;
      } else {
        blocks = importedBlocks(slug, page.title, page.body);
      }
      let id: string;
      if (placement.action === "replace") {
        await ctx.call(getService("cms.updatePage"), {
          id: placement.current!.id,
          title: page.title,
          blocks,
          ...(wordpress ? { seo } : {}),
        });
        replacedPages.push(placement.current!);
        id = placement.current!.id;
      } else {
        const created = createdCmsPage(
          await ctx.call(getService("cms.createPage"), {
            slug,
            title: page.title || slug || "Imported page",
            blocks,
            seo,
          }),
        );
        createdPageIds.push(created.id);
        id = created.id;
      }
      if (page.status === "draft") draftPageIds.push(id);
      if (wordpress && placement.action === "replace") {
        postSnapshots.push(await ctx.call(getService("cms.getPostMeta"), { pageId: id }));
        if (page.kind !== "post") {
          const meta = { pageId: id, isPost: false };
          if (placement.current?.status === "published") pendingBlogPosts.push({ pageId: id, key: page.wpId ?? slug, meta, comments: [] });
          else await ctx.call(getService("cms.setPostMeta"), meta);
        }
      }
      if (wordpress && page.kind === "post") {
        const meta = {
          pageId: id, isPost: true, authorId: page.author ? authorIds.get(page.author) ?? null : null,
          categoryIds: (page.categorySlugs ?? []).flatMap(slug => categoryIds.has(slug) ? [categoryIds.get(slug)!] : []),
          tagIds: (page.tagSlugs ?? []).flatMap(slug => tagIds.has(slug) ? [tagIds.get(slug)!] : []),
          source: blogSource, sourceModifiedAt: page.modifiedAt,
        };
        if (placement.action === "replace" && placement.current?.status === "published") {
          pendingBlogPosts.push({ pageId: id, key: page.wpId ?? slug, meta, comments: page.readerComments ?? [] });
        } else {
          await ctx.call(getService("cms.setPostMeta"), meta);
          commentsImported += await importPostComments(ctx, before.id, id, page.wpId ?? slug, page.readerComments ?? []);
        }
      }
      if (page.publishedAt) publishedAt[id] = page.publishedAt;
      if (page.kind === "post") posts += 1;
      if (page.wpId) slugByWpId.set(page.wpId, slug);
      landed.push(placement);
    }

    // The listing the posts belong to. Without it they exist but nothing lists them.
    let blogIndexPageId: string | undefined;
    if (wordpress && posts > 0 && !used.has("blog") && !bySlug.has("blog")) {
      const created = createdCmsPage(
        await ctx.call(getService("cms.createPage"), {
          slug: "blog",
          title: "Blog",
          blocks: [
            { id: "import-blog-heading", type: "heading", props: { text: "Blog", level: 1, align: "start" } },
            blogIndexBlock("import-blog-index"),
          ],
          seo: {},
        }),
      );
      createdPageIds.push(created.id);
      blogIndexPageId = created.id;
    }

    // Old permalinks that moved get a Redirect row; nothing existing is overwritten.
    const redirectIds: string[] = [];
    const displacedRedirects: Array<z.infer<typeof redirectSnapshot>> = [];
    const skippedRedirects: Array<{ fromPath: string; reason: string }> = [];
    if (wordpress) {
      const existingRedirects = z
        .array(redirectSnapshot.extend({ id: z.string() }))
        .parse(await ctx.call(getService("seo.listRedirects"), {}));
      const byFrom = new Map(existingRedirects.map((redirect) => [`${redirect.locale}:${redirect.fromPath}`, redirect]));
      const livePaths = new Set([...bySlug.keys(), ...landed.map((placement) => placement.slug)]);
      for (const { page, slug } of landed) {
        const fromPath = page.redirectFrom?.replace(/^\/+|\/+$/g, "");
        if (!fromPath || fromPath === slug) continue;
        if (livePaths.has(fromPath)) {
          skippedRedirects.push({ fromPath, reason: "a page already lives there" });
          continue;
        }
        if (byFrom.has(`en:${fromPath}`)) {
          skippedRedirects.push({ fromPath, reason: "an existing redirect was kept" });
          continue;
        }
        // seo.recordRedirect removes a redirect *from* the new page's path,
        // because the page now answers there. Keep it so rollback can restore it.
        const displaced = byFrom.get(`en:${slug}`);
        if (displaced) {
          displacedRedirects.push(redirectSnapshot.parse(displaced));
          byFrom.delete(`en:${slug}`);
        }
        const recorded = z.object({ id: z.string() }).parse(
          await ctx.call(getService("seo.recordRedirect"), { fromPath, toPath: slug, source: "import" }),
        );
        redirectIds.push(recorded.id);
        byFrom.set(`en:${fromPath}`, { id: recorded.id, fromPath, toPath: slug, status: "301", locale: "en", source: "import" });
      }
    }

    // Resolve and retain the source hierarchy. An unresolved ancestor never
    // accidentally attaches its child to the preceding owner's/root item.
    const menus: ResolvedMenu[] = (wordpress?.menus ?? []).map((menu) => {
      const links: NavigationLink[] = [];
      const ancestors: Array<NavigationLink | null> = [];
      let nested = 0, unresolved = 0;
      for (const [index, item] of menu.items.entries()) {
        if (item.depth > 0) nested += 1;
        const depth = Math.max(0, Math.min(4, Math.trunc(item.depth)));
        ancestors.length = Math.min(ancestors.length, depth);
        let href = item.targetWpId ? slugByWpId.has(item.targetWpId) ? `/${slugByWpId.get(item.targetWpId)}${item.fragment ?? ""}` : undefined : item.href;
        if (href && !item.targetWpId && !href.startsWith("#")) {
          const path = wordpressPath(href, hosts, basePath);
          if (path !== null) {
            const url = new URL(href, `https://${hosts[0] ?? "invalid.invalid"}/`);
            href = `/${linkMap.get(path) ?? path}${url.search}${url.hash}`;
          }
        }
        if (!href || !item.label.trim()) { unresolved += 1; ancestors[depth] = null; continue; }
        const actualDepth = ancestors.filter(Boolean).length;
        const id = `import-${before.id}-${createHash("sha256").update(`${menu.slug}:${index}`).digest("hex").slice(0, 16)}`;
        const link: NavigationLink = { id, label: item.label.trim().slice(0, 80), href, ...(actualDepth ? { depth: actualDepth } : {}) };
        links.push(link); ancestors[depth] = link;
      }
      return { slug: menu.slug, name: menu.name, links, nested, unresolved };
    });

    // Authors have no CMS field; match them to accounts for the record only.
    let accounts: Array<{ id: string; email: string }> = [];
    if (wordpress && wordpress.authors.some((author) => author.email)) {
      try {
        accounts = z
          .array(z.object({ id: z.string(), email: z.string() }))
          .parse(await ctx.call(getService("roles.users"), {}));
      } catch (error) {
        if (!(error instanceof ServiceError) || error.code !== "permission") throw error;
      }
    }
    const authors = (wordpress?.authors ?? []).map((author) => ({
      login: author.login,
      displayName: author.displayName,
      posts: author.posts,
      userId: author.email
        ? accounts.find((account) => account.email.toLowerCase() === author.email!.toLowerCase())?.id
        : undefined,
    }));

    const commentsStaged = pendingBlogPosts.reduce((total, post) => total + post.comments.length, 0);
    const mediaImported = records.filter((record) => record.assetId).length;
    const mediaFailures = records.filter((record) => !record.assetId);
    const report = wordpress
      ? {
          ...wordpress.report,
          skippedPages,
          skippedRedirects,
          unresolvedImages: [...new Set(unresolvedImages)].slice(0, REPORT_LIST_MAX),
          mediaFailures: mediaFailures.slice(0, REPORT_LIST_MAX).map(({ sourceUrl, error }) => ({ sourceUrl, error })),
          droppedEmbeds,
          flattenedHtml,
          authors,
          taxonomy: wordpress.taxonomy,
          menus: menus.map(({ slug, name, links, nested, unresolved }) => ({ slug, name, links: links.length, nested, unresolved })),
          // Said out loud so nobody reads a silent zero as "done".
          notRecreated: [
            ...(Number((wordpress.report.comments as { total?: number } | undefined)?.total ?? 0) > commentsImported + commentsStaged ? ["Unsupported comment types, comments on ordinary pages or skipped posts remain in the source export; counts.commentsSkipped reports the difference."] : []),
            ...(wordpress.attachments.some(attachment => !attachment.parentWpId || !slugByWpId.has(attachment.parentWpId)) ? ["Orphan attachment pages need an owner-selected destination."] : []),
            "WordPress /feed is already Freeholder’s member feed; root ?feed=rss2/atom/rss aliases use /feeds/blog.xml. Review this reserved-path collision before DNS cutover.",
            "WXR does not carry rendered hreflang or all plugin-generated metadata. Compare the source crawl with the destination before DNS cutover.",
          ],
          commentsImported, commentsStaged,
        }
      : undefined;
    const counts = wordpress
      ? {
          pages: createdPageIds.length + replacedPages.length,
          posts,
          media: mediaImported,
          mediaFailed: mediaFailures.length,
          redirects: redirectIds.length,
          menus: menus.filter((menu) => menu.links.length > 0).length,
          categories: wordpress.taxonomy.categories.length,
          tags: wordpress.taxonomy.tags.length,
          authors: authors.length,
          commentsImported, commentsStaged,
          commentsSkipped: Math.max(0, Number((wordpress.report.comments as { total?: number } | undefined)?.total ?? 0) - commentsImported - commentsStaged),
          skippedPages: skippedPages.length,
        }
      : { pages: createdPageIds.length + replacedPages.length, media: 0, redirects: 0 };

    const checkpoint = withImportPages(before.checkpoint, createdPageIds, replacedPages);
    Object.assign(checkpoint, {
      draftPageIds,
      publishedAt,
      redirectIds,
      displacedRedirects,
      postSnapshots, pendingBlogPosts,
      landedPaths: landed.map(({ page, slug }) => ({ sourceUrl: page.url, path: slug, status: page.status ?? "publish", seo: page.seo ?? {} })),
      legacyAliases: [
        ...archiveAliases,
        ...(wordpress?.attachments ?? []).flatMap(attachment => {
          const target = attachment.parentWpId ? slugByWpId.get(attachment.parentWpId) : undefined;
          if (target === undefined) return [];
          return [
            ...(attachment.path ? [{ fromPath: attachment.path, toPath: target }] : []),
            ...(attachment.wpId ? ["", "index.php"].map(root => ({ fromPath: `${root}?attachment_id=${attachment.wpId}`, toPath: target })) : []),
          ];
        }),
        ...(wordpress ? ["rss2", "atom", "rss"].map(feed => ({ fromPath: `?feed=${feed}`, toPath: "feeds/blog.xml" })) : []),
        ...landed.flatMap(({ page, slug }) => page.wpId ? ["p", "page_id"].flatMap(key => ["", "index.php"].map(root => ({ fromPath: `${root}?${key}=${page.wpId}`, toPath: slug }))) : []),
      ],
      menus,
      menuPagePaths: [...new Set(placements.map(placement => placement.slug))],
      ...(blogIndexPageId ? { blogIndexPageId } : {}),
      ...(report ? { report } : {}),
    });
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ status: "committed", checkpoint, counts })
      .where(eq(importRuns.id, input.id))
      .returning();
    ctx.setSubject("import_run", row!.id);
    ctx.queueEvent("import.committed", { id: row!.id });
    return row!;
  },
});

export const commitImport = defineOrchestratedService({
  name: "imports.commit",
  summary:
    "Write previewed import pages into the CMS as drafts, fetching WordPress media first. Publish stays a later step.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: runRow,
  handler: async (input, actor) => {
    const source = await commitSource.call({ id: input.id }, actor);
    for (const [index, item] of source.media.entries()) {
      if (index > 0) await pause(source.delayMs);
      const outcome = await fetchImportMedia(item, actor);
      await recordImportMedia.call({ id: input.id, key: item.key, ...outcome }, actor);
    }
    return commitApply.call({ id: input.id }, actor);
  },
});

/* ---------------------------------------------------------------- rollback */

function withoutNavLinks(nodes: BlockNode[], links: NavigationLink[], blockId?: string): boolean {
  let changed = false;
  for (const node of nodes) {
    if (node.type === "nav" && (!blockId || node.id === blockId)) {
      const current = (node.props.links ?? []) as NavigationLink[];
      const kept = removeNavigation(current, links);
      if (JSON.stringify(kept) !== JSON.stringify(current)) { node.props.links = kept; changed = true; }
    }
    if (node.children && withoutNavLinks(node.children, links, blockId)) changed = true;
  }
  return changed;
}

function isMissing(error: unknown): boolean {
  return error instanceof ServiceError && (error.code === "not_found" || error.code === "conflict");
}

export const rollbackImport = defineService({
  name: "imports.rollback",
  summary: "Reverse a committed import batch.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!before) throw new ServiceError("not_found", "No such import run.");
    if (before.status === "rolled_back") return before;
    const checkpoint = checkpointOf(before.checkpoint);

    // Menu links the import added, and only those, come off the nav.
    const nav = navAppliedSchema.safeParse(checkpoint.navApplied);
    if (nav.success && nav.data.links.length > 0) {
      const section = z
        .object({ blocks: z.unknown() })
        .nullable()
        .parse(await ctx.call(getService("cms.getSection"), { key: nav.data.key, locale: nav.data.locale, fallback: false }));
      if (section) {
        const blocks = structuredClone(section.blocks) as BlockNode[];
        if (Array.isArray(blocks) && withoutNavLinks(blocks, nav.data.links, nav.data.blockId)) {
          await ctx.call(getService("cms.updateSection"), { key: nav.data.key, locale: nav.data.locale, blocks });
        }
      }
    }

    for (const snapshot of replacedPagesFrom(before.checkpoint)) {
      await restoreReplacedPage(ctx, snapshot);
    }
    for (const id of createdPageIdsFrom(before.checkpoint)) {
      try {
        await ctx.call(getService("cms.publishPage"), { id, published: false });
      } catch (error) {
        if (!(error instanceof ServiceError) || error.code !== "not_found") throw error;
      }
      try {
        await ctx.call(getService("cms.deleteDraftPage"), { id });
      } catch (error) {
        if (!(error instanceof ServiceError) || (error.code !== "not_found" && error.code !== "conflict")) {
          throw error;
        }
      }
    }
    for (const snapshot of Array.isArray(checkpoint.postSnapshots) ? checkpoint.postSnapshots : []) {
      await ctx.call(getService("cms.setPostMeta"), snapshot);
    }
    await ctx.call(getService("cms.rollbackImportedBlogProfiles"), { runId: before.id });
    await ctx.call(getService("cms.rollbackImportedReaderComments"), { runId: before.id });

    for (const id of stringIds(checkpoint.redirectIds)) {
      try {
        await ctx.call(getService("seo.deleteRedirect"), { id });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    const displaced = z.array(redirectSnapshot).safeParse(checkpoint.displacedRedirects);
    for (const redirect of displaced.success ? displaced.data : []) {
      await ctx.call(getService("seo.recordRedirect"), redirect);
    }

    // Imported files go to the recoverable trash unless something now uses them.
    const keptMedia: string[] = [];
    for (const record of mediaRecordsFrom(before.checkpoint)) {
      if (!record.assetId) continue;
      const usage = z
        .object({ pages: z.number(), sections: z.number() })
        .parse(await ctx.call(getService("media.usage"), { id: record.assetId }));
      if (usage.pages + usage.sections > 0) {
        keptMedia.push(record.assetId);
        continue;
      }
      try {
        await ctx.call(getService("media.trash"), { id: record.assetId });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }

    const next = withImportPages(before.checkpoint, [], []);
    Object.assign(next, {
      redirectIds: [],
      displacedRedirects: [],
      navApplied: undefined,
      media: [],
      rolledBack: { keptMedia },
    });
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ status: "rolled_back", checkpoint: next })
      .where(eq(importRuns.id, input.id))
      .returning();
    ctx.setSubject("import_run", row!.id);
    ctx.queueEvent("import.rolledBack", { id: row!.id });
    return row!;
  },
});

export const listImports = defineService({
  name: "imports.list",
  summary: "Recent import runs.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(runRow),
  handler: (input, ctx) =>
    ctx.tx.select().from(importRuns).orderBy(desc(importRuns.createdAt)),
});

export const mapImport = defineService({
  name: "imports.map",
  summary: "Record URL-to-slug mapping after discovery.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    mapping: z.array(
      z.object({
        url: z.string(),
        slug: z.string(),
        title: z.string(),
        kind: z.enum(["page", "post"]),
      }),
    ),
  }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!before) throw new ServiceError("not_found", "No such import run.");
    assertSourceStageable(before);
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ status: "mapped", mapping: { pages: input.mapping } })
      .where(eq(importRuns.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such import run.");
    ctx.setSubject("import_run", row.id);
    return row;
  },
});

export const reviewImportConflicts = defineService({
  name: "imports.reviewConflicts",
  summary: "Record conflict decisions before commit.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    conflicts: z.array(
      z.object({
        slug: z.string(),
        resolution: z.enum(["keep-existing", "replace", "rename"]),
        renamedSlug: z.string().optional(),
      }),
    ),
  }),
  output: runRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ conflicts: input.conflicts })
      .where(eq(importRuns.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such import run.");
    ctx.setSubject("import_run", row.id);
    return row;
  },
});

const reconcileCounts = z.object({
  pages: z.number().int().nonnegative(),
  media: z.number().int().nonnegative(),
  redirects: z.number().int().nonnegative(),
});

export const reconcileImport = defineService({
  name: "imports.reconcile",
  summary:
    "Recount what a commit wrote (pages, media, redirects) and record it. Counts may be supplied; the recount is always recorded beside them.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    counts: reconcileCounts.optional(),
  }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", "No such import run.");
    if (before.status !== "committed") {
      throw new ServiceError("conflict", "Commit the import before reconciling it.");
    }
    const checkpoint = checkpointOf(before.checkpoint);
    let pagesFound = 0;
    for (const id of pageIdsFrom(checkpoint)) {
      try {
        await ctx.call(getService("cms.getPage"), { id });
        pagesFound += 1;
      } catch (error) {
        if (!(error instanceof ServiceError) || error.code !== "not_found") throw error;
      }
    }
    let mediaFound = 0;
    for (const record of mediaRecordsFrom(checkpoint)) {
      if (!record.assetId) continue;
      try {
        const asset = z
          .object({ status: z.string() })
          .parse(await ctx.call(getService("media.get"), { id: record.assetId }));
        if (asset.status !== "trashed") mediaFound += 1;
      } catch (error) {
        if (!(error instanceof ServiceError) || error.code !== "not_found") throw error;
      }
    }
    const redirectIds = new Set(stringIds(checkpoint.redirectIds));
    const redirectsFound = redirectIds.size === 0
      ? 0
      : z
          .array(z.object({ id: z.string() }))
          .parse(await ctx.call(getService("seo.listRedirects"), {}))
          .filter((redirect) => redirectIds.has(redirect.id)).length;
    const found = { pages: pagesFound, media: mediaFound, redirects: redirectsFound };
    const committed = reconcileCounts.partial().safeParse(before.counts);
    const expected = {
      pages: committed.success ? (committed.data.pages ?? 0) : 0,
      media: committed.success ? (committed.data.media ?? 0) : 0,
      redirects: committed.success ? (committed.data.redirects ?? 0) : 0,
    };
    const previous = before.counts && typeof before.counts === "object" ? (before.counts as Record<string, unknown>) : {};
    const [row] = await ctx.tx
      .update(importRuns)
      .set({
        status: "reconciled",
        counts: { ...previous, ...(input.counts ?? found) },
        checkpoint: {
          ...checkpoint,
          reconciliation: {
            expected,
            found,
            matches:
              expected.pages === found.pages &&
              expected.media === found.media &&
              expected.redirects === found.redirects,
          },
        },
      })
      .where(eq(importRuns.id, input.id))
      .returning();
    ctx.setSubject("import_run", row!.id);
    return row!;
  },
});

export const publishImport = defineService({
  name: "imports.publish",
  summary:
    "Approve cutover after reconciliation: publish imported pages (WordPress drafts stay drafts, original dates kept) and add the imported menu to the site navigation.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!before) throw new ServiceError("not_found", "No such import run.");
    if (before.status === "published") return before;
    if (before.status !== "reconciled") {
      throw new ServiceError("conflict", "Reconcile the import before publishing it.");
    }
    const checkpoint = checkpointOf(before.checkpoint);
    const drafts = new Set(stringIds(checkpoint.draftPageIds));
    const dates =
      checkpoint.publishedAt && typeof checkpoint.publishedAt === "object"
        ? (checkpoint.publishedAt as Record<string, unknown>)
        : {};
    const now = Date.now();
    for (const id of pageIdsFrom(checkpoint)) {
      if (drafts.has(id)) continue;
      const raw = dates[id];
      const date = typeof raw === "string" ? raw : undefined;
      const usable = date && !Number.isNaN(Date.parse(date)) && Date.parse(date) <= now ? date : undefined;
      await ctx.call(getService("cms.publishPage"), {
        id,
        published: true,
        ...(usable ? { publishedAt: usable } : {}),
      });
    }

    const pending = pendingBlogPost.array().parse(checkpoint.pendingBlogPosts ?? []);
    let stagedCommentsImported = 0;
    for (const post of pending) {
      await ctx.call(getService("cms.setPostMeta"), post.meta);
      stagedCommentsImported += await importPostComments(ctx, before.id, post.pageId, post.key, post.comments);
    }

    // Query-ID aliases are activated at cutover, never while imported content
    // remains a private draft. Existing redirects are preserved and reported.
    const aliasSchema = z.array(z.object({ fromPath: z.string(), toPath: z.string() }));
    const aliases = aliasSchema.safeParse(checkpoint.legacyAliases);
    const redirectIds = stringIds(checkpoint.redirectIds);
    const skippedAliases: Array<{ fromPath: string; reason: string }> = [];
    if (aliases.success) {
      const landings = z.array(z.object({ path: z.string(), status: z.string() })).safeParse(checkpoint.landedPaths);
      const draftPaths = new Set(landings.success ? landings.data.filter(page => page.status === "draft").map(page => page.path) : []);
      const existing = z.array(z.object({ fromPath: z.string() })).parse(await ctx.call(getService("seo.listRedirects"), {}));
      const occupied = new Set(existing.map(row => row.fromPath));
      for (const alias of aliases.data) {
        if (draftPaths.has(alias.toPath)) continue;
        if (alias.toPath !== "feeds/blog.xml") {
          const page = await ctx.call(getService("cms.resolvePage"), { slug: alias.toPath, locale: "en" });
          const archive = page ? null : await ctx.call(getService("cms.resolveBlogArchive"), { path: alias.toPath });
          if (!page && !archive) { skippedAliases.push({ fromPath: alias.fromPath, reason: "destination is not public" }); continue; }
        }
        if (occupied.has(alias.fromPath)) { skippedAliases.push({ fromPath: alias.fromPath, reason: "existing redirect preserved" }); continue; }
        const created = z.object({ id: z.string() }).parse(await ctx.call(getService("seo.recordRedirect"), { ...alias, source: "import" }));
        redirectIds.push(created.id); occupied.add(alias.fromPath);
      }
    }

    // One imported menu joins the site's nav section; the rest stay on record.
    let navApplied: z.infer<typeof navAppliedSchema> | undefined;
    const menus = resolvedMenusSchema.safeParse(checkpoint.menus);
    const menu = menus.success ? chooseMenu(menus.data) : undefined;
    const skippedMenuLinks: Array<{ href: string; reason: string }> = [];
    if (menu) {
      const landings = z.array(z.object({ path: z.string() })).safeParse(checkpoint.landedPaths);
      const sourcePaths = new Set([...stringIds(checkpoint.menuPagePaths), ...(landings.success ? landings.data.map(page => page.path) : [])]);
      const checked = new Map<string, boolean>();
      const hidden: NavigationLink[] = [];
      for (const link of menu.links) {
        if (!link.href.startsWith("/") || link.href.startsWith("//")) continue;
        const path = new URL(link.href, "https://freeholder.invalid").pathname.replace(/^\/+|\/+$/g, "");
        if (!sourcePaths.has(path)) continue;
        if (!checked.has(path)) checked.set(path, Boolean(await ctx.call(getService("cms.resolvePage"), { slug: path, locale: "en" })));
        if (!checked.get(path)) { hidden.push(link); skippedMenuLinks.push({ href: link.href, reason: "imported destination is not public" }); }
      }
      menu.links = removeNavigation(menu.links, hidden);

      for (const key of NAV_SECTION_KEYS) {
        const section = z
          .object({ blocks: z.unknown() })
          .nullable()
          .parse(await ctx.call(getService("cms.getSection"), { key, locale: "en", fallback: false }));
        if (!section || !Array.isArray(section.blocks)) continue;
        const blocks = structuredClone(section.blocks) as BlockNode[];
        const merged = mergeNavMenu(blocks, menu.links);
        if (!merged) continue;
        const { added, blockId } = merged;
        if (added.length > 0) {
          await ctx.call(getService("cms.updateSection"), { key, locale: "en", blocks });
        }
        navApplied = { key, locale: "en", menu: menu.slug, blockId, links: added };
        break;
      }
    }
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ status: "published", counts: { ...checkpointOf(before.counts), commentsImported: Number(checkpointOf(before.counts).commentsImported ?? 0) + stagedCommentsImported, commentsStaged: 0 }, checkpoint: { ...checkpoint, pendingBlogPosts: [], redirectIds, skippedAliases, skippedMenuLinks, ...(navApplied ? { navApplied } : {}) } })
      .where(eq(importRuns.id, input.id))
      .returning();
    ctx.setSubject("import_run", row!.id);
    ctx.queueEvent("import.published", { id: row!.id });
    return row!;
  },
});

/* ----------------------------------------------------------------- preview */

type StagedPreview = { preview: Record<string, unknown>; counts: Record<string, number> };

/** A parsed WordPress export as a staged preview: plan, media list and report. */
export function stageWordpressExport(exported: WordpressExport, origin: string): StagedPreview {
  const plan = planWordpressImport(exported, origin);
  // Only public addresses are ever fetched; anything else is reported now.
  const media = plan.media.filter((item) => {
    try {
      assertPublicHttpUrl(item.sourceUrl);
      return true;
    } catch {
      plan.report.skipped["media on a non-public address"] = (plan.report.skipped["media on a non-public address"] ?? 0) + 1;
      return false;
    }
  });
  const posts = plan.pages.filter((page) => page.kind === "post").length;
  return {
    preview: {
      pages: plan.pages,
      wordpress: {
        site: plan.site,
        media,
        menus: plan.menus,
        authors: plan.authors,
        taxonomy: plan.taxonomy,
        attachments: exported.attachments.map(attachment => ({ wpId: attachment.wpId, parentWpId: attachment.parentWpId, path: attachment.url ? wordpressPath(attachment.url, plan.site.hosts, plan.site.basePath) ?? undefined : undefined })),
        report: plan.report,
      },
    },
    counts: {
      pages: plan.pages.length,
      posts,
      media: media.length,
      redirects: plan.pages.filter((page) => page.redirectFrom).length,
      menus: plan.menus.length,
      categories: plan.taxonomy.categories.length,
      tags: plan.taxonomy.tags.length,
      authors: plan.authors.length,
      commentsSkipped: plan.report.comments.total,
    },
  };
}

/** Any supported source text as a staged preview. Throws when it cannot be read. */
export function stageImportSource(kind: string, payload: string, origin: string, robotsTxt = ""): StagedPreview {
  if (kind === "wordpress-wxr") return stageWordpressExport(parseWordpressExport(payload), origin);
  if (kind === "wordpress-rest") {
    return stageWordpressExport(wordpressExportFromRest(JSON.parse(payload) as unknown, origin), origin);
  }
  let parsed: ParsedPage[] = [];
  if (kind === "sitemap") {
    parsed = parseSitemap(payload).map((page) => ({
      url: page.url,
      slug: page.title ?? "page",
      title: page.title ?? page.url,
      kind: "page",
      body: "",
      provenance: { url: page.url, source: "sitemap" },
    }));
  } else if (kind === "rss" || kind === "atom") {
    parsed = parseRssOrAtom(payload);
  } else {
    parsed = [parseSemanticHtml(payload, origin)];
  }
  const discovered = discoverFromPublicOrigin(origin, parsed, robotsTxt);
  const pages: PreviewPage[] = discovered.pages.map((page) => {
    const full = parsed.find((candidate) => candidate.url === page.url);
    const extra = page as { slug?: string };
    return {
      url: page.url,
      slug: extra.slug ?? full?.slug ?? page.title ?? "page",
      title: page.title ?? full?.title ?? page.url,
      body: full?.body ?? "",
      kind: full?.kind ?? (page.kind === "post" ? "post" : "page"),
    };
  });
  return { preview: { pages }, counts: { pages: pages.length } };
}

export const previewFromSource = defineService({
  name: "imports.previewFromSource",
  summary: "Parse a WordPress or generic-site payload into a staged preview.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    payload: z.string().min(1),
    robotsTxt: z.string().optional(),
  }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!before) throw new ServiceError("not_found", "No such import run.");
    assertSourceStageable(before);
    const origin = before.origin ?? "https://example.com";
    const kind = before.kind ?? "html";
    let preview: Record<string, unknown>;
    let counts: Record<string, number>;
    try {
      ({ preview, counts } = stageImportSource(kind, input.payload, origin, input.robotsTxt ?? ""));
    } catch (error) {
      const [failed] = await ctx.tx
        .update(importRuns)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : "That source could not be parsed.",
        })
        .where(eq(importRuns.id, input.id))
        .returning();
      return failed!;
    }
    const [row] = await ctx.tx
      .update(importRuns)
      .set({
        status: "previewed",
        preview,
        counts,
        error: null,
      })
      .where(eq(importRuns.id, input.id))
      .returning();
    ctx.setSubject("import_run", row!.id);
    return row!;
  },
});


/** The digest is a compare-and-swap token, never an authorization grant. */
function sourceRevision(run: unknown): string {
  return createHash("sha256").update(JSON.stringify(run)).digest("hex");
}

const crawlSource = defineService({
  name: "imports.crawlSource",
  orchestratedBy: "imports.previewFromUrl",
  summary: "Read an unchanged stageable import before public-source discovery.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: z.object({ id: uuid, url: z.string().url() }),
  output: z.object({ id: uuid, revision: z.string(), kind: z.string(), origin: z.string(), url: z.string() }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!run) throw new ServiceError("not_found", "No such import run.");
    assertSourceStageable(run);
    if (!["wordpress-rest", "sitemap", "rss", "atom", "html"].includes(run.kind ?? "")) throw new ServiceError("validation", "Upload this source as an export file instead.");
    let url: URL;
    try { url = assertPublicHttpUrl(input.url); } catch { throw new ServiceError("validation", "Use a public HTTP or HTTPS source URL without credentials."); }
    if (url.origin !== run.origin) throw new ServiceError("validation", "The source URL must belong to this import's origin.");
    return { id: run.id, revision: sourceRevision(run), kind: run.kind!, origin: run.origin, url: url.href };
  },
});

const applyCrawl = defineService({
  name: "imports.applyCrawl",
  orchestratedBy: "imports.previewFromUrl",
  summary: "Stage discovery only while the source run still matches its read snapshot.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  input: z.object({ id: uuid, revision: z.string(), preview: z.record(z.string(), z.unknown()).optional(), counts: z.record(z.string(), z.number()).optional(), report: z.record(z.string(), z.unknown()).optional(), error: z.string().max(2000).optional() }),
  output: runRow,
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!run) throw new ServiceError("not_found", "No such import run.");
    assertSourceStageable(run);
    if (sourceRevision(run) !== input.revision) throw new ServiceError("conflict", "This import changed during discovery. Reload it before trying again.");
    const [result] = await ctx.tx.update(importRuns).set(input.error
      ? { status: "failed", error: input.error }
      : { status: "previewed", preview: input.preview!, counts: input.counts!, error: null, checkpoint: { ...checkpointOf(run.checkpoint), crawl: input.report } }
    ).where(eq(importRuns.id, input.id)).returning();
    ctx.setSubject("import_run", run.id);
    return result!;
  },
});

export const previewFromUrl = defineOrchestratedService({
  name: "imports.previewFromUrl",
  summary: "Crawl a public WordPress API, sitemap, feed or HTML site into a staged preview. Nothing is published.",
  kind: "mutation",
  permission: "scoped",
  rateLimit: { limit: 10, windowSeconds: 3600, subject: input => input.id, message: "This import has read its source repeatedly. Wait before trying again." },
  input: z.object({ id: uuid, url: z.string().url().max(2048) }),
  output: runRow,
  handler: async (input, actor) => {
    const source = await crawlSource.call(input, actor);
    let staged: StagedPreview;
    let report: Record<string, unknown>;
    try {
      const discovered = await crawlPublicSource(source.kind as CrawlKind, source.url);
      staged = discovered.wordpress
        ? stageWordpressExport(wordpressExportFromRest(discovered.wordpress, source.origin), source.origin)
        : { preview: { pages: discovered.pages }, counts: { pages: discovered.pages.length } };
      staged.counts = { ...staged.counts, crawlBlocked: discovered.report.blocked.length, crawlRequests: discovered.report.requests, crawlBytes: discovered.report.bytes };
      report = { sourceUrl: discovered.sourceUrl, ...discovered.report };
    } catch (error) {
      // Transport errors contain no response body, provider secret or arbitrary source text.
      const message = error instanceof SyntaxError ? "The source did not return valid UTF-8 JSON." : error instanceof Error ? error.message.slice(0, 2000) : "The source could not be read.";
      return applyCrawl.call({ id: input.id, revision: source.revision, error: message }, actor);
    }
    return applyCrawl.call({ id: input.id, revision: source.revision, ...staged, report }, actor);
  },
});

export const wordpressVerificationPlan = defineService({
  name: "imports.wordpressVerificationPlan",
  summary: "A read-only URL and metadata acceptance manifest for a committed WordPress migration; unresolved source features remain explicit.",
  kind: "query", permission: "scoped", input: z.object({ id: uuid }),
  output: z.object({ sourceOrigin: z.string(), status: z.string(), checks: z.array(z.object({ sourceUrl: z.string(), requestPath: z.string(), destinationPath: z.string(), redirect: z.boolean(), expected: z.record(z.string(), z.unknown()) })), warnings: z.array(z.string()) }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!run) throw new ServiceError("not_found", "No such import run.");
    if (!run.kind?.startsWith("wordpress-")) throw new ServiceError("validation", "URL acceptance manifests apply to WordPress imports.");
    const checkpoint = checkpointOf(run.checkpoint);
    const landed = z.array(z.object({ sourceUrl: z.string(), path: z.string(), status: z.string(), seo: z.record(z.string(), z.unknown()) })).safeParse(checkpoint.landedPaths);
    if (!landed.success) throw new ServiceError("conflict", "Commit a WordPress import with URL acceptance records before requesting verification.");
    const published = landed.data.filter(page => page.status !== "draft");
    const drafts = new Set(landed.data.filter(page => page.status === "draft").map(page => page.path));
    const sourceOrigin = run.origin ?? "";
    const checks = published.map(page => ({ sourceUrl: page.sourceUrl, requestPath: `/${page.path}`, destinationPath: `/${page.path}`, redirect: false, expected: page.seo }));
    for (const page of published) {
      const original = new URL(page.sourceUrl);
      if (original.pathname !== `/${page.path}`) checks.push({ sourceUrl: page.sourceUrl, requestPath: `${original.pathname}${original.search}`, destinationPath: `/${page.path}`, redirect: true, expected: {} });
    }
    const aliases = z.array(z.object({ fromPath: z.string(), toPath: z.string() })).safeParse(checkpoint.legacyAliases);
    const skipped = z.array(z.object({ fromPath: z.string(), reason: z.string() })).safeParse(checkpoint.skippedAliases);
    const excluded = new Set(skipped.success ? skipped.data.map(alias => alias.fromPath) : []);
    if (aliases.success) for (const alias of aliases.data) {
      if (drafts.has(alias.toPath) || excluded.has(alias.fromPath)) continue;
      checks.push({ sourceUrl: new URL(`/${alias.fromPath}`, sourceOrigin).href, requestPath: `/${alias.fromPath}`, destinationPath: `/${alias.toPath}`, redirect: true, expected: {} });
    }
    const report = checkpointOf(checkpoint.report);
    const warnings = stringIds(report.notRecreated);
    if (skipped.success) warnings.push(...skipped.data.map(alias => `${alias.fromPath}: ${alias.reason}`));
    if (run.status !== "published") warnings.push("The import has not been published; draft privacy is expected and cutover acceptance cannot pass yet.");
    return { sourceOrigin, status: run.status, checks, warnings };
  },
});

export default [
  wordpressVerificationPlan,
  startImport,
  previewImport,
  previewFromSource,
  crawlSource,
  applyCrawl,
  previewFromUrl,
  mapImport,
  reviewImportConflicts,
  commitSource,
  recordImportMedia,
  commitApply,
  commitImport,
  reconcileImport,
  publishImport,
  rollbackImport,
  listImports,
];
