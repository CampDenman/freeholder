// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The cms module (MASTER.md §11, §32).
//
// The first feature module in the codebase, which makes it the first real test
// of the module contract rather than core describing itself. Two things it
// exercises that core could not:
//
//   - `requires`, and the topo-sort behind it. cms depends on core for the
//     business profile it renders the brand from.
//   - `events.listens`, and the post-commit bus. Core announces that setup
//     finished; cms seeds the site in response, and neither module imports the
//     other.
//
// Note what is *not* here: a `routes` entry. See MASTER.md §11 — a module
// contributes block types and services, and the public surface is one
// catch-all route rendering block trees from the database. A module that
// mounted its own page routes would be code where §32 says there should be
// data.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "cms",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  onboarding: () => import("./onboarding"),
  events: {
    emits: [
      "cms.pageCreated",
      "cms.pageDeleted",
      "cms.pageUpdated",
      "cms.pagePublished",
      "cms.pageUnpublished",
      "cms.pageScheduled",
      "cms.pageApprovalChanged",
      "cms.previewLinkCreated",
      "cms.revisionNamed",
      "cms.sectionUpdated",
      "cms.sectionCreated",
      "cms.sectionDeleted",
      "cms.templateUpdated",
      "cms.templateReset",
      "cms.layoutAttached",
      "cms.layoutDetached",
      "cms.layoutRejoined",
      "cms.emailTestSent",
      "cms.smsTestSent",
      "cms.commentCreated",
      "cms.commentResolved",
      "cms.commentReopened",
      "cms.reviewRequested",
      "cms.reviewDecided",
      "cms.quoteRequested",
      "cms.siteChatStarted",
      "cms.tipIntended",
    ],
    listens: {
      "settings.setupCompleted": "onSetupCompleted",
      // §4.10's LocationPage. core announces that a location exists; cms
      // answers with a page, and neither module imports the other (§11).
      "location.created": "onLocationCreated",
      "location.updated": "onLocationUpdated",
      "location.deleted": "onLocationDeleted",
    },
  },
  // The public URLs this module puts in the sitemap (§5). The engine asks;
  // the module answers with a service name rather than a list, because the
  // list changes every time an owner publishes.
  seo: { sitemapSources: ["cms.publishedPaths"] },
});
