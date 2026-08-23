// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The CRM module (MASTER.md §11, §4.1, C7.01).
//
// §4.1: "A deal is optional. A retail store never opens one; a wedding
// photographer opens one per enquiry. Pipelines are configuration, so the
// module is inert until an owner defines a stage."
//
// That is why installing this module changes nothing on its own: there are no
// default rows at boot, `crm.installDefaults` exists for owners who want the
// standard ladders, and core creates no deals by itself. A retail instance
// carries the tables and never notices them.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "crm",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: [
      "deal.opened",
      "deal.moved",
      "deal.won",
      "deal.lost",
      "contact.stageChanged",
    ],
  },
});
