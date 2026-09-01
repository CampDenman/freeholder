// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sharing in the DNA (MASTER.md §34, C9.28).
//
// `requires: ["core", "analytics"]` and the dependency is the honest one.
// §34's promise is not a row of buttons; it is that "sharing becomes a
// measured channel, not a hopeful button". Measuring is analytics' job, and
// this module composes `analytics.campaignTotals` rather than counting clicks
// of its own — so an instance with analytics switched off should not get a
// share report full of zeros it cannot explain. It should not get this module.
//
// It does *not* require cms. Share targets are keyed by public path, which is
// the one thing every module's public entities agree on, so a gallery, a
// product and a page are the same kind of thing here without this module
// knowing that any of them exist.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "share",
  version: "0.1.0",
  requires: ["core", "analytics"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: [
      // One act of sharing. Emitted so an automation or a loyalty earn rule
      // can reward advocacy without this module knowing either exists.
      "share.linkCreated",
      // An owner changed their mind about an entity. Worth announcing because
      // it is the moment links already in the world stop working.
      "share.targetChanged",
    ],
  },
});
