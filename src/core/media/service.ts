// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Media services (MASTER.md §3 core/media, §4.5, §18).
//
// The only door to the asset library. Uploading writes bytes to the storage
// adapter and a row to the database, in that order and deliberately: an object
// with no row is litter a sweep can find, whereas a row with no object is a
// broken image on a customer's screen.
import { z } from "zod";
import { and, count, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/core/db";
import {
  assets,
  mediaAltTextSuggestions,
  mediaObjects,
  mediaUploads,
} from "@/core/media/schema";
import {
  actorString,
  defineService,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { storage } from "@/adapters/storage";
import {
  storageKey,
  type MultipartPart,
} from "@/adapters/storage/types";
import { malwareScanner, type MalwareScanResult } from "@/adapters/malware";
import {
  altTextSuggester,
  AltTextSuggestionError,
} from "@/adapters/alt-text";
import {
  expectedKind,
  MEDIA_LIMITS,
  MediaValidationError,
  PROXY_UPLOAD_LIMIT,
  SIGNATURE_BYTES,
  mediaSignatureSample,
  validateMediaFile,
  type MediaKind,
} from "@/core/media/validation";
import captureServices from "./capture";
import {
  buildRenditions,
  readImageFacts,
  toVariantSet,
  type Rendition,
  type VariantFormat,
  type VariantSet,
} from "@/core/media/variants";

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;
const LEGACY_MAX_BYTES = 2_147_483_647;
const ALT_TEXT_PROMPT_VERSION = "accessible-image-v1";

const sourceSchema = z.enum(["upload", "import", "generated", "migration", "capture"]);
const provenanceSchema = z
  .object({
    sourceUrl: z.string().url().max(2_048).optional(),
    capturedAt: z.string().datetime().optional(),
    lastModifiedAt: z.string().datetime().optional(),
    note: z.string().trim().max(500).optional(),
    captureToken: z.string().trim().min(16).max(128).optional(),
    captureSessionId: z.string().uuid().optional(),
  })
  .default({});
const mediaMetadataSchema = z
  .object({
    width: z.number().int().positive().max(100_000).optional(),
    height: z.number().int().positive().max(100_000).optional(),
    durationSeconds: z.number().int().nonnegative().max(31_536_000).optional(),
    pageCount: z.number().int().positive().max(1_000_000).optional(),
    codec: z.string().trim().max(100).optional(),
    trimStartMs: z.number().int().min(0).max(31_536_000_000).optional(),
    trimEndMs: z.number().int().min(0).max(31_536_000_000).optional(),
  })
  .default({});

function serviceValidation(error: unknown): never {
  if (error instanceof MediaValidationError) {
    throw new ServiceError("validation", error.message);
  }
  throw error;
}

function userOwnsUpload(actor: Actor, uploadedBy: string | null): boolean {
  return actor.kind === "system" ||
    (actor.kind === "user" &&
      (actor.role === "owner" || actorString(actor) === uploadedBy));
}

function requireUploadAccess(actor: Actor, uploadedBy: string | null): void {
  if (actor.kind === "anonymous" && uploadedBy?.startsWith("capture:")) return;
  if (!userOwnsUpload(actor, uploadedBy)) {
    throw new ServiceError("not_found", "That upload is not here.");
  }
}

async function trackPendingObject(input: {
  key: string;
  contentType: string;
  role: "original" | "variant" | "staged";
  bytes?: number;
  uploadId?: string;
}): Promise<void> {
  await db()
    .insert(mediaObjects)
    .values({
      key: input.key,
      contentType: input.contentType,
      role: input.role,
      bytes: input.bytes,
      uploadId: input.uploadId,
      state: "pending",
    })
    .onConflictDoUpdate({
      target: mediaObjects.key,
      set: {
        contentType: input.contentType,
        role: input.role,
        bytes: input.bytes,
        uploadId: input.uploadId,
        state: "pending",
        assetId: null,
        updatedAt: new Date(),
      },
    });
}

async function putTrackedObject(input: {
  key: string;
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
  role: "original" | "variant";
  uploadId?: string;
}): Promise<void> {
  await trackPendingObject({ ...input, bytes: input.body.byteLength });
  try {
    await storage().put(input.key, input.body, input.contentType);
  } catch (error) {
    await db().delete(mediaObjects).where(eq(mediaObjects.key, input.key));
    throw error;
  }
}

async function putTrackedObjects(
  inputs: Array<{
    key: string;
    body: Uint8Array<ArrayBuffer>;
    contentType: string;
    role: "variant";
    uploadId?: string;
  }>,
): Promise<void> {
  if (inputs.length === 0) return;
  const keys = inputs.map((input) => input.key);
  await db()
    .insert(mediaObjects)
    .values(
      inputs.map((input) => ({
        key: input.key,
        contentType: input.contentType,
        role: input.role,
        bytes: input.body.byteLength,
        uploadId: input.uploadId,
        state: "pending" as const,
      })),
    )
    .onConflictDoNothing();
  try {
    await Promise.all(
      inputs.map((input) =>
        storage().put(input.key, input.body, input.contentType),
      ),
    );
  } catch (error) {
    await db().delete(mediaObjects).where(inArray(mediaObjects.key, keys));
    throw error;
  }
}

async function attachObjects(
  tx: Tx,
  keys: string[],
  assetId: string,
): Promise<void> {
  if (keys.length === 0) return;
  await tx
    .update(mediaObjects)
    .set({ assetId, state: "attached", updatedAt: new Date() })
    .where(inArray(mediaObjects.key, keys));
}

async function sha256Stream(
  body: AsyncIterable<Uint8Array<ArrayBuffer>>,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of body) hash.update(chunk);
  return hash.digest("hex");
}

async function scanStoredAndHash(
  key: string,
  filename: string,
  contentType: string,
  bytes: number,
): Promise<{ scan: MalwareScanResult; checksumSha256: string }> {
  const source = await storage().stream(key);
  if (!source) throw new Error(`storage: ${key} disappeared before scanning`);
  const scanner = malwareScanner();
  if (scanner.id === "none") {
    const scan = await scanner.scan({ filename, contentType, bytes, body: source });
    return { scan, checksumSha256: await sha256Stream(source) };
  }

  const hash = createHash("sha256");
  let hashedBytes = 0;
  const hashingBody = (async function* () {
    for await (const chunk of source) {
      hash.update(chunk);
      hashedBytes += chunk.byteLength;
      yield chunk;
    }
  })();
  const scan = await scanner.scan({
    filename,
    contentType,
    bytes,
    body: hashingBody,
  });
  if (hashedBytes === bytes) {
    return { scan, checksumSha256: hash.digest("hex") };
  }
  // A scanner can fail before consuming the stream. Quarantine truth and the
  // original's digest are independent, so finish the digest with a fresh read.
  const retry = await storage().stream(key);
  if (!retry) throw new Error(`storage: ${key} disappeared before hashing`);
  return { scan, checksumSha256: await sha256Stream(retry) };
}

function bodyOnce(bytes: Uint8Array<ArrayBuffer>) {
  return (async function* () {
    yield bytes;
  })();
}

async function scanBytes(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  contentType: string,
): Promise<MalwareScanResult> {
  return malwareScanner().scan({
    filename,
    contentType,
    bytes: bytes.byteLength,
    body: bodyOnce(bytes),
  });
}

async function scanStored(
  key: string,
  filename: string,
  contentType: string,
  bytes: number,
): Promise<MalwareScanResult> {
  const body = await storage().stream(key);
  if (!body) throw new Error(`storage: ${key} disappeared before scanning`);
  return malwareScanner().scan({ filename, contentType, bytes, body });
}

function scanFields(scan: MalwareScanResult) {
  return {
    scanStatus: scan.status,
    scanEngine: scan.engine,
    scanMessage: scan.message ?? null,
    scannedAt: scan.status === "not_configured" ? null : new Date(),
    status:
      scan.status === "infected" || scan.status === "error"
        ? ("quarantined" as const)
        : ("ready" as const),
  };
}

function safeProvenance(
  ctx: ServiceContext,
  source: z.output<typeof sourceSchema>,
  supplied: z.output<typeof provenanceSchema>,
  method: "proxy" | "direct_multipart",
) {
  return {
    ...supplied,
    source,
    method,
    introducedBy: actorString(ctx.actor),
    receivedAt: new Date().toISOString(),
  };
}

interface CreateAssetInput {
  filename: string;
  mime: string;
  kind: MediaKind;
  bytes: number;
  body?: Uint8Array<ArrayBuffer>;
  key: string;
  altText?: string;
  source: z.output<typeof sourceSchema>;
  provenance: Record<string, unknown>;
  metadata: z.output<typeof mediaMetadataSchema>;
  scan: MalwareScanResult;
  checksumSha256: string;
  uploadId?: string;
}

async function createAssetFromStoredOriginal(
  input: CreateAssetInput,
  ctx: ServiceContext,
) {
  let facts: Awaited<ReturnType<typeof readImageFacts>>;
  let variants: VariantSet = {};
  const trackedKeys = [input.key];
  const scan = scanFields(input.scan);

  if (input.kind === "image" && scan.status === "ready") {
    const body = input.body ?? (await storage().get(input.key));
    if (!body) throw new Error(`storage: ${input.key} disappeared during processing`);
    facts = await readImageFacts(body);
    if (!facts) {
      throw new MediaValidationError(
        "The image signature is recognized, but the image data is damaged.",
      );
    }
    const built = await buildRenditions(body, facts, (format, width) =>
      `${input.key}.${width}.${format}`,
    );
    await putTrackedObjects(
      built.map((rendition) => ({
        key: rendition.key,
        body: rendition.body,
        contentType: rendition.contentType,
        role: "variant" as const,
        uploadId: input.uploadId,
      })),
    );
    trackedKeys.push(...built.map((rendition) => rendition.key));
    variants = toVariantSet(built);
  }

  const [asset] = await ctx.tx
    .insert(assets)
    .values({
      kind: input.kind,
      storageKey: input.key,
      filename: input.filename,
      mime: input.mime,
      bytes: input.bytes,
      legacyBytes: Math.min(input.bytes, LEGACY_MAX_BYTES),
      width: facts?.width ?? input.metadata.width,
      height: facts?.height ?? input.metadata.height,
      durationSeconds: input.metadata.durationSeconds,
      variants,
      altText: input.altText,
      checksumSha256: input.checksumSha256,
      metadata: input.metadata,
      provenance: input.provenance,
      source: input.source,
      uploadedBy: actorString(ctx.actor),
      ...scan,
    })
    .returning();
  await ctx.tx
    .update(mediaObjects)
    .set({
      role: "original",
      bytes: input.bytes,
      contentType: input.mime,
      updatedAt: new Date(),
    })
    .where(eq(mediaObjects.key, input.key));
  await attachObjects(ctx.tx, trackedKeys, asset!.id);
  if (input.uploadId) {
    await ctx.tx
      .update(mediaUploads)
      .set({
        state: "complete",
        assetId: asset!.id,
        detectedMime: input.mime,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mediaUploads.id, input.uploadId));
  }

  ctx.setSubject("asset", asset!.id);
  ctx.queueEvent("media.uploaded", {
    assetId: asset!.id,
    kind: asset!.kind,
    scanStatus: asset!.scanStatus,
  });
  return asset!;
}

export const uploadAsset = defineService({
  name: "media.upload",
  summary: "Validate and store a bounded proxied upload.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    bytes: z.instanceof(Uint8Array),
    altText: z.string().max(500).optional(),
    uploadId: z.string().uuid().optional(),
    source: sourceSchema.default("upload"),
    provenance: provenanceSchema,
    metadata: mediaMetadataSchema,
  }),
  handler: async (input, ctx) => {
    if (
      ctx.actor.kind === "anonymous" &&
      !input.uploadId &&
      !input.provenance.captureToken &&
      !input.provenance.captureSessionId
    ) {
      throw new ServiceError("permission", "Sign in or use an upload link.");
    }
    const body = input.bytes;
    if (body.byteLength > PROXY_UPLOAD_LIMIT) {
      throw new ServiceError(
        "validation",
        "Files larger than 25 MB use the resumable direct-upload path.",
      );
    }
    try {
      const validated = validateMediaFile({
        filename: input.filename,
        declaredMime: input.contentType,
        bytes: body.byteLength,
        prefix: mediaSignatureSample(
          body.subarray(0, SIGNATURE_BYTES),
          body.byteLength > SIGNATURE_BYTES
            ? body.subarray(Math.max(SIGNATURE_BYTES, body.byteLength - SIGNATURE_BYTES))
            : new Uint8Array(),
        ),
      });
      let session:
        | typeof mediaUploads.$inferSelect
        | undefined;
      if (input.uploadId) {
        [session] = await ctx.tx
          .select()
          .from(mediaUploads)
          .where(eq(mediaUploads.id, input.uploadId))
          .limit(1)
          .for("update");
        if (!session || session.strategy !== "proxy") {
          throw new ServiceError("not_found", "That upload is not here.");
        }
        requireUploadAccess(ctx.actor, session.uploadedBy);
        if (session.state === "complete" && session.assetId) {
          const [asset] = await ctx.tx
            .select()
            .from(assets)
            .where(eq(assets.id, session.assetId))
            .limit(1);
          if (asset) return asset;
        }
        if (session.expiresAt <= new Date()) {
          throw new ServiceError("conflict", "That upload reservation has expired.");
        }
        if (session.state !== "created") {
          throw new ServiceError("conflict", "That upload is no longer accepting bytes.");
        }
        if (
          session.filename !== input.filename ||
          session.expectedBytes !== body.byteLength
        ) {
          throw new ServiceError(
            "validation",
            "The selected file no longer matches the upload reservation.",
          );
        }
      }

      const key =
        session?.storageKey ??
        storageKey(input.filename, new Date(), randomUUID().slice(0, 8));
      const scan = await scanBytes(body, input.filename, validated.mime);
      if (
        storage().id === "s3" && storage().isPublic &&
        (scan.status === "infected" || scan.status === "error")
      ) {
        throw new ServiceError(
          "validation",
          "The scanner did not clear this file, and public storage cannot quarantine it safely.",
        );
      }
      await putTrackedObject({
        key,
        body,
        contentType: validated.mime,
        role: "original",
        uploadId: session?.id,
      });
      const asset = await createAssetFromStoredOriginal(
        {
          filename: input.filename,
          mime: validated.mime,
          kind: validated.kind,
          bytes: body.byteLength,
          body,
          key,
          altText: input.altText,
          source: input.source,
          provenance: safeProvenance(
            ctx,
            input.source,
            input.provenance,
            "proxy",
          ),
          metadata: input.metadata,
          scan,
          checksumSha256: createHash("sha256").update(body).digest("hex"),
          uploadId: session?.id,
        },
        ctx,
      );
      return asset;
    } catch (error) {
      return serviceValidation(error);
    }
  },
});

const uploadIntent = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  bytes: z.number().int().positive().max(MEDIA_LIMITS.video),
  altText: z.string().max(500).optional(),
  source: sourceSchema.default("upload"),
  provenance: provenanceSchema,
  metadata: mediaMetadataSchema,
});

/** Reserve a durable upload and choose the capability the active adapter has. */
export const beginUpload = defineService({
  name: "media.beginUpload",
  summary: "Reserve a resumable direct upload or bounded proxy fallback.",
  kind: "mutation",
  permission: "public",
  input: uploadIntent,
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous" && !input.provenance.captureToken) {
      throw new ServiceError("permission", "Sign in or use an upload link.");
    }
    let kind: MediaKind;
    try {
      kind = expectedKind(input.filename, input.contentType);
    } catch (error) {
      return serviceValidation(error);
    }
    if (/[\u0000-\u001f/\\]/.test(input.filename)) {
      throw new ServiceError("validation", "The filename contains unsafe characters.");
    }
    if (input.bytes > MEDIA_LIMITS[kind]) {
      throw new ServiceError(
        "validation",
        `That ${kind} file is larger than ${Math.floor(MEDIA_LIMITS[kind] / 1024 / 1024)} MB.`,
      );
    }

    const store = storage();
    const strategy = store.directMultipart
      ? ("direct_multipart" as const)
      : ("proxy" as const);
    if (strategy === "proxy" && input.bytes > PROXY_UPLOAD_LIMIT) {
      throw new ServiceError(
        "validation",
        "This storage adapter cannot accept that file through the 25 MB proxy. Configure S3-compatible storage for resumable direct uploads.",
      );
    }

    const key = storageKey(input.filename, new Date(), randomUUID().slice(0, 8));
    let providerUploadId: string | undefined;
    try {
      if (store.directMultipart) {
        providerUploadId = (
          await store.directMultipart.create(key, input.contentType)
        ).uploadId;
      }
      const [session] = await ctx.tx
        .insert(mediaUploads)
        .values({
          strategy,
          storageKey: key,
          filename: input.filename,
          declaredMime: input.contentType,
          expectedBytes: input.bytes,
          providerUploadId,
          uploadedBy: input.provenance.captureToken
            ? `capture:${input.provenance.captureToken}`
            : actorString(ctx.actor),
          source: input.provenance.captureToken ? "capture" : input.source,
          provenance: input.provenance,
          mediaMetadata: input.metadata,
          expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
        })
        .returning();
      await ctx.tx.insert(mediaObjects).values({
        key,
        uploadId: session!.id,
        role: "staged",
        state: "pending",
        contentType: input.contentType,
      });
      ctx.setSubject("mediaUpload", session!.id);
      return {
        id: session!.id,
        strategy,
        partSize: strategy === "direct_multipart" ? MULTIPART_PART_BYTES : null,
        partCount:
          strategy === "direct_multipart"
            ? Math.ceil(input.bytes / MULTIPART_PART_BYTES)
            : null,
        expiresAt: session!.expiresAt,
      };
    } catch (error) {
      if (providerUploadId && store.directMultipart) {
        await store.directMultipart.abort(key, providerUploadId).catch(() => undefined);
      }
      throw error;
    }
  },
});

async function uploadSession(tx: Tx, id: string) {
  const [session] = await tx
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.id, id))
    .limit(1);
  return session;
}

async function lockedUploadSession(tx: Tx, id: string) {
  const [session] = await tx
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.id, id))
    .limit(1)
    .for("update");
  return session;
}

async function assetForCompletedUpload(
  tx: Tx,
  session: typeof mediaUploads.$inferSelect,
) {
  if (!session.assetId) return undefined;
  const [asset] = await tx
    .select()
    .from(assets)
    .where(eq(assets.id, session.assetId))
    .limit(1);
  return asset;
}

export const uploadStatus = defineService({
  name: "media.uploadStatus",
  summary: "Report durable progress for an interrupted upload.",
  kind: "query",
  permission: "public",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const session = await uploadSession(ctx.tx, input.id);
    if (!session) throw new ServiceError("not_found", "That upload is not here.");
    requireUploadAccess(ctx.actor, session.uploadedBy);
    let parts: MultipartPart[] = [];
    if (
      session.strategy === "direct_multipart" &&
      session.providerUploadId &&
      !["complete", "failed", "aborted", "expired"].includes(session.state)
    ) {
      const multipart = storage().directMultipart;
      if (multipart) {
        parts = await multipart.listParts(
          session.storageKey,
          session.providerUploadId,
        );
      }
    }
    return {
      id: session.id,
      strategy: session.strategy,
      state: session.state,
      filename: session.filename,
      contentType: session.declaredMime,
      expectedBytes: session.expectedBytes,
      partSize:
        session.strategy === "direct_multipart" ? MULTIPART_PART_BYTES : null,
      partCount:
        session.strategy === "direct_multipart"
          ? Math.ceil(session.expectedBytes / MULTIPART_PART_BYTES)
          : null,
      parts,
      assetId: session.assetId,
      failureReason: session.failureReason,
      expiresAt: session.expiresAt,
    };
  },
});

export const signUploadParts = defineService({
  name: "media.signUploadParts",
  summary: "Sign a bounded set of direct multipart upload requests.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    id: z.string().uuid(),
    partNumbers: z.array(z.number().int().min(1).max(MAX_MULTIPART_PARTS)).min(1).max(25),
  }),
  handler: async (input, ctx) => {
    const session = await uploadSession(ctx.tx, input.id);
    if (!session || session.strategy !== "direct_multipart") {
      throw new ServiceError("not_found", "That direct upload is not here.");
    }
    requireUploadAccess(ctx.actor, session.uploadedBy);
    if (session.expiresAt <= new Date()) {
      throw new ServiceError("conflict", "That upload reservation has expired.");
    }
    if (!["created", "uploading"].includes(session.state)) {
      throw new ServiceError("conflict", "That upload is no longer accepting parts.");
    }
    const multipart = storage().directMultipart;
    if (!multipart || !session.providerUploadId) {
      throw new ServiceError("conflict", "Direct uploads are unavailable.");
    }
    const partCount = Math.ceil(session.expectedBytes / MULTIPART_PART_BYTES);
    const partNumbers = [...new Set(input.partNumbers)].sort((a, b) => a - b);
    if (partNumbers.some((part) => part > partCount)) {
      throw new ServiceError("validation", "A requested upload part is outside the file.");
    }
    const signed = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        ...(await multipart.signPart(
          session.storageKey,
          session.providerUploadId!,
          partNumber,
        )),
      })),
    );
    await ctx.tx
      .update(mediaUploads)
      .set({ state: "uploading", updatedAt: new Date() })
      .where(eq(mediaUploads.id, session.id));
    ctx.setSubject("mediaUpload", session.id);
    return { parts: signed, expiresAt: session.expiresAt };
  },
});

async function failCompletedUpload(
  session: typeof mediaUploads.$inferSelect,
  message: string,
  ctx: ServiceContext,
) {
  await storage().delete(session.storageKey);
  await ctx.tx.delete(mediaObjects).where(eq(mediaObjects.key, session.storageKey));
  await ctx.tx
    .update(mediaUploads)
    .set({ state: "failed", failureReason: message, updatedAt: new Date() })
    .where(eq(mediaUploads.id, session.id));
  ctx.setSubject("mediaUpload", session.id);
  return { ok: false as const, message };
}

const multipartPartSchema = z.object({
  partNumber: z.number().int().min(1).max(MAX_MULTIPART_PARTS),
  etag: z.string().trim().min(1).max(256),
});

export const completeUpload = defineService({
  name: "media.completeUpload",
  summary: "Assemble, validate, scan, and register a direct upload.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    id: z.string().uuid(),
    parts: z.array(multipartPartSchema).min(1).max(MAX_MULTIPART_PARTS),
    altText: z.string().max(500).optional(),
  }),
  handler: async (input, ctx) => {
    const session = await lockedUploadSession(ctx.tx, input.id);
    if (!session || session.strategy !== "direct_multipart") {
      throw new ServiceError("not_found", "That direct upload is not here.");
    }
    requireUploadAccess(ctx.actor, session.uploadedBy);
    if (session.state === "complete") {
      const asset = await assetForCompletedUpload(ctx.tx, session);
      if (asset) return { ok: true as const, asset };
      const provenance = session.provenance as { captureToken?: string; captureSessionId?: string };
      if (provenance.captureToken || provenance.captureSessionId) {
        return { ok: true as const, asset: null };
      }
      throw new ServiceError(
        "conflict",
        "That upload completed without a recoverable asset record.",
      );
    }
    if (session.state === "failed") {
      return {
        ok: false as const,
        message: session.failureReason ?? "That upload failed validation.",
      };
    }
    if (session.expiresAt <= new Date()) {
      throw new ServiceError("conflict", "That upload reservation has expired.");
    }
    if (!["created", "uploading"].includes(session.state)) {
      throw new ServiceError("conflict", "That upload cannot be completed again.");
    }
    const multipart = storage().directMultipart;
    if (!multipart || !session.providerUploadId) {
      throw new ServiceError("conflict", "Direct uploads are unavailable.");
    }
    const expectedParts = Math.ceil(session.expectedBytes / MULTIPART_PART_BYTES);
    const parts = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
    if (
      parts.length !== expectedParts ||
      parts.some((part, index) => part.partNumber !== index + 1)
    ) {
      throw new ServiceError(
        "validation",
        `This file requires exactly ${expectedParts} ordered upload parts.`,
      );
    }

    // If the object store completed the upload but the process died before the
    // database transaction committed, HEAD turns the retry into recovery.
    const completed =
      (await storage().head(session.storageKey)) ??
      (await multipart.complete(
        session.storageKey,
        session.providerUploadId,
        parts,
      ));
    await ctx.tx
      .update(mediaUploads)
      .set({ state: "processing", updatedAt: new Date() })
      .where(eq(mediaUploads.id, session.id));
    if (completed.bytes !== session.expectedBytes) {
      return failCompletedUpload(
        session,
        `The object store received ${completed.bytes} bytes; ${session.expectedBytes} were expected.`,
        ctx,
      );
    }

    const prefix = await storage().readRange(
      session.storageKey,
      0,
      SIGNATURE_BYTES - 1,
    );
    const suffixStart = Math.max(0, completed.bytes - SIGNATURE_BYTES);
    const suffix = suffixStart > 0
      ? await storage().readRange(
          session.storageKey,
          suffixStart,
          completed.bytes - 1,
        )
      : undefined;
    try {
      const validated = validateMediaFile({
        filename: session.filename,
        declaredMime: session.declaredMime,
        bytes: completed.bytes,
        prefix: mediaSignatureSample(
          prefix ?? new Uint8Array(),
          suffix ?? new Uint8Array(),
        ),
      });
      const verified = await scanStoredAndHash(
        session.storageKey,
        session.filename,
        validated.mime,
        completed.bytes,
      );
      const provenance = session.provenance as z.output<typeof provenanceSchema>;
      if (provenance.captureToken || provenance.captureSessionId) {
        const { stageCompletedUpload } = await import("./capture");
        await ctx.callAsSystem(stageCompletedUpload, {
          uploadId: session.id,
          token: provenance.captureToken,
          sessionId: provenance.captureSessionId,
          filename: session.filename,
          contentType: validated.mime,
          key: session.storageKey,
          bytes: completed.bytes,
          checksumSha256: verified.checksumSha256,
        });
        await ctx.tx
          .update(mediaUploads)
          .set({
            state: "complete",
            detectedMime: validated.mime,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(mediaUploads.id, session.id));
        return { ok: true as const, asset: null };
      }
      const asset = await createAssetFromStoredOriginal(
        {
          filename: session.filename,
          mime: validated.mime,
          kind: validated.kind,
          bytes: completed.bytes,
          key: session.storageKey,
          altText: input.altText,
          source: session.source,
          provenance: safeProvenance(
            ctx,
            session.source,
            provenance,
            "direct_multipart",
          ),
          metadata: session.mediaMetadata as z.output<typeof mediaMetadataSchema>,
          scan: verified.scan,
          checksumSha256: verified.checksumSha256,
          uploadId: session.id,
        },
        ctx,
      );
      return { ok: true as const, asset };
    } catch (error) {
      if (error instanceof MediaValidationError) {
        return failCompletedUpload(session, error.message, ctx);
      }
      throw error;
    }
  },
});

export const registerStoredOriginal = defineService({
  name: "media.registerStoredOriginal",
  summary: "Turn an already-stored original into a library Asset.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1).max(500),
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    bytes: z.number().int().positive(),
    altText: z.string().max(500).optional(),
    source: sourceSchema.default("capture"),
    provenance: provenanceSchema,
    metadata: mediaMetadataSchema,
    checksumSha256: z.string().length(64).optional(),
  }),
  handler: async (input, ctx) => {
    const head = await storage().head(input.key);
    if (!head) throw new ServiceError("not_found", "The staged file is gone.");
    const prefix = await storage().readRange(input.key, 0, SIGNATURE_BYTES - 1);
    const suffixStart = Math.max(0, input.bytes - SIGNATURE_BYTES);
    const suffix =
      suffixStart > 0
        ? await storage().readRange(input.key, suffixStart, input.bytes - 1)
        : undefined;
    try {
      const validated = validateMediaFile({
        filename: input.filename,
        declaredMime: input.contentType,
        bytes: input.bytes,
        prefix: mediaSignatureSample(prefix ?? new Uint8Array(), suffix ?? new Uint8Array()),
      });
      const verified = await scanStoredAndHash(input.key, input.filename, validated.mime, input.bytes);
      return createAssetFromStoredOriginal(
        {
          filename: input.filename,
          mime: validated.mime,
          kind: validated.kind,
          bytes: input.bytes,
          key: input.key,
          altText: input.altText,
          source: input.source,
          provenance: safeProvenance(ctx, input.source, input.provenance, "proxy"),
          metadata: input.metadata,
          scan: verified.scan,
          checksumSha256: input.checksumSha256 ?? verified.checksumSha256,
        },
        ctx,
      );
    } catch (error) {
      return serviceValidation(error);
    }
  },
});

export const abortUpload = defineService({
  name: "media.abortUpload",
  summary: "Abort an unfinished upload and remove its staged bytes.",
  kind: "mutation",
  permission: "public",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const session = await lockedUploadSession(ctx.tx, input.id);
    if (!session) throw new ServiceError("not_found", "That upload is not here.");
    requireUploadAccess(ctx.actor, session.uploadedBy);
    if (["complete", "failed", "aborted", "expired"].includes(session.state)) {
      return { ok: true };
    }
    const multipart = storage().directMultipart;
    if (multipart && session.providerUploadId) {
      await multipart.abort(session.storageKey, session.providerUploadId);
    }
    await storage().delete(session.storageKey);
    await ctx.tx.delete(mediaObjects).where(eq(mediaObjects.key, session.storageKey));
    await ctx.tx
      .update(mediaUploads)
      .set({ state: "aborted", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(mediaUploads.id, session.id));
    ctx.setSubject("mediaUpload", session.id);
    return { ok: true };
  },
});

export const listAssets = defineService({
  name: "media.list",
  summary: "The asset library, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    kind: z.enum(["image", "video", "doc", "audio"]).optional(),
    status: z
      .enum(["processing", "ready", "quarantined", "failed", "trashed"])
      .optional(),
    includeUnavailable: z.boolean().default(false),
    includeTrashed: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, ctx) => {
    const visibility = input.status
      ? eq(assets.status, input.status)
      : input.includeTrashed
        ? undefined
        : input.includeUnavailable
          ? ne(assets.status, "trashed")
          : eq(assets.status, "ready");
    const where = input.kind
      ? and(eq(assets.kind, input.kind), visibility)
      : visibility;
    const rows = await ctx.tx
      .select()
      .from(assets)
      .where(where)
      .orderBy(desc(assets.createdAt))
      .limit(input.limit)
      .offset(input.offset);
    const [totals] = await ctx.tx
      .select({ n: count() })
      .from(assets)
      .where(where);
    return { rows, total: totals?.n ?? 0 };
  },
});

export const getAsset = defineService({
  name: "media.get",
  summary: "One asset by id.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset) throw new ServiceError("not_found", "That file is not here.");
    return asset;
  },
});

export interface ResolvedSource {
  format: VariantFormat;
  /** A `srcset` value: "url 400w, url 800w". */
  srcset: string;
  type: string;
}

export interface ResolvedImage {
  src: string;
  sources: ResolvedSource[];
  width: number | null;
  height: number | null;
  altText: string | null;
}

/**
 * Everything a public page needs to render an asset (§5, §36).
 *
 * Public, because it is what draws an image on a page a visitor is reading —
 * and it returns URLs rather than bytes, so a public bucket is served straight
 * from the CDN and a private one through a signed link, without the caller
 * knowing which it is.
 */
export const resolveImage = defineService({
  name: "media.resolveImage",
  summary: "URLs and dimensions for rendering one image.",
  kind: "query",
  permission: "public",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx): Promise<ResolvedImage | null> => {
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    // Null rather than an error: a block pointing at a deleted asset should
    // leave a gap in a page, never take the page down.
    if (!asset || asset.kind !== "image" || asset.status !== "ready") return null;

    const store = storage();
    const variants = asset.variants as VariantSet;
    const sources: ResolvedSource[] = [];
    for (const [format, renditions] of Object.entries(variants) as [
      VariantFormat,
      Rendition[],
    ][]) {
      if (!renditions?.length) continue;
      const entries = await Promise.all(
        renditions.map(async (r) => `${await store.url(r.key)} ${r.width}w`),
      );
      sources.push({
        format,
        srcset: entries.join(", "),
        type: `image/${format}`,
      });
    }

    return {
      src: await store.url(asset.storageKey, { contentType: asset.mime }),
      sources,
      width: asset.width,
      height: asset.height,
      altText: asset.altText,
    };
  },
});

export interface ResolvedAsset {
  id: string;
  kind: "video" | "doc" | "audio";
  src: string;
  mime: string;
  filename: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/** Ready non-image media for a public block or an owner preview. */
export const resolveAsset = defineService({
  name: "media.resolveAsset",
  summary: "Resolve a ready video, audio file, or document.",
  kind: "query",
  permission: "public",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx): Promise<ResolvedAsset | null> => {
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset || asset.kind === "image" || asset.status !== "ready") return null;
    return {
      id: asset.id,
      kind: asset.kind,
      src:
        asset.kind === "doc"
          ? `/media/download/${asset.id}`
          : await storage().url(asset.storageKey, { contentType: asset.mime }),
      mime: asset.mime,
      filename: asset.filename,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
    };
  },
});

export const authorizeAssetDownload = defineService({
  name: "media.authorizeAssetDownload",
  summary: "Authorize a controlled document download.",
  kind: "query",
  permission: "public",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .select({
        storageKey: assets.storageKey,
        filename: assets.filename,
        mime: assets.mime,
        bytes: assets.bytes,
      })
      .from(assets)
      .where(
        and(
          eq(assets.id, input.id),
          eq(assets.kind, "doc"),
          eq(assets.status, "ready"),
        ),
      )
      .limit(1);
    return asset ?? null;
  },
});

/**
 * The app-served storage route asks this before returning any bytes. A known
 * URL therefore stops working as soon as an asset is trashed or quarantined.
 */
export const authorizeObjectDelivery = defineService({
  name: "media.authorizeObjectDelivery",
  summary: "Authorize delivery of one ready asset object.",
  kind: "query",
  permission: "public",
  input: z.object({
    key: z
      .string()
      .min(1)
      .max(1_024)
      .refine((key) => !key.includes("..") && !key.startsWith("/")),
  }),
  handler: async (input, ctx) => {
    const [object] = await ctx.tx
      .select({
        contentType: mediaObjects.contentType,
        filename: assets.filename,
        kind: assets.kind,
      })
      .from(mediaObjects)
      .innerJoin(assets, eq(mediaObjects.assetId, assets.id))
      .where(
        and(
          eq(mediaObjects.key, input.key),
          eq(mediaObjects.state, "attached"),
          eq(assets.status, "ready"),
        ),
      )
      .limit(1);
    return object ?? null;
  },
});

export const setAltText = defineService({
  name: "media.setAltText",
  summary: "Describe an image for people who cannot see it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    altText: z.string().max(500),
  }),
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select({ kind: assets.kind })
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That file is not here.");
    if (existing.kind !== "image") {
      throw new ServiceError("validation", "Only images use alternative text.");
    }
    const now = new Date();
    const [asset] = await ctx.tx
      .update(assets)
      .set({ altText: input.altText, updatedAt: now })
      .where(eq(assets.id, input.id))
      .returning();
    if (!asset) throw new ServiceError("not_found", "That file is not here.");
    // A person or agent authored new text outside the suggestion review. Any
    // proposal still on screen is now stale and may never overwrite it.
    await ctx.tx
      .update(mediaAltTextSuggestions)
      .set({
        status: "superseded",
        reviewedBy: actorString(ctx.actor),
        reviewedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaAltTextSuggestions.assetId, asset.id),
          eq(mediaAltTextSuggestions.status, "ready"),
        ),
      );
    ctx.setSubject("asset", asset.id);
    return asset;
  },
});

function requireHumanReview(actor: Actor): void {
  if (actor.kind !== "user") {
    throw new ServiceError(
      "permission",
      "Sign in as a person to review generated alternative text.",
    );
  }
}

function sourceIdentity(asset: typeof assets.$inferSelect): string {
  return asset.checksumSha256 ?? `storage:${asset.storageKey}`;
}

async function suggestionPreview(asset: typeof assets.$inferSelect): Promise<{
  image: Uint8Array<ArrayBuffer>;
  contentType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}> {
  const variants = asset.variants as VariantSet;
  const webp = variants.webp ?? [];
  const rendition = webp.find((candidate) => candidate.width >= 800) ?? webp.at(-1);
  if (rendition) {
    const image = await storage().get(rendition.key);
    if (image) return { image, contentType: "image/webp" };
  }

  const supported = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
  const contentType = supported.find((candidate) => candidate === asset.mime);
  if (!contentType) {
    throw new ServiceError(
      "conflict",
      "This image has no safe provider-compatible preview. Rescan it to rebuild renditions, then try again.",
    );
  }
  const image = await storage().get(asset.storageKey);
  if (!image) throw new ServiceError("not_found", "That image file is missing.");
  return { image, contentType };
}

/** Provider readiness plus the one proposal awaiting a person's decision. */
export const altTextSuggestionState = defineService({
  name: "media.altTextSuggestionState",
  summary: "Show provider readiness and the pending alt-text suggestion.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .select({ id: assets.id, kind: assets.kind })
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset) throw new ServiceError("not_found", "That file is not here.");
    if (asset.kind !== "image") {
      throw new ServiceError("validation", "Only images use alternative text.");
    }
    const [suggestion] = await ctx.tx
      .select()
      .from(mediaAltTextSuggestions)
      .where(
        and(
          eq(mediaAltTextSuggestions.assetId, asset.id),
          eq(mediaAltTextSuggestions.status, "ready"),
        ),
      )
      .orderBy(desc(mediaAltTextSuggestions.createdAt))
      .limit(1);
    const provider = altTextSuggester();
    return {
      available: provider.available,
      provider: provider.id,
      model: provider.model ?? null,
      unavailableReason: provider.unavailableReason ?? null,
      suggestion: suggestion ?? null,
    };
  },
});

/** One provider status and pending proposals for a media-library page. */
export const listAltTextSuggestionStates = defineService({
  name: "media.listAltTextSuggestionStates",
  summary: "List pending alt-text suggestions for a set of images.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
  }),
  handler: async (input, ctx) => {
    const suggestions = await ctx.tx
      .select()
      .from(mediaAltTextSuggestions)
      .where(
        and(
          inArray(mediaAltTextSuggestions.assetId, input.ids),
          eq(mediaAltTextSuggestions.status, "ready"),
        ),
      )
      .orderBy(desc(mediaAltTextSuggestions.createdAt));
    const provider = altTextSuggester();
    return {
      available: provider.available,
      provider: provider.id,
      model: provider.model ?? null,
      unavailableReason: provider.unavailableReason ?? null,
      suggestions,
    };
  },
});

/**
 * Generate only a proposal. This operation cannot write `assets.alt_text` and
 * is unavailable to API keys because each call can have provider cost and the
 * workflow is intentionally initiated by a person looking at the image.
 */
export const generateAltTextSuggestion = defineService({
  name: "media.generateAltTextSuggestion",
  summary: "Generate an image description for explicit human review.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  rateLimit: {
    windowSeconds: 60 * 60,
    limit: 5,
    subject: (input) => input.id,
    message: "That image has had several suggestions generated recently. Review one or try again later.",
  },
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    requireHumanReview(ctx.actor);
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset || asset.status === "trashed") {
      throw new ServiceError("not_found", "That image is not here.");
    }
    if (asset.kind !== "image" || asset.status !== "ready") {
      throw new ServiceError(
        "conflict",
        "Only a ready, verified image can be sent for an alt-text suggestion.",
      );
    }
    const provider = altTextSuggester();
    if (!provider.available) {
      throw new ServiceError(
        "conflict",
        provider.unavailableReason ?? "Generated alt text is not configured.",
      );
    }
    const preview = await suggestionPreview(asset);
    let generated;
    try {
      generated = await provider.suggest(preview);
    } catch (error) {
      if (error instanceof AltTextSuggestionError) {
        throw new ServiceError("conflict", error.message);
      }
      throw new ServiceError(
        "conflict",
        "The alt-text provider could not produce a suggestion. Try again in a moment.",
      );
    }
    const suggestion = generated.text.replace(/\s+/g, " ").trim();
    if (!suggestion || suggestion.length > 500) {
      throw new ServiceError(
        "conflict",
        "The provider returned a suggestion that cannot be reviewed safely.",
      );
    }

    const now = new Date();
    const reviewer = actorString(ctx.actor);
    // The provider call happens without a row lock. Re-lock and compare now,
    // so a person can author text while it runs and that newer work wins.
    const [currentAsset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, asset.id))
      .limit(1)
      .for("update");
    if (
      !currentAsset ||
      currentAsset.status !== "ready" ||
      currentAsset.kind !== "image" ||
      sourceIdentity(currentAsset) !== sourceIdentity(asset) ||
      currentAsset.altText !== asset.altText
    ) {
      throw new ServiceError(
        "conflict",
        "The image or its authored alt text changed while the suggestion was generated. Nothing was overwritten; try again from the current image.",
      );
    }
    await ctx.tx
      .update(mediaAltTextSuggestions)
      .set({
        status: "superseded",
        reviewedBy: reviewer,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaAltTextSuggestions.assetId, asset.id),
          eq(mediaAltTextSuggestions.status, "ready"),
        ),
      );
    const [stored] = await ctx.tx
      .insert(mediaAltTextSuggestions)
      .values({
        assetId: currentAsset.id,
        suggestion,
        provider: generated.provider,
        model: generated.model,
        promptVersion: ALT_TEXT_PROMPT_VERSION,
        sourceChecksum: sourceIdentity(currentAsset),
        authoredAltTextAtRequest: currentAsset.altText,
        requestedBy: reviewer,
      })
      .returning();
    ctx.setSubject("asset", asset.id);
    ctx.queueEvent("media.altTextSuggested", {
      assetId: asset.id,
      suggestionId: stored!.id,
      provider: stored!.provider,
      model: stored!.model,
    });
    return stored!;
  },
});

export const acceptAltTextSuggestion = defineService({
  name: "media.acceptAltTextSuggestion",
  summary: "Accept or edit a generated image description after human review.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  input: z.object({
    id: z.string().uuid(),
    suggestionId: z.string().uuid(),
    altText: z.string().trim().min(1).max(500),
  }),
  handler: async (input, ctx) => {
    requireHumanReview(ctx.actor);
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1)
      .for("update");
    const [suggestion] = await ctx.tx
      .select()
      .from(mediaAltTextSuggestions)
      .where(eq(mediaAltTextSuggestions.id, input.suggestionId))
      .limit(1)
      .for("update");
    if (!asset || asset.kind !== "image" || suggestion?.assetId !== asset.id) {
      throw new ServiceError("not_found", "That alt-text suggestion is not here.");
    }
    if (asset.status !== "ready") {
      throw new ServiceError(
        "conflict",
        "Only a ready, verified image can receive reviewed alternative text.",
      );
    }
    if (suggestion.status !== "ready") {
      throw new ServiceError("conflict", "That suggestion has already been reviewed.");
    }
    if (
      suggestion.sourceChecksum !== sourceIdentity(asset) ||
      suggestion.authoredAltTextAtRequest !== asset.altText
    ) {
      throw new ServiceError(
        "conflict",
        "The image or its authored alt text changed after this suggestion was generated. Generate a fresh suggestion instead.",
      );
    }
    const now = new Date();
    const reviewer = actorString(ctx.actor);
    const [updated] = await ctx.tx
      .update(assets)
      .set({ altText: input.altText, updatedAt: now })
      .where(eq(assets.id, asset.id))
      .returning();
    await ctx.tx
      .update(mediaAltTextSuggestions)
      .set({
        status: "accepted",
        reviewedBy: reviewer,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(mediaAltTextSuggestions.id, suggestion.id));
    ctx.setSubject("asset", asset.id);
    ctx.queueEvent("media.altTextAccepted", {
      assetId: asset.id,
      suggestionId: suggestion.id,
      edited: input.altText !== suggestion.suggestion,
    });
    return updated!;
  },
});

export const dismissAltTextSuggestion = defineService({
  name: "media.dismissAltTextSuggestion",
  summary: "Dismiss a generated image description after human review.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  input: z.object({ id: z.string().uuid(), suggestionId: z.string().uuid() }),
  handler: async (input, ctx) => {
    requireHumanReview(ctx.actor);
    const [suggestion] = await ctx.tx
      .select()
      .from(mediaAltTextSuggestions)
      .where(eq(mediaAltTextSuggestions.id, input.suggestionId))
      .limit(1)
      .for("update");
    if (suggestion?.assetId !== input.id || suggestion.status !== "ready") {
      throw new ServiceError("not_found", "That pending suggestion is not here.");
    }
    const now = new Date();
    await ctx.tx
      .update(mediaAltTextSuggestions)
      .set({
        status: "dismissed",
        reviewedBy: actorString(ctx.actor),
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(mediaAltTextSuggestions.id, suggestion.id));
    ctx.setSubject("asset", input.id);
    ctx.queueEvent("media.altTextDismissed", {
      assetId: input.id,
      suggestionId: suggestion.id,
    });
    return { ok: true };
  },
});

export const setFocalPoint = defineService({
  name: "media.setFocalPoint",
  summary: "Set the image crop anchor in basis points.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    x: z.number().int().min(0).max(10_000),
    y: z.number().int().min(0).max(10_000),
  }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .update(assets)
      .set({ focalX: input.x, focalY: input.y, updatedAt: new Date() })
      .where(and(eq(assets.id, input.id), eq(assets.kind, "image")))
      .returning();
    if (!asset) throw new ServiceError("not_found", "That image is not here.");
    ctx.setSubject("asset", asset.id);
    return asset;
  },
});

export const updateAssetDetails = defineService({
  name: "media.updateDetails",
  summary: "Update safe media metadata and provenance notes.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    metadata: mediaMetadataSchema.optional(),
    provenance: provenanceSchema.optional(),
  }),
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That file is not here.");
    const metadata = {
      ...(existing.metadata as Record<string, unknown>),
      ...(input.metadata ?? {}),
    };
    const provenance = {
      ...(existing.provenance as Record<string, unknown>),
      ...(input.provenance ?? {}),
      lastEditedBy: actorString(ctx.actor),
      lastEditedAt: new Date().toISOString(),
    };
    const [asset] = await ctx.tx
      .update(assets)
      .set({
        metadata,
        provenance,
        width: input.metadata?.width ?? existing.width,
        height: input.metadata?.height ?? existing.height,
        durationSeconds:
          input.metadata?.durationSeconds ?? existing.durationSeconds,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, existing.id))
      .returning();
    ctx.setSubject("asset", existing.id);
    return asset!;
  },
});

/**
 * Where an asset is still being used.
 *
 * Deleting a file that a page still points at leaves a gap on that page. The
 * block handles it — `resolveImage` answers null and the block renders
 * nothing, so a live site never breaks — but an owner deserves to know before
 * rather than discover after.
 *
 * The jsonpath `$.**` walks the whole block tree, so an image nested inside a
 * columns block is found as readily as one at the top level.
 *
 * cms owns those tables, which is why this reaches them through a raw query
 * rather than importing their schema: core must not depend on a module (§11).
 * The cost is that this string knows two table names — a narrow, deliberate
 * exception, and the alternative is core importing downward.
 */
export const assetUsage = defineService({
  name: "media.usage",
  summary: "How many pages and sections still reference a file.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    // The id travels as a jsonpath *variable* rather than being concatenated
    // into the expression: the path stays a constant, and a value that is not
    // a uuid can only ever fail to match rather than change the query.
    const vars = sql`jsonb_build_object('id', ${input.id}::text)`;
    const path = sql`'$.** ? (@.assetId == $id)'::jsonpath`;
    const counts = await ctx.tx.execute<{ pages: number; sections: number }>(sql`
      select
        (select count(*) from pages
          where jsonb_path_exists(blocks, ${path}, ${vars})) as pages,
        (select count(*) from sections
          where jsonb_path_exists(blocks, ${path}, ${vars})) as sections
    `);
    const row = counts[0];
    return {
      pages: Number(row?.pages ?? 0),
      sections: Number(row?.sections ?? 0),
    };
  },
});

/** Hide immediately while retaining every byte for one-action recovery. */
export const trashAsset = defineService({
  name: "media.trash",
  summary: "Move a file to recoverable trash for thirty days.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset) throw new ServiceError("not_found", "That file is not here.");

    if (asset.status === "trashed") return asset;
    const now = new Date();
    const [trashed] = await ctx.tx
      .update(assets)
      .set({
        status: "trashed",
        deletedAt: now,
        purgeAfter: new Date(now.getTime() + TRASH_RETENTION_MS),
        updatedAt: now,
      })
      .where(eq(assets.id, asset.id))
      .returning();
    ctx.setSubject("asset", asset.id);
    ctx.queueEvent("media.trashed", {
      assetId: asset.id,
      purgeAfter: trashed!.purgeAfter!.toISOString(),
    });
    return trashed!;
  },
});

/** Compatibility for existing server-action imports; deletion is now trash. */
export const deleteAsset = trashAsset;

export const restoreAsset = defineService({
  name: "media.restore",
  summary: "Restore a file from recoverable trash.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!existing || existing.status !== "trashed") {
      throw new ServiceError("not_found", "That trashed file is not here.");
    }
    const status =
      existing.scanStatus === "infected" || existing.scanStatus === "error"
        ? ("quarantined" as const)
        : ("ready" as const);
    const [restored] = await ctx.tx
      .update(assets)
      .set({
        status,
        deletedAt: null,
        purgeAfter: null,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, existing.id))
      .returning();
    ctx.setSubject("asset", existing.id);
    ctx.queueEvent("media.restored", { assetId: existing.id });
    return restored!;
  },
});

async function purgeStoredAsset(tx: Tx, asset: typeof assets.$inferSelect) {
  const inventory = await tx
    .select({ key: mediaObjects.key })
    .from(mediaObjects)
    .where(eq(mediaObjects.assetId, asset.id));
  const keys = new Set(inventory.map((row) => row.key));
  keys.add(asset.storageKey);
  const variants = asset.variants as VariantSet;
  for (const renditions of Object.values(variants)) {
    for (const rendition of renditions ?? []) keys.add(rendition.key);
  }
  for (const key of keys) await storage().delete(key);
  await tx.delete(assets).where(eq(assets.id, asset.id));
  return { assetId: asset.id, objects: keys.size };
}

export const purgeAsset = defineService({
  name: "media.purge",
  summary: "Permanently purge one trashed file after typed owner confirmation.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.string().uuid(), confirmation: z.string().max(255) }),
  handler: async (input, ctx) => {
    if (
      ctx.actor.kind !== "system" &&
      (ctx.actor.kind !== "user" || ctx.actor.role !== "owner")
    ) {
      throw new ServiceError(
        "permission",
        "Only the owner can permanently purge media.",
      );
    }
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset || asset.status !== "trashed") {
      throw new ServiceError("not_found", "That trashed file is not here.");
    }
    if (input.confirmation !== asset.filename) {
      throw new ServiceError(
        "validation",
        "Type the exact filename to confirm permanent deletion.",
      );
    }
    const result = await purgeStoredAsset(ctx.tx, asset);
    ctx.setSubject("asset", asset.id);
    ctx.queueEvent("media.purged", result);
    return { ok: true, ...result };
  },
});

/** Scheduler-only purge lane; still goes through audit and event invariants. */
export const purgeExpiredAsset = defineService({
  name: "media.purgeExpired",
  summary: "Purge one asset after its recoverable trash window expires.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    asOf: z.string().datetime().optional(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "system") {
      throw new ServiceError("permission", "Only lifecycle maintenance can run this operation.");
    }
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (
      !asset ||
      asset.status !== "trashed" ||
      !asset.purgeAfter ||
      asset.purgeAfter > (input.asOf ? new Date(input.asOf) : new Date())
    ) {
      throw new ServiceError("conflict", "That asset is not due for purge.");
    }
    const result = await purgeStoredAsset(ctx.tx, asset);
    ctx.setSubject("asset", asset.id);
    ctx.queueEvent("media.purged", result);
    return result;
  },
});

export const rescanAsset = defineService({
  name: "media.rescan",
  summary: "Run the configured malware scanner against an original again.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset || asset.status === "trashed") {
      throw new ServiceError("not_found", "That file is not here.");
    }
    const scan = await scanStored(
      asset.storageKey,
      asset.filename,
      asset.mime,
      asset.bytes,
    );
    const fields = scanFields(scan);
    const status =
      scan.status === "not_configured" && asset.status === "quarantined"
        ? ("quarantined" as const)
        : fields.status;
    let variants = asset.variants as VariantSet;
    let width = asset.width;
    let height = asset.height;
    if (
      status === "ready" &&
      asset.kind === "image" &&
      Object.keys(variants).length === 0
    ) {
      const body = await storage().get(asset.storageKey);
      const facts = body ? await readImageFacts(body) : undefined;
      if (!body || !facts) {
        throw new ServiceError(
          "validation",
          "The original image is missing or damaged and cannot be released.",
        );
      }
      const built = await buildRenditions(body, facts, (format, size) =>
        `${asset.storageKey}.${size}.${format}`,
      );
      await putTrackedObjects(
        built.map((rendition) => ({
          key: rendition.key,
          body: rendition.body,
          contentType: rendition.contentType,
          role: "variant" as const,
        })),
      );
      const keys = built.map((rendition) => rendition.key);
      await attachObjects(ctx.tx, keys, asset.id);
      variants = toVariantSet(built);
      width = facts.width;
      height = facts.height;
    }
    const [updated] = await ctx.tx
      .update(assets)
      .set({
        ...fields,
        status,
        variants,
        width,
        height,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, asset.id))
      .returning();
    ctx.setSubject("asset", asset.id);
    ctx.queueEvent("media.scanned", {
      assetId: asset.id,
      scanStatus: updated!.scanStatus,
    });
    return updated!;
  },
});

/** Scheduled lifecycle work. These return evidence for the job history. */
export async function purgeExpiredMedia(now = new Date()): Promise<number> {
  const due = await db()
    .select()
    .from(assets)
    .where(and(eq(assets.status, "trashed"), lt(assets.purgeAfter, now)))
    .limit(100);
  for (const asset of due) {
    await purgeExpiredAsset.call(
      { id: asset.id, asOf: now.toISOString() },
      { kind: "system" },
    );
  }
  return due.length;
}

export async function cleanupOrphanedMedia(now = new Date()): Promise<{
  expiredUploads: number;
  orphanedObjects: number;
  prunedSessions: number;
}> {
  const store = storage();
  const expired = await db()
    .select()
    .from(mediaUploads)
    .where(
      and(
        lt(mediaUploads.expiresAt, now),
        inArray(mediaUploads.state, [
          "created",
          "uploading",
          "uploaded",
          "processing",
        ]),
      ),
    )
    .limit(100);
  for (const upload of expired) {
    if (store.directMultipart && upload.providerUploadId) {
      await store.directMultipart.abort(
        upload.storageKey,
        upload.providerUploadId,
      );
    }
    await store.delete(upload.storageKey);
    await db().transaction(async (tx) => {
      await tx.delete(mediaObjects).where(eq(mediaObjects.uploadId, upload.id));
      await tx
        .update(mediaUploads)
        .set({ state: "expired", completedAt: now, updatedAt: now })
        .where(eq(mediaUploads.id, upload.id));
    });
  }

  const cutoff = new Date(now.getTime() - UPLOAD_TTL_MS);
  const orphans = await db()
    .select()
    .from(mediaObjects)
    .where(
      and(eq(mediaObjects.state, "pending"), lt(mediaObjects.createdAt, cutoff)),
    )
    .limit(500);
  for (const object of orphans) {
    await store.delete(object.key);
    await db().delete(mediaObjects).where(eq(mediaObjects.key, object.key));
  }
  const terminalCutoff = new Date(now.getTime() - TRASH_RETENTION_MS);
  const pruned = await db()
    .delete(mediaUploads)
    .where(
      and(
        inArray(mediaUploads.state, ["complete", "failed", "aborted", "expired"]),
        lt(mediaUploads.updatedAt, terminalCutoff),
      ),
    )
    .returning({ id: mediaUploads.id });
  return {
    expiredUploads: expired.length,
    orphanedObjects: orphans.length,
    prunedSessions: pruned.length,
  };
}

export default [
  uploadAsset,
  beginUpload,
  uploadStatus,
  signUploadParts,
  completeUpload,
  registerStoredOriginal,
  abortUpload,
  listAssets,
  getAsset,
  resolveImage,
  resolveAsset,
  authorizeAssetDownload,
  authorizeObjectDelivery,
  assetUsage,
  altTextSuggestionState,
  listAltTextSuggestionStates,
  generateAltTextSuggestion,
  acceptAltTextSuggestion,
  dismissAltTextSuggestion,
  setAltText,
  setFocalPoint,
  updateAssetDetails,
  trashAsset,
  restoreAsset,
  purgeAsset,
  purgeExpiredAsset,
  rescanAsset,
  ...captureServices,
];
