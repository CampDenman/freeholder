// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Capture and phone ingest sessions (MASTER.md §4.5, C1.28, C1.29).

import { randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import encodeQR from "qr";
import { defineService, ServiceError, actorString, type ServiceContext } from "@/core/service";
import { siteOrigin } from "@/core/seo/origin";
import {
  CAPTURE_SOURCES,
  CAPTURE_STATUSES,
  mediaCaptureSessions,
} from "./schema";

const CAPTURE_TTL_MS = 24 * 60 * 60 * 1000;
const id = z.string().uuid();
const token = z.string().trim().min(16).max(128);
const source = z.enum(CAPTURE_SOURCES);

function newToken(): string {
  return randomBytes(32).toString("hex");
}

function publicSession(row: typeof mediaCaptureSessions.$inferSelect) {
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
    uploadId: row.uploadId,
    assetId: row.assetId,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    captureUrl: row.token ? `${siteOrigin()}/capture/${row.token}` : null,
  };
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
    return publicSession(created!);
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
      ...publicSession(created!),
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
      return { ...publicSession({ ...row, status: "expired" }), status: "expired" as const };
    }
    return publicSession(row);
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
    return publicSession(updated!);
  },
});

export const startCapture = defineService({
  name: "media.startCapture",
  summary: "Mark a capture session live after explicit permission.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
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
    return publicSession(updated!);
  },
});

export const stopCapture = defineService({
  name: "media.stopCapture",
  summary: "Stop a live recording so the owner can preview it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
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
    return publicSession(updated!);
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
      })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    if (existing.assetId && (input.focalX !== undefined || input.focalY !== undefined)) {
      const { setFocalPoint } = await import("./service");
      await ctx.call(setFocalPoint, {
        id: existing.assetId,
        x: input.focalX ?? 5_000,
        y: input.focalY ?? 5_000,
      });
    }
    ctx.setSubject("mediaCaptureSession", existing.id);
    return publicSession(updated!);
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
    const { uploadAsset } = await import("./service");
    const asset = await ctx.callAsSystem(uploadAsset, {
      filename: input.filename,
      contentType: input.contentType,
      bytes: input.bytes,
      source: "capture",
      provenance: {
        capturedAt: new Date().toISOString(),
        note: `capture:${existing.source}:${existing.id}`,
      },
      metadata: {
        width: input.width,
        height: input.height,
        durationSeconds: input.durationSeconds,
      },
    });
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({
        status: "preview",
        assetId: asset.id,
        uploadCount: existing.uploadCount + 1,
      })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    ctx.queueEvent("media.captureAttached", { sessionId: existing.id, assetId: asset.id });
    return { session: publicSession(updated!), asset };
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
    if (!existing.assetId) {
      throw new ServiceError("validation", "Attach and preview the recording before confirming it.");
    }
    if (existing.status !== "preview" && existing.status !== "pending") {
      throw new ServiceError("conflict", "Confirm the capture from preview.");
    }
    if (existing.caption) {
      const { setAltText } = await import("./service");
      await ctx.call(setAltText, { id: existing.assetId, altText: existing.caption });
    }
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({ status: "confirmed", completedAt: sql`now()` })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    ctx.queueEvent("media.captureConfirmed", { sessionId: existing.id, assetId: existing.assetId });
    return publicSession(updated!);
  },
});

export const discardCapture = defineService({
  name: "media.discardCapture",
  summary: "Discard a capture without publishing a new Asset.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id }),
  handler: async (input, ctx) => {
    const existing = await load(ctx, input.id);
    if (existing.status === "confirmed") {
      throw new ServiceError("conflict", "A confirmed capture cannot be discarded.");
    }
    if (existing.assetId) {
      const { trashAsset } = await import("./service");
      await ctx.call(trashAsset, { id: existing.assetId }).catch(() => undefined);
    }
    const [updated] = await ctx.tx
      .update(mediaCaptureSessions)
      .set({ status: "discarded", completedAt: sql`now()` })
      .where(eq(mediaCaptureSessions.id, existing.id))
      .returning();
    ctx.setSubject("mediaCaptureSession", existing.id);
    ctx.queueEvent("media.captureDiscarded", { sessionId: existing.id });
    return publicSession(updated!);
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
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(mediaCaptureSessions)
      .where(input.status ? eq(mediaCaptureSessions.status, input.status) : undefined)
      .orderBy(desc(mediaCaptureSessions.createdAt));
    return rows.map(publicSession);
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
  attachCaptureUpload,
  confirmCapture,
  discardCapture,
  listCaptureSessions,
];
