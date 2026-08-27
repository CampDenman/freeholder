// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private client galleries (MASTER.md §4.5, C8.03).
//
// Requires only core: Assets, contacts, and sessions already live there.
// Public proof-of-work stays on the projects module; this module is delivery.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "galleries",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  events: {
    emits: [
      "gallery.created",
      "gallery.accessed",
      "gallery.denied",
      "gallery.guestInvited",
      "gallery.guestRevoked",
    ],
  },
});
