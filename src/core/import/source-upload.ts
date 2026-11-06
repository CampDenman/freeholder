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
import { randomUUID } from "node:crypto";
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
import { DEFAULT_IMPORTER_LIMITS } from "./contract";
import { stageImportSource, stageWordpressExport } from "./service";
import { wordpressExportBuilder } from "./wordpress";

/**
 * One export file. WordPress's own exporter has no size cap, and real WXR
 * files for a few hundred posts with comments run 5–60 MB; 100 MB leaves
 * headroom without inviting a multi-gigabyte upload. What the import then
 * keeps is still bounded by the importer limits (500 items, 20 MB of bodies).
 */
export const IMPORT_SOURCE_MAX_BYTES = 100 * 1024 * 1024;
/** Under the request proxy's 10 MB buffer, with room to spare. */
export const IMPORT_SOURCE_CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const STAGEABLE = new Set(["discover", "mapped", "previewed", "failed"]);

const uploadRecord = z.object({
  uploadId: z.string().uuid(),
  filename: z.string(),
  bytes: z.number().int().positive(),
  chunkBytes: z.number().int().positive(),
  chunks: z.number().int().positive(),
  received: z.array(z.number().int().nonnegative()),
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
    if (!STAGEABLE.has(run.status)) {
      throw new ServiceError("conflict", "This import has already been committed. Start a new import for another file.");
    }
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
      keyPrefix: `imports/${run.id}/${uploadId}`,
      createdBy: actorString(ctx.actor),
      expiresAt: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
    };
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
    const { upload, previousKeys } = await beginApply.call(input, actor);
    // A replaced, unfinished upload leaves nothing behind.
    for (const key of previousKeys) await storage().delete(key).catch(() => undefined);
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
  summary: "Check one chunk of an import source upload before it is stored.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: z.object({
    id: z.string().uuid(),
    uploadId: z.string().uuid(),
    index: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    prefix: z.string().max(8_192).optional(),
  }),
  output: z.object({ key: z.string() }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!run) throw new ServiceError("not_found", "No such import run.");
    const upload = uploadOf(run.checkpoint);
    if (!upload || upload.uploadId !== input.uploadId || !sameUploader(upload, ctx.actor)) {
      throw new ServiceError("not_found", "That upload is not here.");
    }
    if (!STAGEABLE.has(run.status)) throw new ServiceError("conflict", "This import is no longer accepting a file.");
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
    if (input.index === 0 && !sourceLooksRight(run.kind ?? "html", input.prefix ?? "")) {
      throw new ServiceError(
        "validation",
        run.kind === "wordpress-wxr"
          ? "That file does not look like a WordPress export (.xml from Tools → Export)."
          : "That file does not look like the source this import was started for.",
      );
    }
    return { key: partKey(upload, input.index) };
  },
});

const recordChunk = defineService({
  name: "imports.recordSourceChunk",
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
    const checkpoint = checkpointOf(run.checkpoint);
    const upload = uploadOf(checkpoint);
    if (!upload || upload.uploadId !== input.uploadId) {
      throw new ServiceError("conflict", "That upload was replaced while this chunk was being stored.");
    }
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
    const prefix =
      input.index === 0
        ? new TextDecoder("utf-8", { fatal: false }).decode(input.bytes.subarray(0, 4_096))
        : undefined;
    const { key } = await claimChunk.call(
      { id: input.id, uploadId: input.uploadId, index: input.index, size: input.bytes.byteLength, prefix },
      actor,
    );
    await storage().put(key, new Uint8Array(input.bytes), "application/octet-stream");
    const recorded = await recordChunk.call({ id: input.id, uploadId: input.uploadId, index: input.index }, actor);
    return { ...recorded, complete: recorded.received === recorded.chunks };
  },
});

const uploadSource = defineService({
  name: "imports.sourceUploadState",
  summary: "The stored chunks of a finished import source upload, in order.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: z.object({ id: z.string().uuid(), uploadId: z.string().uuid() }),
  output: z.object({ kind: z.string(), origin: z.string(), keys: z.array(z.string()), bytes: z.number().int() }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!run) throw new ServiceError("not_found", "No such import run.");
    const upload = uploadOf(run.checkpoint);
    if (!upload || upload.uploadId !== input.uploadId || !sameUploader(upload, ctx.actor)) {
      throw new ServiceError("not_found", "That upload is not here.");
    }
    if (!STAGEABLE.has(run.status)) throw new ServiceError("conflict", "This import is no longer accepting a file.");
    if (upload.received.length !== upload.chunks) {
      throw new ServiceError(
        "conflict",
        `Only ${upload.received.length} of ${upload.chunks} chunks have arrived. Send the rest first.`,
      );
    }
    return { kind: run.kind ?? "html", origin: run.origin ?? "https://example.com", keys: allKeys(upload), bytes: upload.bytes };
  },
});

const applyUploaded = defineService({
  name: "imports.applyUploadedPreview",
  summary: "Write the preview staged from an uploaded import source.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  input: z.object({
    id: z.string().uuid(),
    uploadId: z.string().uuid(),
    preview: z.record(z.string(), z.unknown()).optional(),
    counts: z.record(z.string(), z.number()).optional(),
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
    const checkpoint = checkpointOf(run.checkpoint);
    const upload = uploadOf(checkpoint);
    if (!upload || upload.uploadId !== input.uploadId) {
      throw new ServiceError("conflict", "That upload was replaced while it was being read.");
    }
    delete checkpoint.sourceUpload;
    checkpoint.source = { filename: upload.filename, bytes: upload.bytes, stagedAt: new Date().toISOString() };
    await ctx.tx
      .update(importRuns)
      .set(
        input.preview && input.counts
          ? { status: "previewed", preview: input.preview, counts: input.counts, error: null, checkpoint }
          : { status: "failed", error: input.error ?? "That file could not be read.", checkpoint },
      )
      .where(eq(importRuns.id, run.id));
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
  state: { kind: string; origin: string; keys: string[] },
): Promise<{ preview: Record<string, unknown>; counts: Record<string, number> }> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const wxr = state.kind === "wordpress-wxr" ? wordpressExportBuilder() : undefined;
  const reader = wxr?.reader();
  let text = "";
  for (const key of state.keys) {
    const bytes = await storage().get(key);
    if (!bytes) throw new Error("Part of the uploaded file is missing. Upload it again.");
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
      await applyUploaded.call({ ...input, preview: staged.preview, counts: staged.counts }, actor);
      return { id: input.id, status: "previewed", error: null, counts: staged.counts };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      const message = error instanceof Error ? error.message.slice(0, 2_000) : "That file could not be read.";
      await applyUploaded.call({ ...input, error: message }, actor);
      return { id: input.id, status: "failed", error: message, counts: {} };
    } finally {
      // The file was the owner's to hand over, not the platform's to keep.
      for (const key of state.keys) await storage().delete(key).catch(() => undefined);
    }
  },
});

export default [
  beginApply,
  beginSourceUpload,
  claimChunk,
  recordChunk,
  uploadSourceChunk,
  uploadSource,
  applyUploaded,
  previewFromUpload,
];
