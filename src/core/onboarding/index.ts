// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Core-owned guidance and the real UI targets its steps point at.
import { CORE_GUIDANCE_FLOWS } from "@/core/guidance/definitions";
import type { OnboardingModuleExport } from "@/core/onboarding/contract";

const contribution: OnboardingModuleExport = {
  targets: [
    {
      key: "core.admin-pages",
      href: "/admin/pages",
      requiredModules: ["cms"],
      requiredCapabilities: ["cms:view"],
    },
    {
      key: "core.admin-forms",
      href: "/admin/forms",
      requiredModules: ["forms"],
      requiredCapabilities: ["forms:view"],
    },
    {
      key: "core.admin-contacts",
      href: "/admin/contacts",
      requiredModules: ["core"],
      requiredCapabilities: ["contacts:view"],
    },
    {
      key: "core.admin-invitations",
      href: "/admin/invitations",
      requiredModules: ["core"],
      requiredCapabilities: ["invitations:manage"],
    },
    {
      key: "core.notification-schedule",
      href: "/admin/notifications#notification-schedule",
      requiredModules: ["core"],
      requiredCapabilities: [],
    },
    {
      key: "core.admin-media",
      href: "/admin/media",
      requiredModules: ["core"],
      requiredCapabilities: ["media:manage"],
    },
    {
      key: "core.notification-preferences",
      href: "/admin/notifications#notification-preferences-heading",
      requiredModules: ["core"],
      requiredCapabilities: [],
    },
    {
      key: "core.admin-contact-new",
      href: "/admin/contacts/new",
      requiredModules: ["core"],
      requiredCapabilities: ["contacts:manage"],
    },
    {
      key: "core.portal-privacy",
      href: "/portal/privacy",
      requiredModules: ["core"],
      requiredCapabilities: [],
    },
    {
      key: "core.portal-privacy-preferences",
      href: "/portal/privacy#privacy-preferences",
      requiredModules: ["core"],
      requiredCapabilities: [],
    },
  ],
  guidance: CORE_GUIDANCE_FLOWS,
  scenarios: [],
  fixtures: [],
};

export default contribution;
