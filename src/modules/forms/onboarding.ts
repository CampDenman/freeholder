// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "forms.current-modules",
      version: 1,
      scenarioKeys: ["seed.current-modules"],
      dependsOn: [],
      requiredModules: ["forms"],
      requiredCapabilities: ["forms:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "enquiry-form", subjectType: "form" }],
      expectedOutcomes: [
        {
          key: "forms.current-modules.visible",
          labelKey: "demo.outcome.formVisible",
          targetKey: "core.admin-forms",
        },
      ],
      loadService: "forms.loadDemoFixture",
      purgeService: "forms.purgeDemoFixture",
      verifyService: "forms.verifyDemoFixture",
    },
  ],
};

export default contribution;
