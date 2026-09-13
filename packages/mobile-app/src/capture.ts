// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion ingest through the core media contract (C10.17).
//
// Camera, camera-roll, screen and share-sheet all open a capture session the
// website already understands, then upload through `/api/media` and confirm.
// There is no mobile-only upload endpoint: C10.18 is the offline queue; this
// path is live-only.

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

export interface CaptureTransport {
  call<T>(service: string, body: unknown): Promise<T>;
  /**
   * The existing bounded proxy (`POST /api/media`), not a mobile route.
   * Returns the uploaded asset when the proxy created one.
   */
  putProxy(input: {
    uploadId: string;
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<{ id?: string } | null>;
}

function live(online: boolean, service: string): void {
  if (!online) throw new OfflineWriteRefused(service);
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
  const recording = input.source === "camera" || input.source === "screen";
  const service = recording ? "media.createCaptureSession" : "media.createUploadLink";
  live(input.online, service);
  const session = asSession(
    await transport.call(service, {
      source: recording ? input.source : input.source === "share_sheet" ? "share_sheet" : "camera_roll",
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
    }),
  );
  if (recording) {
    live(input.online, "media.grantCapturePermission");
    return asSession(await transport.call("media.grantCapturePermission", { id: session.id }));
  }
  return session;
}

/**
 * Stage bytes onto a capture session through the core upload reservation,
 * then bind any resulting Asset so confirm can promote it.
 */
export async function ingestCaptureUpload(
  input: {
    session: CaptureSession;
    filename: string;
    contentType: string;
    bytes: Uint8Array;
    online: boolean;
  },
  transport: CaptureTransport,
): Promise<CaptureSession> {
  live(input.online, "media.beginUpload");
  if (input.bytes.byteLength === 0) throw new Error("An empty file cannot be stored.");
  const reservation = await transport.call<{ id: string }>("media.beginUpload", {
    filename: input.filename,
    contentType: input.contentType,
    bytes: input.bytes.byteLength,
    source: "capture",
    provenance: {
      captureSessionId: input.session.id,
      ...(input.session.token ? { captureToken: input.session.token } : {}),
      capturedAt: new Date().toISOString(),
    },
    metadata: {},
  });
  const uploaded = await transport.putProxy({
    uploadId: reservation.id,
    filename: input.filename,
    contentType: input.contentType,
    bytes: input.bytes,
  });
  if (uploaded?.id) {
    live(input.online, "media.bindCaptureAsset");
    return asSession(
      await transport.call("media.bindCaptureAsset", {
        id: input.session.id,
        ...(input.session.token ? { token: input.session.token } : {}),
        assetId: uploaded.id,
      }),
    );
  }
  live(input.online, "media.getCaptureSession");
  return asSession(
    await transport.call("media.getCaptureSession", {
      id: input.session.id,
      ...(input.session.token ? { token: input.session.token } : {}),
    }),
  );
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
