// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Capability-aware media upload. S3-compatible storage sends resumable parts
// straight from the browser; local/Replit use the bounded application proxy.
import { useRef, useState } from "react";
import {
  ArrowClockwise,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field } from "@/ui/primitives";

function readCsrfToken(): string {
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
  failureReason?: string | null;
}

interface MediaFacts {
  width?: number;
  height?: number;
  durationSeconds?: number;
}

async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
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

function resumeKey(file: File): string {
  return `freeholder.media.upload:${file.name}:${file.size}:${file.lastModified}`;
}

export function UploadForm({
  labels,
  captureToken,
  captureSessionId,
}: {
  captureToken?: string;
  captureSessionId?: string;
  labels: {
    file: string;
    fileHint: string;
    submit: string;
    pending: string;
    failed: string;
    progress: string;
    resumable: string;
    cancel: string;
  };
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [resuming, setResuming] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const activeUploadId = useRef<string | undefined>(undefined);

  async function reservationFor(
    file: File,
    metadata: MediaFacts,
  ): Promise<UploadReservation> {
    const key = resumeKey(file);
    const saved = window.localStorage.getItem(key);
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
          setResuming(status.parts.length > 0);
          return status;
        }
      } catch {
        window.localStorage.removeItem(key);
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
            file.lastModified > 0
              ? new Date(file.lastModified).toISOString()
              : undefined,
          captureToken,
          captureSessionId,
        },
      }),
    });
    window.localStorage.setItem(key, reservation.id);
    return reservation;
  }

  async function proxyUpload(
    file: File,
    reservation: UploadReservation,
    metadata: MediaFacts,
    signal: AbortSignal,
  ): Promise<void> {
    const data = new FormData();
    data.set("file", file);
    data.set("uploadId", reservation.id);
    for (const [name, value] of Object.entries(metadata)) {
      if (value !== undefined) data.set(name, String(value));
    }
    const response = await fetch("/api/media", {
      method: "POST",
      body: data,
      signal,
      headers: { "x-csrf-token": readCsrfToken() },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? labels.failed);
    }
    setProgress(100);
  }

  async function directUpload(
    file: File,
    reservation: UploadReservation,
    signal: AbortSignal,
  ): Promise<void> {
    const partSize = reservation.partSize!;
    const status = await apiJson<UploadStatus>(
      `/api/media/uploads?id=${encodeURIComponent(reservation.id)}`,
    );
    const completed = new Map(
      status.parts.map((part) => [part.partNumber, part] as const),
    );
    let uploadedBytes = status.parts.reduce(
      (total, part) => total + (part.bytes ?? 0),
      0,
    );
    setProgress(Math.floor((uploadedBytes / file.size) * 100));

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
        signal,
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
      setProgress(Math.min(99, Math.floor((uploadedBytes / file.size) * 100)));
    }

    const result = await apiJson<
      | { ok: true; asset: { id: string } }
      | { ok: false; message: string }
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
    setProgress(100);
  }

  return (
    <form
      className="grid gap-4 rounded-lg border border-rule bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const files = [...data.getAll("file")].filter(
          (value): value is File => value instanceof File && value.size > 0,
        );
        if (files.length === 0) return;

        setPending(true);
        setError(undefined);
        setProgress(0);
        setResuming(false);
        controller.current = new AbortController();
        void (async () => {
          try {
            let done = 0;
            for (const file of files) {
              const metadata = await mediaFacts(file);
              const reservation = await reservationFor(file, metadata);
              activeUploadId.current = reservation.id;
              if (reservation.strategy === "direct_multipart") {
                await directUpload(file, reservation, controller.current!.signal);
              } else {
                await proxyUpload(
                  file,
                  reservation,
                  metadata,
                  controller.current!.signal,
                );
              }
              if (captureToken || captureSessionId) {
                const status = await apiJson<{ assetId?: string | null }>(
                  `/api/media/uploads?id=${encodeURIComponent(reservation.id)}`,
                );
                if (status.assetId) {
                  const bind = new FormData();
                  if (captureToken) bind.set("token", captureToken);
                  if (captureSessionId) bind.set("id", captureSessionId);
                  bind.set("assetId", status.assetId);
                  const { bindCaptureAction } = await import("../../capture-actions");
                  await bindCaptureAction(bind);
                }
              }
              window.localStorage.removeItem(resumeKey(file));
              done += 1;
              setProgress(Math.floor((done / files.length) * 100));
            }
            form.reset();
            window.location.reload();
          } catch (caught) {
            if ((caught as Error).name === "AbortError") {
              const id = activeUploadId.current;
              if (id) {
                await apiJson("/api/media/uploads/abort", {
                  method: "POST",
                  body: JSON.stringify({ id }),
                }).catch(() => undefined);
              }
            } else {
              setError(caught instanceof Error ? caught.message : labels.failed);
            }
          } finally {
            activeUploadId.current = undefined;
            controller.current = undefined;
            setPending(false);
          }
        })();
      }}
    >
      {error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {error}
        </Callout>
      ) : null}
      <Field label={labels.file} htmlFor="file" hint={labels.fileHint}>
        <input
          id="file"
          name="file"
          type="file"
          required
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,application/pdf,text/plain,text/csv,application/json,.docx,.xlsx,.pptx"
          className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
        />
      </Field>
      {pending ? (
        <div className="grid gap-1" aria-live="polite">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              {resuming ? (
                <ArrowClockwise size={14} weight="bold" />
              ) : (
                <UploadSimple size={14} weight="bold" />
              )}
              {resuming ? labels.resumable : labels.pending}
            </span>
            <span className="font-mono tabular-nums">
              {labels.progress.replace("{percent}", String(progress))}
            </span>
          </div>
          <progress className="h-2 w-full accent-accent" max={100} value={progress} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          <UploadSimple size={15} weight="bold" />
          {pending ? labels.pending : labels.submit}
        </Button>
        {pending ? (
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              controller.current?.abort();
              const id = activeUploadId.current;
              if (id) {
                void apiJson("/api/media/uploads/abort", {
                  method: "POST",
                  body: JSON.stringify({ id }),
                }).catch(() => undefined);
              }
            }}
          >
            <X size={15} weight="bold" />
            {labels.cancel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
