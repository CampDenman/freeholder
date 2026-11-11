// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: static files retain their own semantics and exact encoded identities.
import { createHash } from "node:crypto";
import { z } from "zod";
import { readStaticArchive, type ArchiveResult, type ArchiveSource } from "./archive";

export const archivePlanSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  site: z.object({ url: z.string().url(), hosts: z.array(z.string()), basePath: z.string() }),
  media: z.array(z.object({
    path: z.string(), key: z.string(), sourceUrl: z.string(), filename: z.string(),
    digest: z.string().regex(/^[a-f0-9]{64}$/), crc32: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(), aliases: z.array(z.string()), referenced: z.boolean(),
    altText: z.string().optional(),
  })).max(500),
  report: z.object({ entries: z.number().int(), expandedBytes: z.number().int(), ignored: z.array(z.string()), unresolvedImages: z.array(z.string()), root: z.string() }),
});
export type ArchivePlan = z.infer<typeof archivePlanSchema>;

export function archivePlan(result: ArchiveResult): ArchivePlan {
  return archivePlanSchema.parse({ version: result.contentVersion, site: result.site, media: result.assets, report: result.report });
}

/** This binds a private checkpoint to the server-generated staged content. */
export function archivePreviewDigest(preview: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right, "en")).map(([key, entry]) => [key, canonical(entry)]));
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonical(preview))).digest("hex");
}

export async function stageStaticArchive(source: ArchiveSource, origin: string): Promise<{ preview: Record<string, unknown>; counts: Record<string, number> }> {
  const result = await readStaticArchive(source, origin, async () => {});
  return {
    preview: { sourceFormat: "static-archive", pages: result.pages, archive: archivePlan(result) },
    counts: { pages: result.pages.length, media: result.assets.length, redirects: result.pages.filter(page => page.redirectFrom).length, filesNotImported: result.report.ignored.length, mediaWarnings: result.report.unresolvedImages.length },
  };
}

export function staticArchivePlan(preview: unknown): ArchivePlan | null {
  if (!preview || typeof preview !== "object" || (preview as Record<string, unknown>).sourceFormat !== "static-archive") return null;
  return archivePlanSchema.parse((preview as Record<string, unknown>).archive);
}

/**
 * Match literal URL paths. In particular, `%252F` must never become an owned
 * slash or let one entry impersonate another after a second decode.
 */
export function archiveSourcePath(href: string, site: ArchivePlan["site"]): string | null {
  try {
    const base = new URL(site.url), url = new URL(href, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== base.origin) return null;
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    return url.pathname.replace(/^\//, "");
  } catch { return null; }
}
