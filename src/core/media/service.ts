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
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { db, type Database } from "@/core/db";
import {
  assets,
  mediaAltTextSuggestions,
  mediaObjects,
  mediaUploads,
} from "@/core/media/schema";
import {
  actorString,
  defineOrchestratedService,
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
  allRenditionKeys,
  buildRenditions,
  isRasterImage,
  publicRenditions,
  readImageFacts,
  toVariantSet,
  withWatermarked,
  type VariantFormat,
  type VariantSet,
} from "@/core/media/variants";
import { buildWatermarked, type WatermarkMark } from "@/core/media/watermark";
import { designSettings } from "@/core/design/schema";
import { businessProfile } from "@/core/settings/schema";

const assetRow = row({
  id: uuid,
  kind: z.enum(["image", "video", "doc", "audio"]),
  storageKey: z.string(),
  filename: z.string(),
  mime: z.string(),
  legacyBytes: z.number().int(),
  bytes: z.number(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSeconds: z.number().int().nullable(),
  variants: z.unknown(),
  altText: z.string().nullable(),
  blurhash: z.string().nullable(),
  status: z.enum(["processing", "ready", "quarantined", "failed", "trashed"]),
  scanStatus: z.enum(["pending", "clean", "not_configured", "infected", "error"]),
  scanEngine: z.string().nullable(),
  scanMessage: z.string().nullable(),
  scannedAt: timestamp.nullable(),
  checksumSha256: z.string().nullable(),
  metadata: z.unknown(),
  provenance: z.unknown(),
  source: z.enum(["upload", "import", "generated", "migration", "capture"]),
  uploadedBy: z.string().nullable(),
  focalX: z.number().int(),
  focalY: z.number().int(),
  deletedAt: timestamp.nullable(),
  purgeAfter: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const suggestionRow = row({
  id: uuid,
  assetId: uuid,
  status: z.enum(["ready", "accepted", "dismissed", "superseded"]),
  suggestion: z.string(),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  sourceChecksum: z.string(),
  authoredAltTextAtRequest: z.string().nullable(),
  requestedBy: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const suggestionProviderState = {
  available: z.boolean(),
  provider: z.string(),
  model: z.string().nullable(),
  unavailableReason: z.string().nullable(),
};

const completeUploadResult = z.union([
  z.object({ ok: z.literal(true), asset: assetRow.nullable() }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);

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

/**
 * The mark this install stamps proofs with: the brand logo when one is set,
 * the business name otherwise (C8.04). Undefined before setup has named the
 * business — there is nothing to mark with yet, and an unnamed watermark is
 * worse than none.
 */
async function watermarkMarkFrom(
  reader: { select: Database["select"] },
): Promise<{ text: string; logoKey: string | null } | undefined> {
  const [business] = await reader
    .select({ name: businessProfile.name })
    .from(businessProfile)
    .limit(1);
  if (!business?.name) return undefined;
  const [design] = await reader
    .select({ logoAssetId: designSettings.logoAssetId })
    .from(designSettings)
    .limit(1);
  if (!design?.logoAssetId) return { text: business.name, logoKey: null };
  const [asset] = await reader
    .select({ storageKey: assets.storageKey })
    .from(assets)
    .where(eq(assets.id, design.logoAssetId))
    .limit(1);
  return { text: business.name, logoKey: asset?.storageKey ?? null };
}

/** Brand mark for orchestrators: DB snapshot, then logo bytes with no tx held. */
async function loadWatermarkMark(): Promise<WatermarkMark | undefined> {
  const source = await watermarkMarkFrom(db());
  if (!source) return undefined;
  let logo: Uint8Array<ArrayBuffer> | undefined;
  if (source.logoKey) logo = (await storage().get(source.logoKey)) ?? undefined;
  return { logo, text: source.text };
}

interface PreparedOriginal {
  facts?: { width: number; height: number };
  variants: VariantSet | Record<string, never>;
  trackedKeys: string[];
}

async function prepareDerivedObjects(
  input: {
    key: string;
    kind: MediaKind;
    scan: MalwareScanResult;
    body?: Uint8Array<ArrayBuffer>;
    uploadId?: string;
  },
  mark: WatermarkMark | undefined,
): Promise<PreparedOriginal> {
  const scan = scanFields(input.scan);
  const trackedKeys = [input.key];
  let facts: Awaited<ReturnType<typeof readImageFacts>>;
  let variants: VariantSet = {};
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

    // Marked renditions are built here, with the ladder, so serving a proof
    // is a key lookup rather than an image job on the client's first view.
    const marked = mark
      ? await buildWatermarked(body, facts, mark, (format, width) =>
          `${input.key}.wm.${width}.${format}`,
        )
      : [];
    if (marked.length) {
      await putTrackedObjects(
        marked.map((rendition) => ({
          key: rendition.key,
          body: rendition.body,
          contentType: rendition.contentType,
          role: "variant" as const,
          uploadId: input.uploadId,
        })),
      );
      trackedKeys.push(...marked.map((rendition) => rendition.key));
      variants = withWatermarked(variants, marked);
    }
  }
  return { facts, variants, trackedKeys };
}

async function insertPreparedAsset(
  input: CreateAssetInput,
  prepared: PreparedOriginal,
  ctx: ServiceContext,
) {
  const scan = scanFields(input.scan);
  const [asset] = await ctx.tx
    .insert(assets)
    .values({
      kind: input.kind,
      storageKey: input.key,
      filename: input.filename,
      mime: input.mime,
      bytes: input.bytes,
      legacyBytes: Math.min(input.bytes, LEGACY_MAX_BYTES),
      width: prepared.facts?.width ?? input.metadata.width,
      height: prepared.facts?.height ?? input.metadata.height,
      durationSeconds: input.metadata.durationSeconds,
      variants: prepared.variants,
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
  await attachObjects(ctx.tx, prepared.trackedKeys, asset!.id);
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

const proxyUploadInput = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  bytes: z.instanceof(Uint8Array),
  altText: z.string().max(500).optional(),
  uploadId: z.string().uuid().optional(),
  source: sourceSchema.default("upload"),
  provenance: provenanceSchema,
  metadata: mediaMetadataSchema,
});

const claimProxyUpload = defineService({
  name: "media.claimProxyUpload",
  summary: "Authorize a proxied upload reservation before scanner and storage work.",
  kind: "mutation",
  permission: "public",
  external: false,
  writeClass: "write",
  input: z.object({
    uploadId: z.string().uuid(),
    filename: z.string().min(1).max(255),
    bytes: z.number().int().positive(),
  }),
  output: z.object({
    key: z.string(),
    uploadId: uuid,
    asset: assetRow.nullable(),
  }),
  handler: async (input, ctx) => {
    const [session] = await ctx.tx
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
      if (asset) {
        return { key: session.storageKey, uploadId: session.id, asset };
      }
    }
    if (session.expiresAt <= new Date()) {
      throw new ServiceError("conflict", "That upload reservation has expired.");
    }
    if (!["created", "processing"].includes(session.state)) {
      throw new ServiceError("conflict", "That upload is no longer accepting bytes.");
    }
    if (
      session.filename !== input.filename ||
      session.expectedBytes !== input.bytes
    ) {
      throw new ServiceError(
        "validation",
        "The selected file no longer matches the upload reservation.",
      );
    }
    if (session.state === "created") {
      await ctx.tx
        .update(mediaUploads)
        .set({ state: "processing", updatedAt: new Date() })
        .where(eq(mediaUploads.id, session.id));
    }
    return { key: session.storageKey, uploadId: session.id, asset: null };
  },
});

const applyStoredOriginal = defineService({
  name: "media.applyStoredOriginal",
  summary: "Attach a scanned original and its derived objects as a library asset.",
  kind: "mutation",
  permission: "public",
  external: false,
  writeClass: "write",
  input: z.object({
    filename: z.string().min(1).max(255),
    mime: z.string().min(1).max(255),
    kind: z.enum(["image", "video", "doc", "audio"]),
    bytes: z.number(),
    key: z.string().min(1),
    altText: z.string().max(500).optional(),
    source: sourceSchema,
    provenance: provenanceSchema,
    metadata: mediaMetadataSchema,
    scan: z.object({
      status: z.enum(["clean", "infected", "not_configured", "error"]),
      engine: z.string(),
      message: z.string().optional(),
    }),
    checksumSha256: z.string().min(1),
    uploadId: z.string().uuid().optional(),
    method: z.enum(["proxy", "direct_multipart"]),
    variants: z.unknown(),
    trackedKeys: z.array(z.string().min(1)).min(1).max(64),
    width: z.number().int().nullable().optional(),
    height: z.number().int().nullable().optional(),
  }),
  output: assetRow,
  handler: async (input, ctx) => {
    if (input.uploadId) {
      const session = await lockedUploadSession(ctx.tx, input.uploadId);
      if (!session) throw new ServiceError("not_found", "That upload is not here.");
      requireUploadAccess(ctx.actor, session.uploadedBy);
      if (session.state === "complete" && session.assetId) {
        const [asset] = await ctx.tx
          .select()
          .from(assets)
          .where(eq(assets.id, session.assetId))
          .limit(1);
        if (asset) return asset;
      }
      if (["aborted", "expired", "failed"].includes(session.state)) {
        throw new ServiceError(
          "conflict",
          "That upload can no longer become a library file.",
        );
      }
    }
    return insertPreparedAsset(
      {
        filename: input.filename,
        mime: input.mime,
        kind: input.kind,
        bytes: input.bytes,
        key: input.key,
        altText: input.altText,
        source: input.source,
        provenance: safeProvenance(ctx, input.source, input.provenance, input.method),
        metadata: input.metadata,
        scan: input.scan,
        checksumSha256: input.checksumSha256,
        uploadId: input.uploadId,
      },
      {
        facts:
          input.width != null && input.height != null
            ? { width: input.width, height: input.height }
            : undefined,
        variants: (input.variants ?? {}),
        trackedKeys: input.trackedKeys,
      },
      ctx,
    );
  },
});

export const uploadAsset = defineOrchestratedService({
  name: "media.upload",
  summary: "Validate and store a bounded proxied upload.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: proxyUploadInput,
  output: assetRow,
  handler: async (input, actor) => {
    if (
      actor.kind === "anonymous" &&
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
      let key = storageKey(input.filename, new Date(), randomUUID().slice(0, 8));
      let uploadId = input.uploadId;
      if (input.uploadId) {
        const claimed = await claimProxyUpload.call(
          {
            uploadId: input.uploadId,
            filename: input.filename,
            bytes: body.byteLength,
          },
          actor,
        );
        if (claimed.asset) return claimed.asset;
        key = claimed.key;
        uploadId = claimed.uploadId;
      }
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
        uploadId,
      });
      const prepared = await prepareDerivedObjects(
        {
          key,
          kind: validated.kind,
          scan,
          body,
          uploadId,
        },
        await loadWatermarkMark(),
      );
      return applyStoredOriginal.call(
        {
          filename: input.filename,
          mime: validated.mime,
          kind: validated.kind,
          bytes: body.byteLength,
          key,
          altText: input.altText,
          source: input.source,
          provenance: input.provenance,
          metadata: input.metadata,
          scan,
          checksumSha256: createHash("sha256").update(body).digest("hex"),
          uploadId,
          method: "proxy",
          variants: prepared.variants,
          trackedKeys: prepared.trackedKeys,
          width: prepared.facts?.width ?? null,
          height: prepared.facts?.height ?? null,
        },
        actor,
      );
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

const beginUploadOutput = z.object({
  id: uuid,
  strategy: z.enum(["direct_multipart", "proxy"]),
  partSize: z.number().int().nullable(),
  partCount: z.number().int().nullable(),
  expiresAt: timestamp,
});

const beginUploadApply = defineService({
  name: "media.beginUploadApply",
  summary: "Record a reserved upload after the storage provider has accepted it.",
  kind: "mutation",
  permission: "public",
  external: false,
  writeClass: "write",
  input: uploadIntent.extend({
    key: z.string().min(1),
    strategy: z.enum(["direct_multipart", "proxy"]),
    providerUploadId: z.string().min(1).optional(),
  }),
  output: beginUploadOutput,
  handler: async (input, ctx) => {
    const [session] = await ctx.tx
      .insert(mediaUploads)
      .values({
        strategy: input.strategy,
        storageKey: input.key,
        filename: input.filename,
        declaredMime: input.contentType,
        expectedBytes: input.bytes,
        providerUploadId: input.providerUploadId,
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
      key: input.key,
      uploadId: session!.id,
      role: "staged",
      state: "pending",
      contentType: input.contentType,
    });
    ctx.setSubject("mediaUpload", session!.id);
    return {
      id: session!.id,
      strategy: input.strategy,
      partSize: input.strategy === "direct_multipart" ? MULTIPART_PART_BYTES : null,
      partCount:
        input.strategy === "direct_multipart"
          ? Math.ceil(input.bytes / MULTIPART_PART_BYTES)
          : null,
      expiresAt: session!.expiresAt,
    };
  },
});

/** Reserve a durable upload and choose the capability the active adapter has. */
export const beginUpload = defineOrchestratedService({
  name: "media.beginUpload",
  summary: "Reserve a resumable direct upload or bounded proxy fallback.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: uploadIntent,
  output: beginUploadOutput,
  handler: async (input, actor) => {
    if (actor.kind === "anonymous" && !input.provenance.captureToken) {
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
      return await beginUploadApply.call(
        {
          ...input,
          key,
          strategy,
          providerUploadId,
        },
        actor,
      );
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

const uploadStatusOutput = z.object({
  id: uuid,
  strategy: z.enum(["direct_multipart", "proxy"]),
  state: z.enum([
    "created",
    "uploading",
    "uploaded",
    "processing",
    "complete",
    "failed",
    "aborted",
    "expired",
  ]),
  filename: z.string(),
  contentType: z.string(),
  expectedBytes: z.number(),
  partSize: z.number().int().nullable(),
  partCount: z.number().int().nullable(),
  parts: listed(
    z.object({
      partNumber: z.number().int(),
      etag: z.string(),
      bytes: z.number().optional(),
    }),
  ),
  assetId: uuid.nullable(),
  failureReason: z.string().nullable(),
  expiresAt: timestamp,
  storageKey: z.string(),
  providerUploadId: z.string().nullable(),
});

const uploadStatusSource = defineService({
  name: "media.uploadStatusSource",
  summary: "Authorize and snapshot an upload reservation before listing provider parts.",
  kind: "query",
  permission: "public",
  external: false,
  input: z.object({ id: z.string().uuid() }),
  output: uploadStatusOutput.omit({ parts: true }),
  handler: async (input, ctx) => {
    const session = await uploadSession(ctx.tx, input.id);
    if (!session) throw new ServiceError("not_found", "That upload is not here.");
    requireUploadAccess(ctx.actor, session.uploadedBy);
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
      assetId: session.assetId,
      failureReason: session.failureReason,
      expiresAt: session.expiresAt,
      storageKey: session.storageKey,
      providerUploadId: session.providerUploadId,
    };
  },
});

export const uploadStatus = defineOrchestratedService({
  name: "media.uploadStatus",
  summary: "Report durable progress for an interrupted upload.",
  kind: "query",
  permission: "public",
  input: z.object({ id: z.string().uuid() }),
  output: uploadStatusOutput.omit({ storageKey: true, providerUploadId: true }),
  handler: async (input, actor) => {
    const session = await uploadStatusSource.call(input, actor);
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
      contentType: session.contentType,
      expectedBytes: session.expectedBytes,
      partSize: session.partSize,
      partCount: session.partCount,
      parts,
      assetId: session.assetId,
      failureReason: session.failureReason,
      expiresAt: session.expiresAt,
    };
  },
});

const signUploadClaim = defineService({
  name: "media.signUploadClaim",
  summary: "Mark a direct upload as accepting parts before signing provider URLs.",
  kind: "mutation",
  permission: "public",
  external: false,
  writeClass: "write",
  input: z.object({
    id: z.string().uuid(),
    partNumbers: z.array(z.number().int().min(1).max(MAX_MULTIPART_PARTS)).min(1).max(25),
  }),
  output: z.object({
    storageKey: z.string(),
    providerUploadId: z.string(),
    expiresAt: timestamp,
    partNumbers: z.array(z.number().int()),
  }),
  handler: async (input, ctx) => {
    const session = await lockedUploadSession(ctx.tx, input.id);
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
    if (!session.providerUploadId) {
      throw new ServiceError("conflict", "Direct uploads are unavailable.");
    }
    const partCount = Math.ceil(session.expectedBytes / MULTIPART_PART_BYTES);
    const partNumbers = [...new Set(input.partNumbers)].sort((a, b) => a - b);
    if (partNumbers.some((part) => part > partCount)) {
      throw new ServiceError("validation", "A requested upload part is outside the file.");
    }
    if (session.state === "created") {
      await ctx.tx
        .update(mediaUploads)
        .set({ state: "uploading", updatedAt: new Date() })
        .where(eq(mediaUploads.id, session.id));
    }
    ctx.setSubject("mediaUpload", session.id);
    return {
      storageKey: session.storageKey,
      providerUploadId: session.providerUploadId,
      expiresAt: session.expiresAt,
      partNumbers,
    };
  },
});

export const signUploadParts = defineOrchestratedService({
  name: "media.signUploadParts",
  summary: "Sign a bounded set of direct multipart upload requests.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: z.object({
    id: z.string().uuid(),
    partNumbers: z.array(z.number().int().min(1).max(MAX_MULTIPART_PARTS)).min(1).max(25),
  }),
  output: z.object({
    parts: listed(
      z.object({
        partNumber: z.number().int(),
        url: z.string(),
        method: z.literal("PUT"),
      }),
    ),
    expiresAt: timestamp,
  }),
  handler: async (input, actor) => {
    const claimed = await signUploadClaim.call(input, actor);
    const multipart = storage().directMultipart;
    if (!multipart) {
      throw new ServiceError("conflict", "Direct uploads are unavailable.");
    }
    const signed = await Promise.all(
      claimed.partNumbers.map(async (partNumber) => ({
        partNumber,
        ...(await multipart.signPart(
          claimed.storageKey,
          claimed.providerUploadId,
          partNumber,
        )),
      })),
    );
    return { parts: signed, expiresAt: claimed.expiresAt };
  },
});

const failDirectUpload = defineService({
  name: "media.failDirectUpload",
  summary: "Record that a direct upload failed validation after provider work.",
  kind: "mutation",
  permission: "public",
  external: false,
  writeClass: "write",
  input: z.object({
    id: z.string().uuid(),
    storageKey: z.string().min(1),
    message: z.string().min(1).max(500),
  }),
  output: z.object({ ok: z.literal(false), message: z.string() }),
  handler: async (input, ctx) => {
    const session = await lockedUploadSession(ctx.tx, input.id);
    if (!session) throw new ServiceError("not_found", "That upload is not here.");
    requireUploadAccess(ctx.actor, session.uploadedBy);
    if (session.state === "failed") {
      return {
        ok: false as const,
        message: session.failureReason ?? input.message,
      };
    }
    if (session.state === "complete") {
      throw new ServiceError("conflict", "That upload already became a library file.");
    }
    await ctx.tx.delete(mediaObjects).where(eq(mediaObjects.key, input.storageKey));
    await ctx.tx
      .update(mediaUploads)
      .set({ state: "failed", failureReason: input.message, updatedAt: new Date() })
      .where(eq(mediaUploads.id, session.id));
    ctx.setSubject("mediaUpload", session.id);
    return { ok: false as const, message: input.message };
  },
});

const applyCaptureComplete = defineService({
  name: "media.applyCaptureComplete",
  summary: "Hold a finished direct upload on a capture session and close the reservation.",
  kind: "mutation",
  permission: "public",
  external: false,
  writeClass: "write",
  input: z.object({
    uploadId: z.string().uuid(),
    token: z.string().optional(),
    sessionId: z.string().uuid().optional(),
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    key: z.string().min(1),
    bytes: z.number().int().positive(),
    checksumSha256: z.string().length(64).optional(),
    detectedMime: z.string().min(1),
  }),
  output: completeUploadResult,
  handler: async (input, ctx) => {
    const { stageCompletedUpload } = await import("./capture");
    await ctx.callAsSystem(stageCompletedUpload, {
      uploadId: input.uploadId,
      token: input.token,
      sessionId: input.sessionId,
      filename: input.filename,
      contentType: input.contentType,
      key: input.key,
      bytes: input.bytes,
      checksumSha256: input.checksumSha256,
    });
    await ctx.tx
      .update(mediaUploads)
      .set({
        state: "complete",
        detectedMime: input.detectedMime,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mediaUploads.id, input.uploadId));
    return { ok: true as const, asset: null };
  },
});

const multipartPartSchema = z.object({
  partNumber: z.number().int().min(1).max(MAX_MULTIPART_PARTS),
  etag: z.string().trim().min(1).max(256),
});

const completeUploadSource = defineService({
  name: "media.completeUploadSource",
  summary: "Authorize a direct upload before assembling and scanning stored bytes.",
  kind: "query",
  permission: "public",
  external: false,
  input: z.object({
    id: z.string().uuid(),
    parts: z.array(multipartPartSchema).min(1).max(MAX_MULTIPART_PARTS),
  }),
  output: z.union([
    z.object({ kind: z.literal("done"), result: completeUploadResult }),
    z.object({
      kind: z.literal("open"),
      id: uuid,
      storageKey: z.string(),
      filename: z.string(),
      declaredMime: z.string(),
      expectedBytes: z.number(),
      providerUploadId: z.string(),
      source: sourceSchema,
      provenance: provenanceSchema,
      metadata: mediaMetadataSchema,
      parts: z.array(multipartPartSchema),
    }),
  ]),
  handler: async (input, ctx) => {
    const session = await uploadSession(ctx.tx, input.id);
    if (!session || session.strategy !== "direct_multipart") {
      throw new ServiceError("not_found", "That direct upload is not here.");
    }
    requireUploadAccess(ctx.actor, session.uploadedBy);
    if (session.state === "complete") {
      const asset = await assetForCompletedUpload(ctx.tx, session);
      if (asset) return { kind: "done" as const, result: { ok: true as const, asset } };
      const provenance = session.provenance as { captureToken?: string; captureSessionId?: string };
      if (provenance.captureToken || provenance.captureSessionId) {
        return { kind: "done" as const, result: { ok: true as const, asset: null } };
      }
      throw new ServiceError(
        "conflict",
        "That upload completed without a recoverable asset record.",
      );
    }
    if (session.state === "failed") {
      return {
        kind: "done" as const,
        result: {
          ok: false as const,
          message: session.failureReason ?? "That upload failed validation.",
        },
      };
    }
    if (session.expiresAt <= new Date()) {
      throw new ServiceError("conflict", "That upload reservation has expired.");
    }
    if (!["created", "uploading", "processing"].includes(session.state)) {
      throw new ServiceError("conflict", "That upload cannot be completed again.");
    }
    if (!session.providerUploadId) {
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
    return {
      kind: "open" as const,
      id: session.id,
      storageKey: session.storageKey,
      filename: session.filename,
      declaredMime: session.declaredMime,
      expectedBytes: session.expectedBytes,
      providerUploadId: session.providerUploadId,
      source: session.source,
      provenance: session.provenance as z.output<typeof provenanceSchema>,
      metadata: session.mediaMetadata as z.output<typeof mediaMetadataSchema>,
      parts,
    };
  },
});

export const completeUpload = defineOrchestratedService({
  name: "media.completeUpload",
  summary: "Assemble, validate, scan, and register a direct upload.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: z.object({
    id: z.string().uuid(),
    parts: z.array(multipartPartSchema).min(1).max(MAX_MULTIPART_PARTS),
    altText: z.string().max(500).optional(),
  }),
  output: completeUploadResult,
  handler: async (input, actor) => {
    const source = await completeUploadSource.call(
      { id: input.id, parts: input.parts },
      actor,
    );
    if (source.kind === "done") return source.result;
    const multipart = storage().directMultipart;
    if (!multipart) {
      throw new ServiceError("conflict", "Direct uploads are unavailable.");
    }

    // If the object store completed the upload but the process died before the
    // database apply committed, HEAD turns the retry into recovery.
    const completed =
      (await storage().head(source.storageKey)) ??
      (await multipart.complete(
        source.storageKey,
        source.providerUploadId,
        source.parts,
      ));
    const fail = async (message: string) => {
      await storage().delete(source.storageKey).catch(() => undefined);
      return failDirectUpload.call(
        { id: source.id, storageKey: source.storageKey, message },
        actor,
      );
    };
    if (completed.bytes !== source.expectedBytes) {
      return fail(
        `The object store received ${completed.bytes} bytes; ${source.expectedBytes} were expected.`,
      );
    }

    const prefix = await storage().readRange(
      source.storageKey,
      0,
      SIGNATURE_BYTES - 1,
    );
    const suffixStart = Math.max(0, completed.bytes - SIGNATURE_BYTES);
    const suffix = suffixStart > 0
      ? await storage().readRange(
          source.storageKey,
          suffixStart,
          completed.bytes - 1,
        )
      : undefined;
    try {
      const validated = validateMediaFile({
        filename: source.filename,
        declaredMime: source.declaredMime,
        bytes: completed.bytes,
        prefix: mediaSignatureSample(
          prefix ?? new Uint8Array(),
          suffix ?? new Uint8Array(),
        ),
      });
      const verified = await scanStoredAndHash(
        source.storageKey,
        source.filename,
        validated.mime,
        completed.bytes,
      );
      const provenance = source.provenance;
      if (provenance.captureToken || provenance.captureSessionId) {
        return applyCaptureComplete.call(
          {
            uploadId: source.id,
            token: provenance.captureToken,
            sessionId: provenance.captureSessionId,
            filename: source.filename,
            contentType: validated.mime,
            key: source.storageKey,
            bytes: completed.bytes,
            checksumSha256: verified.checksumSha256,
            detectedMime: validated.mime,
          },
          actor,
        );
      }
      const prepared = await prepareDerivedObjects(
        {
          key: source.storageKey,
          kind: validated.kind,
          scan: verified.scan,
          uploadId: source.id,
        },
        await loadWatermarkMark(),
      );
      const asset = await applyStoredOriginal.call(
        {
          filename: source.filename,
          mime: validated.mime,
          kind: validated.kind,
          bytes: completed.bytes,
          key: source.storageKey,
          altText: input.altText,
          source: source.source,
          provenance,
          metadata: source.metadata,
          scan: verified.scan,
          checksumSha256: verified.checksumSha256,
          uploadId: source.id,
          method: "direct_multipart",
          variants: prepared.variants,
          trackedKeys: prepared.trackedKeys,
          width: prepared.facts?.width ?? null,
          height: prepared.facts?.height ?? null,
        },
        actor,
      );
      return { ok: true as const, asset };
    } catch (error) {
      if (error instanceof MediaValidationError) {
        return fail(error.message);
      }
      throw error;
    }
  },
});

export const registerStoredOriginal = defineOrchestratedService({
  name: "media.registerStoredOriginal",
  summary: "Turn an already-stored original into a library Asset.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
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
  output: assetRow,
  handler: async (input, actor) => {
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
      const verified = await scanStoredAndHash(
        input.key,
        input.filename,
        validated.mime,
        input.bytes,
      );
      const prepared = await prepareDerivedObjects(
        {
          key: input.key,
          kind: validated.kind,
          scan: verified.scan,
        },
        await loadWatermarkMark(),
      );
      return applyStoredOriginal.call(
        {
          filename: input.filename,
          mime: validated.mime,
          kind: validated.kind,
          bytes: input.bytes,
          key: input.key,
          altText: input.altText,
          source: input.source,
          provenance: input.provenance,
          metadata: input.metadata,
          scan: verified.scan,
          checksumSha256: input.checksumSha256 ?? verified.checksumSha256,
          method: "proxy",
          variants: prepared.variants,
          trackedKeys: prepared.trackedKeys,
          width: prepared.facts?.width ?? null,
          height: prepared.facts?.height ?? null,
        },
        actor,
      );
    } catch (error) {
      return serviceValidation(error);
    }
  },
});

const abortUploadClaim = defineService({
  name: "media.abortUploadClaim",
  summary: "Mark an unfinished upload aborted before deleting provider bytes.",
  kind: "mutation",
  permission: "public",
  external: false,
  writeClass: "write",
  input: z.object({ id: z.string().uuid() }),
  output: z.object({
    alreadyTerminal: z.boolean(),
    storageKey: z.string(),
    providerUploadId: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    const session = await lockedUploadSession(ctx.tx, input.id);
    if (!session) throw new ServiceError("not_found", "That upload is not here.");
    requireUploadAccess(ctx.actor, session.uploadedBy);
    if (["complete", "failed", "aborted", "expired"].includes(session.state)) {
      return {
        alreadyTerminal: true,
        storageKey: session.storageKey,
        providerUploadId: session.providerUploadId,
      };
    }
    await ctx.tx
      .update(mediaUploads)
      .set({ state: "aborted", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(mediaUploads.id, session.id));
    ctx.setSubject("mediaUpload", session.id);
    return {
      alreadyTerminal: false,
      storageKey: session.storageKey,
      providerUploadId: session.providerUploadId,
    };
  },
});

const abortUploadApply = defineService({
  name: "media.abortUploadApply",
  summary: "Drop the staged object ledger after provider bytes are gone.",
  kind: "mutation",
  permission: "public",
  external: false,
  writeClass: "write",
  input: z.object({ id: z.string().uuid(), storageKey: z.string().min(1) }),
  output: okResult,
  handler: async (input, ctx) => {
    await ctx.tx.delete(mediaObjects).where(eq(mediaObjects.key, input.storageKey));
    ctx.setSubject("mediaUpload", input.id);
    return { ok: true };
  },
});

export const abortUpload = defineOrchestratedService({
  name: "media.abortUpload",
  summary: "Abort an unfinished upload and remove its staged bytes.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: z.object({ id: z.string().uuid() }),
  output: okResult,
  handler: async (input, actor) => {
    const claimed = await abortUploadClaim.call(input, actor);
    if (claimed.alreadyTerminal) return { ok: true };
    const multipart = storage().directMultipart;
    if (multipart && claimed.providerUploadId) {
      await multipart.abort(claimed.storageKey, claimed.providerUploadId);
    }
    await storage().delete(claimed.storageKey);
    return abortUploadApply.call(
      { id: input.id, storageKey: claimed.storageKey },
      actor,
    );
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
  output: z.object({
    rows: listed(assetRow),
    total: z.number(),
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
  output: assetRow,
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
  output: z
    .object({
      src: z.string(),
      sources: listed(
        z.object({
          format: z.string(),
          srcset: z.string(),
          type: z.string(),
        }),
      ),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      altText: z.string().nullable(),
    })
    .nullable(),
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
    // publicRenditions, not Object.entries: a watermarked rendition is stored
    // on the same row and must never become a source on a public page.
    for (const [format, renditions] of publicRenditions(variants)) {
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
  output: z
    .object({
      id: uuid,
      kind: z.enum(["video", "doc", "audio"]),
      src: z.string(),
      mime: z.string(),
      filename: z.string(),
      bytes: z.number(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      durationSeconds: z.number().int().nullable(),
    })
    .nullable(),
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
  output: row({
    storageKey: z.string(),
    filename: z.string(),
    mime: z.string(),
    bytes: z.number(),
  }).nullable(),
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
  output: row({
    contentType: z.string(),
    filename: z.string(),
    kind: z.enum(["image", "video", "doc", "audio"]),
  }).nullable(),
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

const watermarkBackfillSource = row({
  id: uuid,
  storageKey: z.string(),
  mime: z.string(),
  variants: z.unknown(),
});

const watermarkedRendition = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number(),
  key: z.string().min(1),
});

function alreadyWatermarked(variants: unknown): boolean {
  return Boolean(
    variants && typeof variants === "object" && "watermarked" in variants,
  );
}

const listWatermarkBackfill = defineService({
  name: "media.listWatermarkBackfill",
  summary: "Snapshot unmarked ready images for one backfill batch.",
  kind: "query",
  permission: "system",
  input: z.object({ limit: z.number().int().min(1).max(100) }),
  output: listed(watermarkBackfillSource),
  handler: async (input, ctx) => {
    return ctx.tx
      .select({
        id: assets.id,
        storageKey: assets.storageKey,
        mime: assets.mime,
        variants: assets.variants,
      })
      .from(assets)
      .where(
        and(
          eq(assets.kind, "image"),
          eq(assets.status, "ready"),
          sql`not (${assets.variants} ? 'watermarked')`,
        ),
      )
      .limit(input.limit);
  },
});

const applyWatermarkBackfill = defineService({
  name: "media.applyWatermarkBackfill",
  summary: "Attach one asset's watermarked renditions after storage work.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({
    id: uuid,
    storageKey: z.string().min(1),
    mime: z.string().min(1),
    variantKeys: z.array(z.string().min(1)).max(64),
    watermarked: z.object({
      avif: z.array(watermarkedRendition).optional(),
      webp: z.array(watermarkedRendition).optional(),
    }),
  }),
  output: z.object({ attached: z.boolean() }),
  handler: async (input, ctx) => {
    const [current] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1)
      .for("update");
    if (
      !current ||
      current.status !== "ready" ||
      current.kind !== "image" ||
      current.storageKey !== input.storageKey ||
      current.mime !== input.mime ||
      alreadyWatermarked(current.variants)
    ) {
      // Storage may already have written pending objects. Leave them
      // sweepable rather than attaching marks to a file that moved on.
      return { attached: false };
    }
    const currentSet = current.variants as VariantSet;
    if (input.variantKeys.length > 0) {
      await attachObjects(ctx.tx, input.variantKeys, current.id);
    }
    await ctx.tx
      .update(assets)
      .set({
        variants: { ...currentSet, watermarked: input.watermarked },
        updatedAt: new Date(),
      })
      .where(eq(assets.id, current.id));
    ctx.setSubject("asset", current.id);
    return { attached: input.variantKeys.length > 0 };
  },
});

/**
 * Add the marks that did not exist when a photograph was uploaded (C8.04).
 *
 * Watermarked renditions are built on upload, which leaves every image
 * already in the library unmarked — and a gallery that refuses to serve an
 * unmarked file would render an empty grid the first time an owner ticks
 * "watermark" on work they delivered last year. This walks that backlog a
 * batch at a time, one durable asset at a time: storage I/O is outside the
 * short list/apply transactions, and a losing apply leaves only sweepable
 * pending objects.
 *
 * An image that cannot be marked records an empty `watermarked` set rather
 * than nothing, so the next batch moves past it instead of retrying the
 * same unmarkable file forever.
 */
export const backfillWatermarks = defineOrchestratedService({
  name: "media.backfillWatermarks",
  summary: "Add missing watermarked renditions to images already in the library.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
  output: row({ marked: z.number().int(), skipped: z.number().int() }),
  handler: async (input, actor) => {
    const mark = await loadWatermarkMark();
    if (!mark) return { marked: 0, skipped: 0 };
    const candidates = await listWatermarkBackfill.call(
      { limit: input.limit },
      actor,
    );

    let marked = 0;
    let skipped = 0;
    for (const asset of candidates) {
      const body = isRasterImage(asset.mime)
        ? await storage().get(asset.storageKey)
        : undefined;
      const facts = body ? await readImageFacts(body) : undefined;
      const built =
        body && facts
          ? await buildWatermarked(body, facts, mark, (format, width) =>
              `${asset.storageKey}.wm.${width}.${format}`,
            )
          : [];
      if (built.length > 0) {
        await putTrackedObjects(
          built.map((rendition) => ({
            key: rendition.key,
            body: rendition.body,
            contentType: rendition.contentType,
            role: "variant" as const,
          })),
        );
      }
      const result = await applyWatermarkBackfill.call(
        {
          id: asset.id,
          storageKey: asset.storageKey,
          mime: asset.mime,
          variantKeys: built.map((rendition) => rendition.key),
          watermarked: withWatermarked({}, built).watermarked ?? {},
        },
        actor,
      );
      if (result.attached) marked += 1;
      else skipped += 1;
    }
    return { marked, skipped };
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
  output: assetRow,
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

type AltTextSuggestionSource = Pick<
  typeof assets.$inferSelect,
  "id" | "storageKey" | "mime" | "variants" | "checksumSha256" | "altText"
>;

const altTextSuggestionSource = z.object({
  id: uuid,
  storageKey: z.string(),
  mime: z.string(),
  variants: z.unknown(),
  checksumSha256: z.string().nullable(),
  altText: z.string().nullable(),
});

function sourceIdentity(asset: {
  checksumSha256: string | null;
  storageKey: string;
}): string {
  return asset.checksumSha256 ?? `storage:${asset.storageKey}`;
}

async function suggestionPreview(asset: AltTextSuggestionSource): Promise<{
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
  output: z.object({
    ...suggestionProviderState,
    suggestion: suggestionRow.nullable(),
  }),
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
  output: z.object({
    ...suggestionProviderState,
    suggestions: listed(suggestionRow),
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
const altTextSuggestionSourceService = defineService({
  name: "media.altTextSuggestionSource",
  summary: "Authorize and snapshot an image before provider-assisted alt-text generation.",
  kind: "query",
  permission: "scoped",
  agentCallable: false,
  external: false,
  input: z.object({ id: z.string().uuid() }),
  output: altTextSuggestionSource,
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
    return asset;
  },
});

const applyAltTextSuggestion = defineService({
  name: "media.applyAltTextSuggestion",
  summary: "Revalidate an image and atomically store a provider-generated alt-text proposal.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  external: false,
  writeClass: "write",
  input: z.object({
    id: z.string().uuid(),
    suggestion: z.string().trim().min(1).max(500),
    provider: z.string().min(1),
    model: z.string().min(1),
    sourceChecksum: z.string().min(1),
    authoredAltTextAtRequest: z.string().nullable(),
  }),
  output: suggestionRow,
  handler: async (input, ctx) => {
    requireHumanReview(ctx.actor);
    const now = new Date();
    const reviewer = actorString(ctx.actor);
    // The provider runs outside this transaction. Re-lock and compare its
    // source snapshot so newer image bytes or authored text always win.
    const [currentAsset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1)
      .for("update");
    if (
      !currentAsset ||
      currentAsset.status !== "ready" ||
      currentAsset.kind !== "image" ||
      sourceIdentity(currentAsset) !== input.sourceChecksum ||
      currentAsset.altText !== input.authoredAltTextAtRequest
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
          eq(mediaAltTextSuggestions.assetId, currentAsset.id),
          eq(mediaAltTextSuggestions.status, "ready"),
        ),
      );
    const [stored] = await ctx.tx
      .insert(mediaAltTextSuggestions)
      .values({
        assetId: currentAsset.id,
        suggestion: input.suggestion,
        provider: input.provider,
        model: input.model,
        promptVersion: ALT_TEXT_PROMPT_VERSION,
        sourceChecksum: input.sourceChecksum,
        authoredAltTextAtRequest: input.authoredAltTextAtRequest,
        requestedBy: reviewer,
      })
      .returning();
    ctx.setSubject("asset", currentAsset.id);
    ctx.queueEvent("media.altTextSuggested", {
      assetId: currentAsset.id,
      suggestionId: stored!.id,
      provider: stored!.provider,
      model: stored!.model,
    });
    return stored!;
  },
});

export const generateAltTextSuggestion = defineOrchestratedService({
  name: "media.generateAltTextSuggestion",
  summary: "Generate an image description for explicit human review.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  rateLimit: {
    windowSeconds: 60 * 60,
    limit: 5,
    subject: (input) => input.id,
    message: "That image has had several suggestions generated recently. Review one or try again later.",
  },
  input: z.object({ id: z.string().uuid() }),
  output: suggestionRow,
  handler: async (input, actor) => {
    requireHumanReview(actor);
    const asset = await altTextSuggestionSourceService.call(input, actor);
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
    return applyAltTextSuggestion.call(
      {
        id: asset.id,
        suggestion,
        provider: generated.provider,
        model: generated.model,
        sourceChecksum: sourceIdentity(asset),
        authoredAltTextAtRequest: asset.altText,
      },
      actor,
    );
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
  output: assetRow,
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
  output: okResult,
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
  output: assetRow,
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
  output: assetRow,
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
  output: z.object({
    pages: z.number(),
    sections: z.number(),
  }),
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
  output: assetRow,
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
  output: assetRow,
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

function contentTypeForPurgeKey(
  key: string,
  asset: typeof assets.$inferSelect,
): string {
  if (key === asset.storageKey) return asset.mime;
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".avif")) return "image/avif";
  return asset.mime;
}

function collectPurgeKeys(asset: typeof assets.$inferSelect, inventoryKeys: string[]): string[] {
  const keys = new Set(inventoryKeys);
  keys.add(asset.storageKey);
  for (const key of allRenditionKeys(asset.variants as VariantSet)) keys.add(key);
  return [...keys];
}

/**
 * Make the library row disappear first. Bytes stay as pending objects so a
 * crash after this commit is sweepable litter, never a visible file with
 * missing originals.
 */
async function claimPurge(
  tx: Tx,
  asset: typeof assets.$inferSelect,
): Promise<{ assetId: string; keys: string[] }> {
  const inventory = await tx
    .select({ key: mediaObjects.key })
    .from(mediaObjects)
    .where(eq(mediaObjects.assetId, asset.id));
  const keys = collectPurgeKeys(
    asset,
    inventory.map((row) => row.key),
  );
  if (inventory.length > 0) {
    await tx
      .update(mediaObjects)
      .set({ assetId: null, state: "pending", updatedAt: new Date() })
      .where(eq(mediaObjects.assetId, asset.id));
  }
  const tracked = new Set(inventory.map((row) => row.key));
  const untracked = keys.filter((key) => !tracked.has(key));
  if (untracked.length > 0) {
    await tx
      .insert(mediaObjects)
      .values(
        untracked.map((key) => ({
          key,
          contentType: contentTypeForPurgeKey(key, asset),
          role:
            key === asset.storageKey
              ? ("original" as const)
              : ("variant" as const),
          state: "pending" as const,
        })),
      )
      .onConflictDoNothing();
  }
  await tx.delete(assets).where(eq(assets.id, asset.id));
  return { assetId: asset.id, keys };
}

async function deleteStoredKeys(keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await storage().delete(key);
    } catch {
      // The row is already gone. A failed delete stays as a pending object
      // the orphan sweep can finish; throwing here would look like the
      // library file survived when it did not.
    }
  }
}

const purgeClaimOutput = z.object({
  assetId: uuid,
  keys: z.array(z.string().min(1)),
});

const purgeClaim = defineService({
  name: "media.purgeClaim",
  summary: "Hide a trashed file from the library before its bytes are deleted.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({ id: z.string().uuid(), confirmation: z.string().max(255) }),
  output: purgeClaimOutput,
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
      .limit(1)
      .for("update");
    if (!asset || asset.status !== "trashed") {
      throw new ServiceError("not_found", "That trashed file is not here.");
    }
    if (input.confirmation !== asset.filename) {
      throw new ServiceError(
        "validation",
        "Type the exact filename to confirm permanent deletion.",
      );
    }
    const result = await claimPurge(ctx.tx, asset);
    ctx.setSubject("asset", result.assetId);
    ctx.queueEvent("media.purged", {
      assetId: result.assetId,
      objects: result.keys.length,
    });
    return result;
  },
});

const purgeExpiredClaim = defineService({
  name: "media.purgeExpiredClaim",
  summary: "Hide expired trash from the library before its bytes are deleted.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({
    id: z.string().uuid(),
    asOf: z.string().datetime().optional(),
  }),
  output: purgeClaimOutput,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "system") {
      throw new ServiceError("permission", "Only lifecycle maintenance can run this operation.");
    }
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1)
      .for("update");
    if (
      !asset ||
      asset.status !== "trashed" ||
      !asset.purgeAfter ||
      asset.purgeAfter > (input.asOf ? new Date(input.asOf) : new Date())
    ) {
      throw new ServiceError("conflict", "That asset is not due for purge.");
    }
    const result = await claimPurge(ctx.tx, asset);
    ctx.setSubject("asset", result.assetId);
    ctx.queueEvent("media.purged", {
      assetId: result.assetId,
      objects: result.keys.length,
    });
    return result;
  },
});

const purgeApply = defineService({
  name: "media.purgeApply",
  summary: "Drop pending object rows after purge has deleted provider bytes.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({ keys: z.array(z.string().min(1)).max(256) }),
  output: okResult,
  handler: async (input, ctx) => {
    if (input.keys.length === 0) return { ok: true as const };
    await ctx.tx
      .delete(mediaObjects)
      .where(
        and(inArray(mediaObjects.key, input.keys), eq(mediaObjects.state, "pending")),
      );
    return { ok: true as const };
  },
});

export const purgeAsset = defineOrchestratedService({
  name: "media.purge",
  summary: "Permanently purge one trashed file after typed owner confirmation.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  writeClass: "write",
  input: z.object({ id: z.string().uuid(), confirmation: z.string().max(255) }),
  output: z.object({
    ok: z.literal(true),
    assetId: uuid,
    objects: z.number().int(),
  }),
  handler: async (input, actor) => {
    const claimed = await purgeClaim.call(input, actor);
    await deleteStoredKeys(claimed.keys);
    await purgeApply.call({ keys: claimed.keys }, actor);
    return { ok: true as const, assetId: claimed.assetId, objects: claimed.keys.length };
  },
});

/** Scheduler-only purge lane; still goes through audit and event invariants. */
export const purgeExpiredAsset = defineOrchestratedService({
  name: "media.purgeExpired",
  summary: "Purge one asset after its recoverable trash window expires.",
  kind: "mutation",
  permission: "system",
  writeClass: "write",
  input: z.object({
    id: z.string().uuid(),
    asOf: z.string().datetime().optional(),
  }),
  output: z.object({
    assetId: uuid,
    objects: z.number().int(),
  }),
  handler: async (input, actor) => {
    const claimed = await purgeExpiredClaim.call(input, actor);
    await deleteStoredKeys(claimed.keys);
    await purgeApply.call({ keys: claimed.keys }, actor);
    return { assetId: claimed.assetId, objects: claimed.keys.length };
  },
});

const rescanSource = z.object({
  id: uuid,
  storageKey: z.string(),
  filename: z.string(),
  mime: z.string(),
  bytes: z.number(),
  kind: z.enum(["image", "video", "doc", "audio"]),
  status: z.enum(["processing", "ready", "quarantined", "failed", "trashed"]),
  variants: z.unknown(),
  checksumSha256: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

const rescanSourceService = defineService({
  name: "media.rescanSource",
  summary: "Authorize and snapshot a file before scanning it again.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: z.object({ id: z.string().uuid() }),
  output: rescanSource,
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset || asset.status === "trashed") {
      throw new ServiceError("not_found", "That file is not here.");
    }
    return asset;
  },
});

const applyRescan = defineService({
  name: "media.applyRescan",
  summary: "Revalidate a file and atomically store a completed rescan.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    id: z.string().uuid(),
    sourceChecksum: z.string().min(1),
    storageKey: z.string().min(1),
    bytes: z.number(),
    mime: z.string().min(1),
    scanStatus: z.enum(["pending", "clean", "not_configured", "infected", "error"]),
    scanEngine: z.string().nullable(),
    scanMessage: z.string().nullable(),
    scannedAt: timestamp.nullable(),
    status: z.enum(["processing", "ready", "quarantined", "failed", "trashed"]),
    variantKeys: z.array(z.string().min(1)).max(64),
    variants: z.unknown(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
  }),
  output: assetRow,
  handler: async (input, ctx) => {
    // Scanner and storage work ran outside this transaction. Re-lock and
    // compare the source snapshot so a concurrent edit always wins, and so
    // newly written renditions stay sweepable pending objects instead of
    // attaching to a file that is no longer the one we scanned.
    const [current] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1)
      .for("update");
    if (!current || current.status === "trashed") {
      throw new ServiceError("not_found", "That file is not here.");
    }
    if (
      sourceIdentity(current) !== input.sourceChecksum ||
      current.storageKey !== input.storageKey ||
      current.bytes !== input.bytes ||
      current.mime !== input.mime
    ) {
      throw new ServiceError(
        "conflict",
        "The file changed while it was being scanned. Nothing was overwritten; try again from the current file.",
      );
    }
    const currentVariants = current.variants as VariantSet;
    const attachKeys =
      input.variantKeys.length > 0 && Object.keys(currentVariants).length === 0
        ? input.variantKeys
        : [];
    if (attachKeys.length > 0) {
      await attachObjects(ctx.tx, attachKeys, current.id);
    }
    const [updated] = await ctx.tx
      .update(assets)
      .set({
        scanStatus: input.scanStatus,
        scanEngine: input.scanEngine,
        scanMessage: input.scanMessage,
        scannedAt: input.scannedAt,
        status: input.status,
        variants: attachKeys.length > 0 ? input.variants : current.variants,
        width: attachKeys.length > 0 ? input.width : current.width,
        height: attachKeys.length > 0 ? input.height : current.height,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, current.id))
      .returning();
    ctx.setSubject("asset", current.id);
    ctx.queueEvent("media.scanned", {
      assetId: current.id,
      scanStatus: updated!.scanStatus,
    });
    return updated!;
  },
});

export const rescanAsset = defineOrchestratedService({
  name: "media.rescan",
  summary: "Run the configured malware scanner against an original again.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id: z.string().uuid() }),
  output: assetRow,
  handler: async (input, actor) => {
    const asset = await rescanSourceService.call(input, actor);
    let scan;
    try {
      scan = await scanStored(
        asset.storageKey,
        asset.filename,
        asset.mime,
        asset.bytes,
      );
    } catch {
      throw new ServiceError(
        "conflict",
        "The original file is missing or could not be scanned.",
      );
    }
    const fields = scanFields(scan);
    const status =
      scan.status === "not_configured" && asset.status === "quarantined"
        ? ("quarantined" as const)
        : fields.status;
    let variants = asset.variants;
    let width = asset.width;
    let height = asset.height;
    const variantKeys: string[] = [];
    if (
      status === "ready" &&
      asset.kind === "image" &&
      Object.keys(asset.variants as VariantSet).length === 0
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
      variantKeys.push(...built.map((rendition) => rendition.key));
      variants = toVariantSet(built);
      width = facts.width;
      height = facts.height;
    }
    return applyRescan.call(
      {
        id: asset.id,
        sourceChecksum: sourceIdentity(asset),
        storageKey: asset.storageKey,
        bytes: asset.bytes,
        mime: asset.mime,
        ...fields,
        status,
        variantKeys,
        variants,
        width,
        height,
      },
      actor,
    );
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
  claimProxyUpload,
  applyStoredOriginal,
  beginUpload,
  beginUploadApply,
  uploadStatus,
  uploadStatusSource,
  signUploadParts,
  signUploadClaim,
  completeUpload,
  completeUploadSource,
  failDirectUpload,
  applyCaptureComplete,
  registerStoredOriginal,
  abortUpload,
  abortUploadClaim,
  abortUploadApply,
  listAssets,
  getAsset,
  resolveImage,
  resolveAsset,
  authorizeAssetDownload,
  authorizeObjectDelivery,
  backfillWatermarks,
  listWatermarkBackfill,
  applyWatermarkBackfill,
  assetUsage,
  altTextSuggestionState,
  listAltTextSuggestionStates,
  generateAltTextSuggestion,
  altTextSuggestionSourceService,
  applyAltTextSuggestion,
  acceptAltTextSuggestion,
  dismissAltTextSuggestion,
  setAltText,
  setFocalPoint,
  updateAssetDetails,
  trashAsset,
  restoreAsset,
  purgeAsset,
  purgeClaim,
  purgeExpiredAsset,
  purgeExpiredClaim,
  purgeApply,
  rescanAsset,
  rescanSourceService,
  applyRescan,
  ...captureServices,
];
