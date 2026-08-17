// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Newsletters and public issue archives (MASTER.md C9.04, C2.21).
import { defineModule } from "@/core/module";

export default defineModule({
  name: "newsletters",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  blocks: () => import("./blocks"),
  events: {
    emits: [
      "newsletters.created",
      "newsletters.updated",
      "newsletters.issueCreated",
      "newsletters.issueUpdated",
      "newsletters.issuePublished",
      "newsletters.subscribed",
      "newsletters.confirmed",
      "newsletters.unsubscribed",
    ],
  },
});
