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
// The member's surface is in-tree, because plugin capabilities carry no routes
// or pages. It is deliberately small: the register is a portal room from the
// C8.11 section registry rather than a hand-written list page, so the only
// bespoke screens are the ones the registry has no verb for — adding a charge
// and correcting one.
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
