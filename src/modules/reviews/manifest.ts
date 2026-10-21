// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Collected customer feedback (MASTER.md §4.6, C8.09).
//
// Requires only core. A review of a product must not make this module depend
// on catalog being installed (§11), so subject ids are recorded untyped and
// the module works whichever commerce or booking modules are switched on.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "reviews",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  blocks: () => import("./blocks"),
  events: {
    emits: [
      "review.requested",
      "review.submitted",
      "review.approved",
      "review.hidden",
      "review.replied",
    ],
  },
});
