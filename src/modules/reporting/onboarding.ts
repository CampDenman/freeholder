// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "reporting.demo-view",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.service-business", "seed.shop", "seed.everything"],
      dependsOn: [],
      requiredModules: ["reporting"],
      requiredCapabilities: ["reporting:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "revenue-view", subjectType: "report_view" }],
      expectedOutcomes: [
        {
          key: "reporting.demo-view.visible",
          labelKey: "demo.outcome.reportVisible",
          targetKey: "core.admin-reports",
        },
      ],
      loadService: "reporting.loadDemoFixture",
      purgeService: "reporting.purgeDemoFixture",
      verifyService: "reporting.verifyDemoFixture",
    },
  ],
};

export default contribution;
