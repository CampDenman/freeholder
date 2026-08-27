// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Gallery session hygiene (C8.03).
import { defineJob } from "@/core/jobs";

export const expireGallerySessions = defineJob({
  name: "galleries.expireSessions",
  summary: "Delete gallery sessions that have expired.",
  schedule: "11 * * * *",
  concurrency: 1,
  handler: async () => {
    const { expireGallerySessions: expire } = await import("./service");
    return expire.call({}, { kind: "system" });
  },
});

export default [expireGallerySessions];
