// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: immutable source identity and bounded private reads, never public keys.
import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { privacyRetentionExceptions } from "@/core/privacy/schema";
import { importRuns } from "@/core/plugins/schema";
import { insideServiceTransaction } from "@/core/plugins/context";
import { ServiceError, type ServiceContext } from "@/core/service";
import { originalStoredObject } from "@/core/media/write-ledger";
import { registerPendingObjectOwner } from "@/core/media/object-ledger";

export const IMPORT_SOURCE_MAX_BYTES = 100 * 1024 * 1024;
export const IMPORT_SOURCE_CHUNK_BYTES = 4 * 1024 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const retainedImportSourceSchema = z.object({
  runId: z.uuid(), uploadId: z.uuid(), revision: digest,
  filename: z.string().min(1).max(255), bytes: z.number().int().positive().max(IMPORT_SOURCE_MAX_BYTES),
  chunkBytes: z.literal(IMPORT_SOURCE_CHUNK_BYTES), chunkDigests: z.array(digest).min(1).max(25),
  expiresAt: z.iso.datetime(),
});
export type RetainedImportSource = z.infer<typeof retainedImportSourceSchema>;
type Upload = { uploadId: string; filename: string; bytes: number; chunkBytes: number; digests?: Record<string, string>; expiresAt: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const importSourceWriteSchema = z.object({
  state: z.enum(["running", "unknown"]).default("running"),
  attemptId: z.uuid(), uploadId: z.uuid(), index: z.number().int().nonnegative().max(24),
  bytes: z.number().int().positive().max(IMPORT_SOURCE_CHUNK_BYTES), startedAt: z.iso.datetime(),
});
export function importSourceWrites(checkpoint: unknown): z.infer<typeof importSourceWriteSchema>[] {
  return importSourceWriteSchema.array().max(100).parse(object(checkpoint).sourceWrites ?? []);
}
const activeUploadSchema = z.object({ uploadId: z.uuid(), filename: z.string(), bytes: z.number().int().positive(), chunkBytes: z.number().int().positive(), digests: z.record(z.string(), digest), received: z.array(z.number().int().nonnegative()), expiresAt: z.iso.datetime() });
function revision(bytes: number, chunkBytes: number, chunkDigests: string[]): string {
  return createHash("sha256").update("freeholder.import.source.v1\0").update(JSON.stringify({ bytes, chunkBytes, chunkDigests })).digest("hex");
}
export function makeRetainedImportSource(runId: string, upload: Upload): RetainedImportSource {
  const chunkDigests = Array.from({ length: Math.ceil(upload.bytes / upload.chunkBytes) }, (_, index) => upload.digests?.[String(index)]);
  if (chunkDigests.some(value => !value)) throw new ServiceError("conflict", "This older upload has no verified chunk identity. Upload the source again.");
  const hashes = chunkDigests as string[];
  return retainedImportSourceSchema.parse({ ...upload, runId, chunkDigests: hashes, revision: revision(upload.bytes, upload.chunkBytes, hashes) });
}
export function retainedSourceFromRun(run: { id: string; checkpoint: unknown }): RetainedImportSource | null {
  const parsed = retainedImportSourceSchema.safeParse(object(run.checkpoint).retainedSource);
  return parsed.success && parsed.data.runId === run.id && parsed.data.revision === revision(parsed.data.bytes, parsed.data.chunkBytes, parsed.data.chunkDigests) ? parsed.data : null;
}
export function retainedSourceChunkKey(source: RetainedImportSource, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= source.chunkDigests.length) throw new ServiceError("validation", "That source chunk is outside the manifest.");
  return `imports/${source.runId}/${source.uploadId}/${String(index).padStart(5, "0")}.part`;
}

/** Only server-derived, run-owned names can enter source cleanup jobs. */
export function importSourceObjectKeys(run: { id: string; checkpoint: unknown }): string[] {
  const keys = new Set<string>(), retained = retainedSourceFromRun(run);
  if (retained) for (let index = 0; index < retained.chunkDigests.length; index++) keys.add(retainedSourceChunkKey(retained, index));
  const upload = activeUploadSchema.safeParse(object(run.checkpoint).sourceUpload);
  if (upload.success && upload.data.chunkBytes === IMPORT_SOURCE_CHUNK_BYTES && upload.data.bytes <= IMPORT_SOURCE_MAX_BYTES) {
    const count = Math.ceil(upload.data.bytes / upload.data.chunkBytes);
    for (let index = 0; index < count; index++) keys.add(`imports/${run.id}/${upload.data.uploadId}/${String(index).padStart(5, "0")}.part`);
  }
  return [...keys];
}

/** Release authority and its durable deletion task share the caller's TX. */
export async function releaseImportSources(ctx: ServiceContext, run: { id: string; checkpoint: unknown }, checkpoint: Record<string, unknown>): Promise<void> {
  const keys = importSourceObjectKeys(run);
  delete checkpoint.retainedSource;
  delete checkpoint.sourceUpload;
  delete checkpoint.sourceGraphRebind;
  if (keys.length) await ctx.queueJob("core.deleteCaptureObjects", { keys });
}
/** The descriptor comes from an authorized service; no arbitrary key is read. */
export async function readRetainedSourceChunk(input: RetainedImportSource, index: number): Promise<Uint8Array<ArrayBuffer>> {
  if (insideServiceTransaction()) throw new ServiceError("internal", "Read source bytes outside the service transaction.");
  const source = retainedImportSourceSchema.parse(input);
  const key = retainedSourceChunkKey(source, index);
  if (source.chunkDigests.length !== Math.ceil(source.bytes / source.chunkBytes)) throw new ServiceError("conflict", "The source manifest has an invalid chunk count.");
  if (source.revision !== revision(source.bytes, source.chunkBytes, source.chunkDigests)) throw new ServiceError("conflict", "The source manifest changed.");
  if (Date.parse(source.expiresAt) <= Date.now()) throw new ServiceError("conflict", "The retained source has expired. Upload the same source again before retrying.");
  const [run] = await db().select({ id: importRuns.id, status: importRuns.status, checkpoint: importRuns.checkpoint }).from(importRuns).where(eq(importRuns.id, source.runId)).limit(1);
  if (!run || ["published", "rolled_back"].includes(run.status)) throw new ServiceError("conflict", "This source is no longer retained by its import.");
  const upload = activeUploadSchema.safeParse(object(run.checkpoint).sourceUpload);
  const retained = retainedSourceFromRun(run);
  let active: RetainedImportSource | null = retained;
  if (upload.success && upload.data.uploadId === source.uploadId && upload.data.received.length === source.chunkDigests.length && source.chunkDigests.every((_, index) => upload.data.received.includes(index))) {
    active = makeRetainedImportSource(run.id, upload.data);
  }
  if (!active || active.uploadId !== source.uploadId || active.revision !== source.revision || active.expiresAt !== source.expiresAt) throw new ServiceError("conflict", "The retained source was replaced. Reload the import before retrying.");
  const captured = await originalStoredObject(key);
  if (captured.store.isPublic) throw new ServiceError("conflict", "Import source files require private object storage.");
  const bytes = await captured.store.get(key);
  const expected = Math.min(source.chunkBytes, source.bytes - index * source.chunkBytes);
  if (!bytes || bytes.byteLength !== expected || createHash("sha256").update(bytes).digest("hex") !== source.chunkDigests[index]) throw new ServiceError("conflict", "The stored source chunk is missing or differs from its verified upload. Upload the source again.");
  return bytes;
}

registerPendingObjectOwner("imports/", async (key, now) => {
  const match = /^imports\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/\d{5}\.part$/.exec(key);
  if (!match || !z.uuid().safeParse(match[1]).success || !z.uuid().safeParse(match[2]).success) return false;
  const [run] = await db().select({ status: importRuns.status, checkpoint: importRuns.checkpoint }).from(importRuns).where(eq(importRuns.id, match[1]!)).limit(1);
  if (!run) return false;
  // An unresolved provider request can still write after expiry. Preserve its
  // cleanup witness until that exact attempt reports an outcome; a clock or
  // object-not-found response cannot prove provider cancellation.
  if (importSourceWrites(run.checkpoint).some(write => write.uploadId === match[2] && key.endsWith(`/${String(write.index).padStart(5, "0")}.part`))) return true;
  const holds = z.object({ exceptionId: z.uuid(), requestId: z.uuid(), uploadId: z.uuid() }).array().parse(object(run.checkpoint).sourcePrivacyHolds ?? []).filter(hold => hold.uploadId === match[2]);
  if (holds.length) {
    const [active] = await db().select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions).where(and(
      or(...holds.map(hold => and(eq(privacyRetentionExceptions.id, hold.exceptionId), eq(privacyRetentionExceptions.dataRequestId, hold.requestId)))),
      inArray(privacyRetentionExceptions.scope, ["imports.readerSources", "cms.readerComments"]),
      or(isNull(privacyRetentionExceptions.expiresAt), gt(privacyRetentionExceptions.expiresAt, now)),
    )).limit(1);
    if (active) return true;
  }
  if (["published", "rolled_back"].includes(run.status)) return false;
  const checkpoint = object(run.checkpoint);
  for (const value of [checkpoint.sourceUpload, checkpoint.retainedSource]) {
    const owner = object(value);
    if (owner.uploadId === match[2] && typeof owner.expiresAt === "string" && Date.parse(owner.expiresAt) > now.getTime()) return true;
  }
  return false;
});
