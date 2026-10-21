// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The demo community in the creator and everything scenarios (C12.16).
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [
    {
      key: "members.feed",
      href: "/feed?view=latest",
      requiredModules: ["members"],
      requiredCapabilities: [],
    },
  ],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "members.demo-community",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.everything"],
      dependsOn: [],
      requiredModules: ["members"],
      requiredCapabilities: [],
      localeVariants: ["en", "fr", "es"],
      records: [
        { key: "ada", subjectType: "member" },
        { key: "ben", subjectType: "member" },
        { key: "cy", subjectType: "member" },
        { key: "listing", subjectType: "product" },
      ],
      expectedOutcomes: [
        {
          key: "members.demo-community.visible",
          labelKey: "demo.outcome.communityVisible",
          targetKey: "members.feed",
        },
      ],
      loadService: "members.loadDemoFixture",
      purgeService: "members.purgeDemoFixture",
      verifyService: "members.verifyDemoFixture",
    },
  ],
};

export default contribution;
