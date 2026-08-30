// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Automations: trigger → condition → action over spine events
// (MASTER.md §4.17, C9.01).
//
// Requires only core. An automation names events by their declared topic and
// calls verbs modules registered, so it neither imports nor is imported by the
// modules whose work it orchestrates — which is what lets an owner wire the
// shop to the CRM without either knowing the other exists.
//
// C9.01 defines and validates. Nothing here runs an automation: runs, delays,
// branches and per-contact state are C9.02, and the consent, quiet-hours,
// budget and approval guardrails are C9.03.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "automations",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: [
      "automation.created",
      "automation.published",
      "automation.statusChanged",
    ],
  },
});
