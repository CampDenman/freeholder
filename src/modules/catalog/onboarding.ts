// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "catalog.demo-product",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.service-business", "seed.shop", "seed.everything"],
      dependsOn: [],
      requiredModules: ["catalog"],
      requiredCapabilities: ["catalog:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "print", subjectType: "product" }],
      expectedOutcomes: [
        {
          key: "catalog.demo-product.visible",
          labelKey: "demo.outcome.productVisible",
          targetKey: "core.admin-products",
        },
      ],
      loadService: "catalog.loadDemoFixture",
      purgeService: "catalog.purgeDemoFixture",
      verifyService: "catalog.verifyDemoFixture",
    },
  ],
};

export default contribution;
