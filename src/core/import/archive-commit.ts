// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: materialize only entries bound to the immutable private source plan.
import { ServiceError } from "@/core/service";
import { readStaticArchive, type ArchiveAsset, type ArchiveSource } from "./archive";
import { archivePlan, archivePreviewDigest, type ArchivePlan } from "./archive-plan";

export async function restoreStaticArchive(
  source: ArchiveSource,
  origin: string,
  expected: { plan: ArchivePlan; previewDigest: string },
  completed: ReadonlySet<string>,
  apply: (asset: ArchiveAsset, bytes: Uint8Array<ArrayBuffer>) => Promise<void>,
): Promise<void> {
  const planned = new Map(expected.plan.media.map(asset => [asset.key, asset]));
  const result = await readStaticArchive(source, origin, async (asset, bytes) => {
    const match = planned.get(asset.key);
    if (!match || asset.path !== match.path || asset.digest !== match.digest || asset.crc32 !== match.crc32 || asset.bytes !== match.bytes || asset.sourceUrl !== match.sourceUrl || asset.filename !== match.filename) throw new ServiceError("conflict", "The archive entry differs from its accepted preview. Stage the source again.");
    if (!completed.has(asset.key)) await apply(asset, bytes);
  }, { preserveRootTarget: expected.plan.version >= 2 });
  const actual = { sourceFormat: "static-archive", pages: result.pages, archive: archivePlan(result) };
  if (archivePreviewDigest(actual) !== expected.previewDigest) throw new ServiceError("conflict", "The archive preview no longer matches its private source. Stage the source again.");
}
