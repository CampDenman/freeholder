// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social connection hub (MASTER.md §33, C9.24, C9.31).
//
// Optional: most instances never connect a network. The hub exists so that
// when they do, every conforming adapter — built-in or plugin — is reached
// the same way. Onboarding in the normal business presets lists the hub on
// day one; nothing is authorized or published until a person finishes OAuth
// and review. A fixture plugin (`plugins/social-fixture`) proves another
// network can join without editing this module or the composer.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "social",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  onboarding: () => import("./onboarding"),
  events: {
    emits: [
      "social.profileConnected",
      "social.profileReviewed",
      "social.profileAssigned",
      "social.profileUnhealthy",
      "social.ingested",
      "social.variantsCreated",
      "social.scheduled",
      "social.gbpHoursSynced",
      "social.gbpReviewsSynced",
    ],
  },
});
