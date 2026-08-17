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
  caption: string;
  trimStart: string;
  trimEnd: string;
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
    setLive(false);
    const stop = new FormData();
    stop.set("id", session.id);
    await markStoppedAction(stop);
    const assemble = new FormData();
    assemble.set("id", session.id);
    assemble.set("filename", `${session.source}.webm`);
    await assembleCaptureAction(assemble);
  }

  return (
    <Card>
      <CardHeader title={labels.title} />
      <CardBody>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <video ref={preview} className="mb-4 max-h-72 w-full rounded-md bg-ink" autoPlay muted playsInline />
        {live ? (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-surface px-4 py-3">
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
          {session.status !== "live" && session.status !== "confirmed" ? (
            <Button type="button" onClick={() => void begin()}>
              {labels.record}
            </Button>
          ) : null}
        </div>
        {session.status === "preview" || session.assetId ? (
          <form action={reviewCaptureAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={session.id} />
            <Field label={labels.caption} htmlFor="caption">
              <Input id="caption" name="caption" defaultValue={session.caption ?? ""} maxLength={500} />
            </Field>
            <Field label={labels.trimStart} htmlFor="trimStartMs">
              <Input id="trimStartMs" name="trimStartMs" type="number" min={0} defaultValue={session.trimStartMs} />
            </Field>
            <Field label={labels.trimEnd} htmlFor="trimEndMs">
              <Input
                id="trimEndMs"
                name="trimEndMs"
                type="number"
                min={0}
                defaultValue={session.trimEndMs ?? undefined}
              />
            </Field>
            <Button type="submit">{labels.saveReview}</Button>
          </form>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {session.assetId ? (
            <form action={confirmCaptureAction}>
              <input type="hidden" name="id" value={session.id} />
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
