// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The quotes module (MASTER.md §11, §4.3, C6.12).
//
// `requires: ["core", "invoicing"]` — which is §11's own worked example of a
// module depending on another. The dependency is real rather than decorative:
// quote arithmetic uses the same integer-minor helpers the invoice does, so a
// line that extends to £1,234.56 on a quote extends to exactly that on the
// invoice it becomes (C6.13). A second rounding implementation is a penny that
// appears from nowhere on a reconciliation report.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "quotes",
  version: "0.1.0",
  requires: ["core", "invoicing"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: [
      "quote.sent",
      "quote.viewed",
      "quote.questioned",
      "quote.ownerReplied",
      "quote.revised",
      "quote.accepted",
      "quote.declined",
      "quote.expired",
    ],
  },
});
