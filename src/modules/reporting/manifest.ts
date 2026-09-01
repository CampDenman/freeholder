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
  events: {
    emits: ["report.viewSaved"],
  },
});
