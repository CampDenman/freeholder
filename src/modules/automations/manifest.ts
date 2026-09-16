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
// C9.01 defines and validates; C9.02 runs. A run is a row in `core/runs`
// between steps rather than a held process, which is what lets a two-day wait
// survive a deploy and a run be paused or inspected between any two steps.
//
// The guardrails — consent, quiet hours, budgets, approvals and the
// untrusted-input rule — are C9.03, and go in front of the step that acts
// rather than around the run.
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
      "automation.runStarted",
      "automation.runFinished",
      "automation.runFailed",
      "automation.runKilled",
    ],
  },
});
