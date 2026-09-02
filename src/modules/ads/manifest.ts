// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Advertising and sponsored inventory (MASTER.md §4.16, C9.17–C9.18).
//
// §4.16 is for the businesses that are publishers: "a local news site, a
// newsletter with a sponsor, a niche blog with a house ad for its own
// workshop." Most instances will never switch this on, which is exactly why
// it is a module.
//
// Requires core, and cms because the slot is placed on a page as a block —
// §4.16: "Placed on the page as a block (§32), so where an ad appears is
// content structure like everything else." And analytics, because §4.16 says
// "measurement is first-party and follows the MRC definition", reported to
// first-party analytics (§4.7) as `ad.impression`, `ad.viewable`, `ad.click`.
// An ad module that cannot count is not one a publisher can sell from, so the
// dependency is real rather than optional.
//
// C9.17 was the inventory and the paperwork; C9.18 is the artwork, the house
// fill, the signed click-out and the money path. Third-party tags and ads.txt
// are C9.20, and the counting of impressions and viewability is C9.19 — a
// campaign can be sold, scheduled and served before either exists, which is
// the order the work actually happens in.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "ads",
  version: "0.1.0",
  requires: ["core", "cms", "analytics"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  // §4.16: an ad slot is "placed on the page as a block (§32), so where an ad
  // appears is content structure like everything else." The block belongs to
  // this module rather than to cms, because it is this module's vocabulary —
  // cms does not know what a creative is and should not have to.
  blocks: () => import("./blocks"),
  events: {
    emits: [
      "ads.campaignCreated",
      "ads.campaignDecided",
      "ads.campaignInvoiced",
      "ads.campaignStatusChanged",
      "ads.creativeReviewed",
      "ads.campaignReconciled",
    ],
    // Core announces that setup finished; ads answers with its standard
    // sizes, and neither module imports the other (§11).
    listens: { "settings.setupCompleted": "onSetupCompleted" },
  },
});
