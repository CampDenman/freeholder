// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Large import sources arrive in chunks (C3.22).
//
// A WordPress export is routinely tens of megabytes. Every JSON route is held
// to a 1 MB body, and the request proxy buffers at most 10 MB, so neither limit
// is raised: an export is reserved (`imports.beginSourceUpload`), sent as
// fixed 4 MB chunks to the import-only chunk route, each written to private
// object storage outside any transaction, and then read back one chunk at a
// time by `imports.previewFromUpload`. A WXR file is parsed as it streams, so
// memory holds one chunk and one `<item>` rather than the whole export. The
// chunks are deleted once the preview is staged, whether it succeeded or not.
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { uuid } from "@/core/contract";
import {
  actorString,
  defineOrchestratedService,
  defineService,
  ServiceError,
  type Actor,
} from "@/core/service";
import { importRuns } from "@/core/plugins/schema";
import { storage } from "@/adapters/storage";
import { deleteUnownedPendingObjects, reservePendingMediaObject } from "@/core/media/object-ledger";
import { IMPORT_SOURCE_MAX_BYTES, IMPORT_SOURCE_CHUNK_BYTES, makeRetainedImportSource, readRetainedSourceChunk, retainedImportSourceSchema, importSourceWrites, type RetainedImportSource } from "./retained-source";
export { IMPORT_SOURCE_MAX_BYTES, IMPORT_SOURCE_CHUNK_BYTES } from "./retained-source";
import { DEFAULT_IMPORTER_LIMITS } from "./contract";
import { stageImportSource, stageWordpressExport } from "./service";
import { assertSourceStageable } from "./source-lifecycle";
import { assertReaderUploadWindow, bindReaderSources, ReaderSourceErasureError } from "./privacy";
import { wordpressExportBuilder } from "./wordpress";

/**
 * One export file. WordPress's own exporter has no size cap, and real WXR
 * files for a few hundred posts with comments run 5–60 MB; 100 MB leaves
 * headroom without inviting a multi-gigabyte upload. What the import then
 * keeps is still bounded by the importer limits (500 items, 20 MB of bodies).
 */
/** Under the request proxy's 10 MB buffer, with room to spare. */
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;


const uploadRecord = z.object({
  uploadId: z.string().uuid(),
  filename: z.string(),
  bytes: z.number().int().positive(),
  chunkBytes: z.number().int().positive(),
  chunks: z.number().int().positive(),
  received: z.array(z.number().int().nonnegative()),
  digests: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  keyPrefix: z.string(),
  createdBy: z.string(),
  expiresAt: z.string(),
});
type UploadRecord = z.infer<typeof uploadRecord>;

function checkpointOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function uploadOf(checkpoint: unknown): UploadRecord | null {
  const parsed = uploadRecord.safeParse(checkpointOf(checkpoint).sourceUpload);
  return parsed.success ? parsed.data : null;
}

function partKey(upload: Pick<UploadRecord, "keyPrefix">, index: number): string {
  return `${upload.keyPrefix}/${String(index).padStart(5, "0")}.part`;
}

function allKeys(upload: UploadRecord): string[] {
  return Array.from({ length: upload.chunks }, (_, index) => partKey(upload, index));
}

function expectedChunkSize(upload: UploadRecord, index: number): number {
  return index < upload.chunks - 1 ? upload.chunkBytes : upload.bytes - upload.chunkBytes * (upload.chunks - 1);
}

/**
 * The first bytes have to look like the source the run was opened for. The
 * parsers check the rest; this stops an image or an archive at the door.
 */
export function sourceLooksRight(kind: string, prefix: string): boolean {
  if (prefix.includes("\u0000")) return false;
  const start = prefix.replace(/^﻿/, "").trimStart();
  if (kind === "wordpress-rest") return start.startsWith("[") || start.startsWith("{");
  if (!start.startsWith("<")) return false;
  if (kind === "wordpress-wxr") return /<rss[\s>]|<channel[\s>]|wordpress\.org\/export/i.test(prefix);
  return true;
}

function sameUploader(upload: UploadRecord, actor: Actor): boolean {
  return actor.kind === "system" || upload.createdBy === actorString(actor);
}

const beginApply = defineService({
  name: "imports.beginSourceUploadApply",
  orchestratedBy: "imports.beginSourceUpload",
  summary: "Reserve a chunked upload of an import source file.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  input: z.object({
    id: z.string().uuid(),
    filename: z.string().trim().min(1).max(255),
    bytes: z.number().int().positive(),
  }),
  output: z.object({ upload: uploadRecord, previousKeys: z.array(z.string()) }),
  handler: async (input, ctx) => {
    if (input.bytes > IMPORT_SOURCE_MAX_BYTES) {
      throw new ServiceError(
        "validation",
        `Export files can be up to ${IMPORT_SOURCE_MAX_BYTES / 1024 / 1024} MB.`,
      );
    }
    const [run] = await ctx.tx
      .select()
      .from(importRuns)
      .where(eq(importRuns.id, input.id))
      .limit(1)
      .for("update");
    if (!run) throw new ServiceError("not_found", "No such import run.");
    assertSourceStageable(run, true);
    const checkpoint = checkpointOf(run.checkpoint);
    if (Array.isArray(checkpoint.media) && checkpoint.media.length > 0) {
      throw new ServiceError("conflict", "Files from this import were already fetched. Roll it back before staging another export.");
    }
    const previous = uploadOf(checkpoint);
    const uploadId = randomUUID();
    const upload: UploadRecord = {
      uploadId,
      filename: input.filename,
      bytes: input.bytes,
      chunkBytes: IMPORT_SOURCE_CHUNK_BYTES,
      chunks: Math.ceil(input.bytes / IMPORT_SOURCE_CHUNK_BYTES),
      received: [],
      digests: {},
      keyPrefix: `imports/${run.id}/${uploadId}`,
      createdBy: actorString(ctx.actor),
      expiresAt: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
    };
    // Reserve cleanup before the first provider write. Abandoned uploads and
    // lost acknowledgements still have an exact durable deletion task.
    await ctx.queueJob("core.deleteCaptureObjects", { keys: allKeys(upload) }, { startAfter: new Date(upload.expiresAt) });
    if (previous) await ctx.queueJob("core.deleteCaptureObjects", { keys: allKeys(previous) });
    await ctx.tx
      .update(importRuns)
      .set({ checkpoint: { ...checkpoint, sourceUpload: upload } })
      .where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { upload, previousKeys: previous ? allKeys(previous) : [] };
  },
});

export const beginSourceUpload = defineOrchestratedService({
  name: "imports.beginSourceUpload",
  rateLimit: {
    limit: 60,
    windowSeconds: 3600,
    message: "That import has started a lot of uploads in an hour. Wait a little and try again.",
    subject: (input) => input.id,
  },
  summary: `Reserve an upload of an export file (up to ${IMPORT_SOURCE_MAX_BYTES / 1024 / 1024} MB), sent afterwards as ${IMPORT_SOURCE_CHUNK_BYTES / 1024 / 1024} MB chunks to /api/imports/source/chunk.`,
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id: z.string().uuid(),
    filename: z.string().trim().min(1).max(255),
    bytes: z.number().int().positive(),
  }),
  output: z.object({
    uploadId: uuid,
    chunkBytes: z.number().int(),
    chunkCount: z.number().int(),
    maxBytes: z.number().int(),
  }),
  handler: async (input, actor) => {
    if (storage().isPublic) throw new ServiceError("conflict", "Import source files require private object storage. Configure private storage and retry.");
    const { upload, previousKeys } = await beginApply.call(input, actor);
    // A replaced, unfinished upload leaves nothing behind.
    for (const key of previousKeys) await deleteUnownedPendingObjects([key]).catch(() => undefined);
    return {
      uploadId: upload.uploadId,
      chunkBytes: upload.chunkBytes,
      chunkCount: upload.chunks,
      maxBytes: IMPORT_SOURCE_MAX_BYTES,
    };
  },
});

const claimChunk = defineService({
  name: "imports.claimSourceChunk",
  orchestratedBy: "imports.uploadSourceChunk",
  summary: "Check one chunk of an import source upload before it is stored.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  input: z.object({
    id: z.string().uuid(),
    uploadId: z.string().uuid(),
    index: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    prefixSecret: z.string().max(8_192).optional(),
  }),
  output: z.object({ key: z.string(), received: z.number().int(), chunks: z.number().int(), alreadyReceived: z.boolean(), attemptId: z.uuid().nullable() }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!run) throw new ServiceError("not_found", "No such import run.");
    const upload = uploadOf(run.checkpoint);
    if (!upload || upload.uploadId !== input.uploadId || !sameUploader(upload, ctx.actor)) {
      throw new ServiceError("not_found", "That upload is not here.");
    }
    assertSourceStageable(run, true);
    if (Date.parse(upload.expiresAt) <= Date.now()) {
      throw new ServiceError("conflict", "That upload has expired. Start the upload again.");
    }
    if (input.index >= upload.chunks) throw new ServiceError("validation", "That chunk is not part of this upload.");
    if (input.size !== expectedChunkSize(upload, input.index)) {
      throw new ServiceError(
        "validation",
        `Chunk ${input.index} should be ${expectedChunkSize(upload, input.index)} bytes.`,
      );
    }
    ctx.setSubject("import_run", run.id);
    const prior = upload.digests[String(input.index)];
    if (prior && prior !== input.digest) throw new ServiceError("conflict", "This source chunk was already bound to different bytes. Start a new upload for a changed source.");
    if (upload.received.includes(input.index)) {
      if (!prior) throw new ServiceError("conflict", "This older upload has no verified chunk identity. Upload the source again.");
      return { key: partKey(upload, input.index), received: upload.received.length, chunks: upload.chunks, alreadyReceived: true, attemptId: null };
    }
    if (input.index === 0 && !sourceLooksRight(run.kind ?? "html", input.prefixSecret ?? "")) {
      throw new ServiceError(
        "validation",
        run.kind === "wordpress-wxr"
          ? "That file does not look like a WordPress export (.xml from Tools → Export)."
          : "That file does not look like the source this import was started for.",
      );
    }
    const key = partKey(upload, input.index);
    const writes = importSourceWrites(run.checkpoint);
    if (writes.length >= 100) throw new ServiceError("conflict", "This import has unresolved source writes. Wait for storage recovery before sending more chunks.");
    const attemptId = randomUUID();
    upload.digests[String(input.index)] = input.digest;
    writes.push({ attemptId, uploadId: input.uploadId, index: input.index, bytes: input.size, startedAt: new Date().toISOString() });
    await ctx.tx.update(importRuns).set({ checkpoint: { ...checkpointOf(run.checkpoint), sourceUpload: upload, sourceWrites: writes } }).where(eq(importRuns.id, run.id));
    await reservePendingMediaObject(ctx, { key, role: "staged", contentType: "application/octet-stream", bytes: input.size });
    return { key, received: upload.received.length, chunks: upload.chunks, alreadyReceived: false, attemptId };
  },
});

// Provider acknowledgement can arrive after the original reservation expired
// and was swept. Commit a fresh cleanup witness after every attempted PUT,
// including ambiguous errors, before a stale chunk is refused by recordChunk.
const rememberChunkWrite = defineService({
  name: "imports.rememberSourceWrite",
  orchestratedBy: "imports.uploadSourceChunk",
  summary: "Keep attempted source writes recoverable after provider I/O.",
  kind: "mutation", permission: "scoped", external: false,
  input: z.object({ id: z.uuid(), uploadId: z.uuid(), attemptId: z.uuid(), index: z.number().int().nonnegative().max(24), size: z.number().int().nonnegative().max(IMPORT_SOURCE_CHUNK_BYTES) }),
  output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    // The live parent already authorized and claimed these exact coordinates.
    // Never accept arbitrary object keys or a caller-supplied actor here.
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!run) throw new ServiceError("conflict", "The source write lost its durable import witness.");
    const writes = importSourceWrites(run.checkpoint);
    const attempt = writes.find(write => write.attemptId === input.attemptId);
    if (!attempt || attempt.uploadId !== input.uploadId || attempt.index !== input.index || attempt.bytes !== input.size) throw new ServiceError("conflict", "The source write no longer matches its original attempt.");
    const key = `imports/${input.id}/${input.uploadId}/${String(input.index).padStart(5, "0")}.part`;
    await reservePendingMediaObject(ctx, { key, role: "staged", contentType: "application/octet-stream", bytes: input.size });
    await ctx.queueJob("core.deleteCaptureObjects", { keys: [key] });
    await ctx.tx.update(importRuns).set({ checkpoint: { ...checkpointOf(run.checkpoint), sourceWrites: writes.filter(write => write.attemptId !== input.attemptId) } }).where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", input.id);
    return { ok: true as const };
  },
});

const recordChunk = defineService({
  name: "imports.recordSourceChunk",
  orchestratedBy: "imports.uploadSourceChunk",
  summary: "Record one stored chunk of an import source upload.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  input: z.object({
    id: z.string().uuid(),
    uploadId: z.string().uuid(),
    index: z.number().int().nonnegative(),
  }),
  output: z.object({ received: z.number().int(), chunks: z.number().int() }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx
      .select()
      .from(importRuns)
      .where(eq(importRuns.id, input.id))
      .limit(1)
      .for("update");
    if (!run) throw new ServiceError("not_found", "No such import run.");
    assertSourceStageable(run, true);
    const checkpoint = checkpointOf(run.checkpoint);
    const upload = uploadOf(checkpoint);
    if (!upload || upload.uploadId !== input.uploadId) {
      throw new ServiceError("conflict", "That upload was replaced while this chunk was being stored.");
    }
    if (Date.parse(upload.expiresAt) <= Date.now()) throw new ServiceError("conflict", "That upload expired while this chunk was being stored. Start the upload again.");
    const received = [...new Set([...upload.received, input.index])].sort((a, b) => a - b);
    await ctx.tx
      .update(importRuns)
      .set({ checkpoint: { ...checkpoint, sourceUpload: { ...upload, received } } })
      .where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { received: received.length, chunks: upload.chunks };
  },
});

export const uploadSourceChunk = defineOrchestratedService({
  name: "imports.uploadSourceChunk",
  summary: "Store one chunk of a reserved export file upload. The body is the raw bytes.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  // Raw bytes cannot travel as an MCP tool argument; agents with a small file
  // use imports.previewFromSource, and the chunk route serves everyone else.
  mcpExclude: true,
  rateLimit: {
    limit: 600,
    windowSeconds: 3600,
    message: "That is a lot of upload chunks in an hour. Wait a little and try again.",
    subject: (input) => input.id,
  },
  input: z.object({
    id: z.string().uuid(),
    uploadId: z.string().uuid(),
    index: z.number().int().nonnegative(),
    bytes: z.instanceof(Uint8Array),
  }),
  output: z.object({ received: z.number().int(), chunks: z.number().int(), complete: z.boolean() }),
  handler: async (input, actor) => {
    if (storage().isPublic) throw new ServiceError("conflict", "Import source files require private object storage. Configure private storage and retry.");
    const bytes = new Uint8Array(input.bytes);
    const prefix =
      input.index === 0
        ? new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4_096))
        : undefined;
    const claimed = await claimChunk.call(
      { id: input.id, uploadId: input.uploadId, index: input.index, size: bytes.byteLength, digest: createHash("sha256").update(bytes).digest("hex"), prefixSecret: prefix },
      actor,
    );
    if (claimed.alreadyReceived) return { received: claimed.received, chunks: claimed.chunks, complete: claimed.received === claimed.chunks };
    if (!claimed.attemptId) throw new ServiceError("internal", "The source write has no durable attempt.");
    try {
      await storage().put(claimed.key, bytes, "application/octet-stream");
    } finally {
      await rememberChunkWrite.call({ id: input.id, uploadId: input.uploadId, index: input.index, size: bytes.byteLength, attemptId: claimed.attemptId }, actor);
    }
    const recorded = await recordChunk.call({ id: input.id, uploadId: input.uploadId, index: input.index }, actor);
    return { ...recorded, complete: recorded.received === recorded.chunks };
  },
});

const uploadSource = defineService({
  name: "imports.sourceUploadState",
  orchestratedBy: "imports.previewFromUpload",
  summary: "The stored chunks of a finished import source upload, in order.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: z.object({ id: z.string().uuid(), uploadId: z.string().uuid() }),
  output: z.object({ kind: z.string(), origin: z.string(), keys: z.array(z.string()), bytes: z.number().int(), source: retainedImportSourceSchema }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!run) throw new ServiceError("not_found", "No such import run.");
    const upload = uploadOf(run.checkpoint);
    if (!upload || upload.uploadId !== input.uploadId || !sameUploader(upload, ctx.actor)) {
      throw new ServiceError("not_found", "That upload is not here.");
    }
    assertSourceStageable(run, true);
    if (upload.received.length !== upload.chunks) {
      throw new ServiceError(
        "conflict",
        `Only ${upload.received.length} of ${upload.chunks} chunks have arrived. Send the rest first.`,
      );
    }
    return { kind: run.kind ?? "html", origin: run.origin ?? "https://example.com", keys: allKeys(upload), bytes: upload.bytes, source: makeRetainedImportSource(run.id, upload) };
  },
});

const applyUploaded = defineService({
  name: "imports.applyUploadedPreview",
  orchestratedBy: "imports.previewFromUpload",
  summary: "Write the preview staged from an uploaded import source.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  input: z.object({
    id: z.string().uuid(),
    uploadId: z.string().uuid(),
    preview: z.record(z.string(), z.unknown()).optional(),
    counts: z.record(z.string(), z.number()).optional(),
    archivePreviewDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    error: z.string().max(2_000).optional(),
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
    assertSourceStageable(run, true);
    const checkpoint = checkpointOf(run.checkpoint);
    const upload = uploadOf(checkpoint);
    if (!upload || upload.uploadId !== input.uploadId) {
      throw new ServiceError("conflict", "That upload was replaced while it was being read.");
    }
    if (input.preview) await assertReaderUploadWindow(ctx.tx, input.preview, new Date(Date.parse(upload.expiresAt) - UPLOAD_TTL_MS));
    if (Date.parse(upload.expiresAt) <= Date.now()) throw new ServiceError("conflict", "That upload expired while it was being read. Start the upload again.");
    // Metadata and the retry task commit together. The fast deletion below
    // remains an optimization; an outage never forgets the source bytes.
    await ctx.queueJob("core.deleteCaptureObjects", { keys: allKeys(upload) });
    if (input.preview?.sourceFormat === "static-archive") {
      if (!input.archivePreviewDigest) throw new ServiceError("conflict", "The archive preview has no verified identity.");
      const source = makeRetainedImportSource(run.id, upload);
      checkpoint.retainedSource = source;
      checkpoint.archiveSource = { source, previewDigest: input.archivePreviewDigest };
    }
    delete checkpoint.sourceUpload;
    checkpoint.source = { filename: upload.filename, bytes: upload.bytes, stagedAt: new Date().toISOString() };
    await ctx.tx
      .update(importRuns)
      .set(
        input.preview && input.counts
          ? { status: "previewed", preview: await bindReaderSources(ctx.tx, input.preview), counts: input.counts, error: null, checkpoint }
          : { status: "failed", error: input.error ?? "That file could not be read.", checkpoint },
      )
      .where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { ok: true as const };
  },
});

/** A typed privacy refusal retires only its rejected raw upload, never assets. */
const releaseErasedUpload = defineService({
  name: "imports.releaseErasedSourceUpload", orchestratedBy: "imports.previewFromUpload",
  summary: "Release a rejected pre-erasure source upload for private cleanup.",
  kind: "mutation", permission: "scoped", external: false,
  input: z.object({ id: z.uuid(), uploadId: z.uuid() }), output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!run) throw new ServiceError("not_found", "No such import run.");
    assertSourceStageable(run, true);
    const checkpoint = checkpointOf(run.checkpoint), upload = uploadOf(checkpoint);
    if (!upload || upload.uploadId !== input.uploadId || !sameUploader(upload, ctx.actor)) throw new ServiceError("conflict", "The rejected source upload was replaced.");
    delete checkpoint.sourceUpload;
    await ctx.queueJob("core.deleteCaptureObjects", { keys: allKeys(upload) });
    await ctx.tx.update(importRuns).set({ checkpoint, status: "failed", error: new ReaderSourceErasureError().message }).where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { ok: true as const };
  },
});

/**
 * Read the stored chunks in order. A WXR export streams through the item
 * reader; the other sources are small by nature and are read whole, within
 * the importer's byte limit.
 */
async function stageStoredSource(
  state: { kind: string; origin: string; keys: string[]; source: RetainedImportSource },
): Promise<{ preview: Record<string, unknown>; counts: Record<string, number>; archivePreviewDigest?: string }> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const wxr = state.kind === "wordpress-wxr" ? wordpressExportBuilder() : undefined;
  const reader = wxr?.reader();
  let text = "";
  for (let index = 0; index < state.source.chunkDigests.length; index += 1) {
    const bytes = await readRetainedSourceChunk(state.source, index);
    let decoded: string;
    try {
      decoded = decoder.decode(bytes, { stream: true });
    } catch {
      throw new Error("That file is not UTF-8 text.");
    }
    if (reader) {
      reader.push(decoded);
    } else {
      text += decoded;
      if (text.length > DEFAULT_IMPORTER_LIMITS.maxBytes) {
        throw new Error(`This source is larger than ${DEFAULT_IMPORTER_LIMITS.maxBytes / 1024 / 1024} MB.`);
      }
    }
  }
  const tail = decoder.decode();
  if (reader && wxr) {
    reader.push(tail);
    reader.end();
    return stageWordpressExport(wxr.finish(), state.origin);
  }
  return stageImportSource(state.kind, text + tail, state.origin);
}

export const previewFromUpload = defineOrchestratedService({
  name: "imports.previewFromUpload",
  summary: "Stage a preview from an export file uploaded with imports.beginSourceUpload and its chunks.",
  rateLimit: {
    limit: 30,
    windowSeconds: 3600,
    message: "That import has read a lot of files in an hour. Wait a little and try again.",
    subject: (input) => input.id,
  },
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id: z.string().uuid(), uploadId: z.string().uuid() }),
  output: z.object({ id: uuid, status: z.string(), error: z.string().nullable(), counts: z.unknown() }),
  handler: async (input, actor) => {
    const state = await uploadSource.call(input, actor);
    try {
      const staged = await stageStoredSource(state);
      await applyUploaded.call({ ...input, preview: staged.preview, counts: staged.counts, archivePreviewDigest: staged.archivePreviewDigest }, actor);
      return { id: input.id, status: "previewed", error: null, counts: staged.counts };
    } catch (error) {
      if (error instanceof ReaderSourceErasureError) await releaseErasedUpload.call(input, actor);
      if (error instanceof ServiceError) throw error;
      const message = error instanceof Error ? error.message.slice(0, 2_000) : "That file could not be read.";
      await applyUploaded.call({ ...input, error: message }, actor);
      return { id: input.id, status: "failed", error: message, counts: {} };
    } finally {
      // The file was the owner's to hand over, not the platform's to keep.
      for (const key of state.keys) await deleteUnownedPendingObjects([key]).catch(() => undefined);
    }
  },
});

export default [
  beginApply,
  beginSourceUpload,
  claimChunk,
  recordChunk,
  rememberChunkWrite,
  uploadSourceChunk,
  uploadSource,
  applyUploaded,
  releaseErasedUpload,
  previewFromUpload,
];
