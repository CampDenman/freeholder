// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.24: a group call in the browser. Frames are encrypted on this device
// with a key that came through the conversation's MLS group, so the SFU
// forwards media it cannot read.
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalE2EEKeyProvider, Room, RoomEvent, Track, type Participant, type RemoteTrack } from "livekit-client";
import { Button, Callout } from "@/ui/primitives";
import { unb64 } from "@/modules/members/e2ee/wire";
import { deviceFor } from "../../messages/SecureConversation";
import { joinGroupCallAction, leaveGroupCallAction, startGroupCallAction } from "./actions";

type Result<T> = { ok: T } | { error: { code: string; message: string } };
async function unwrap<T>(pending: Promise<Result<T>>): Promise<T> {
  const result = await pending;
  if ("error" in result) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.ok;
}

export interface GroupCallLabels {
  connecting: string;
  waitingKey: string;
  encrypted: string;
  notEncrypted: string;
  failed: string;
  mute: string;
  unmute: string;
  cameraOff: string;
  cameraOn: string;
  leave: string;
  you: string;
  alone: string;
  removed: string;
}

type Tile = { identity: string; name: string; encrypted: boolean; local: boolean; video: Track | null };

function VideoTile({ tile, labels }: { tile: Tile; labels: GroupCallLabels }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !tile.video) return;
    tile.video.attach(element);
    return () => { tile.video?.detach(element); };
  }, [tile.video]);
  return (
    <li className="grid gap-1 rounded-lg border border-rule bg-surface p-2" data-participant={tile.identity} data-encrypted={tile.encrypted ? "yes" : "no"}>
      {tile.video ? <video ref={ref} autoPlay playsInline muted={tile.local} className="aspect-video w-full rounded-md bg-surface-muted" /> : <div className="grid aspect-video place-items-center rounded-md bg-surface-muted text-2xl" aria-hidden="true">{tile.name.slice(0, 1)}</div>}
      <p className="text-sm">{tile.local ? labels.you : tile.name} · {tile.encrypted ? labels.encrypted : labels.notEncrypted}</p>
    </li>
  );
}

function tilesOf(room: Room): Tile[] {
  const tile = (p: Participant, local: boolean): Tile => ({
    identity: p.identity,
    name: p.name || p.identity,
    encrypted: p.isEncrypted,
    local,
    video: [...p.videoTrackPublications.values()].find((pub) => pub.track && pub.source === Track.Source.Camera)?.track ?? null,
  });
  return [tile(room.localParticipant, true), ...[...room.remoteParticipants.values()].map((p) => tile(p, false))];
}

export function GroupCallRoom({ callId, conversationId, userId, media, labels }: { callId: string; conversationId: string; userId: string; media: "voice" | "video"; labels: GroupCallLabels }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"connecting" | "key" | "live" | "failed" | "removed">("connecting");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(media === "video");
  const [connectionRevision, setConnectionRevision] = useState(0);
  const leaving = useRef(false);
  const microphoneWanted = useRef(true);
  const cameraWanted = useRef(media === "video");
  const connectionAttempts = useRef(0);
  const roomRef = useRef<Room | null>(null);
  const audio = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    let restarting = false;
    let installed: Room | undefined;
    let worker: Worker | undefined;
    let resync: ReturnType<typeof setInterval> | undefined;
    const device = deviceFor(userId);
    setPhase("connecting");
    setTiles([]);
    const restart = () => {
      if (stopped || restarting || leaving.current) return;
      if (connectionAttempts.current >= 4) { setPhase("failed"); return; }
      restarting = true;
      void installed?.disconnect();
      setConnectionRevision(revision => revision + 1);
    };
    async function connect() {
      connectionAttempts.current++;
      const me = await device.device();
      await device.sync(conversationId);
      setPhase("key");
      let key: string | null = null;
      let generation = 0;
      for (let i = 0; i < 60 && !key && !stopped; i++) {
        ({ key, generation } = await device.currentCallKey(conversationId, callId));
        if (!key) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (stopped || leaving.current) return;
      if (!key) throw new Error("No media key arrived.");
      const credentials = await unwrap(joinGroupCallAction({ id: callId, deviceId: me.deviceId, generation }));
      if (credentials.generation !== generation) { restart(); return; }
      if (stopped || leaving.current) return;
      const keyProvider = new ExternalE2EEKeyProvider();
      worker = new Worker(new URL("livekit-client/e2ee-worker", import.meta.url));
      const room = new Room({ encryption: { keyProvider, worker }, adaptiveStream: true, dynacast: true });
      installed = room;
      roomRef.current = room;
      const refresh = () => { if (!stopped && !restarting) setTiles(tilesOf(room)); };
      room
        .on(RoomEvent.ParticipantConnected, refresh)
        .on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio && audio.current) audio.current.appendChild(track.attach());
          refresh();
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => { track.detach().forEach((el) => el.remove()); refresh(); })
        .on(RoomEvent.LocalTrackPublished, refresh)
        .on(RoomEvent.ParticipantEncryptionStatusChanged, refresh)
        .on(RoomEvent.Disconnected, restart);
      await keyProvider.setKey(unb64(key).buffer as ArrayBuffer);
      await room.setE2EEEnabled(true);
      await room.connect(credentials.url, credentials.token);
      if (stopped || leaving.current) { await room.disconnect(); return; }
      await room.localParticipant.setMicrophoneEnabled(microphoneWanted.current);
      if (media === "video" && !stopped && !leaving.current) await room.localParticipant.setCameraEnabled(cameraWanted.current);
      if (stopped || leaving.current) { await room.disconnect(); return; }
      refresh();
      setPhase("live");
      connectionAttempts.current = 0;
      // Keep the group current, so a device that joins gets the key, and move
      // to the new key when someone has left (C12.37).
      resync = setInterval(() => {
        void device
          .currentCallKey(conversationId, callId)
          .then((next) => {
            // Even before the new key arrives, stop publishing in a room
            // reachable with a removed participant's cached credential.
            if (next.generation !== generation) restart();
          })
          .catch(() => undefined);
      }, 3000);
    }
    connect().catch((error: unknown) => {
      if (stopped || leaving.current) return;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
      if (code === "conflict" && connectionAttempts.current < 4) restart();
      else setPhase(code === "permission" || code === "not_found" ? "removed" : "failed");
    });
    return () => {
      stopped = true;
      if (resync) clearInterval(resync);
      if (roomRef.current === installed) roomRef.current = null;
      if (installed) void installed.disconnect().finally(() => worker?.terminate());
      else worker?.terminate();
    };
  }, [callId, conversationId, media, userId, connectionRevision]);

  async function leave() {
    leaving.current = true;
    await roomRef.current?.disconnect();
    await leaveGroupCallAction({ id: callId });
    router.push(`/messages/${conversationId}`);
  }

  return (
    <div className="grid gap-4">
      {phase === "connecting" ? <p className="text-ink-muted">{labels.connecting}</p> : null}
      {phase === "key" ? <p className="text-ink-muted">{labels.waitingKey}</p> : null}
      {phase === "failed" ? <Callout tone="danger">{labels.failed}</Callout> : null}
      {phase === "removed" ? <Callout>{labels.removed}</Callout> : null}
      {phase === "live" && tiles.length === 1 ? <p className="text-ink-muted">{labels.alone}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2" aria-live="polite">
        {tiles.map((tile) => <VideoTile key={tile.identity} tile={tile} labels={labels} />)}
      </ul>
      <div ref={audio} hidden />
      <div className="flex flex-wrap gap-2">
        <Button variant="quiet" disabled={phase !== "live"} onClick={() => { const next = !mic; microphoneWanted.current = next; setMic(next); void roomRef.current?.localParticipant.setMicrophoneEnabled(next); }}>{mic ? labels.mute : labels.unmute}</Button>
        {media === "video" ? <Button variant="quiet" disabled={phase !== "live"} onClick={() => { const next = !camera; cameraWanted.current = next; setCamera(next); void roomRef.current?.localParticipant.setCameraEnabled(next); }}>{camera ? labels.cameraOff : labels.cameraOn}</Button> : null}
        <Button variant="danger" onClick={() => { void leave(); }}>{labels.leave}</Button>
      </div>
    </div>
  );
}

/** On a group conversation: start a call (making and sending its key), or join the one going on. */
export function GroupCallButtons({ conversationId, userId, active, labels }: { conversationId: string; userId: string; active: { id: string; media: "voice" | "video" } | null; labels: { voice: string; video: string; join: string; failed: string } }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function start(media: "voice" | "video") {
    setBusy(true);
    setFailed(false);
    try {
      const { id, started } = await unwrap(startGroupCallAction({ conversationId, media }));
      // Only the device that started the call makes its key; anyone else joins the one already going.
      if (started) await deviceFor(userId).startCallKey(conversationId, id);
      // A full load, so the call page's own policy (which admits the SFU) applies.
      window.location.assign(`/call/group/${id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  if (active) return <p><a className="underline" href={`/call/group/${active.id}`}>{labels.join}</a></p>;
  return (
    <div className="grid gap-2">
      {failed ? <Callout tone="danger">{labels.failed}</Callout> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="quiet" disabled={busy} onClick={() => { void start("voice"); }}>{labels.voice}</Button>
        <Button variant="quiet" disabled={busy} onClick={() => { void start("video"); }}>{labels.video}</Button>
      </div>
    </div>
  );
}
