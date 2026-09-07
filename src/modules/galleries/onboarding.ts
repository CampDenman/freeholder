// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "galleries.demo-gallery",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.service-business", "seed.shop", "seed.everything"],
      dependsOn: [{ key: "core.demo-contacts", version: 1 }],
      requiredModules: ["galleries"],
      requiredCapabilities: ["galleries:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "proofs", subjectType: "gallery" }],
      expectedOutcomes: [
        {
          key: "galleries.demo-gallery.visible",
          labelKey: "demo.outcome.galleryVisible",
          targetKey: "core.admin-galleries",
        },
      ],
      loadService: "galleries.loadDemoFixture",
      purgeService: "galleries.purgeDemoFixture",
      verifyService: "galleries.verifyDemoFixture",
    },
  ],
};

export default contribution;
