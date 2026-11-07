// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Config { enabled: boolean; modes: string[]; label: string; disclosure: string }
interface Session {
  status: string; session_id?: string; mode?: "voice" | "video"; max_seconds?: number;
  hard_until_ms?: number; call?: { duplex?: { session_id: string }; ice_servers?: RTCIceServer[] };
  disclosure?: string; retry_after_ms?: number; queue_position?: number;
  ready?: boolean;
}
interface Handle { stop(): void; isReady(): boolean; failed(): boolean }
export interface PreviewAssistantLabels {
  label: string; captions: string; video: string; voice: string; leave: string; end: string;
  waiting: string; unavailable: string; connecting: string; captionFailed: string;
  ended: string; lost: string; microphone: string;
}
type SharedTransport = {
  startDuplexCall(started: unknown, transcript: (text: string) => void, deps: {
    audioContext(): AudioContext | undefined; microphone(): Promise<MediaStream | undefined>;
    codecBase: string; endSession(): Promise<void>; signal: AbortSignal;
    videoElement: HTMLVideoElement | null; report(): void;
  }, hooks?: { onTranscriptSegment(segment: { speaker: "member" | "muse"; text: string; startedAt: number; endedAt: number; final: boolean }): void }): Promise<Handle | undefined>;
};

/** The cookie stays httpOnly; the browser supplies only bounded call choices. */
async function control(body: Record<string, unknown>, keepalive = false): Promise<Session & Partial<Config>> {
  const csrf = document.cookie.split("; ").find(cookie => cookie.startsWith("freeholder_csrf="))?.split("=").slice(1).join("=");
  const response = await fetch("/api/chat/assistant/call", {
    method: "POST", cache: "no-store", keepalive,
    headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("The assistant could not connect. You can still send a message.");
  return response.json() as Promise<Session & Partial<Config>>;
}

/** Voice/video is an extension of the existing site chat, with shared PM media. */
export function PreviewAssistantCall({ ended, labels }: { ended: boolean; labels: PreviewAssistantLabels }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [state, setState] = useState("idle");
  const [notice, setNotice] = useState("");
  const [caption, setCaption] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const live = useRef<{ id?: string; handle?: Handle; audio?: AudioContext; mic?: MediaStream; controller?: AbortController; timer?: ReturnType<typeof setInterval>; until?: number; want?: "voice" | "video" }>({});

  const stop = useCallback(async (unmount = false) => {
    const current = live.current;
    live.current = {};
    current.controller?.abort();
    if (current.timer) clearInterval(current.timer);
    current.handle?.stop();
    current.mic?.getTracks().forEach(track => track.stop());
    await current.audio?.close().catch(() => undefined);
    if (current.id) await control({ action: "end", sessionId: current.id }, unmount).catch(() => undefined);
    if (!unmount) { setState("idle"); setCaption(""); }
  }, []);

  useEffect(() => {
    let active = true;
    void control({ action: "config" }).then(value => {
      if (active && value.enabled && Array.isArray(value.modes)) setConfig(value as unknown as Config);
    }).catch(() => undefined);
    return () => { active = false; void stop(true); };
  }, [stop]);
  useEffect(() => { if (ended) void stop(); }, [ended, stop]);

  async function attach(result: Session, current: typeof live.current) {
    if (live.current !== current || current.controller?.signal.aborted || !current.controller) {
      if (result.session_id) await control({ action: "end", sessionId: result.session_id }).catch(() => undefined);
      return;
    }
    if (result.session_id) current.id = result.session_id;
    if (result.status === "queued") {
      setState("queued"); setNotice(labels.waiting);
      return;
    }
    if (result.status !== "live" || !result.call?.duplex || !current.id) {
      await stop(); setNotice(labels.unavailable);
      return;
    }
    current.until = result.hard_until_ms;
    setState("connecting"); setNotice(result.disclosure ?? config?.disclosure ?? labels.connecting);
    // This is a byte-pinned local distribution of the shared transport, not
    // another browser call implementation. Its codecs stay on this origin.
    const moduleUrl = "/managed-assistant/0.1.10/pm-ai-duplex-client.js";
    const sdk = await import(/* webpackIgnore: true */ moduleUrl) as SharedTransport;
    if (current.controller.signal.aborted) return;
    const handle = await sdk.startDuplexCall({
      sessionId: result.call.duplex.session_id, callKind: result.mode, stack: "ditto-duplex",
      maxSeconds: result.max_seconds, duplex: result.call.duplex, iceServers: result.call.ice_servers,
    }, setCaption, {
      audioContext: () => current.audio, microphone: async () => current.mic,
      codecBase: "/managed-assistant/0.1.10/duplex-codec/", signal: current.controller.signal,
      videoElement: video.current, report: () => undefined,
      endSession: async () => { if (live.current === current) await stop(); },
    }, { onTranscriptSegment: segment => {
      if (!segment.final || !current.id) return;
      const { speaker, text, startedAt, endedAt } = segment;
      void control({ action: "caption", sessionId: current.id, caption: { speaker, text, startedAt, endedAt } }).catch(() => {
        setNotice(labels.captionFailed);
      });
    } });
    if (!handle || current.controller.signal.aborted) {
      handle?.stop(); await stop(); setNotice(labels.unavailable);
    } else current.handle = handle;
  }

  async function start(want: "voice" | "video") {
    await stop();
    const current = { controller: new AbortController(), want } as typeof live.current;
    live.current = current;
    setState("connecting"); setNotice(labels.connecting);
    try {
      // Unlock audio in the person's click, before a network round trip.
      current.audio = new AudioContext();
      await current.audio.resume();
      current.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current.controller!.signal.aborted) { current.mic.getTracks().forEach(track => track.stop()); return; }
      await attach(await control({ action: "start", want }), current);
      if (live.current !== current || !current.id) return;
      let ticking = false;
      current.timer = setInterval(() => {
        if (ticking) return;
        ticking = true;
        void (async () => {
          if (current.until && Date.now() >= current.until || current.handle?.failed()) {
            await stop(); setNotice(labels.ended); return;
          }
          if (current.handle) {
            if (current.handle.isReady()) setState("live");
            await control({ action: "lease", sessionId: current.id, authorizedUntilMs: Math.min(Date.now() + 20000, current.until ?? 0) });
          } else {
            const status = await control({ action: "poll", sessionId: current.id });
            if (status.status === "queued" && status.ready) await attach(await control({ action: "queued", sessionId: current.id, want }), current);
            else if (status.status !== "queued") { await stop(); setNotice(labels.ended); }
          }
        })().catch(async () => { await stop(); setNotice(labels.lost); })
          .finally(() => { ticking = false; });
      }, 5000);
    } catch {
      await stop(); setNotice(labels.microphone);
    }
  }

  if (!config || ended) return null;
  return <section aria-label={labels.label} className="grid gap-2 rounded-md border border-rule p-3">
    <p className="text-sm font-semibold">{config.label}</p>
    <p className="text-xs text-ink-muted">{config.disclosure}</p>
    <p className="text-xs text-ink-muted">{labels.captions}</p>
    <video ref={video} autoPlay playsInline muted className={state === "idle" || state === "queued" ? "hidden" : "max-h-72 w-full rounded-md bg-ink"} />
    <div className="flex flex-wrap gap-3">
      {state === "idle" ? <>
        {config.modes.includes("video") && <button type="button" onClick={() => void start("video")} className="underline">{labels.video}</button>}
        {config.modes.includes("voice") && <button type="button" onClick={() => void start("voice")} className="underline">{labels.voice}</button>}
      </> : <button type="button" onClick={() => void stop()} className="underline">{state === "queued" ? labels.leave : labels.end}</button>}
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {caption && <p aria-live="polite" className="text-sm">{caption}</p>}
  </section>;
}
