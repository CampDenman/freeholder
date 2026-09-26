// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The demo contribution for events (MASTER.md C6.11, C1.28).
//
// The target is declared here rather than in core's list, because the screen
// belongs to this module: switch events off and the target goes with it,
// instead of leaving core pointing at a route that no longer exists.
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [
    {
      key: "events.admin",
      href: "/admin/events",
      requiredModules: ["events"],
      requiredCapabilities: ["events:view"],
    },
  ],
  guidance: [],
  scenarios: [],
  fixtures: [
    {
      key: "events.demo-class",
      version: 1,
      // A class is a service business's shape, and part of "everything". A
      // creator or a shop seeing a sourdough class would be noise.
      scenarioKeys: ["seed.service-business", "seed.everything"],
      dependsOn: [],
      requiredModules: ["events"],
      requiredCapabilities: ["events:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "demo-class", subjectType: "event" }],
      expectedOutcomes: [
        {
          key: "events.demo-class.visible",
          labelKey: "demo.outcome.eventVisible",
          targetKey: "events.admin",
        },
      ],
      loadService: "events.loadDemoFixture",
      purgeService: "events.purgeDemoFixture",
      verifyService: "events.verifyDemoFixture",
    },
  ],
};

export default contribution;
