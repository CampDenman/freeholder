// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: freeze a bounded shared media/menu plan before emitting any batch.
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { importSourceEntries, importSourceMedia } from "@/core/plugins/schema";
import { ServiceError, type Tx } from "@/core/service";
import { assertPublicHttpUrl } from "./contract";
import { planWordpressImport, wordpressPath, WORDPRESS_MEDIA_LIMITS, type WordpressExport } from "./wordpress";
import { archiveGraphMetadataSchema, archiveFileFactSchema } from "./archive-graph-contract";
import { archiveGraphHeaderSchema } from "./source-index-contract";
import { wxrEntryMetadataSchema, wxrHeaderMetadataSchema } from "./wxr-index";

export const IMPORT_GRAPH_MEDIA_TOTAL_BYTES = 1024 * 1024 * 1024;
export const graphMediaPlanSchema = z.object({ key: z.string().min(1).max(4_096), sourceUrl: z.string().max(8_192), filename: z.string().max(255), altText: z.string().max(500).optional(), caption: z.string().max(2_048).optional(), wpId: z.string().max(128).optional(), aliases: z.string().max(8_192).array().max(16), referenced: z.boolean(), archive: z.object({ file: archiveFileFactSchema, factsDigest: z.string().regex(/^[a-f0-9]{64}$/), contentDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() });
const menuSchema = z.object({ slug: z.string(), name: z.string(), items: z.array(z.object({ label: z.string(), depth: z.number(), targetWpId: z.string().optional(), href: z.string().optional(), note: z.string().optional(), fragment: z.string().optional() })).max(500) });
export const graphCatalogSchema = z.object({
  site: z.object({ title: z.string(), url: z.string(), hosts: z.string().array(), basePath: z.string() }),
  menus: menuSchema.array().max(500),
  attachments: z.array(z.object({ wpId: z.string().optional(), parentWpId: z.string().optional(), path: z.string().optional() })).max(500),
  report: z.record(z.string(), z.unknown()),
});

export async function buildGraphCatalog(tx: Tx, graphId: string, header: unknown, origin: string) {
  if (header && typeof header === "object" && "format" in header && header.format === "archive-zip") {
    const head = archiveGraphHeaderSchema.parse(header), base = new URL(head.origin);
    const rows = await tx.select({ kind: importSourceEntries.kind, metadata: importSourceEntries.metadata }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graphId)).orderBy(asc(importSourceEntries.ordinal));
    const metadata = rows.map(row => archiveGraphMetadataSchema.parse(row.metadata));
    if (metadata.length !== head.files) throw new ServiceError("conflict", "The original ZIP directory is not completely indexed.");
    const references = new Map<string, string | undefined>();
    const unresolved = new Set<string>();
    for (const entry of metadata) for (const image of entry.images ?? []) {
      try { const url = new URL(image.src), key = url.host.toLowerCase() + url.pathname; if (!references.has(key)) references.set(key, image.alt); } catch { if (unresolved.size < 100) unresolved.add(image.src); }
    }
    const media = metadata.filter(entry => entry.file.kind === "asset").map(entry => {
      const file = entry.file, url = new URL(file.url!), key = url.host.toLowerCase() + url.pathname;
      return graphMediaPlanSchema.parse({ key, sourceUrl: url.href, filename: file.relativePath.split("/").at(-1)!, aliases: [key], referenced: references.has(key), ...(references.get(key) ? { altText: references.get(key) } : {}), archive: { file, factsDigest: entry.factsDigest, contentDigest: entry.contentDigest! } });
    });
    if (media.length > 500 || media.some(item => Buffer.byteLength(JSON.stringify(item)) > 16_384)) throw new ServiceError("validation", "The complete ZIP exceeds its graph media budget.");
    const keys = new Set(media.map(item => item.key));
    for (const entry of metadata) for (const image of entry.images ?? []) {
      try { const url = new URL(image.src); if (!keys.has(url.host.toLowerCase() + url.pathname) && unresolved.size < 100) unresolved.add(url.href); } catch { /* Already accounted for above. */ }
    }
    const catalog = graphCatalogSchema.parse({ site: { title: "", url: base.href, hosts: [base.host.toLowerCase()], basePath: base.pathname.replace(/^\/+|\/+$/g, "") }, menus: [], attachments: [], report: { entries: head.directoryEntries, expandedBytes: head.expandedBytes, root: head.root, ignored: metadata.filter(entry => entry.file.kind === "ignored").slice(0, 100).map(entry => entry.file.path), unresolvedImages: [...unresolved] } });
    return { catalog, media, attachments: [] };
  }
  const head = wxrHeaderMetadataSchema.parse(header);
  const rows = await tx.select({ kind: importSourceEntries.kind, metadata: importSourceEntries.metadata }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graphId)).orderBy(asc(importSourceEntries.ordinal));
  const metadata = rows.map(row => wxrEntryMetadataSchema.parse(row.metadata));
  const attachments = metadata.flatMap(entry => entry.attachment ? [entry.attachment] : []), menuItems = metadata.flatMap(entry => entry.menu ? [entry.menu] : []);
  if (attachments.length > 500 || menuItems.length > 500) throw new ServiceError("validation", "The complete source exceeds its 500-file or 500-menu-item graph budget.");
  const exported: WordpressExport = { ...head, items: [], attachments, authors: [], menuItems, skipped: {} };
  const targets = rows.flatMap((row, index) => ["page", "post"].includes(row.kind) ? [{ wpId: metadata[index]!.wpId, title: metadata[index]!.title ?? "" }] : []);
  const plan = planWordpressImport(exported, origin, metadata.flatMap(entry => entry.images ?? []), targets);
  if (plan.report.mediaOverLimit || plan.media.length > WORDPRESS_MEDIA_LIMITS.maxFiles) throw new ServiceError("validation", "The complete source exceeds its 500-file media graph budget.");
  const media = plan.media.filter(item => { try { assertPublicHttpUrl(item.sourceUrl); return true; } catch { plan.report.skipped["media on a non-public address"] = Number(plan.report.skipped["media on a non-public address"] ?? 0) + 1; return false; } }).map(item => graphMediaPlanSchema.parse(item));
  const catalog = graphCatalogSchema.parse({ site: plan.site, menus: plan.menus, attachments: attachments.map(attachment => ({ wpId: attachment.wpId, parentWpId: attachment.parentWpId, path: attachment.url ? wordpressPath(attachment.url, plan.site.hosts, plan.site.basePath) ?? undefined : undefined })), report: plan.report });
  if (Buffer.byteLength(JSON.stringify(catalog)) > 4 * 1024 * 1024 || media.some(item => Buffer.byteLength(JSON.stringify(item)) > 16_384)) throw new ServiceError("validation", "The complete media/menu plan exceeds its graph metadata budget.");
  return { catalog, media, attachments };
}

export async function graphMediaPlans(tx: Tx, graphId: string) {
  const rows = await tx.select({ planned: importSourceMedia.planned }).from(importSourceMedia).where(eq(importSourceMedia.graphId, graphId)).orderBy(asc(importSourceMedia.key));
  return rows.map(row => graphMediaPlanSchema.parse(row.planned));
}

export async function graphAttachments(tx: Tx, graphId: string) {
  const rows = await tx.select({ metadata: importSourceEntries.metadata }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graphId)).orderBy(asc(importSourceEntries.ordinal));
  return rows.flatMap(row => { const entry = row.metadata && typeof row.metadata === "object" && "format" in row.metadata && row.metadata.format === "archive-zip" ? null : wxrEntryMetadataSchema.parse(row.metadata); return entry?.attachment ? [entry.attachment] : []; });
}
