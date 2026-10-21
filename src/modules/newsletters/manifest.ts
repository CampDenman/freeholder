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
  jobs: () => import("./jobs"),
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
      // Broadcasts (C9.06). A separate subject from a newsletter issue: an
      // automation that wants to know a campaign finished should not have to
      // listen for every subscription too.
      "broadcast.created",
      "broadcast.started",
      "broadcast.finished",
      "broadcast.paused",
    ],
    listens: {
      // Bounces and spam complaints (C9.06). `core/mail` suppresses the
      // address whether campaigns exist or not; this records what became of
      // the copy, so a broadcast can answer for its own numbers.
      "mail.deliveryUpdated": "onMailDeliveryUpdated",
    },
  },
});
