// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The analytics module (MASTER.md §4.7, §36).
//
// Note what it does *not* require: forms. It listens for `forms.submitted` on
// the bus and records a conversion, and the two modules do not import each
// other — which is the §11 contract doing the work it was designed for. An
// instance with forms switched off records no conversions and breaks nothing.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "analytics",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: { listens: { "forms.submitted": "onFormSubmitted" } },
});
