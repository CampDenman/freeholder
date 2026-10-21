// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: the Paradise Comms adapter behind the plugin's provider seam.
// Paradise identity is the `rm_`/`rec_` prefixed id kept in externalRef;
// providerRoomId stays null because those ids are not UUIDs.
import { getPinnedBytes } from "@/core/http/pinned-download";
import { createParadiseClient, ParadiseError } from "./paradise";
import type { ParadiseConfig } from "./settings";
import type {
  VoiceVideoAccessInput,
  VoiceVideoCaptureInput,
  VoiceVideoProvider,
  VoiceVideoRoomInput,
} from "./adapter";

export function createParadiseVoiceVideoProvider(
  configuration: ParadiseConfig,
  fetcher: typeof fetch = fetch,
  download: typeof getPinnedBytes = getPinnedBytes,
): VoiceVideoProvider {
  const client = createParadiseClient({
    baseUrl: configuration.baseUrl,
    authScheme: configuration.authScheme,
    apiKey: configuration.apiKey,
    portfolioToken: configuration.portfolioToken,
  }, fetcher, Date.now, download);
  function verify(input: { provider: string; accountDomain: string | null }) {
    if (input.provider !== "paradise") throw new ParadiseError("This room belongs to this instance's other call provider.");
    if (input.accountDomain) throw new ParadiseError("Restore this room's original provider configuration before retrying.");
  }
  function roomIdentity(input: VoiceVideoAccessInput & { roomExternalRef?: string | null }): string {
    const ref = input.roomExternalRef ?? input.externalRef;
    if (!ref) throw new ParadiseError("This room has no verified Paradise Comms session. Create a new room.");
    return ref;
  }
  return {
    async startRoom(input: VoiceVideoRoomInput) {
      verify(input);
      // The owner's title names the provider room; the Idempotency-Key is the
      // deterministic handle that recovers a create whose response was lost
      // (a replay returns the same rm_ room instead of opening a second one).
      const room = await client.createRoom({
        name: input.title.trim().slice(0, 200) || `fh-${input.roomId}`,
        ownerId: `freeholder:${input.roomId}`,
        policy: configuration.roomPolicy,
        maxParticipants: 20,
        recordingEnabled: true,
        retentionDays: configuration.retentionDays,
      });
      if (room.state === "ended" || room.state === "error") throw new ParadiseError("Paradise Comms closed this room as it was being opened. Create a new room.");
      // PM ids are rm_-prefixed ULIDs, not UUIDs; externalRef is the identity.
      return { externalRef: room.id, providerRoomId: null };
    },
    async endRoom(input) {
      verify(input);
      await client.endRoom(roomIdentity(input));
    },
    async meetingToken(input) {
      verify(input);
      const credentials = await client.createCredentials({
        roomId: roomIdentity(input),
        participantId: input.userId,
        role: input.owner ? "host" : "participant",
        ttlSeconds: 1800,
      });
      return {
        // LiveKit has no hosted join page; the URL is the server the client
        // connects to with the token. Admin screens render these details for
        // copy into a LiveKit client rather than redirecting to them.
        roomUrl: credentials.livekit_url,
        meetingToken: credentials.token,
        expiresAt: Math.floor(new Date(credentials.expires_at).getTime() / 1000),
        livekitUrl: credentials.livekit_url,
        iceServers: credentials.ice_servers,
      };
    },
    async capture(input: VoiceVideoCaptureInput) {
      verify(input);
      const roomId = roomIdentity({ ...input, externalRef: input.roomExternalRef });
      let recording;
      if (input.externalRef) {
        recording = await client.readRecording(input.externalRef);
        if (recording.source_type !== "room" || recording.source_id !== roomId) {
          throw new ParadiseError("Paradise Comms has not verified a recording for this room.");
        }
        if (recording.status !== "available") {
          throw new ParadiseError("The Paradise Comms recording is not ready. Stop recording in the call, then refresh after processing finishes.");
        }
      } else {
        const page = await client.listRecordings({ roomId, status: "available", limit: 50 });
        const latest = [...page.data].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
        if (!latest) {
          throw new ParadiseError("The Paradise Comms recording is not ready. Stop recording in the call, then refresh after processing finishes.");
        }
        recording = latest;
      }
      // PM ships no transcripts; the slot stays absent, never a placeholder.
      return { externalRef: recording.id, transcript: null, durationSeconds: recording.duration_seconds ?? 0 };
    },
    async recordingAccess(input) {
      verify(input);
      return client.recordingAccess(input.recordingId);
    },
    async downloadRecording(input) {
      verify(input);
      return client.downloadRecording(input.recordingId);
    },
    async startRecording(input) {
      verify(input);
      const recording = await client.startRecording({ roomId: roomIdentity(input), audioOnly: input.audioOnly });
      return { providerRecordingId: recording.id, status: recording.status };
    },
    async stopRecording(input) {
      verify(input);
      const recording = await client.stopRecording(roomIdentity(input));
      return recording ? { providerRecordingId: recording.id, status: recording.status } : null;
    },
    async eraseRoomRecordings(input) {
      verify(input);
      if (!input.externalRef) throw new ParadiseError("This erasure task has no original room reference.");
      const roomId = input.externalRef;
      const deadline = Date.now() + 120_000;
      const checkpoint = () => { if (Date.now() > deadline) throw new ParadiseError("Provider erasure reached its time budget. Retry the same job."); };

      const room = await client.readRoom(roomId).catch(() => null);
      if (room && room.state !== "ended" && room.state !== "error") {
        // Closing the room first stops new media; PM's end is idempotent and
        // provider-confirmed before we touch the recording inventory.
        await client.endRoom(roomId);
      }

      // PM paginates at 50; walk every page, then verify the inventory is
      // empty, exactly like the Daily erasure path.
      const inventory: string[] = [];
      for (let offset = 0; offset < 10_000; offset += 50) {
        checkpoint();
        const page = await client.listRecordings({ roomId, limit: 50, offset });
        for (const item of page.data) if (!inventory.includes(item.id)) inventory.push(item.id);
        if (!page.hasMore) break;
      }
      for (const id of inventory) {
        checkpoint();
        const recording = await client.readRecording(id).catch(() => null);
        if (!recording) continue; // Already gone — idempotent erasure.
        if (recording.status === "active" || recording.status === "stopping" || recording.status === "processing") {
          // Mid-egress: PM answers DELETE with 409; stop the egress and let
          // the durable job retry the erase once processing settles.
          if (recording.status === "active") await client.stopRecording(roomId).catch(() => undefined);
          throw new ParadiseError("Paradise Comms is still processing a recording from this room. Retry erasure shortly.");
        }
        await client.deleteRecording(id);
      }
      const remaining = await client.listRecordings({ roomId, limit: 50 });
      if (remaining.data.length) throw new ParadiseError("Paradise Comms recording erasure remains pending. Retry the same job.");
    },
  };
}
