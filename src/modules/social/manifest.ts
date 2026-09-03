// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social connection hub (MASTER.md §33, C9.24).
//
// Optional: most instances never connect a network. The hub exists so that
// when they do, every conforming adapter — built-in or plugin — is reached
// the same way. Ingest, the composer and preset onboarding are later items;
// this module stores connections and, from C9.25, the packages those
// connections pull back. The composer is later.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "social",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  events: {
    emits: [
      "social.profileConnected",
      "social.profileReviewed",
      "social.profileAssigned",
      "social.profileUnhealthy",
      "social.ingested",
      "social.variantsCreated",
      "social.scheduled",
    ],
  },
});
