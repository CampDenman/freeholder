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
      key: "core.admin-locations",
      href: "/admin/locations",
      requiredModules: ["core"],
      requiredCapabilities: ["locations:view"],
    },
    {
      key: "core.admin-inbox",
      href: "/admin/inbox",
      requiredModules: ["core"],
      requiredCapabilities: ["crm:view"],
    },
    {
      key: "core.admin-appointments",
      href: "/admin/appointments",
      requiredModules: ["core"],
      requiredCapabilities: ["scheduling:view"],
    },
    {
      key: "core.admin-products",
      href: "/admin/products",
      requiredModules: ["catalog"],
      requiredCapabilities: ["catalog:view"],
    },
    {
      key: "core.admin-invoices",
      href: "/admin/invoices",
      requiredModules: ["invoicing"],
      requiredCapabilities: ["invoicing:view"],
    },
    {
      key: "core.admin-galleries",
      href: "/admin/galleries",
      requiredModules: ["galleries"],
      requiredCapabilities: ["galleries:view"],
    },
    {
      key: "core.admin-quotes",
      href: "/admin/quotes",
      requiredModules: ["quotes"],
      requiredCapabilities: ["quotes:view"],
    },
    {
      key: "core.admin-reports",
      href: "/admin/reports",
      requiredModules: ["reporting"],
      requiredCapabilities: ["reporting:view"],
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
  fixtures: [
    {
      key: "core.demo-contacts",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.service-business", "seed.shop", "seed.everything"],
      dependsOn: [],
      requiredModules: ["core"],
      requiredCapabilities: ["contacts:view"],
      localeVariants: ["en", "fr", "es"],
      records: [
        { key: "customer", subjectType: "contact" },
        { key: "overdue-client", subjectType: "contact" },
      ],
      expectedOutcomes: [
        {
          key: "core.demo-contacts.visible",
          labelKey: "demo.outcome.contactsVisible",
          targetKey: "core.admin-contacts",
        },
      ],
      loadService: "core.loadDemoContacts",
      purgeService: "core.purgeDemoContacts",
      verifyService: "core.verifyDemoContacts",
    },
    {
      key: "core.demo-locations",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.service-business", "seed.shop", "seed.everything"],
      dependsOn: [],
      requiredModules: ["core"],
      requiredCapabilities: ["locations:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "studio", subjectType: "location" }],
      expectedOutcomes: [
        {
          key: "core.demo-locations.visible",
          labelKey: "demo.outcome.locationVisible",
          targetKey: "core.admin-locations",
        },
      ],
      loadService: "core.loadDemoLocations",
      purgeService: "core.purgeDemoLocations",
      verifyService: "core.verifyDemoLocations",
    },
    {
      key: "core.demo-bookings",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.service-business", "seed.shop", "seed.everything"],
      dependsOn: [
        { key: "core.demo-contacts", version: 1 },
        { key: "core.demo-locations", version: 1 },
      ],
      requiredModules: ["core"],
      requiredCapabilities: ["scheduling:view"],
      localeVariants: ["en", "fr", "es"],
      records: [
        { key: "room", subjectType: "calendar" },
        { key: "sitting", subjectType: "booking" },
      ],
      expectedOutcomes: [
        {
          key: "core.demo-bookings.visible",
          labelKey: "demo.outcome.bookingVisible",
          targetKey: "core.admin-appointments",
        },
      ],
      loadService: "core.loadDemoBookings",
      purgeService: "core.purgeDemoBookings",
      verifyService: "core.verifyDemoBookings",
    },
    {
      key: "core.demo-inbox",
      version: 1,
      scenarioKeys: ["seed.creator", "seed.service-business", "seed.shop", "seed.everything"],
      dependsOn: [{ key: "core.demo-contacts", version: 1 }],
      requiredModules: ["core"],
      requiredCapabilities: ["crm:view"],
      localeVariants: ["en", "fr", "es"],
      records: [{ key: "thread", subjectType: "conversation" }],
      expectedOutcomes: [
        {
          key: "core.demo-inbox.visible",
          labelKey: "demo.outcome.inboxVisible",
          targetKey: "core.admin-inbox",
        },
      ],
      loadService: "core.loadDemoInbox",
      purgeService: "core.purgeDemoInbox",
      verifyService: "core.verifyDemoInbox",
    },
  ],
};

export default contribution;
