// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "invoicing.demo-invoice",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.service-business", "seed.shop", "seed.everything"],
      dependsOn: [{ key: "core.demo-contacts", version: 1 }],
      requiredModules: ["invoicing"],
      requiredCapabilities: ["invoicing:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "overdue-invoice", subjectType: "invoice" }],
      expectedOutcomes: [
        {
          key: "invoicing.demo-invoice.visible",
          labelKey: "demo.outcome.invoiceVisible",
          targetKey: "core.admin-invoices",
        },
      ],
      loadService: "invoicing.loadDemoFixture",
      purgeService: "invoicing.purgeDemoFixture",
      verifyService: "invoicing.verifyDemoFixture",
    },
  ],
};

export default contribution;
