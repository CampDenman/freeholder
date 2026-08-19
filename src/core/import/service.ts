// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner import studio ledger (C3.22, C3.23).
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { actorString, defineService, ServiceError } from "@/core/service";
import { importRuns } from "@/core/plugins/schema";
import { assertPublicHttpUrl, DEFAULT_IMPORTER_LIMITS } from "./contract";
import {
  discoverFromPublicOrigin,
  parseRssOrAtom,
  parseSemanticHtml,
  parseSitemap,
  parseWordpressRest,
  parseWordpressWxr,
} from "./parsers";

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
    pages: z.array(z.object({ url: z.string(), slug: z.string(), title: z.string() })),
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
  summary: "Mark a previewed import as committed. Publish stays a later step.",
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
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ status: "committed" })
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
    const [row] = await ctx.tx
      .update(importRuns)
      .set({ status: "rolled_back" })
      .where(eq(importRuns.id, input.id))
      .returning();
    if (!row) throw new ServiceError("not_found", "No such import run.");
    ctx.setSubject("import_run", row.id);
    ctx.queueEvent("import.rolledBack", { id: row.id });
    return row;
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
    let pages: Array<{ url: string; slug: string; title: string }>;
    try {
      if (kind === "wordpress-rest") {
        pages = parseWordpressRest(JSON.parse(input.payload) as unknown, origin);
      } else if (kind === "wordpress-wxr") {
        pages = parseWordpressWxr(input.payload);
      } else if (kind === "sitemap") {
        pages = parseSitemap(input.payload).map((page) => ({
          url: page.url,
          slug: page.title ?? "page",
          title: page.title ?? page.url,
        }));
      } else if (kind === "rss" || kind === "atom") {
        pages = parseRssOrAtom(input.payload);
      } else {
        const parsed = parseSemanticHtml(input.payload, origin);
        pages = [{ url: parsed.url, slug: parsed.slug, title: parsed.title }];
      }
      const discovered = discoverFromPublicOrigin(origin, pages, input.robotsTxt ?? "");
      pages = discovered.pages.map((page) => ({
        url: page.url,
        slug: "slug" in page && typeof page.slug === "string" ? page.slug : page.title ?? "page",
        title: page.title ?? page.url,
      }));
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
