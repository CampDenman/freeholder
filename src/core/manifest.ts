// Copyright (C) 2026 Camp Denman Society
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
  events: {
    emits: [
      "contact.created",
      "contact.merged",
      "settings.businessUpdated",
      "settings.setupCompleted",
      "module.enabled",
      "module.disabled",
    ],
  },
});
