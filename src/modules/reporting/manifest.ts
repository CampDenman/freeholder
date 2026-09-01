// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reports an owner will actually read (MASTER.md §2535, §4.7, C9.08).
//
// It requires `invoicing` because revenue is paid invoices — §4.6's "single
// money object" — and `analytics` because the funnel report asks C9.07's
// funnel rather than defining a second one. Everything else it can report on
// reaches it through `core/reporting`'s dimension registry, so this module
// never has to know which of catalog, scheduling or locations is installed.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "reporting",
  version: "0.1.0",
  requires: ["core", "invoicing", "analytics"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  // Scheduled accounting exports (C9.32). A report an owner opens needs no
  // job; one an accountant is waiting for does.
  jobs: () => import("./jobs"),
  events: {
    emits: [
      "report.viewSaved",
      "report.exportDefined",
      "report.exportBuilt",
      "report.exportDelivered",
      // The one that matters. A delivery that failed has to reach a person,
      // because the whole failure mode of a scheduled report is that nobody
      // notices it stopped.
      "report.exportFailed",
    ],
  },
});
