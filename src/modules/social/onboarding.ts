// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social hub onboarding (MASTER.md §33, C9.31).
//
// The surface is a guided visit to /admin/social. Completing it means the
// owner started the provider's OAuth — never that Freeholder authorized or
// published on their behalf.
import type { OnboardingModuleExport } from "@/core/onboarding/contract";
import { SOCIAL_ONBOARDING_SURFACE } from "./capabilities";

const contribution: OnboardingModuleExport = {
  targets: [
    {
      key: "social.admin-hub",
      href: SOCIAL_ONBOARDING_SURFACE.href,
      requiredModules: ["social"],
      requiredCapabilities: ["social:view"],
    },
  ],
  guidance: [
    {
      key: "social.connect-hub",
      version: 1,
      titleKey: "guidance.flow.socialConnect.title",
      descriptionKey: "guidance.flow.socialConnect.description",
      audienceRoles: ["owner", "administrator"],
      requiredCapabilities: ["social:manage"],
      status: "active",
      steps: [
        {
          key: "connect-network",
          titleKey: "guidance.step.connectSocial.title",
          descriptionKey: "guidance.step.connectSocial.description",
          href: SOCIAL_ONBOARDING_SURFACE.href,
          requiredCapabilities: ["social:manage"],
          outcome: { type: "audit", actions: ["social.beginOAuth"] },
        },
      ],
    },
  ],
  scenarios: [],
  fixtures: [],
};

export default contribution;
