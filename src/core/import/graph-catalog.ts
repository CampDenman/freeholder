// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: freeze a bounded shared media/menu plan before emitting any batch.
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { importSourceEntries, importSourceMedia } from "@/core/plugins/schema";
import { ServiceError, type Tx } from "@/core/service";
import { assertPublicHttpUrl } from "./contract";
import { planWordpressImport, wordpressPath, WORDPRESS_MEDIA_LIMITS, type WordpressExport } from "./wordpress";
import { wxrEntryMetadataSchema, wxrHeaderMetadataSchema } from "./wxr-index";

export const IMPORT_GRAPH_MEDIA_TOTAL_BYTES = 1024 * 1024 * 1024;
export const graphMediaPlanSchema = z.object({ key: z.string().min(1).max(4_096), sourceUrl: z.string().max(8_192), filename: z.string().max(255), altText: z.string().max(500).optional(), caption: z.string().max(2_048).optional(), wpId: z.string().max(128).optional(), aliases: z.string().max(8_192).array().max(16), referenced: z.boolean() });
const menuSchema = z.object({ slug: z.string(), name: z.string(), items: z.array(z.object({ label: z.string(), depth: z.number(), targetWpId: z.string().optional(), href: z.string().optional(), note: z.string().optional(), fragment: z.string().optional() })).max(500) });
export const graphCatalogSchema = z.object({
  site: z.object({ title: z.string(), url: z.string(), hosts: z.string().array(), basePath: z.string() }),
  menus: menuSchema.array().max(500),
  attachments: z.array(z.object({ wpId: z.string().optional(), parentWpId: z.string().optional(), path: z.string().optional() })).max(500),
  report: z.record(z.string(), z.unknown()),
});

export async function buildGraphCatalog(tx: Tx, graphId: string, header: unknown, origin: string) {
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
  return rows.flatMap(row => { const entry = wxrEntryMetadataSchema.parse(row.metadata); return entry.attachment ? [entry.attachment] : []; });
}
