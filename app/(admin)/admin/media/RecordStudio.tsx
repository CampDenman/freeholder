// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, CardBody, CardHeader, Field, Input } from "@/ui/primitives";
import {
  appendChunkAction,
  assembleCaptureAction,
  confirmCaptureAction,
  discardCaptureAction,
  grantCaptureAction,
  markLiveAction,
  markStoppedAction,
  reviewCaptureAction,
} from "../../capture-actions";

export interface RecordStudioLabels {
  title: string;
  grant: string;
  record: string;
  stop: string;
  live: string;
  caption: string;
  trimStart: string;
  trimEnd: string;
  cropX: string;
  cropY: string;
  saveReview: string;
  confirm: string;
  discard: string;
}

interface Session {
  id: string;
  source: string;
  status: string;
  permissionGrantedAt: Date | string | null;
  caption: string | null;
  trimStartMs: number;
  trimEndMs: number | null;
  focalX?: number;
  focalY?: number;
  staged?: boolean;
  assetId: string | null;
}

export function RecordStudio({
  session,
  labels,
}: {
  session: Session;
  labels: RecordStudioLabels;
}) {
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(session.status === "live");
  const [status, setStatus] = useState(session.status);
  const [staged, setStaged] = useState(Boolean(session.staged || session.assetId));
  const [playback, setPlayback] = useState<string | null>(null);
  const [focalX, setFocalX] = useState(session.focalX ?? 5_000);
  const [focalY, setFocalY] = useState(session.focalY ?? 5_000);
  const [caption, setCaption] = useState(session.caption ?? "");
  const [trimStart, setTrimStart] = useState(session.trimStartMs);
  const [trimEnd, setTrimEnd] = useState(session.trimEndMs ?? "");
  const preview = useRef<HTMLVideoElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      recorder.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function requestPermission() {
    setError(null);
    try {
      const media =
        session.source === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getUserMedia(
              session.source === "microphone"
                ? { audio: true, video: false }
                : { audio: true, video: true },
            );
      stream.current = media;
      if (preview.current) preview.current.srcObject = media;
      const surface = media.getVideoTracks()[0]?.getSettings().displaySurface;
      const grant = new FormData();
      grant.set("id", session.id);
      if (surface === "monitor" || surface === "window" || surface === "browser") {
        grant.set("displaySurface", surface);
      }
      await grantCaptureAction(grant);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "permission");
    }
  }

  async function begin() {
    if (!stream.current) await requestPermission();
    if (!stream.current) return;
    chunks.current = [];
    const liveForm = new FormData();
    liveForm.set("id", session.id);
    await markLiveAction(liveForm);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    const instance = new MediaRecorder(stream.current, { mimeType: mime });
    let sequence = 0;
    instance.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      chunks.current.push(event.data);
      const form = new FormData();
      form.set("id", session.id);
      form.set("sequence", String(sequence));
      form.set("file", new File([event.data], `chunk-${sequence}.webm`, { type: mime }));
      sequence += 1;
      void appendChunkAction(form);
    };
    instance.start(2_000);
    recorder.current = instance;
    setLive(true);
  }

  async function halt() {
    const instance = recorder.current;
    if (instance && instance.state !== "inactive") {
      await new Promise<void>((resolve) => {
        instance.onstop = () => resolve();
        instance.stop();
      });
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    if (chunks.current.length > 0) {
      const blob = new Blob(chunks.current, { type: "video/webm" });
      setPlayback(URL.createObjectURL(blob));
    }
    setLive(false);
    setStatus("preview");
    const stop = new FormData();
    stop.set("id", session.id);
    await markStoppedAction(stop);
    const assemble = new FormData();
    assemble.set("id", session.id);
    assemble.set("filename", `${session.source}.webm`);
    await assembleCaptureAction(assemble);
    setStaged(true);
  }

  return (
    <Card>
      <CardHeader title={labels.title} />
      <CardBody>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <video
          ref={preview}
          src={playback ?? undefined}
          className="mb-4 max-h-72 w-full rounded-md bg-ink"
          autoPlay={live}
          muted={live}
          controls={!live && Boolean(playback)}
          playsInline
        />
        {live ? (
          <div
            role="status"
            aria-live="assertive"
            className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-between gap-3 border-t border-danger bg-danger-soft px-4 py-3"
          >
            <p className="text-sm font-semibold text-danger">{labels.live}</p>
            <Button type="button" onClick={() => void halt()}>
              {labels.stop}
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {!session.permissionGrantedAt ? (
            <Button type="button" onClick={() => void requestPermission()}>
              {labels.grant}
            </Button>
          ) : null}
          {!live && status !== "confirmed" ? (
            <Button type="button" onClick={() => void begin()}>
              {labels.record}
            </Button>
          ) : null}
        </div>
        {status === "preview" || staged ? (
          <form action={reviewCaptureAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={session.id} />
            <Field label={labels.caption} htmlFor="caption">
              <Input
                id="caption"
                name="caption"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                maxLength={500}
              />
            </Field>
            <Field label={labels.trimStart} htmlFor="trimStartMs">
              <Input
                id="trimStartMs"
                name="trimStartMs"
                type="number"
                min={0}
                value={trimStart}
                onChange={(event) => setTrimStart(Number(event.target.value))}
              />
            </Field>
            <Field label={labels.trimEnd} htmlFor="trimEndMs">
              <Input
                id="trimEndMs"
                name="trimEndMs"
                type="number"
                min={0}
                value={trimEnd}
                onChange={(event) => setTrimEnd(event.target.value)}
              />
            </Field>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-ink-muted">{labels.cropX}</span>
              <input
                type="range"
                name="focalX"
                min={0}
                max={10000}
                step={100}
                value={focalX}
                onChange={(event) => setFocalX(Number(event.target.value))}
                className="accent-accent"
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-ink-muted">{labels.cropY}</span>
              <input
                type="range"
                name="focalY"
                min={0}
                max={10000}
                step={100}
                value={focalY}
                onChange={(event) => setFocalY(Number(event.target.value))}
                className="accent-accent"
              />
            </label>
            <Button type="submit">{labels.saveReview}</Button>
          </form>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {staged ? (
            <form action={confirmCaptureAction}>
              <input type="hidden" name="id" value={session.id} />
              <input type="hidden" name="caption" value={caption} />
              <input type="hidden" name="trimStartMs" value={String(trimStart)} />
              {trimEnd !== "" ? <input type="hidden" name="trimEndMs" value={String(trimEnd)} /> : null}
              <input type="hidden" name="focalX" value={String(focalX)} />
              <input type="hidden" name="focalY" value={String(focalY)} />
              <Button type="submit">{labels.confirm}</Button>
            </form>
          ) : null}
          <form action={discardCaptureAction}>
            <input type="hidden" name="id" value={session.id} />
            <Button type="submit">{labels.discard}</Button>
          </form>
        </div>
      </CardBody>
    </Card>
  );
}
