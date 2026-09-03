// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Rebuild the assistant retrieval index (MASTER.md §31, C9.22).
import { defineJob } from "@/core/jobs";

export const reindexAssistant = defineJob({
  name: "assistant.reindex",
  summary: "Rebuild the assistant's retrieval index from published content.",
  schedule: "17 * * * *",
  concurrency: 1,
  handler: async () => {
    const { reindex } = await import("./service");
    return reindex.call({}, { kind: "system" });
  },
});

export default [reindexAssistant];
