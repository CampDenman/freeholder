// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The browser half of the resumable media pipeline (MASTER.md §4.5, §18).
//
// One implementation, every door: the media library's upload form and the
// editor canvas's image picker both send files through here, so a picture
// dropped onto a page is reserved, validated, scanned, deduplicated and given
// provenance exactly as one uploaded in the library — and a phone that loses
// signal half way resumes the same multipart reservation instead of starting
// again. S3-compatible storage receives presigned parts straight from the
// browser; local/Replit storage uses the bounded application proxy.

export function readCsrfToken(): string {
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "freeholder_csrf") return decodeURIComponent(rest.join("="));
  }
  return "";
}

interface UploadReservation {
  id: string;
  strategy: "direct_multipart" | "proxy";
  partSize: number | null;
  partCount: number | null;
  expiresAt: string;
}

interface UploadedPart {
  partNumber: number;
  etag: string;
  bytes?: number;
}

interface UploadStatus extends UploadReservation {
  state: string;
  filename: string;
  contentType: string;
  expectedBytes: number;
  parts: UploadedPart[];
  assetId?: string | null;
  failureReason?: string | null;
}

export interface MediaFacts {
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      "x-csrf-token": readCsrfToken(),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(
      (body as { error?: { message?: string } } | null)?.error?.message ??
        "The upload request failed.",
    );
  }
  return body as T;
}

async function mediaFacts(file: File): Promise<MediaFacts> {
  if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
    return {};
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<MediaFacts>((resolve) => {
      const element = document.createElement(
        file.type.startsWith("video/") ? "video" : "audio",
      );
      const timeout = window.setTimeout(() => resolve({}), 5_000);
      element.preload = "metadata";
      element.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        const video = element instanceof HTMLVideoElement ? element : undefined;
        resolve({
          width: video?.videoWidth || undefined,
          height: video?.videoHeight || undefined,
          durationSeconds: Number.isFinite(element.duration)
            ? Math.round(element.duration)
            : undefined,
        });
      };
      element.onerror = () => {
        window.clearTimeout(timeout);
        resolve({});
      };
      element.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function resumeKey(file: File, purpose?: string): string {
  // A form upload and a library upload of the same file are different
  // reservations: resuming one as the other would change who may see it.
  return `freeholder.media.upload:${purpose ? `${purpose}:` : ""}${file.name}:${file.size}:${file.lastModified}`;
}

function readResume(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeResume(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the upload still works, it just
    // cannot resume across a page reload.
  }
}

export interface UploadOptions {
  signal: AbortSignal;
  /** 0..100 for this file. */
  onProgress?: (percent: number) => void;
  /** Called when an interrupted multipart upload is being resumed. */
  onResuming?: (resuming: boolean) => void;
  /** Called as soon as the reservation exists, so a cancel can abort it. */
  onReservation?: (uploadId: string) => void;
  captureToken?: string;
  captureSessionId?: string;
  /** C3.38: `form` reserves a private upload only its uploader may attach. */
  purpose?: "form";
  failedMessage?: string;
}

export interface UploadResult {
  uploadId: string;
  /** The Asset the pipeline produced; null only if the server withheld it. */
  assetId: string | null;
}

async function reservationFor(
  file: File,
  metadata: MediaFacts,
  options: UploadOptions,
): Promise<UploadReservation> {
  const key = resumeKey(file, options.purpose);
  const saved = readResume(key);
  if (saved) {
    try {
      const status = await apiJson<UploadStatus>(
        `/api/media/uploads?id=${encodeURIComponent(saved)}`,
      );
      if (
        status.strategy === "direct_multipart" &&
        ["created", "uploading"].includes(status.state) &&
        status.filename === file.name &&
        status.expectedBytes === file.size
      ) {
        options.onResuming?.(status.parts.length > 0);
        return status;
      }
    } catch {
      writeResume(key, null);
    }
  }
  const reservation = await apiJson<UploadReservation>("/api/media/uploads", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      bytes: file.size,
      metadata,
      provenance: {
        lastModifiedAt:
          file.lastModified > 0 ? new Date(file.lastModified).toISOString() : undefined,
        captureToken: options.captureToken,
        captureSessionId: options.captureSessionId,
        purpose: options.purpose,
      },
    }),
  });
  writeResume(key, reservation.id);
  return reservation;
}

async function proxyUpload(
  file: File,
  reservation: UploadReservation,
  metadata: MediaFacts,
  options: UploadOptions,
): Promise<string | null> {
  const data = new FormData();
  data.set("file", file);
  data.set("uploadId", reservation.id);
  for (const [name, value] of Object.entries(metadata)) {
    if (value !== undefined) data.set(name, String(value));
  }
  const response = await fetch("/api/media", {
    method: "POST",
    body: data,
    signal: options.signal,
    headers: { "x-csrf-token": readCsrfToken() },
  });
  const body = (await response.json().catch(() => null)) as {
    id?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? options.failedMessage ?? "The upload failed.");
  }
  options.onProgress?.(100);
  return typeof body?.id === "string" ? body.id : null;
}

async function directUpload(
  file: File,
  reservation: UploadReservation,
  options: UploadOptions,
): Promise<string | null> {
  const partSize = reservation.partSize!;
  // Declare the entire selected body before accepting remote resume progress
  // or requesting any capability. These browser hashes are immutable limits;
  // only actual provider/body evidence can later prove their physical receipt.
  const declaredParts:Array<{partNumber:number;bytes:number;sha256:string}>=[];
  for(let partNumber=1;partNumber<=reservation.partCount!;partNumber++){
    const start=(partNumber-1)*partSize,end=Math.min(start+partSize,file.size),body=await file.slice(start,end).arrayBuffer();
    const digest=await crypto.subtle.digest("SHA-256",body),sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
    declaredParts.push({partNumber,bytes:end-start,sha256});
  }
  await apiJson("/api/media/uploads/part-manifest",{method:"POST",body:JSON.stringify({id:reservation.id,parts:declaredParts})});
  const status = await apiJson<UploadStatus>(
    `/api/media/uploads?id=${encodeURIComponent(reservation.id)}`,
  );
  const completed = new Map(status.parts.map((part) => [part.partNumber, part] as const));
  let uploadedBytes = status.parts.reduce((total, part) => total + (part.bytes ?? 0), 0);
  options.onProgress?.(Math.floor((uploadedBytes / file.size) * 100));

  for (let partNumber = 1; partNumber <= reservation.partCount!; partNumber += 1) {
    if (completed.has(partNumber)) continue;
    const signed = await apiJson<{
      parts: { partNumber: number; url: string; method: "PUT" }[];
    }>("/api/media/uploads/parts", {
      method: "POST",
      body: JSON.stringify({ id: reservation.id, partNumbers: [partNumber] }),
    });
    const start = (partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const response = await fetch(signed.parts[0]!.url, {
      method: "PUT",
      body: file.slice(start, end),
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`Part ${partNumber} failed (${response.status}).`);
    }
    const etag = response.headers.get("etag");
    if (!etag) {
      throw new Error(
        "The object store did not expose its ETag header. Add ETag to the bucket CORS ExposeHeaders list.",
      );
    }
    completed.set(partNumber, { partNumber, etag, bytes: end - start });
    uploadedBytes += end - start;
    options.onProgress?.(Math.min(99, Math.floor((uploadedBytes / file.size) * 100)));
  }

  const result = await apiJson<
    { ok: true; asset: { id: string } } | { ok: false; message: string }
  >("/api/media/uploads/complete", {
    method: "POST",
    body: JSON.stringify({
      id: reservation.id,
      parts: [...completed.values()]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map(({ partNumber, etag }) => ({ partNumber, etag })),
    }),
  });
  if (!result.ok) throw new Error(result.message);
  options.onProgress?.(100);
  return result.asset.id;
}

/**
 * Send one file through the pipeline and return the Asset it became.
 *
 * Resumable: a reservation is remembered per file (name, size, mtime), so a
 * retry after a dropped connection lists the parts the store already holds
 * and sends only the rest.
 */
export async function uploadMediaFile(
  file: File,
  options: UploadOptions,
): Promise<UploadResult> {
  return uploadMediaFileWithFacts(file, await mediaFacts(file), options);
}

/**
 * The same pipeline with facts the caller already has, or none. A public form
 * upload (C3.38) sends none: the server reads what it needs from the bytes,
 * and a visitor's file is never loaded into a media element on the page.
 */
export async function uploadMediaFileWithFacts(
  file: File,
  metadata: MediaFacts,
  options: UploadOptions,
): Promise<UploadResult> {
  const reservation = await reservationFor(file, metadata, options);
  options.onReservation?.(reservation.id);
  let assetId =
    reservation.strategy === "direct_multipart"
      ? await directUpload(file, reservation, options)
      : await proxyUpload(file, reservation, metadata, options);
  if (!assetId) {
    const status = await apiJson<{ assetId?: string | null }>(
      `/api/media/uploads?id=${encodeURIComponent(reservation.id)}`,
    );
    assetId = status.assetId ?? null;
  }
  writeResume(resumeKey(file, options.purpose), null);
  return { uploadId: reservation.id, assetId };
}

/** Best effort — cleanupOrphanedMedia reclaims staged parts if this never lands. */
export async function abortMediaUpload(uploadId: string): Promise<void> {
  await apiJson("/api/media/uploads/abort", {
    method: "POST",
    body: JSON.stringify({ id: uploadId }),
  }).catch(() => undefined);
}
