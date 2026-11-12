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
// Ordinary text previews release their chunks after staging. Static archives
// and durable source graphs retain their immutable originals until acceptance,
// cancellation or expiry; unknown writes and named holds keep their witnesses.
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
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
import { boundStorage } from "@/adapters/storage";
import { putWithReceipt } from "@/core/media/write-ledger";
import { deleteUnownedPendingObjects, reservePendingMediaObject } from "@/core/media/object-ledger";
import { IMPORT_SOURCE_MAX_BYTES, IMPORT_SOURCE_CHUNK_BYTES, importSourceObjectKeys, importSourceWrites, makeRetainedImportSource, readRetainedSourceChunk, releaseImportSources, retainedImportSourceSchema, retainedSourceChunkKey, retainedSourceFromRun, type RetainedImportSource } from "./retained-source";
export { IMPORT_SOURCE_MAX_BYTES, IMPORT_SOURCE_CHUNK_BYTES } from "./retained-source";
import { DEFAULT_IMPORTER_LIMITS, ImporterPhaseLimitError } from "./contract";
import sourceGraphServices, { claimWxrGraph, applyWxrIndex } from "./source-graph";
import { indexWxrPhase } from "./wxr-index";
import { importSourceRanges } from "./source-range";
import { markGraphRunWriter } from "./graph-writer";
import { importGraphVersionSchema } from "./graph-version";
import { assertCurrentImportAuthority } from "./authority";
import graphRebindServices, { beginGraphSourceRebind, claimSourceRebind, acceptSourceRebindChunk } from "./graph-rebind";
import { prepareSourceGraphPlan } from "./graph-plan";
import { releaseIndexRead } from "./graph-read-recovery";
import { approvedMediaOrigins, approvedMediaOriginsSchema } from "./media-origins";
import { stageImportSource, stageWordpressExport } from "./service";
import { assertSourceStageable } from "./source-lifecycle";
import { assertReaderUploadWindow, bindReaderSources, ReaderSourceErasureError } from "./privacy";
import { wordpressExportBuilder } from "./wordpress";
import { archivePreviewDigest, stageStaticArchive } from "./archive-plan";
import { archiveRangeSource } from "./archive-source";

/**
 * One export file. WordPress's own exporter has no size cap, and real WXR
 * files for a few hundred posts with comments run 5–60 MB; 100 MB leaves
 * headroom without inviting a multi-gigabyte upload. What the import then
 * reads in one phase is still bounded by 500 items and 20 MB of bodies.
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
  storageNamespace: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  uploaderIdentity: z.object({ kind: z.enum(["key", "user"]), id: z.uuid() }).optional(),
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
  if (kind === "archive") return prefix.startsWith("PK\u0003\u0004") || prefix.startsWith("PK\u0005\u0006");
  if (prefix.includes("\u0000")) return false;
  const start = prefix.replace(/^﻿/, "").trimStart();
  if (kind === "wordpress-rest") return start.startsWith("[") || start.startsWith("{");
  if (!start.startsWith("<")) return false;
  if (kind === "wordpress-wxr") return /<rss[\s>]|<channel[\s>]|wordpress\.org\/export/i.test(prefix);
  return true;
}

function sameUploader(upload: UploadRecord, actor: Actor): boolean {
  if (actor.kind === "system") return true;
  if (upload.uploaderIdentity) return (actor.kind === "agent" || actor.kind === "user") && (actor.keyId ? upload.uploaderIdentity.kind === "key" && upload.uploaderIdentity.id === actor.keyId : actor.kind === "user" && upload.uploaderIdentity.kind === "user" && upload.uploaderIdentity.id === actor.userId);
  // Legacy names cannot prove which live API credential supplied the bytes.
  if ((actor.kind === "agent" || actor.kind === "user") && actor.keyId) return false;
  return upload.createdBy === actorString(actor);
}

type SourceRun = typeof importRuns.$inferSelect;
function archiveRebinding(run: SourceRun): boolean {
  if (run.kind !== "archive" || !["previewed", "failed"].includes(run.status)) return false;
  const checkpoint = checkpointOf(run.checkpoint);
  if (!["media", "mediaClaims"].some(key => Array.isArray(checkpoint[key]) && checkpoint[key].length > 0)) return false;
  if (["createdPageIds", "replacedPages", "pageIds", "redirectIds", "displacedRedirects", "postSnapshots", "pendingBlogPosts"].some(key => checkpoint[key] !== undefined && (!Array.isArray(checkpoint[key]) || checkpoint[key].length > 0)) || checkpoint.navApplied || checkpoint.blogIndexPageId) return false;
  const source = retainedSourceFromRun(run);
  const binding = z.object({ source: retainedImportSourceSchema, previewDigest: z.string() }).safeParse(checkpoint.archiveSource);
  return Boolean(source && binding.success && source.runId === run.id && archivePreviewDigest(source) === archivePreviewDigest(binding.data.source) && binding.data.previewDigest === archivePreviewDigest(run.preview));
}
function assertSourceUploadStageable(run: SourceRun, currentGraphUpload = false): void {
  if (checkpointOf(run.checkpoint).sourceGraph) {
    if (!currentGraphUpload || !["discover", "previewed"].includes(run.status)) throw new ServiceError("conflict", "This import owns a source graph. Resume or roll it back before choosing another source.");
    return;
  }
  if (!archiveRebinding(run)) assertSourceStageable(run, true);
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
    graph: importGraphVersionSchema.optional(),
    storageNamespace: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  output: z.object({ upload: uploadRecord, previousKeys: z.array(z.string()) }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
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
    await markGraphRunWriter(ctx.tx, run);
    const checkpoint = checkpointOf(run.checkpoint);
    const graphRebind = checkpoint.sourceGraph ? await beginGraphSourceRebind(ctx, run, input.graph, input.bytes) : null;
    const rebind = archiveRebinding(run) || Boolean(graphRebind);
    assertSourceUploadStageable(run, Boolean(graphRebind));
    if (!rebind && Array.isArray(checkpoint.media) && checkpoint.media.length > 0) {
      throw new ServiceError("conflict", "Files from this import were already fetched. Roll it back before staging another export.");
    }
    const previous = uploadOf(checkpoint);
    const retained = retainedSourceFromRun(run);
    const previousKeys = rebind ? previous && previous.uploadId !== retained?.uploadId ? allKeys(previous) : [] : [...new Set([...importSourceObjectKeys(run), ...(previous ? allKeys(previous) : [])])];
    if (!rebind) {
      await releaseImportSources(ctx, run, checkpoint);
      delete checkpoint.archiveSource;
    }
    const uploadId = randomUUID();
    const upload: UploadRecord = {
      uploadId,
      storageNamespace: input.storageNamespace,
      filename: input.filename,
      bytes: input.bytes,
      chunkBytes: IMPORT_SOURCE_CHUNK_BYTES,
      chunks: Math.ceil(input.bytes / IMPORT_SOURCE_CHUNK_BYTES),
      received: [],
      digests: {},
      keyPrefix: `imports/${run.id}/${uploadId}`,
      createdBy: actorString(ctx.actor),
      ...((ctx.actor.kind === "agent" || ctx.actor.kind === "user") && ctx.actor.keyId ? { uploaderIdentity: { kind: "key" as const, id: ctx.actor.keyId } } : ctx.actor.kind === "user" ? { uploaderIdentity: { kind: "user" as const, id: ctx.actor.userId } } : {}),
      expiresAt: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
    };
    // Every fresh reservation has guarded pre-I/O ownership, including chunks
    // never sent. A missing physical intent can then prove no PUT was admitted.
    for (let index = 0; index < upload.chunks; index++) await reservePendingMediaObject(ctx, { key: partKey(upload, index), role: "staged", contentType: "application/octet-stream", bytes: expectedChunkSize(upload, index) });
    // Reserve cleanup before the first provider write. Abandoned uploads and
    // lost acknowledgements still have an exact durable deletion task.
    await ctx.queueJob("core.deleteCaptureObjects", { keys: allKeys(upload) }, { startAfter: new Date(upload.expiresAt) });
    if (previousKeys.length) await ctx.queueJob("core.deleteCaptureObjects", { keys: previousKeys });
    await ctx.tx
      .update(importRuns)
      .set({ checkpoint: { ...checkpoint, ...(graphRebind ? { sourceGraphRebind: graphRebind } : {}), sourceUpload: upload } })
      .where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { upload, previousKeys };
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
    graph: importGraphVersionSchema.optional(),
  }),
  output: z.object({
    uploadId: uuid,
    chunkBytes: z.number().int(),
    chunkCount: z.number().int(),
    maxBytes: z.number().int(),
  }),
  handler: async (input, actor) => {
    const captured = await boundStorage();
    if (captured.store.isPublic) throw new ServiceError("conflict", "Import source files require private object storage. Configure private storage and retry.");
    const { upload, previousKeys } = await beginApply.call({ ...input, storageNamespace: captured.binding.namespace }, actor);
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
    storageNamespace: z.string().regex(/^[a-f0-9]{64}$/),
    id: z.string().uuid(),
    uploadId: z.string().uuid(),
    index: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    // Samples can contain private text or binary NUL. Existing audit
    // redaction excludes secret fields while retaining IDs/size/digest.
    prefixSecret: z.string().max(8_192).optional(),
  }),
  output: z.object({ key: z.string(), received: z.number().int(), chunks: z.number().int(), alreadyReceived: z.boolean(), attemptId: z.uuid().nullable() }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!run) throw new ServiceError("not_found", "No such import run.");
    await markGraphRunWriter(ctx.tx, run);
    if (checkpointOf(run.checkpoint).sourceGraph) await assertCurrentImportAuthority(ctx, "imports.uploadSourceChunk");
    const upload = uploadOf(run.checkpoint);
    if (!upload || upload.uploadId !== input.uploadId || !sameUploader(upload, ctx.actor)) {
      throw new ServiceError("not_found", "That upload is not here.");
    }
    if (!upload.storageNamespace || upload.storageNamespace !== input.storageNamespace) throw new ServiceError("conflict", "Restore the original private storage resource, or start a new source upload for this resource.");
    assertSourceUploadStageable(run, true);
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
    if (writes.some(write => write.uploadId === input.uploadId && write.index === input.index)) throw new ServiceError("conflict", "This original chunk already has an unresolved storage write. Wait for its actual outcome before retrying.");
    if (writes.length >= 100) throw new ServiceError("conflict", "This import has unresolved source writes. Wait for storage recovery before sending more chunks.");
    const attemptId = randomUUID();
    upload.digests[String(input.index)] = input.digest;
    writes.push({ state: "running", attemptId, uploadId: input.uploadId, index: input.index, bytes: input.size, startedAt: new Date().toISOString() });
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
  input: z.object({ id: z.uuid(), uploadId: z.uuid(), attemptId: z.uuid(), settled: z.boolean(), index: z.number().int().nonnegative().max(24), size: z.number().int().nonnegative().max(IMPORT_SOURCE_CHUNK_BYTES) }),
  output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    // The live parent already authorized and claimed these exact coordinates.
    // Never accept arbitrary object keys or a caller-supplied actor here.
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!run) throw new ServiceError("conflict", "The source write lost its durable import witness.");
    await markGraphRunWriter(ctx.tx, run);
    const writes = importSourceWrites(run.checkpoint);
    const attempt = writes.find(write => write.attemptId === input.attemptId);
    if (!attempt || attempt.uploadId !== input.uploadId || attempt.index !== input.index || attempt.bytes !== input.size) throw new ServiceError("conflict", "The source write no longer matches its original attempt.");
    const key = `imports/${input.id}/${input.uploadId}/${String(input.index).padStart(5, "0")}.part`;
    await reservePendingMediaObject(ctx, { key, role: "staged", contentType: "application/octet-stream", bytes: input.size });
    await ctx.queueJob("core.deleteCaptureObjects", { keys: [key] });
    await ctx.tx.update(importRuns).set({ checkpoint: { ...checkpointOf(run.checkpoint), sourceWrites: input.settled ? writes.filter(write => write.attemptId !== input.attemptId) : writes.map(write => write.attemptId === input.attemptId ? { ...write, state: "unknown" as const } : write) } }).where(eq(importRuns.id, run.id));
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
    await markGraphRunWriter(ctx.tx, run);
    assertSourceUploadStageable(run, true);
    if (checkpointOf(run.checkpoint).sourceGraph) await assertCurrentImportAuthority(ctx, "imports.uploadSourceChunk");
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
    const captured = await boundStorage();
    if (captured.store.isPublic) throw new ServiceError("conflict", "Import source files require private object storage. Configure private storage and retry.");
    const bytes = new Uint8Array(input.bytes);
    const prefix =
      input.index === 0
        ? new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4_096))
        : undefined;
    const claimed = await claimChunk.call(
      { storageNamespace: captured.binding.namespace, id: input.id, uploadId: input.uploadId, index: input.index, size: bytes.byteLength, digest: createHash("sha256").update(bytes).digest("hex"), prefixSecret: prefix },
      actor,
    );
    if (claimed.alreadyReceived) return { received: claimed.received, chunks: claimed.chunks, complete: claimed.received === claimed.chunks };
    if (!claimed.attemptId) throw new ServiceError("internal", "The source write has no durable attempt.");
    let settled = false;
    try {
      await putWithReceipt({ key: claimed.key, body: bytes, contentType: "application/octet-stream", role: "staged", requiresReservation: true }, actor, captured);
      settled = true;
    } finally {
      await rememberChunkWrite.call({ id: input.id, uploadId: input.uploadId, index: input.index, size: bytes.byteLength, attemptId: claimed.attemptId, settled }, actor);
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
  output: z.object({ kind: z.string(), origin: z.string(), keys: z.array(z.string()), bytes: z.number().int(), source: retainedImportSourceSchema, approvedMediaOrigins: approvedMediaOriginsSchema, hasSourceGraph: z.boolean(), rebindSourceGraph: z.boolean() }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!run) throw new ServiceError("not_found", "No such import run.");
    const upload = uploadOf(run.checkpoint);
    if (!upload || upload.uploadId !== input.uploadId || !sameUploader(upload, ctx.actor)) {
      throw new ServiceError("not_found", "That upload is not here.");
    }
    assertSourceUploadStageable(run, true);
    if (upload.received.length !== upload.chunks) {
      throw new ServiceError(
        "conflict",
        `Only ${upload.received.length} of ${upload.chunks} chunks have arrived. Send the rest first.`,
      );
    }
    return { kind: run.kind ?? "html", origin: run.origin ?? "https://example.com", keys: allKeys(upload), bytes: upload.bytes, source: makeRetainedImportSource(run.id, upload), approvedMediaOrigins: approvedMediaOrigins(run.checkpoint), hasSourceGraph: Boolean(checkpointOf(run.checkpoint).sourceGraph), rebindSourceGraph: Boolean(checkpointOf(run.checkpoint).sourceGraphRebind) };
  },
});

const applyUploaded = defineService({
  name: "imports.applyUploadedPreview",
  auditInputFields: ["id", "uploadId", "counts", "archivePreviewDigest"],
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
    await markGraphRunWriter(ctx.tx, run);
    const rebind = archiveRebinding(run);
    assertSourceUploadStageable(run);
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
      if (!input.archivePreviewDigest || input.archivePreviewDigest !== archivePreviewDigest(input.preview)) throw new ServiceError("conflict", "The archive preview has no verified identity.");
      const source = makeRetainedImportSource(run.id, upload);
      if (rebind) {
        const previousSource = retainedSourceFromRun(run)!;
        const binding = z.object({ previewDigest: z.string() }).parse(checkpoint.archiveSource);
        if (source.revision !== previousSource.revision || input.archivePreviewDigest !== binding.previewDigest) throw new ServiceError("conflict", "Use the original ZIP to resume this import. A changed source needs a new run.");
        await ctx.queueJob("core.deleteCaptureObjects", { keys: previousSource.chunkDigests.map((_, index) => retainedSourceChunkKey(previousSource, index)) });
      }
      checkpoint.retainedSource = source;
      checkpoint.archiveSource = { source, previewDigest: input.archivePreviewDigest };
    } else if (rebind) {
      throw new ServiceError("validation", input.error ?? "Use the original ZIP to resume this import.");
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
    await markGraphRunWriter(ctx.tx, run);
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
  state: { kind: string; origin: string; keys: string[]; source: RetainedImportSource; approvedMediaOrigins: string[] },
): Promise<{ preview: Record<string, unknown>; counts: Record<string, number>; archivePreviewDigest?: string }> {
  if (state.kind === "archive") {
    const staged = await stageStaticArchive(archiveRangeSource(state.source, index => readRetainedSourceChunk(state.source, index)), state.origin);
    return { ...staged, archivePreviewDigest: archivePreviewDigest(staged.preview) };
  }
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
  return stageImportSource(state.kind, text + tail, state.origin, "", state.approvedMediaOrigins);
}

export const previewFromUpload = defineOrchestratedService({
  name: "imports.previewFromUpload",
  summary: "Stage a preview from an export file uploaded with imports.beginSourceUpload and its chunks.",
  rateLimit: {
    // A complete source can need 20 index phases plus 25 restore reads.
    // Each remains bounded; the ordinary one-shot rate no longer fits it.
    limit: 120,
    windowSeconds: 3600,
    message: "That import has read a lot of files in an hour. Wait a little and try again.",
    subject: (input) => input.id,
  },
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id: z.string().uuid(), uploadId: z.string().uuid() }),
  output: z.object({ id: uuid, status: z.string(), error: z.string().nullable(), counts: z.unknown(), graph: importGraphVersionSchema.optional(), sourceRestored: z.boolean().optional() }),
  handler: async (input, actor) => {
    const state = await uploadSource.call(input, actor);
    try {
      if (state.rebindSourceGraph) {
        const claimed = await claimSourceRebind.call(input, actor);
        let accepted;
        try {
          await readRetainedSourceChunk(claimed.source, claimed.index);
          accepted = await acceptSourceRebindChunk.call({ ...input, ...claimed }, actor);
        } catch (error) { await releaseIndexRead.call({ id: input.id, generation: claimed.generation, leaseToken: claimed.leaseToken }, actor).catch(() => undefined); throw error; }
        if (accepted.sourceRestored && accepted.status === "previewed") return { ...await prepareSourceGraphPlan.call({ id: input.id, version: accepted.graph }, actor), sourceRestored: true };
        return accepted;
      }
      if (state.hasSourceGraph) {
        const claimed = await claimWxrGraph.call(input, actor);
        if (!claimed.leaseToken) throw new ServiceError("internal", "The source phase has no lease.");
        try {
          const indexed = await indexWxrPhase(importSourceRanges(claimed.source, index => readRetainedSourceChunk(claimed.source, index)), claimed.cursor, state.origin);
          const accepted = await applyWxrIndex.call({ ...input, graphId: claimed.graphId, generation: claimed.generation, leaseToken: claimed.leaseToken, source: claimed.source, previous: claimed.cursor, ...indexed }, actor);
          return indexed.done ? await prepareSourceGraphPlan.call({ id: input.id, version: accepted.graph }, actor) : accepted;
        } catch (error) { await releaseIndexRead.call({ id: input.id, graphId: claimed.graphId, generation: claimed.generation, leaseToken: claimed.leaseToken }, actor).catch(() => undefined); throw error; }
      }
      const staged = await stageStoredSource(state);
      await applyUploaded.call({ ...input, preview: staged.preview, counts: staged.counts, archivePreviewDigest: staged.archivePreviewDigest }, actor);
      return { id: input.id, status: "previewed", error: null, counts: staged.counts };
    } catch (error) {
      if (state.kind === "wordpress-wxr" && error instanceof ImporterPhaseLimitError && ["pages", "bytes"].includes(error.limit)) {
        const claimed = await claimWxrGraph.call({ ...input, initialize: true }, actor);
        return { id: input.id, status: "discover", error: null, counts: { indexed: 0 }, graph: { generation: claimed.generation, sourceRevision: claimed.source.revision, planRevision: claimed.planRevision } };
      }
      // An indexed source remains resumable on a failed read or candidate
      // apply; the ordinary preview failure path must not release its bytes.
      if (state.hasSourceGraph) throw error;
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
  ...sourceGraphServices,
  ...graphRebindServices,
  prepareSourceGraphPlan,
  releaseIndexRead,
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
