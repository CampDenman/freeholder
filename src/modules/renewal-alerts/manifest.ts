// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Renewal alerts (MASTER.md §43 C12.40).
//
// `requires` is core and nothing else, deliberately. This module must not
// reach into `modules/subscriptions`: that one is the site's own billing and
// this one is a register of charges other companies make, and the names are
// close enough that a dependency between them would be read as a relationship
// they do not have.
//
// Off by default, like any module nobody asked for: a Freeholder instance
// that does not want a renewal tracker should never see one.
//
// NOT YET BUILT, and named here so the gap is visible rather than discovered:
// the write services (add, edit, archive a tracked subscription) and the
// in-tree dashboard and settings screens. Plugin capabilities carry no routes
// or pages, so those screens are in-tree work. This increment is the register,
// the look-ahead job and the message.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "renewal-alerts",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  events: { emits: ["renewalAlerts.warned"] },
});
