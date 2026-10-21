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
  const roomRef = useRef<Room | null>(null);
  const audio = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    let resync: ReturnType<typeof setInterval> | undefined;
    const device = deviceFor(userId);
    async function connect() {
      const me = await device.device();
      await device.sync(conversationId);
      const credentials = await unwrap(joinGroupCallAction({ id: callId, deviceId: me.deviceId }));
      setPhase("key");
      let key: string | null = null;
      let generation = 0;
      for (let i = 0; i < 60 && !key && !stopped; i++) {
        ({ key, generation } = await device.currentCallKey(conversationId, callId));
        if (!key) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!key || stopped) throw new Error("No media key arrived.");
      const keyProvider = new ExternalE2EEKeyProvider();
      const worker = new Worker(new URL("livekit-client/e2ee-worker", import.meta.url));
      const room = new Room({ encryption: { keyProvider, worker }, adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      const refresh = () => setTiles(tilesOf(room));
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
        .on(RoomEvent.Disconnected, () => { if (!stopped) setPhase("removed"); });
      await keyProvider.setKey(unb64(key).buffer as ArrayBuffer);
      await room.setE2EEEnabled(true);
      await room.connect(credentials.url, credentials.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      if (media === "video") await room.localParticipant.setCameraEnabled(true);
      refresh();
      setPhase("live");
      // Keep the group current, so a device that joins gets the key, and move
      // to the new key when someone has left (C12.37).
      resync = setInterval(() => {
        void device
          .currentCallKey(conversationId, callId)
          .then(async (next) => {
            if (next.key && next.generation > generation) {
              generation = next.generation;
              await keyProvider.setKey(unb64(next.key).buffer as ArrayBuffer);
            }
          })
          .catch(() => undefined);
      }, 3000);
    }
    connect().catch(() => { if (!stopped) setPhase("failed"); });
    return () => {
      stopped = true;
      if (resync) clearInterval(resync);
      void roomRef.current?.disconnect();
    };
  }, [callId, conversationId, media, userId]);

  async function leave() {
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
        <Button variant="quiet" disabled={phase !== "live"} onClick={() => { const next = !mic; setMic(next); void roomRef.current?.localParticipant.setMicrophoneEnabled(next); }}>{mic ? labels.mute : labels.unmute}</Button>
        {media === "video" ? <Button variant="quiet" disabled={phase !== "live"} onClick={() => { const next = !camera; setCamera(next); void roomRef.current?.localParticipant.setCameraEnabled(next); }}>{camera ? labels.cameraOff : labels.cameraOn}</Button> : null}
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
