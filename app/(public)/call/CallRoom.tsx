// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.07: a peer-to-peer WebRTC call. Media flows directly between the two
// devices, encrypted by WebRTC; the server only passes signalling.
"use client";
import { useEffect, useRef, useState } from "react";
import { answer, callConfig, collect, hangUp, signal } from "./actions";

type Labels = {
  ringing: string; connecting: string; connected: string; ended: string; declined: string; missed: string;
  hangUp: string; mute: string; unmute: string; cameraOff: string; cameraOn: string; you: string; them: string;
  noDevice: string; directOnly: string;
};

export function CallRoom({ id, role, media, initialState, labels }: {
  id: string; role: "caller" | "callee"; media: "voice" | "video"; initialState: string; labels: Labels;
}) {
  const [state, setState] = useState(initialState);
  const [phase, setPhase] = useState<"setup" | "connecting" | "connected" | "done">("setup");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [directOnly, setDirectOnly] = useState(false);
  const local = useRef<HTMLVideoElement>(null);
  const remote = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending: RTCIceCandidateInit[] = [];

    async function start() {
      if (role === "callee" && initialState === "ringing") await answer(id, true);
      const config = await callConfig();
      setDirectOnly(!config.relayConfigured);
      let mine: MediaStream;
      try {
        mine = await navigator.mediaDevices.getUserMedia({ audio: true, video: media === "video" });
      } catch {
        setProblem(labels.noDevice);
        await hangUp(id);
        setPhase("done");
        return;
      }
      stream.current = mine;
      if (local.current) local.current.srcObject = mine;
      const peer = new RTCPeerConnection({ iceServers: config.iceServers });
      pc.current = peer;
      mine.getTracks().forEach((track) => peer.addTrack(track, mine));
      peer.ontrack = (event) => { if (remote.current) remote.current.srcObject = event.streams[0] ?? null; };
      peer.onicecandidate = (event) => { if (event.candidate) void signal(id, "candidate", event.candidate.toJSON()); };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") setPhase("connected");
        if (peer.connectionState === "failed") setProblem(labels.directOnly);
      };
      setPhase("connecting");
      if (role === "caller") {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await signal(id, "offer", { type: "offer", sdp: offer.sdp ?? "" });
      }
      void poll();
    }

    async function poll() {
      if (stopped) return;
      try {
        const got = await collect(id);
        setState(got.state);
        const peer = pc.current;
        if (got.state !== "ringing" && got.state !== "active") { finish(); return; }
        for (const s of got.signals) {
          if (!peer) break;
          if (s.kind === "offer" || s.kind === "answer") {
            await peer.setRemoteDescription(s.payload as RTCSessionDescriptionInit);
            for (const c of pending.splice(0)) await peer.addIceCandidate(c);
            if (s.kind === "offer") {
              const reply = await peer.createAnswer();
              await peer.setLocalDescription(reply);
              await signal(id, "answer", { type: "answer", sdp: reply.sdp ?? "" });
            }
          } else if (peer.remoteDescription) {
            await peer.addIceCandidate(s.payload as RTCIceCandidateInit);
          } else {
            pending.push(s.payload as RTCIceCandidateInit);
          }
        }
      } catch {
        // A dropped poll is retried; the call ends only when the server says so.
      }
      timer = setTimeout(() => void poll(), 1000);
    }

    function finish() {
      stopped = true;
      pc.current?.close();
      stream.current?.getTracks().forEach((t) => t.stop());
      setPhase("done");
    }

    void start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      pc.current?.close();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [id, role, media, initialState, labels.noDevice, labels.directOnly]);

  const status =
    phase === "done"
      ? state === "declined" ? labels.declined : state === "missed" ? labels.missed : labels.ended
      : phase === "connected" ? labels.connected
      : state === "ringing" ? labels.ringing : labels.connecting;

  return (
    <div className="grid gap-4">
      <p role="status" aria-live="polite" className="text-lg font-semibold">{status}</p>
      {problem ? <p role="alert" className="text-danger">{problem}</p> : null}
      {directOnly && phase !== "done" ? <p className="text-sm text-ink-muted">{labels.directOnly}</p> : null}
      <div className={media === "video" ? "grid gap-3 sm:grid-cols-2" : "sr-only"}>
        <figure className="grid gap-1">
          <video ref={remote} autoPlay playsInline className="aspect-video w-full rounded-lg bg-ink" />
          <figcaption className="text-sm text-ink-muted">{labels.them}</figcaption>
        </figure>
        <figure className="grid gap-1">
          <video ref={local} autoPlay playsInline muted className="aspect-video w-full rounded-lg bg-ink" />
          <figcaption className="text-sm text-ink-muted">{labels.you}</figcaption>
        </figure>
      </div>
      {phase !== "done" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-md border border-rule-strong px-3 py-2" aria-pressed={muted}
            onClick={() => { stream.current?.getAudioTracks().forEach((t) => { t.enabled = muted; }); setMuted(!muted); }}>
            {muted ? labels.unmute : labels.mute}
          </button>
          {media === "video" ? (
            <button type="button" className="rounded-md border border-rule-strong px-3 py-2" aria-pressed={cameraOff}
              onClick={() => { stream.current?.getVideoTracks().forEach((t) => { t.enabled = cameraOff; }); setCameraOff(!cameraOff); }}>
              {cameraOff ? labels.cameraOn : labels.cameraOff}
            </button>
          ) : null}
          <button type="button" className="rounded-md bg-danger px-3 py-2 text-on-danger"
            onClick={() => { void hangUp(id).then(() => setPhase("done")); pc.current?.close(); stream.current?.getTracks().forEach((t) => t.stop()); }}>
            {labels.hangUp}
          </button>
        </div>
      ) : null}
    </div>
  );
}
