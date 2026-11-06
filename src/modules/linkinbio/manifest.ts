// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The link-in-bio module (MASTER.md §1, §3, §32, C9.39).
//
// The one link a business puts in every social profile, as a page on its own
// site instead of a rented one. What it does *not* bring is the point:
//
//   - No table. The page is a CMS page and the links are a typed block on it,
//     so revisions, translation, variants, SEO, the social card and the
//     publish flow are the ones every page has (`requires: cms`).
//   - No click counter. A click is one first-party analytics event, under the
//     visitor's consent, read back through analytics (`requires: analytics`).
//   - No imports of catalog, events or galleries. Smart links ask those
//     modules by service name, so this one works with any of them off.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "linkinbio",
  version: "0.1.0",
  requires: ["core", "cms", "analytics"],
  services: () => import("./service"),
  blocks: () => import("./blocks"),
  events: {
    emits: ["linkinbio.pageCreated", "linkinbio.linkAdded", "linkinbio.linkRemoved"],
  },
});
