// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion ingest through the core media contract (C10.17).
//
// Camera, camera-roll, screen and share-sheet all open a capture session the
// website already understands. Bytes follow the same two strategies the web
// uploader uses: bounded `POST /api/media` for proxy storage, or signed
// multipart parts plus `media.completeUpload` for private S3. There is no
// mobile-only upload endpoint. This path stays live-only; C10.18 queues files
// locally and flushes through these functions once a connection exists.

import { OfflineWriteRefused } from "./offline.js";

export const CAPTURE_SOURCES = ["camera", "camera_roll", "screen", "share_sheet"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export interface CaptureSession {
  id: string;
  source: CaptureSource;
  status: string;
  token?: string;
  assetId?: string | null;
}

export interface CaptureFile {
  filename: string;
  contentType: string;
  byteLength: number;
  /** Present in tests; native prefers `uri` so a video is not fully buffered. */
  bytes?: Uint8Array;
  uri?: string;
}

export interface UploadReservation {
  id: string;
  strategy: "direct_multipart" | "proxy";
  partSize: number | null;
  partCount: number | null;
}

export interface CaptureTransport {
  call<T>(service: string, body: unknown): Promise<T>;
  /** Bounded proxy (`POST /api/media`). Used only when the reservation is proxy. */
  putProxy(input: {
    uploadId: string;
    filename: string;
    contentType: string;
    bytes?: Uint8Array;
    uri?: string;
    signal?: AbortSignal;
  }): Promise<{ id?: string } | null>;
  /** One signed S3 part (`PUT` the part URL). */
  putPart(input: {
    url: string;
    start: number;
    end: number;
    bytes?: Uint8Array;
    uri?: string;
    signal?: AbortSignal;
  }): Promise<{ etag: string }>;
}

export class CaptureUploadAborted extends Error {
  constructor() {
    super("The capture upload was paused or cancelled.");
    this.name = "CaptureUploadAborted";
  }
}

export function isCaptureUploadAborted(error: unknown): boolean {
  return error instanceof CaptureUploadAborted || (error instanceof Error && error.name === "CaptureUploadAborted");
}

function live(online: boolean, service: string): void {
  if (!online) throw new OfflineWriteRefused(service);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CaptureUploadAborted();
}

export function captureStartService(source: CaptureSource): string {
  return source === "camera" || source === "screen" ? "media.createCaptureSession" : "media.createUploadLink";
}

function asSession(value: unknown): CaptureSession {
  const row = value as {
    id?: string;
    source?: CaptureSource;
    status?: string;
    token?: string;
    assetId?: string | null;
  };
  if (!row.id || !row.source) throw new Error("The capture session did not return an id.");
  return {
    id: row.id,
    source: row.source,
    status: row.status ?? "pending",
    token: row.token,
    assetId: row.assetId ?? null,
  };
}

async function bindOrReload(
  session: CaptureSession,
  assetId: string | undefined,
  online: boolean,
  transport: CaptureTransport,
): Promise<CaptureSession> {
  if (assetId) {
    live(online, "media.bindCaptureAsset");
    return asSession(
      await transport.call("media.bindCaptureAsset", {
        id: session.id,
        ...(session.token ? { token: session.token } : {}),
        assetId,
      }),
    );
  }
  live(online, "media.getCaptureSession");
  return asSession(
    await transport.call("media.getCaptureSession", {
      id: session.id,
      ...(session.token ? { token: session.token } : {}),
    }),
  );
}

/** Open a capture session for the source the owner just chose. */
export async function openCaptureSession(
  input: {
    source: CaptureSource;
    online: boolean;
    targetType?: string;
    targetId?: string;
  },
  transport: CaptureTransport,
): Promise<CaptureSession> {
  const service = captureStartService(input.source);
  live(input.online, service);
  const session = asSession(
    await transport.call(service, {
      source: service === "media.createCaptureSession" ? input.source : input.source === "share_sheet" ? "share_sheet" : "camera_roll",
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
    }),
  );
  if (service === "media.createCaptureSession") {
    live(input.online, "media.grantCapturePermission");
    return asSession(await transport.call("media.grantCapturePermission", { id: session.id }));
  }
  return session;
}

/**
 * Stage a file onto a capture session using whichever strategy `beginUpload`
 * chose — proxy for local/Replit, signed multipart for private S3.
 */
export async function ingestCaptureUpload(
  input: {
    session: CaptureSession;
    file: CaptureFile;
    online: boolean;
    signal?: AbortSignal;
    onProgress?: (progress: { uploadedBytes: number; totalBytes: number }) => void;
  },
  transport: CaptureTransport,
): Promise<CaptureSession> {
  throwIfAborted(input.signal);
  live(input.online, "media.beginUpload");
  const byteLength = input.file.byteLength || input.file.bytes?.byteLength || 0;
  if (byteLength === 0) throw new Error("An empty file cannot be stored.");
  input.onProgress?.({ uploadedBytes: 0, totalBytes: byteLength });
  const reservation = await transport.call<UploadReservation>("media.beginUpload", {
    filename: input.file.filename,
    contentType: input.file.contentType,
    bytes: byteLength,
    source: "capture",
    provenance: {
      captureSessionId: input.session.id,
      ...(input.session.token ? { captureToken: input.session.token } : {}),
      capturedAt: new Date().toISOString(),
    },
    metadata: {},
  });
  throwIfAborted(input.signal);
  if (reservation.strategy === "direct_multipart") {
    const partSize = reservation.partSize;
    const partCount = reservation.partCount;
    if (!partSize || !partCount) throw new Error("That direct upload did not say how to split the file.");
    const parts: { partNumber: number; etag: string }[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      throwIfAborted(input.signal);
      live(input.online, "media.signUploadParts");
      const signed = await transport.call<{ parts: { partNumber: number; url: string }[] }>("media.signUploadParts", {
        id: reservation.id,
        partNumbers: [partNumber],
      });
      const url = signed.parts[0]?.url;
      if (!url) throw new Error("The object store did not sign that upload part.");
      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, byteLength);
      let etag: string;
      try {
        ({ etag } = await transport.putPart({
          url,
          start,
          end,
          bytes: input.file.bytes,
          uri: input.file.uri,
          signal: input.signal,
        }));
      } catch (error) {
        throwIfAborted(input.signal);
        throw error;
      }
      parts.push({ partNumber, etag });
      input.onProgress?.({ uploadedBytes: end, totalBytes: byteLength });
    }
    throwIfAborted(input.signal);
    live(input.online, "media.completeUpload");
    const completed = await transport.call<{ ok?: boolean; asset?: { id?: string } | null }>("media.completeUpload", {
      id: reservation.id,
      parts,
    });
    input.onProgress?.({ uploadedBytes: byteLength, totalBytes: byteLength });
    return bindOrReload(input.session, completed.asset?.id, input.online, transport);
  }
  if (reservation.strategy !== "proxy") {
    throw new Error("This app does not know that upload strategy.");
  }
  throwIfAborted(input.signal);
  let uploaded: { id?: string } | null;
  try {
    uploaded = await transport.putProxy({
      uploadId: reservation.id,
      filename: input.file.filename,
      contentType: input.file.contentType,
      bytes: input.file.bytes,
      uri: input.file.uri,
      signal: input.signal,
    });
  } catch (error) {
    throwIfAborted(input.signal);
    throw error;
  }
  input.onProgress?.({ uploadedBytes: byteLength, totalBytes: byteLength });
  return bindOrReload(input.session, uploaded?.id, input.online, transport);
}

export async function confirmCaptureSession(
  input: { session: CaptureSession; online: boolean },
  transport: CaptureTransport,
): Promise<CaptureSession> {
  live(input.online, "media.confirmCapture");
  return asSession(
    await transport.call("media.confirmCapture", {
      id: input.session.id,
      ...(input.session.token ? { token: input.session.token } : {}),
    }),
  );
}
