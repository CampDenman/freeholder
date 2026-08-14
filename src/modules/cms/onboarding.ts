// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "cms.current-modules",
      version: 1,
      scenarioKeys: ["seed.current-modules"],
      dependsOn: [],
      requiredModules: ["cms"],
      requiredCapabilities: ["cms:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "project-page", subjectType: "page" }],
      expectedOutcomes: [
        {
          key: "cms.current-modules.visible",
          labelKey: "demo.outcome.pageVisible",
          targetKey: "core.admin-pages",
        },
      ],
      loadService: "cms.loadDemoFixture",
      purgeService: "cms.purgeDemoFixture",
      verifyService: "cms.verifyDemoFixture",
    },
  ],
};

export default contribution;
