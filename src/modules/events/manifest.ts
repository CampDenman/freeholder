// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Events and classes (MASTER.md C6.11, C2.21).
import { defineModule } from "@/core/module";

export default defineModule({
  name: "events",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  blocks: () => import("./blocks"),
  events: {
    emits: [
      "events.created",
      "events.updated",
      "events.published",
      "events.cancelled",
      "events.sessionAdded",
      "events.registered",
      "events.waitlisted",
      "events.checkedIn",
    ],
  },
});
