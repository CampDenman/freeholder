// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { eraseProviderRecordings } from "./erasure";
import { defineJob } from "@/core/jobs";
import {
  listVoiceVideoArtifacts,
  listVoiceVideoRooms,
  recordVoiceVideoArtifact,
  startVoiceVideoRoom,
  stopVoiceVideoRoom,
} from "./service";

export const retryFailedVoiceVideo = defineJob({
  name: "voiceVideo.retryFailed",
  summary: "Retry failed rooms and recordings in place.",
  schedule: "11,41 * * * *",
  handler: async () => {
    const actor = { kind: "system" as const };
    const rooms = await listVoiceVideoRooms.call({}, actor);
    let roomAttempts = 0;
    for (const room of rooms) {
      if (!["failed", "pending", "stopping"].includes(room.status)) continue;
      if (room.providerLeaseExpiresAt && room.providerLeaseExpiresAt > new Date()) continue;
      if (room.createdAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) continue;
      if (roomAttempts++ >= 50) break;
      if (room.externalRef) {
        await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, actor);
      } else {
        await startVoiceVideoRoom.call(
          {
            roomId: room.id,
            contactId: room.contactId,
            kind: room.kind === "video" ? "video" : "voice",
            provider: room.provider,
            title: room.title,
          },
          actor,
        );
      }
    }
    const artifacts = await listVoiceVideoArtifacts.call({}, actor);
    let artifactAttempts = 0;
    for (const artifact of artifacts) {
      if (!["failed", "pending"].includes(artifact.status) || artifact.kind === "transcript" ||
        (artifact.providerLeaseExpiresAt && artifact.providerLeaseExpiresAt > new Date()) ||
        artifact.createdAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
        continue;
      }
      if (artifactAttempts++ >= 50) break;
      await recordVoiceVideoArtifact.call(
        {
          artifactId: artifact.id,
          contactId: artifact.contactId,
          kind: artifact.kind === "video" ? "video" : "voice",
          provider: artifact.provider,
          title: artifact.title,
          roomId: artifact.roomId ?? undefined,
        },
        actor,
      );
    }
  },
});

export default [retryFailedVoiceVideo, eraseProviderRecordings];
