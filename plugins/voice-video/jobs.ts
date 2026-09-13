// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
    for (const room of rooms) {
      if (room.status !== "failed") continue;
      if (room.externalRef) {
        await stopVoiceVideoRoom.call({ roomId: room.id }, actor);
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
    for (const artifact of artifacts) {
      if (artifact.status !== "failed" || artifact.kind === "transcript" || artifact.roomId) {
        continue;
      }
      await recordVoiceVideoArtifact.call(
        {
          artifactId: artifact.id,
          contactId: artifact.contactId,
          kind: artifact.kind === "video" ? "video" : "voice",
          provider: artifact.provider,
          title: artifact.title,
        },
        actor,
      );
    }
  },
});

export default [retryFailedVoiceVideo];
