// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The demo contribution for assessments (MASTER.md §4.18, C8.14).
//
// The target is declared here rather than added to core's list, because the
// screen belongs to this module: switch assessments off and the target goes
// with it, instead of leaving core pointing at a route that no longer exists.
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [
    {
      key: "assessments.admin",
      href: "/admin/assessments",
      requiredModules: ["assessments"],
      requiredCapabilities: ["assessments:view"],
    },
  ],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "assessments.demo-assessment",
      version: 1,
      scenarioKeys: ["seed.service-business", "seed.everything"],
      dependsOn: [],
      requiredModules: ["assessments"],
      requiredCapabilities: ["assessments:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "demo-assessment", subjectType: "assessment" }],
      expectedOutcomes: [
        {
          key: "assessments.demo-assessment.visible",
          labelKey: "demo.outcome.assessmentVisible",
          targetKey: "assessments.admin",
        },
      ],
      loadService: "assessments.loadDemoFixture",
      purgeService: "assessments.purgeDemoFixture",
      verifyService: "assessments.verifyDemoFixture",
    },
  ],
};

export default contribution;
