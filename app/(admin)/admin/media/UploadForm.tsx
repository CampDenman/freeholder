// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Capability-aware media upload. S3-compatible storage sends resumable parts
// straight from the browser; local/Replit use the bounded application proxy.
// The transfer itself lives in upload-client.ts, shared with the editor
// canvas's image picker.
import { useRef, useState } from "react";
import {
  ArrowClockwise,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field } from "@/ui/primitives";
import { abortMediaUpload, uploadMediaFile } from "./upload-client";

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
              // The one resumable pipeline (upload-client.ts) — the editor
              // canvas's image picker sends files through the same path.
              const result = await uploadMediaFile(file, {
                signal: controller.current!.signal,
                onProgress: setProgress,
                onResuming: setResuming,
                onReservation: (id) => {
                  activeUploadId.current = id;
                },
                captureToken,
                captureSessionId,
                failedMessage: labels.failed,
              });
              if ((captureToken || captureSessionId) && result.assetId) {
                const bind = new FormData();
                if (captureToken) bind.set("token", captureToken);
                if (captureSessionId) bind.set("id", captureSessionId);
                bind.set("assetId", result.assetId);
                const { bindCaptureAction } = await import("../../capture-actions");
                await bindCaptureAction(bind);
              }
              done += 1;
              setProgress(Math.floor((done / files.length) * 100));
            }
            form.reset();
            window.location.reload();
          } catch (caught) {
            if ((caught as Error).name === "AbortError") {
              const id = activeUploadId.current;
              // Best effort: a failed abort does not orphan the staged
              // parts forever — cleanupOrphanedMedia expires stale uploads
              // and aborts their multipart state on schedule.
              if (id) await abortMediaUpload(id);
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
          className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm text-ink"
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
              if (id) void abortMediaUpload(id);
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
