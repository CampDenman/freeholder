// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every module installed in this instance (MASTER.md §11).
//
// A hand-written list rather than a directory scan, for the same reason
// `contacts.merge` keeps a hand-written FK list: a scan would silently pick up
// whatever happens to be on disk, and "what is installed" is a decision, not an
// observation. Adding a module is one line here.
//
// Order is irrelevant — `sortModules` topologically sorts by `requires` at boot
// and fails in plain English on a missing or circular dependency, so listing
// cms before core would be corrected rather than broken.
//
// Toggling a module *off* is a different question from installing it: that is a
// `module_settings` row (§4.8), read at boot once there is a module anyone
// would want off. Core refuses to be disabled at all.
import coreManifest from "@/core/manifest";
import cmsManifest from "@/modules/cms/manifest";
import analyticsManifest from "@/modules/analytics/manifest";
import formsManifest from "@/modules/forms/manifest";
import seedManifest from "@/modules/seed/manifest";
import builderManifest from "@/modules/builder/manifest";
import invoicingManifest from "@/modules/invoicing/manifest";
import catalogManifest from "@/modules/catalog/manifest";
import eventsManifest from "@/modules/events/manifest";
import newslettersManifest from "@/modules/newsletters/manifest";
import proofManifest from "@/modules/proof/manifest";
import contractsManifest from "@/modules/contracts/manifest";
import rentalsManifest from "@/modules/rentals/manifest";
import quotesManifest from "@/modules/quotes/manifest";
import projectsManifest from "@/modules/projects/manifest";
import giftRegistryManifest from "../../plugins/gift-registry/manifest";
import printOnDemandManifest from "../../plugins/print-on-demand/manifest";
import communityManifest from "../../plugins/community/manifest";
import voiceVideoManifest from "../../plugins/voice-video/manifest";
import marketplaceManifest from "../../plugins/marketplace/manifest";
import type { ModuleManifest } from "@/core/module";

const manifests: ModuleManifest[] = [
  coreManifest,
  cmsManifest,
  formsManifest,
  analyticsManifest,
  seedManifest,
  builderManifest,
  invoicingManifest,
  catalogManifest,
  eventsManifest,
  newslettersManifest,
  proofManifest,
  contractsManifest,
  rentalsManifest,
  quotesManifest,
  projectsManifest,
  giftRegistryManifest,
  printOnDemandManifest,
  communityManifest,
  voiceVideoManifest,
  marketplaceManifest,
];

export default manifests;
