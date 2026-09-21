// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { definePlugin } from "@freeholder/plugin-kit";

export default definePlugin({
  name: "voice-video",
  version: "0.1.0",
  freeholder: ">=0.0.0",
  license: "Apache-2.0",
  permissions: ["contacts:read", "network:external"],
  requires: ["core"],
  migrations: ["0000_reviewed-baseline.sql", "0002_voice_video_rooms.sql", "0009_daily_voice_video.sql", "0012_owner_storage_refunds.sql"],
  capabilities: { adapters: [] },
  events: {
    emits: [
      "voiceVideo.roomStarted",
      "voiceVideo.roomJoined",
      "voiceVideo.roomEnded",
      "voiceVideo.missedCall",
      "voiceVideo.recorded",
      "voiceVideo.recordingImported",
    ],
  },
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
});
