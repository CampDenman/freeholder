// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Documents shared with a client (MASTER.md §4.5, C8.13).
//
// Requires only core. A document hangs off a project, a quote or an invoice
// through a polymorphic `subject_type` + `subject_id` rather than a foreign
// key, so a business with none of those modules still has somewhere to put a
// signed contract — which is the business that most needs one.
//
// The bytes are an `Asset` (§4.5), so uploads, scanning, checksums and storage
// are core's problem and this module only decides who may see them and when.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "documents",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: [
      "document.created",
      "document.revised",
      "document.shared",
      "document.shareRevoked",
      "document.accessed",
    ],
  },
});
