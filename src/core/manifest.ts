// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Core's own manifest. Core is always on (MASTER.md §3) — it has no toggle and
// no `requires` — but it declares itself the same way a feature module does,
// so the boot sequence has exactly one shape to implement and modules have a
// worked example to copy.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "core",
  version: "0.1.0",
  tables: () => import("@/core/tables"),
  services: () => import("@/core/services"),
  jobs: () => import("@/core/jobs/core-jobs"),
  events: {
    // Core listens to *everything*, once, to fan committed events out to the
    // owner's webhook subscriptions. It goes through the ordinary manifest
    // mechanism rather than a special case in boot, so the listener shows up
    // in the boot report like any other.
    listens: { "*": "onAnyEvent" },
    emits: [
      "contact.created",
      "contact.merged",
      "settings.businessUpdated",
      "settings.setupCompleted",
      "module.enabled",
      "module.disabled",
      "location.created",
      "location.updated",
      "location.deleted",
      "apikey.created",
      "apikey.revoked",
      "webhook.created",
      "webhook.updated",
      "webhook.deleted",
      "agent.connected",
      "agent.hired",
      "agent.updated",
      "agent.allPaused",
      "agent.allResumed",
      "agentTask.created",
      "agentTask.assigned",
      "agentTask.cancelled",
      "agentTask.claimed",
      "agentTask.completed",
      "agentTask.failed",
    ],
  },
});
