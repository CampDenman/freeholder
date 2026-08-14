// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The current-module scenario proves the public extension seam without
// pretending that the future booking/commerce domain scenarios already exist.
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [
    {
      key: "seed.admin-demos",
      href: "/admin/demos",
      requiredModules: ["seed"],
      requiredCapabilities: ["demo:manage"],
    },
  ],
  guidance: [],
  scenarios: [
    {
      key: "seed.current-modules",
      version: 1,
      titleKey: "demo.scenario.currentModules.title",
      descriptionKey: "demo.scenario.currentModules.description",
      preset: "foundation",
      requiredModules: ["core", "cms", "forms", "seed"],
      requiredCapabilities: ["demo:manage", "cms:view", "forms:view"],
      fixtureContributions: [
        { key: "cms.current-modules", version: 1 },
        { key: "forms.current-modules", version: 1 },
      ],
      defaultLocale: "en",
      supportedLocales: ["en", "fr", "es"],
      tourFlowKey: "core.owner-first-win",
      status: "active",
    },
  ],
  fixtures: [],
};

export default contribution;
