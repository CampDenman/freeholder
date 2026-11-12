// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: bounded static CMS batches read actual immutable ZIP originals.
import { createHash } from "node:crypto";
import type { z } from "zod";
import { ServiceError } from "@/core/service";
import { ARCHIVE_LIMITS, parseArchiveOriginalPage, type ArchiveAsset, type ArchivePage, type ArchiveSource } from "./archive";
import { readArchiveDirectory, readArchiveOriginalFiles } from "./archive-directory";
import { archiveGraphMetadataSchema } from "./archive-graph-contract";
import type { archiveGraphHeaderSchema } from "./source-index-contract";
import { archivePlanSchema, archivePreviewDigest } from "./archive-plan";
import type { graphCatalogSchema, graphMediaPlanSchema } from "./graph-catalog";

type Header = z.infer<typeof archiveGraphHeaderSchema>;
type Media = z.infer<typeof graphMediaPlanSchema>;
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
export async function readArchiveGraphDirectory(source: ArchiveSource, header: Header) {
  const directory = await readArchiveDirectory(source, header.origin);
  if (directory.directoryFingerprint !== header.directoryFingerprint || directory.root !== header.root || directory.files.length !== header.files || directory.directoryEntries !== header.directoryEntries || directory.expandedBytes !== header.expandedBytes) throw new ServiceError("conflict", "The original ZIP directory no longer matches its accepted graph.");
  return directory;
}
function originalAsset(item: Media): ArchiveAsset {
  const original = item.archive;
  if (!original || original.file.kind !== "asset" || original.file.url !== item.sourceUrl || item.key !== new URL(item.sourceUrl).host.toLowerCase() + new URL(item.sourceUrl).pathname || item.filename !== original.file.relativePath.split("/").at(-1)) throw new ServiceError("conflict", "The static media plan lost its original file binding.");
  return { path: original.file.path, key: item.key, sourceUrl: item.sourceUrl, filename: item.filename, digest: original.contentDigest, crc32: original.file.crc32, bytes: original.file.bytes, aliases: item.aliases, referenced: item.referenced, ...(item.altText ? { altText: item.altText } : {}) };
}
export async function prepareArchiveGraphBatch(source: ArchiveSource, claim: {
  header: Header; catalog: z.infer<typeof graphCatalogSchema>; media: Media[];
  context: { kind: "content" | "media" | "navigation" };
  entries: Array<{ metadata: unknown; digest: string; targetSlug: string | null }>;
}) {
  const deadline = Date.now() + ARCHIVE_LIMITS.timeoutMs;
  const assets = claim.media.map(originalAsset), pages: ArchivePage[] = [];
  if (claim.context.kind === "content") {
    const directory = await readArchiveGraphDirectory(source, claim.header);
    const originals = claim.entries.map(entry => archiveGraphMetadataSchema.parse(entry.metadata));
    const bytes = await readArchiveOriginalFiles(source, directory, originals.map(entry => entry.file.path));
    const byUrl = new Map(assets.map(asset => [asset.key, asset]));
    for (let index = 0; index < originals.length; index++) {
      if (Date.now() > deadline) throw new ServiceError("conflict", "The bounded ZIP content phase exceeded its read budget.");
      const metadata = originals[index]!, row = claim.entries[index]!, payload = bytes.get(metadata.file.path)!;
      const actual = directory.files.find(file => file.path === metadata.file.path);
      if (!actual || metadata.file.kind !== "page" || !row.targetSlug && row.targetSlug !== "" || sha(payload) !== row.digest || row.digest !== metadata.contentDigest || archivePreviewDigest(actual) !== archivePreviewDigest(metadata.file)) throw new ServiceError("conflict", "The original ZIP page changed after its accepted index.");
      const page = parseArchiveOriginalPage(payload, metadata.file.url!, { base: new URL(claim.header.origin), assetByUrl: byUrl, used: new Set(), unresolvedImages: new Set(), preserveRootTarget: true });
      if (page.url !== metadata.url || page.sourcePath !== metadata.sourcePath || page.title !== metadata.title || archivePreviewDigest(page.seo) !== archivePreviewDigest(metadata.seo)) throw new ServiceError("conflict", "The original ZIP page metadata no longer matches its reviewed index.");
      pages.push({ ...page, slug: row.targetSlug, ...(page.sourcePath !== `/${row.targetSlug}` ? { redirectFrom: page.sourcePath.slice(1) } : {}) });
    }
  }
  const plan = archivePlanSchema.parse({ version: 2, site: { url: claim.header.origin, hosts: claim.catalog.site.hosts, basePath: claim.catalog.site.basePath }, media: assets, report: { entries: claim.header.directoryEntries, expandedBytes: claim.header.expandedBytes, root: claim.header.root, ignored: claim.catalog.report.ignored ?? [], unresolvedImages: claim.catalog.report.unresolvedImages ?? [] } });
  return { preview: { sourceFormat: "static-archive", pages, archive: plan }, counts: { pages: pages.length, media: assets.length, redirects: pages.filter(page => page.redirectFrom).length, filesNotImported: plan.report.ignored.length, mediaWarnings: plan.report.unresolvedImages.length } };
}

/** One already reviewed media phase, using the parent's original manifest. */
export async function restoreArchiveGraphMedia(source: ArchiveSource, header: Header, media: Media[], completed: ReadonlySet<string>, apply: (asset: ArchiveAsset, bytes: Uint8Array<ArrayBuffer>) => Promise<void>) {
  const pending = media.filter(item => !completed.has(item.key));
  if (!pending.length) return;
  if (pending.length !== 1) throw new ServiceError("conflict", "Restore one original ZIP media file in its bounded phase.");
  const item = pending[0]!, asset = originalAsset(item), directory = await readArchiveGraphDirectory(source, header);
  const actual = directory.files.find(file => file.path === asset.path);
  if (!actual || archivePreviewDigest(actual) !== archivePreviewDigest(item.archive!.file)) throw new ServiceError("conflict", "The original ZIP media frame changed.");
  const bytes = (await readArchiveOriginalFiles(source, directory, [asset.path])).get(asset.path)!;
  if (bytes.byteLength !== asset.bytes || sha(bytes) !== asset.digest) throw new ServiceError("conflict", "The original ZIP media content changed.");
  await apply(asset, new Uint8Array(bytes));
}
