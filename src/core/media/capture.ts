// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Capture and phone ingest sessions (MASTER.md §4.5, C1.28, C1.29).

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import encodeQR from "qr";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, actorString, type ServiceContext } from "@/core/service";
import { siteOrigin } from "@/core/seo/origin";
import { storage } from "@/adapters/storage";
import {
  CAPTURE_SOURCES,
  CAPTURE_STATUSES,
  mediaCaptureChunks,
  mediaCaptureItems,
  mediaCaptureSessions,
  mediaObjects,
} from "./schema";

const CAPTURE_TTL_MS = 24 * 60 * 60 * 1000;
const id = z.string().uuid();
const token = z.string().trim().min(16).max(128);
const source = z.enum(CAPTURE_SOURCES);

const captureSessionView = row({
  id: uuid,
  source: z.enum(CAPTURE_SOURCES),
  status: z.enum(CAPTURE_STATUSES),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  uploadCount: z.number().int(),
  displaySurface: z.string().nullable(),
  permissionGrantedAt: timestamp.nullable(),
  trimStartMs: z.number().int(),
  trimEndMs: z.number().int().nullable(),
  caption: z.string().nullable(),
  focalX: z.number().int(),
  focalY: z.number().int(),
  staged: z.boolean(),
  stagedMime: z.string().nullable(),
  stagedFilename: z.string().nullable(),
  items: listed(
    z.object({
      id: uuid,
      filename: z.string(),
      bytes: z.number(),
      mime: z.string(),
      assetId: uuid.nullable(),
    }),
  ),
  uploadId: uuid.nullable(),
  assetId: uuid.nullable(),
  expiresAt: timestamp,
  completedAt: timestamp.nullable(),
  captureUrl: z.string().nullable(),
});

function newToken(): string {
  return randomBytes(32).toString("hex");
}

function publicSession(
  row: typeof mediaCaptureSessions.$inferSelect,
  items: Array<{
    id: string;
    filename: string;
    stagedBytes: number;
    stagedMime: string;
    assetId: string | null;
  }> = [],
) {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    targetType: row.targetType,
    targetId: row.targetId,
    uploadCount: row.uploadCount,
    displaySurface: row.displaySurface,
    permissionGrantedAt: row.permissionGrantedAt,
    trimStartMs: row.trimStartMs,
    trimEndMs: row.trimEndMs,
    caption: row.caption,
    focalX: row.focalX,
    focalY: row.focalY,
    staged: Boolean(row.stagedKey) || items.some((item) => !item.assetId),
    stagedMime: row.stagedMime,
    stagedFilename: row.stagedFilename,
    items: items.map((item) => ({
      id: item.id,
      filename: item.filename,
      bytes: item.stagedBytes,
      mime: item.stagedMime,
      assetId: item.assetId,
    })),
    uploadId: row.uploadId,
    assetId: row.assetId,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    captureUrl: row.token ? `${siteOrigin()}/capture/${row.token}` : null,
  };
}

async function present(
  ctx: ServiceContext,
  row: typeof mediaCaptureSessions.$inferSelect,
) {
  const items = await ctx.tx
    .select({
      id: mediaCaptureItems.id,
      filename: mediaCaptureItems.filename,
      stagedBytes: mediaCaptureItems.stagedBytes,
      stagedMime: mediaCaptureItems.stagedMime,
      assetId: mediaCaptureItems.assetId,
    })
    .from(mediaCaptureItems)
    .where(eq(mediaCaptureItems.sessionId, row.id))
    .orderBy(asc(mediaCaptureItems.createdAt));
  return publicSession(row, items);
}

async function load(ctx: ServiceContext, sessionId: string) {
  const [row] = await ctx.tx
    .select()
    .from(mediaCaptureSessions)
    .where(eq(mediaCaptureSessions.id, sessionId))
    .limit(1);
  if (!row) throw new ServiceError("not_found", "That capture session is not here.");
  if (row.expiresAt.getTime() <= Date.now() && row.status !== "confirmed") {
    if (row.status !== "expired") {
      await ctx.tx
        .update(mediaCaptureSessions)
        .set({ status: "expired" })
        .where(eq(mediaCaptureSessions.id, row.id));
    }
    throw new ServiceError("conflict", "That capture session has expired.");
  }
  return row;
}

async function clearChunks(ctx: ServiceContext, sessionId: string) {
  const chunks = await ctx.tx
    .select()
    .from(mediaCaptureChunks)
    .where(eq(mediaCaptureChunks.sessionId, sessionId));
  for (const chunk of chunks) {
    await storage().delete(chunk.storageKey).catch(() => undefined);
  }
  if (chunks.length > 0) {
    await ctx.tx.delete(mediaCaptureChunks).where(eq(mediaCaptureChunks.sessionId, sessionId));
  }
}

async function clearItems(ctx: ServiceContext, sessionId: string, onlyUnconfirmed = false) {
  const items = await ctx.tx
    .select()
    .from(mediaCaptureItems)
    .where(eq(mediaCaptureItems.sessionId, sessionId));
  for (const item of items) {
    if (onlyUnconfirmed && item.assetId) continue;
    if (!item.assetId) {
      await storage().delete(item.stagedKey).catch(() => undefined);
    }
  }
  await ctx.tx.delete(mediaCaptureItems).where(
    onlyUnconfirmed
      ? and(eq(mediaCaptureItems.sessionId, sessionId), sql`${mediaCaptureItems.assetId} is null`)
      : eq(mediaCaptureItems.sessionId, sessionId),
  );
}

async function appendItem(
  ctx: ServiceContext,
  existing: typeof mediaCaptureSessions.$inferSelect,
  input: {
    filename: string;
    contentType: string;
    key: string;
    bytes: number;
    uploadId?: string;
    checksumSha256?: string;
  },
) {
  if (!input.uploadId) {
    await ctx.tx
      .insert(mediaObjects)
      .values({
        key: input.key,
        role: "original",
        state: "pending",
        bytes: input.bytes,
        contentType: input.contentType,
      })
      .onConflictDoNothing();
  }
  await ctx.tx.insert(mediaCaptureItems).values({
    sessionId: existing.id,
    filename: input.filename,
    stagedKey: input.key,
    stagedBytes: input.bytes,
    stagedMime: input.contentType,
    uploadId: input.uploadId,
    checksumSha256: input.checksumSha256,
  });
  const [updated] = await ctx.tx
    .update(mediaCaptureSessions)
    .set({
      status: "preview",
      stagedKey: input.key,
      stagedBytes: input.bytes,
      stagedMime: input.contentType,
      stagedFilename: input.filename,
      uploadCount: existing.uploadCount + 1,
    })
    .where(eq(mediaCaptureSessions.id, existing.id))
    .returning();
  return updated!;
}

async function applyCaptureTarget(
  ctx: ServiceContext,
  session: typeof mediaCaptureSessions.$inferSelect,
  assetIds: string[],
) {
  if (assetIds.length === 0) return;
  const kind = session.targetType;
  const targetId = session.targetId;
  if (!kind || kind === "library" || !targetId) return;

  if (kind === "product") {
    const { attachProductMedia, getProduct } = await import("@/modules/catalog/service");
    let version = (await ctx.callAsSystem(getProduct, { id: targetId })).product.version;
    for (const assetId of assetIds) {
      const updated = await ctx.callAsSystem(attachProductMedia, {
        productId: targetId,
        assetId,
        expectedVersion: version,
      });
      version = updated.version;
    }
    return;
  }

  if (kind === "page") {
    const { getPage, updatePage } = await import("@/modules/cms/service");
    const page = await ctx.callAsSystem(getPage, { id: targetId });
    const current = (page.workingBlocks ?? page.blocks) as Array<{
      id: string;
      type: string;
      props: Record<string, unknown>;
    }>;
    const added = assetIds.map((assetId, index) => ({
      id: `capture-${assetId.slice(0, 8)}-${index}`,
      type: "image",
      props: { assetId, width: "column", rounded: true },
    }));
    await ctx.callAsSystem(updatePage, {
      id: page.id,
      expectedVersion: page.version,
      blocks: [...current, ...added],
    });
  }
}

export const stageCompletedUpload = defineService({
  name: "media.stageCompletedUpload",
  summary: "Hold a finished resumable upload on a capture session until confirm.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    uploadId: id,
    token: token.optional(),
    sessionId: id.optional(),
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    key: z.string().min(1).max(500),
    bytes: z.number().int().positive(),
    checksumSha256: z.string().length(64).optional(),
  }),
  output: captureSessionView,
  handler: async (input, ctx) => {
    if (!input.token && !input.sessionId) {
      throw new ServiceError("validation", "Identify the capture session.");
    }
    if (ctx.actor.kind === "anonymous" && !input.token) {
      throw new ServiceError("permission", "A phone ingest needs its upload link.");
    }
    const [row] = input.token
      ? await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.token, input.token))
          .limit(1)
      : await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.id, input.sessionId!))
          .limit(1);
    if (!row) throw new ServiceError("not_found", "That capture session is not here.");
    const existing = await load(ctx, row.id);
    if (["confirmed", "discarded", "expired"].includes(existing.status)) {
      throw new ServiceError("conflict", "That capture session is closed.");
    }
    const updated = await appendItem(ctx, existing, {
      filename: input.filename,
      contentType: input.contentType,
      key: input.key,
      bytes: input.bytes,
      uploadId: input.uploadId,
      checksumSha256: input.checksumSha256,
    });
    ctx.setSubject("mediaCaptureSession", existing.id);
    ctx.queueEvent("media.captureAttached", { sessionId: existing.id });
    return present(ctx, updated);
  },
});

async function stageOriginal(
  ctx: ServiceContext,
  existing: typeof mediaCaptureSessions.$inferSelect,
  input: { filename: string; contentType: string; bytes: Uint8Array },
) {
  if (input.bytes.byteLength === 0) {
    throw new ServiceError("validation", "An empty recording cannot be stored.");
  }
  const key = `capture/${existing.id}/item/${randomBytes(8).toString("hex")}`;
  const body = new Uint8Array(input.bytes.byteLength);
  body.set(input.bytes);
  await storage().put(key, body, input.contentType);
  return appendItem(ctx, existing, {
    filename: input.filename,
    contentType: input.contentType,
    key,
    bytes: input.bytes.byteLength,
  });
}

export const createCaptureSession = defineService({
  name: "media.createCaptureSession",
  summary: "Open an explicit screen, camera or microphone recording session.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    source: z.enum(["camera", "microphone", "screen"]),
    targetType: z.string().trim().max(80).optional(),
    targetId: z.string().trim().max(80).optional(),
  }),
  output: captureSessionView,
  handler: async (input, ctx) => {
    const [created] = await ctx.tx
      .insert(mediaCaptureSessions)
      .values({
        createdBy: actorString(ctx.actor),
        source: input.source,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        expiresAt: new Date(Date.now() + CAPTURE_TTL_MS),
      })
      .returning();
    ctx.setSubject("mediaCaptureSession", created!.id);
    ctx.queueEvent("media.captureStarted", { sessionId: created!.id, source: created!.source });
    return present(ctx, created!);
  },
});

export const createUploadLink = defineService({
  name: "media.createUploadLink",
  summary: "Create an expiring no-app upload link and QR for phone ingest.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    source: z.enum(["upload_link", "camera_roll", "share_sheet"]).default("upload_link"),
    targetType: z.string().trim().max(80).optional(),
    targetId: z.string().trim().max(80).optional(),
  }),
  output: captureSessionView.extend({
    token: z.string(),
    qrSvg: z.string(),
  }),
  handler: async (input, ctx) => {
    const value = newToken();
    const [created] = await ctx.tx
      .insert(mediaCaptureSessions)
      .values({
        createdBy: actorString(ctx.actor),
        source: input.source,
        token: value,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        expiresAt: new Date(Date.now() + CAPTURE_TTL_MS),
      })
      .returning();
    const url = `${siteOrigin()}/capture/${value}`;
    ctx.setSubject("mediaCaptureSession", created!.id);
    ctx.queueEvent("media.captureLinkCreated", { sessionId: created!.id });
    return {
      ...(await present(ctx, created!)),
      token: value,
      qrSvg: encodeQR(url, "svg"),
    };
  },
});

export const getCaptureSession = defineService({
  name: "media.getCaptureSession",
  summary: "Read a capture session by id or phone-ingest token.",
  kind: "query",
  permission: "public",
  input: z
    .object({
      id: id.optional(),
      token: token.optional(),
    })
    .refine((value) => Boolean(value.id || value.token), "Identify the capture session."),
  output: captureSessionView.nullable(),
  handler: async (input, ctx) => {
    const [row] = input.token
      ? await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.token, input.token))
          .limit(1)
      : await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.id, input.id!))
          .limit(1);
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now() && row.status !== "confirmed") {
      return { ...(await present(ctx, { ...row, status: "expired" })), status: "expired" as const };
    }
    return present(ctx, row);
  },
});

export const grantCapturePermission = defineService({
  name: "media.grantCapturePermission",
  summary: "Record that the browser granted an explicit capture permission.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id,
    displaySurface: z.enum(["monitor", "window", "browser"]).optional(),
  }),
  output: captureSessionView,
  handler: async (input, ctx) => {
    const existing = await load(ctx, input.id);
    if (existing.status === "discarded" || existing.status === "confirmed") {
      throw new ServiceError("conflict", "That capture session is already closed.");
    }
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({
        permissionGrantedAt: existing.permissionGrantedAt ?? sql`now()`,
        displaySurface: input.displaySurface ?? existing.displaySurface,
      })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    return present(ctx, updated!);
  },
});

export const startCapture = defineService({
  name: "media.startCapture",
  summary: "Mark a capture session live after explicit permission.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: captureSessionView,
  handler: async (input, ctx) => {
    const existing = await load(ctx, input.id);
    if (!existing.permissionGrantedAt) {
      throw new ServiceError("validation", "Grant capture permission before recording.");
    }
    if (existing.status !== "pending" && existing.status !== "preview") {
      throw new ServiceError("conflict", "That capture session cannot go live.");
    }
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({ status: "live" })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    return present(ctx, updated!);
  },
});

export const stopCapture = defineService({
  name: "media.stopCapture",
  summary: "Stop a live recording so the owner can preview it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: captureSessionView,
  handler: async (input, ctx) => {
    const existing = await load(ctx, input.id);
    if (existing.status !== "live") {
      throw new ServiceError("conflict", "That capture session is not recording.");
    }
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({ status: "preview" })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    return present(ctx, updated!);
  },
});

export const reviewCapture = defineService({
  name: "media.reviewCapture",
  summary: "Set trim, crop and caption before a capture becomes an Asset.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id,
    trimStartMs: z.number().int().min(0).max(31_536_000_000).optional(),
    trimEndMs: z.number().int().min(0).max(31_536_000_000).nullable().optional(),
    caption: z.string().trim().max(500).nullable().optional(),
    focalX: z.number().int().min(0).max(10_000).optional(),
    focalY: z.number().int().min(0).max(10_000).optional(),
  }),
  output: captureSessionView,
  handler: async (input, ctx) => {
    const existing = await load(ctx, input.id);
    if (existing.status !== "preview" && existing.status !== "pending") {
      throw new ServiceError("conflict", "Review the capture after it has stopped.");
    }
    const trimStartMs = input.trimStartMs ?? existing.trimStartMs;
    const trimEndMs = input.trimEndMs === undefined ? existing.trimEndMs : input.trimEndMs;
    if (trimEndMs !== null && trimEndMs < trimStartMs) {
      throw new ServiceError("validation", "The trim window cannot end before it starts.");
    }
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({
        trimStartMs,
        trimEndMs,
        caption: input.caption === undefined ? existing.caption : input.caption,
        focalX: input.focalX ?? existing.focalX,
        focalY: input.focalY ?? existing.focalY,
      })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    return present(ctx, updated!);
  },
});

export const attachCaptureUpload = defineService({
  name: "media.attachCaptureUpload",
  summary: "Store captured or phone-ingested bytes through the normal media pipeline.",
  kind: "mutation",
  permission: "public",
  input: z
    .object({
      id: id.optional(),
      token: token.optional(),
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(255),
      bytes: z.instanceof(Uint8Array),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      durationSeconds: z.number().int().nonnegative().optional(),
    })
    .refine((value) => Boolean(value.id || value.token), "Identify the capture session."),
  output: z.object({
    session: captureSessionView,
    asset: z.null(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous" && !input.token) {
      throw new ServiceError("permission", "A phone ingest needs its upload link.");
    }
    const [row] = input.token
      ? await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.token, input.token))
          .limit(1)
      : await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.id, input.id!))
          .limit(1);
    if (!row) throw new ServiceError("not_found", "That capture session is not here.");
    const existing = await load(ctx, row.id);
    if (["confirmed", "discarded", "expired"].includes(existing.status)) {
      throw new ServiceError("conflict", "That capture session is closed.");
    }
    const updated = await stageOriginal(ctx, existing, {
      filename: input.filename,
      contentType: input.contentType,
      bytes: input.bytes,
    });
    ctx.setSubject("mediaCaptureSession", existing.id);
    ctx.queueEvent("media.captureAttached", { sessionId: existing.id });
    return { session: await present(ctx, updated), asset: null };
  },
});

export const confirmCapture = defineService({
  name: "media.confirmCapture",
  summary: "Confirm a previewed capture so it becomes a reusable Asset.",
  kind: "mutation",
  permission: "public",
  input: z
    .object({
      id: id.optional(),
      token: token.optional(),
    })
    .refine((value) => Boolean(value.id || value.token), "Identify the capture session."),
  output: captureSessionView,
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous" && !input.token) {
      throw new ServiceError("permission", "A phone ingest needs its upload link.");
    }
    const [row] = input.token
      ? await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.token, input.token))
          .limit(1)
      : await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.id, input.id!))
          .limit(1);
    if (!row) throw new ServiceError("not_found", "That capture session is not here.");
    const existing = await load(ctx, row.id);
    const pending = await ctx.tx
      .select()
      .from(mediaCaptureItems)
      .where(eq(mediaCaptureItems.sessionId, existing.id));
    if (pending.length === 0 && !existing.stagedKey && !existing.assetId) {
      throw new ServiceError("validation", "Attach and preview the recording before confirming it.");
    }
    if (existing.status !== "preview" && existing.status !== "pending") {
      throw new ServiceError("conflict", "Confirm the capture from preview.");
    }
    const { registerStoredOriginal, setAltText, setFocalPoint, updateAssetDetails } =
      await import("./service");
    const assetIds: string[] = [];
    const toPromote =
      pending.length > 0
        ? pending.filter((item) => !item.assetId)
        : existing.stagedKey
          ? [
              {
                id: null as string | null,
                filename: existing.stagedFilename ?? "capture.webm",
                stagedKey: existing.stagedKey,
                stagedBytes: existing.stagedBytes ?? 0,
                stagedMime: existing.stagedMime ?? "application/octet-stream",
                checksumSha256: null as string | null,
              },
            ]
          : [];
    for (const item of toPromote) {
      const asset = await ctx.callAsSystem(registerStoredOriginal, {
        key: item.stagedKey,
        filename: item.filename,
        contentType: item.stagedMime,
        bytes: item.stagedBytes,
        altText: existing.caption ?? undefined,
        source: "capture",
        provenance: {
          capturedAt: new Date().toISOString(),
          captureSessionId: existing.id,
          note: `capture:${existing.source}:${existing.id}`,
        },
        metadata: {
          trimStartMs: existing.trimStartMs,
          trimEndMs: existing.trimEndMs ?? undefined,
        },
        checksumSha256: item.checksumSha256 ?? undefined,
      });
      assetIds.push(asset.id);
      if (item.id) {
        await ctx.tx
          .update(mediaCaptureItems)
          .set({ assetId: asset.id })
          .where(eq(mediaCaptureItems.id, item.id));
      }
      if (asset.kind === "image") {
        await ctx.callAsSystem(setFocalPoint, {
          id: asset.id,
          x: existing.focalX,
          y: existing.focalY,
        });
      }
    }
    if (existing.assetId && assetIds.length === 0) {
      assetIds.push(existing.assetId);
      if (existing.caption) {
        await ctx.callAsSystem(setAltText, { id: existing.assetId, altText: existing.caption });
      }
      await ctx.callAsSystem(updateAssetDetails, {
        id: existing.assetId,
        provenance: {
          captureSessionId: existing.id,
          note: `capture:${existing.source}:${existing.id}`,
        },
        metadata: {
          trimStartMs: existing.trimStartMs,
          trimEndMs: existing.trimEndMs ?? undefined,
        },
      });
    }
    await applyCaptureTarget(ctx, existing, assetIds);
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({
        status: "confirmed",
        completedAt: sql`now()`,
        assetId: assetIds[0] ?? existing.assetId,
        stagedKey: null,
        stagedBytes: null,
        stagedMime: null,
        stagedFilename: null,
      })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    ctx.queueEvent("media.captureConfirmed", {
      sessionId: existing.id,
      assetId: assetIds[0],
      assetIds,
    });
    return present(ctx, updated!);
  },
});

export const discardCapture = defineService({
  name: "media.discardCapture",
  summary: "Discard a capture without publishing a new Asset.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  output: captureSessionView,
  handler: async (input, ctx) => {
    const existing = await load(ctx, input.id);
    if (existing.status === "confirmed") {
      throw new ServiceError("conflict", "A confirmed capture cannot be discarded.");
    }
    await clearChunks(ctx, existing.id);
    await clearItems(ctx, existing.id);
    if (existing.stagedKey) {
      await storage().delete(existing.stagedKey).catch(() => undefined);
    }
    if (existing.assetId) {
      const { trashAsset } = await import("./service");
      await ctx.call(trashAsset, { id: existing.assetId }).catch(() => undefined);
    }
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({
        status: "discarded",
        completedAt: sql`now()`,
        stagedKey: null,
        stagedBytes: null,
        stagedMime: null,
        stagedFilename: null,
      })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    ctx.queueEvent("media.captureDiscarded", { sessionId: existing.id });
    return present(ctx, updated!);
  },
});

export const listCaptureSessions = defineService({
  name: "media.listCaptureSessions",
  summary: "List recent capture and phone-ingest sessions.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(CAPTURE_STATUSES).optional(),
  }),
  output: listed(captureSessionView),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(mediaCaptureSessions)
      .where(input.status ? eq(mediaCaptureSessions.status, input.status) : undefined)
      .orderBy(desc(mediaCaptureSessions.createdAt));
    return Promise.all(rows.map((row) => present(ctx, row)));
  },
});

export const bindCaptureAsset = defineService({
  name: "media.bindCaptureAsset",
  summary: "Attach a completed upload to a capture session for review.",
  kind: "mutation",
  permission: "public",
  input: z
    .object({
      id: id.optional(),
      token: token.optional(),
      assetId: id,
    })
    .refine((value) => Boolean(value.id || value.token), "Identify the capture session."),
  output: captureSessionView,
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous" && !input.token) {
      throw new ServiceError("permission", "A phone ingest needs its upload link.");
    }
    const [row] = input.token
      ? await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.token, input.token))
          .limit(1)
      : await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.id, input.id!))
          .limit(1);
    if (!row) throw new ServiceError("not_found", "That capture session is not here.");
    const existing = await load(ctx, row.id);
    if (["confirmed", "discarded", "expired"].includes(existing.status)) {
      throw new ServiceError("conflict", "That capture session is closed.");
    }
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({
        status: "preview",
        assetId: input.assetId,
        uploadCount: existing.uploadCount + 1,
      })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    return present(ctx, updated!);
  },
});

export const appendCaptureChunk = defineService({
  name: "media.appendCaptureChunk",
  summary: "Persist one recording timeslice so a dropped tab can resume.",
  kind: "mutation",
  permission: "public",
  input: z
    .object({
      id: id.optional(),
      token: token.optional(),
      sequence: z.number().int().min(0).max(100_000),
      contentType: z.string().min(1).max(255).default("video/webm"),
      bytes: z.instanceof(Uint8Array),
    })
    .refine((value) => Boolean(value.id || value.token), "Identify the capture session."),
  output: z.object({
    sessionId: uuid,
    sequence: z.number().int(),
    bytes: z.number().int(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous" && !input.token) {
      throw new ServiceError("permission", "A phone ingest needs its upload link.");
    }
    const [row] = input.token
      ? await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.token, input.token))
          .limit(1)
      : await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.id, input.id!))
          .limit(1);
    if (!row) throw new ServiceError("not_found", "That capture session is not here.");
    const existing = await load(ctx, row.id);
    if (["confirmed", "discarded", "expired"].includes(existing.status)) {
      throw new ServiceError("conflict", "That capture session is closed.");
    }
    const body = input.bytes;
    if (body.byteLength === 0) {
      throw new ServiceError("validation", "An empty recording chunk cannot be stored.");
    }
    const key = `capture/${existing.id}/${String(input.sequence).padStart(6, "0")}`;
    await storage().put(key, body, input.contentType);
    await ctx.tx
      .insert(mediaCaptureChunks)
      .values({
        sessionId: existing.id,
        sequence: input.sequence,
        storageKey: key,
        bytes: body.byteLength,
        contentType: input.contentType,
      })
      .onConflictDoUpdate({
        target: [mediaCaptureChunks.sessionId, mediaCaptureChunks.sequence],
        set: { storageKey: key, bytes: body.byteLength, contentType: input.contentType },
      });
    if (existing.status !== "live") {
      await ctx.tx
        .update(mediaCaptureSessions)
        .set({ status: "live" })
        .where(eq(mediaCaptureSessions.id, existing.id));
    }
    ctx.setSubject("mediaCaptureSession", existing.id);
    return { sessionId: existing.id, sequence: input.sequence, bytes: body.byteLength };
  },
});

export const assembleCapture = defineService({
  name: "media.assembleCapture",
  summary: "Concatenate persisted recording chunks into one Asset.",
  kind: "mutation",
  permission: "public",
  input: z
    .object({
      id: id.optional(),
      token: token.optional(),
      filename: z.string().min(1).max(255).default("capture.webm"),
      /**
       * How many chunks the recorder produced. The client knows; storage can
       * only prove contiguity, and a recording whose *last* chunks never
       * arrived is contiguous. With the count, a tail loss is refused too.
       */
      expectedChunks: z.number().int().min(1).max(100_000).optional(),
    })
    .refine((value) => Boolean(value.id || value.token), "Identify the capture session."),
  output: z.object({
    session: captureSessionView,
    asset: z.null(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind === "anonymous" && !input.token) {
      throw new ServiceError("permission", "A phone ingest needs its upload link.");
    }
    const [row] = input.token
      ? await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.token, input.token))
          .limit(1)
      : await ctx.tx
          .select()
          .from(mediaCaptureSessions)
          .where(eq(mediaCaptureSessions.id, input.id!))
          .limit(1);
    if (!row) throw new ServiceError("not_found", "That capture session is not here.");
    const existing = await load(ctx, row.id);
    const chunks = await ctx.tx
      .select()
      .from(mediaCaptureChunks)
      .where(eq(mediaCaptureChunks.sessionId, existing.id))
      .orderBy(asc(mediaCaptureChunks.sequence));
    if (chunks.length === 0) {
      throw new ServiceError("validation", "This capture has no recorded chunks yet.");
    }
    // Refuse to assemble a recording with holes. Local playback on the
    // recording device always looks intact, so a silent gap here is the one
    // place the owner could lose footage without ever being told.
    const missing = chunks
      .map((chunk, index) => ({ expected: index, got: chunk.sequence }))
      .filter((pair) => pair.got !== pair.expected);
    if (missing.length > 0) {
      throw new ServiceError(
        "conflict",
        `This recording is missing uploaded chunks (first gap at #${missing[0]!.expected}). Retry the upload before assembling.`,
      );
    }
    if (input.expectedChunks !== undefined && chunks.length !== input.expectedChunks) {
      throw new ServiceError(
        "conflict",
        `This recording has ${chunks.length} of ${input.expectedChunks} uploaded chunks. Retry the upload before assembling.`,
      );
    }
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let total = 0;
    for (const chunk of chunks) {
      const body = await storage().get(chunk.storageKey);
      if (!body) throw new ServiceError("conflict", "A recorded chunk disappeared from storage.");
      parts.push(body);
      total += body.byteLength;
    }
    const assembled = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      assembled.set(part, offset);
      offset += part.byteLength;
    }
    for (const chunk of chunks) {
      await storage().delete(chunk.storageKey);
    }
    await ctx.tx.delete(mediaCaptureChunks).where(eq(mediaCaptureChunks.sessionId, existing.id));
    const updated = await stageOriginal(ctx, existing, {
      filename: input.filename,
      contentType: chunks[0]!.contentType,
      bytes: assembled,
    });
    ctx.setSubject("mediaCaptureSession", existing.id);
    ctx.queueEvent("media.captureAttached", { sessionId: existing.id });
    return { session: await present(ctx, updated), asset: null };
  },
});

export const expireCaptureSessions = defineService({
  name: "media.expireCaptureSessions",
  summary: "Expire unconfirmed captures and delete leftover staged bytes.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: z.object({ expired: listed(uuid) }),
  handler: async (_input, ctx) => {
    const due = await ctx.tx
      .select()
      .from(mediaCaptureSessions)
      .where(
        and(
          inArray(mediaCaptureSessions.status, ["pending", "live", "preview"]),
          lte(mediaCaptureSessions.expiresAt, new Date()),
        ),
      );
    const expired: string[] = [];
    for (const row of due) {
      await clearChunks(ctx, row.id);
      await clearItems(ctx, row.id);
      if (row.stagedKey) {
        await storage().delete(row.stagedKey).catch(() => undefined);
      }
      if (row.assetId) {
        const { trashAsset } = await import("./service");
        await ctx.callAsSystem(trashAsset, { id: row.assetId }).catch(() => undefined);
      }
      await ctx.tx
        .update(mediaCaptureSessions)
        .set({
          status: "expired",
          completedAt: sql`now()`,
          stagedKey: null,
          stagedBytes: null,
          stagedMime: null,
          stagedFilename: null,
        })
        .where(eq(mediaCaptureSessions.id, row.id));
      expired.push(row.id);
    }
    return { expired };
  },
});

void source;

export default [
  createCaptureSession,
  createUploadLink,
  getCaptureSession,
  grantCapturePermission,
  startCapture,
  stopCapture,
  reviewCapture,
  bindCaptureAsset,
  stageCompletedUpload,
  appendCaptureChunk,
  assembleCapture,
  attachCaptureUpload,
  confirmCapture,
  discardCapture,
  listCaptureSessions,
  expireCaptureSessions,
];
