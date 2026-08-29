// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Advertising and sponsored inventory (MASTER.md §4.16, C9.17).
//
// §4.16 is for the businesses that are publishers: "a local news site, a
// newsletter with a sponsor, a niche blog with a house ad for its own
// workshop." Most instances will never switch this on, which is exactly why
// it is a module.
//
// Requires core, and cms because the slot is placed on a page as a block —
// §4.16: "Placed on the page as a block (§32), so where an ad appears is
// content structure like everything else."
//
// C9.17 is the inventory and the paperwork. Creatives, house fill, the signed
// click-out and the counting are C9.18 and C9.19; third-party tags and
// ads.txt are C9.20. A campaign can be sold and scheduled before anything
// renders, which is the order the work actually happens in.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "ads",
  version: "0.1.0",
  requires: ["core", "cms"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: ["ads.campaignCreated", "ads.campaignDecided", "ads.campaignStatusChanged"],
    // Core announces that setup finished; ads answers with its standard
    // sizes, and neither module imports the other (§11).
    listens: { "settings.setupCompleted": "onSetupCompleted" },
  },
});
