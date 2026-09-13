// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner import studio ledger (C3.22, C3.23).
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { actorString, defineService, getService, ServiceError } from "@/core/service";
import { importRuns } from "@/core/plugins/schema";
import { assertPublicHttpUrl, DEFAULT_IMPORTER_LIMITS } from "./contract";
import {
  discoverFromPublicOrigin,
  parseRssOrAtom,
  parseSemanticHtml,
  parseSitemap,
  parseWordpressRest,
  parseWordpressWxr,
  type ParsedPage,
} from "./parsers";

const HTML_MARKUP_MAX = 20_000;

type PreviewPage = {
  url: string;
  slug: string;
  title: string;
  body: string;
  kind: "page" | "post";
};

type ConflictDecision = {
  slug: string;
  resolution: "keep-existing" | "replace" | "rename";
  renamedSlug?: string;
};

function previewPages(preview: unknown): PreviewPage[] {
  if (!preview || typeof preview !== "object") return [];
  const pages = (preview as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  const out: PreviewPage[] = [];
  for (const page of pages) {
    if (!page || typeof page !== "object") continue;
    const row = page as Record<string, unknown>;
    if (typeof row.slug !== "string" || typeof row.title !== "string") continue;
    out.push({
      url: typeof row.url === "string" ? row.url : "",
      slug: row.slug,
      title: row.title,
      body: typeof row.body === "string" ? row.body : "",
      kind: row.kind === "post" ? "post" : "page",
    });
  }
  return out;
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
    map.set(item.slug, {
      slug: item.slug,
      resolution: item.resolution,
      renamedSlug: typeof item.renamedSlug === "string" ? item.renamedSlug : undefined,
    });
  }
  return map;
}

function pageIdsFrom(checkpoint: unknown): string[] {
  if (!checkpoint || typeof checkpoint !== "object") return [];
  const ids = (checkpoint as { pageIds?: unknown }).pageIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function withPageIds(checkpoint: unknown, pageIds: string[]): Record<string, unknown> {
  const previous =
    checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint)
      ? { ...(checkpoint as Record<string, unknown>) }
      : {};
  previous.pageIds = pageIds;
  return previous;
}

function cmsSlug(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (trimmed === "") return "page";
  if (/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(trimmed)) return trimmed;
  return trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
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

export const commitImport = defineService({
  name: "imports.commit",
  summary: "Write previewed import pages into the CMS as drafts. Publish stays a later step.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", "No such import run.");
    if (before.status !== "previewed") {
      throw new ServiceError("conflict", "Preview the import before committing it.");
    }
    const staged = previewPages(before.preview);
    const decisions = conflictDecisions(before.conflicts);
    const existing = (await ctx.call(getService("cms.listPages"), {})) as Array<{
      id: string;
      slug: string;
    }>;
    const bySlug = new Map(existing.map((page) => [page.slug, page]));
    const used = new Set(bySlug.keys());
    const pageIds: string[] = [];
    for (const page of staged) {
      const decision = decisions.get(page.slug);
      let slug = cmsSlug(page.slug);
      if (bySlug.has(slug) && decision?.resolution === "keep-existing") continue;
      if (bySlug.has(slug) && decision?.resolution === "rename") {
        slug = cmsSlug(decision.renamedSlug?.trim() || `${page.slug}-imported`);
      }
      if (bySlug.has(slug) && decision?.resolution === "replace") {
        const current = bySlug.get(slug)!;
        await ctx.call(getService("cms.updatePage"), {
          id: current.id,
          title: page.title,
          blocks: importedBlocks(slug, page.title, page.body),
        });
        pageIds.push(current.id);
        continue;
      }
      if (used.has(slug)) {
        throw new ServiceError(
          "conflict",
          `Another page already lives at /${slug}. Review conflicts before committing.`,
        );
      }
      const created = (await ctx.call(getService("cms.createPage"), {
        slug,
        title: page.title || slug,
        blocks: importedBlocks(slug, page.title, page.body),
        seo: {},
      })) as { id: string; slug: string };
      pageIds.push(created.id);
      used.add(created.slug);
    }
    const [row] = await ctx.tx
      .update(importRuns)
      .set({
        status: "committed",
        checkpoint: withPageIds(before.checkpoint, pageIds),
        counts: { pages: pageIds.length, media: 0, redirects: 0 },
      })
      .where(eq(importRuns.id, input.id))
      .returning();
    ctx.setSubject("import_run", row!.id);
    ctx.queueEvent("import.committed", { id: row!.id });
    return row!;
  },
});

export const rollbackImport = defineService({
  name: "imports.rollback",
  summary: "Reverse a committed import batch.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", "No such import run.");
    for (const id of pageIdsFrom(before.checkpoint)) {
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
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ status: "rolled_back", checkpoint: withPageIds(before.checkpoint, []) })
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

export const reconcileImport = defineService({
  name: "imports.reconcile",
  summary: "Record reconciled counts, links and SEO after a commit.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    counts: z.object({
      pages: z.number().int().nonnegative(),
      media: z.number().int().nonnegative(),
      redirects: z.number().int().nonnegative(),
    }),
  }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", "No such import run.");
    if (before.status !== "committed") {
      throw new ServiceError("conflict", "Commit the import before reconciling it.");
    }
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ status: "reconciled", counts: input.counts })
      .where(eq(importRuns.id, input.id))
      .returning();
    ctx.setSubject("import_run", row!.id);
    return row!;
  },
});

export const publishImport = defineService({
  name: "imports.publish",
  summary: "Approve cutover after reconciliation.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: runRow,
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", "No such import run.");
    if (before.status !== "reconciled") {
      throw new ServiceError("conflict", "Reconcile the import before publishing it.");
    }
    for (const id of pageIdsFrom(before.checkpoint)) {
      await ctx.call(getService("cms.publishPage"), { id, published: true });
    }
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ status: "published" })
      .where(eq(importRuns.id, input.id))
      .returning();
    ctx.setSubject("import_run", row!.id);
    ctx.queueEvent("import.published", { id: row!.id });
    return row!;
  },
});

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
    const [before] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", "No such import run.");
    const origin = before.origin ?? "https://example.com";
    const kind = before.kind ?? "html";
    let pages: PreviewPage[];
    try {
      let parsed: ParsedPage[] = [];
      if (kind === "wordpress-rest") {
        parsed = parseWordpressRest(JSON.parse(input.payload) as unknown, origin);
      } else if (kind === "wordpress-wxr") {
        parsed = parseWordpressWxr(input.payload);
      } else if (kind === "sitemap") {
        parsed = parseSitemap(input.payload).map((page) => ({
          url: page.url,
          slug: page.title ?? "page",
          title: page.title ?? page.url,
          kind: "page",
          body: "",
          provenance: { url: page.url, source: "sitemap" },
        }));
      } else if (kind === "rss" || kind === "atom") {
        parsed = parseRssOrAtom(input.payload);
      } else {
        parsed = [parseSemanticHtml(input.payload, origin)];
      }
      const discovered = discoverFromPublicOrigin(origin, parsed, input.robotsTxt ?? "");
      pages = discovered.pages.map((page) => {
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
        preview: { pages },
        counts: { pages: pages.length },
        error: null,
      })
      .where(eq(importRuns.id, input.id))
      .returning();
    ctx.setSubject("import_run", row!.id);
    return row!;
  },
});

export default [
  startImport,
  previewImport,
  previewFromSource,
  mapImport,
  reviewImportConflicts,
  commitImport,
  reconcileImport,
  publishImport,
  rollbackImport,
  listImports,
];
