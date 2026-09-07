// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "quotes.demo-quote",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.service-business", "seed.shop", "seed.everything"],
      dependsOn: [{ key: "core.demo-contacts", version: 1 }],
      requiredModules: ["quotes"],
      requiredCapabilities: ["quotes:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "package", subjectType: "quote" }],
      expectedOutcomes: [
        {
          key: "quotes.demo-quote.visible",
          labelKey: "demo.outcome.quoteVisible",
          targetKey: "core.admin-quotes",
        },
      ],
      loadService: "quotes.loadDemoFixture",
      purgeService: "quotes.purgeDemoFixture",
      verifyService: "quotes.verifyDemoFixture",
    },
  ],
};

export default contribution;
