// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Core's first-win curriculum. Human role names choose the most relevant
// lesson; effective grants decide whether the flow and every individual step
// may be shown. Completion predicates name durable product outcomes rather
// than tour clicks.
import { z } from "zod";
import { guidanceFlows } from "@/core/guidance/schema";
import type { Tx } from "@/core/service";

export const capabilitySchema = z
  .string()
  .regex(/^[a-z*][a-z0-9-]*:(view|manage)$/);

export const guidanceOutcomeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("audit"),
    actions: z.array(z.string().regex(/^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$/)).min(1),
  }),
  z.object({ type: z.literal("form-submission") }),
  z.object({ type: z.literal("portal-account-linked") }),
]);

export const guidanceStepSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]*$/),
  titleKey: z.string().min(1),
  descriptionKey: z.string().min(1),
  href: z.string().regex(/^\/(?!\/)[^\s]*$/),
  requiredCapabilities: z.array(capabilitySchema).default([]),
  outcome: guidanceOutcomeSchema,
});

export const guidanceFlowDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9.-]*$/),
  version: z.number().int().positive(),
  titleKey: z.string().min(1),
  descriptionKey: z.string().min(1),
  audienceRoles: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)),
  requiredCapabilities: z.array(capabilitySchema),
  steps: z.array(guidanceStepSchema).min(1),
  status: z.enum(["draft", "active", "retired"]),
});

export type GuidanceOutcome = z.infer<typeof guidanceOutcomeSchema>;
export type GuidanceStepDefinition = z.infer<typeof guidanceStepSchema>;
export type GuidanceFlowDefinition = z.infer<typeof guidanceFlowDefinitionSchema>;

const definitions: GuidanceFlowDefinition[] = [
  {
    key: "core.owner-first-win",
    version: 1,
    titleKey: "guidance.flow.owner.title",
    descriptionKey: "guidance.flow.owner.description",
    audienceRoles: ["owner"],
    requiredCapabilities: ["*:manage"],
    status: "active",
    steps: [
      {
        key: "publish-page",
        titleKey: "guidance.step.publishPage.title",
        descriptionKey: "guidance.step.publishPage.description",
        href: "/admin/pages",
        requiredCapabilities: ["cms:manage"],
        outcome: { type: "audit", actions: ["cms.publishPage"] },
      },
      {
        key: "capture-enquiry",
        titleKey: "guidance.step.captureEnquiry.title",
        descriptionKey: "guidance.step.captureEnquiry.description",
        href: "/admin/forms",
        requiredCapabilities: ["forms:view"],
        outcome: { type: "form-submission" },
      },
      {
        key: "move-customer-forward",
        titleKey: "guidance.step.moveCustomer.title",
        descriptionKey: "guidance.step.moveCustomer.description",
        href: "/admin/contacts",
        requiredCapabilities: ["contacts:manage"],
        outcome: { type: "audit", actions: ["contacts.update"] },
      },
    ],
  },
  {
    key: "core.administrator-first-win",
    version: 1,
    titleKey: "guidance.flow.administrator.title",
    descriptionKey: "guidance.flow.administrator.description",
    audienceRoles: ["administrator"],
    requiredCapabilities: [
      "admin:manage",
      "invitations:manage",
      "platform:view",
    ],
    status: "active",
    steps: [
      {
        key: "invite-collaborator",
        titleKey: "guidance.step.inviteCollaborator.title",
        descriptionKey: "guidance.step.inviteCollaborator.description",
        href: "/admin/invitations",
        requiredCapabilities: ["invitations:manage"],
        outcome: { type: "audit", actions: ["invitations.create"] },
      },
      {
        key: "schedule-digest",
        titleKey: "guidance.step.scheduleDigest.title",
        descriptionKey: "guidance.step.scheduleDigest.description",
        href: "/admin/notifications#notification-schedule",
        requiredCapabilities: [],
        outcome: { type: "audit", actions: ["notifications.updateSettings"] },
      },
    ],
  },
  {
    key: "core.editor-first-win",
    version: 1,
    titleKey: "guidance.flow.editor.title",
    descriptionKey: "guidance.flow.editor.description",
    audienceRoles: ["editor"],
    requiredCapabilities: ["cms:manage"],
    status: "active",
    steps: [
      {
        key: "publish-page",
        titleKey: "guidance.step.publishPage.title",
        descriptionKey: "guidance.step.publishPage.description",
        href: "/admin/pages",
        requiredCapabilities: ["cms:manage"],
        outcome: { type: "audit", actions: ["cms.publishPage"] },
      },
      {
        key: "upload-media",
        titleKey: "guidance.step.uploadMedia.title",
        descriptionKey: "guidance.step.uploadMedia.description",
        href: "/admin/media",
        requiredCapabilities: ["media:manage"],
        outcome: {
          type: "audit",
          actions: ["media.upload", "media.completeUpload"],
        },
      },
      {
        key: "launch-form",
        titleKey: "guidance.step.launchForm.title",
        descriptionKey: "guidance.step.launchForm.description",
        href: "/admin/forms",
        requiredCapabilities: ["forms:manage"],
        outcome: { type: "audit", actions: ["forms.create", "forms.update"] },
      },
    ],
  },
  {
    key: "core.bookkeeper-first-win",
    version: 1,
    titleKey: "guidance.flow.bookkeeper.title",
    descriptionKey: "guidance.flow.bookkeeper.description",
    audienceRoles: ["bookkeeper"],
    requiredCapabilities: [
      "analytics:view",
      "contacts:view",
      "events:view",
      "settings:view",
    ],
    status: "active",
    steps: [
      {
        key: "choose-alerts",
        titleKey: "guidance.step.chooseAlerts.title",
        descriptionKey: "guidance.step.chooseAlerts.description",
        href: "/admin/notifications#notification-preferences-heading",
        requiredCapabilities: [],
        outcome: {
          type: "audit",
          actions: [
            "notifications.updatePreference",
            "notifications.updatePreferences",
          ],
        },
      },
      {
        key: "schedule-digest",
        titleKey: "guidance.step.scheduleDigest.title",
        descriptionKey: "guidance.step.scheduleDigest.description",
        href: "/admin/notifications#notification-schedule",
        requiredCapabilities: [],
        outcome: { type: "audit", actions: ["notifications.updateSettings"] },
      },
    ],
  },
  {
    key: "core.service-provider-first-win",
    version: 1,
    titleKey: "guidance.flow.serviceProvider.title",
    descriptionKey: "guidance.flow.serviceProvider.description",
    audienceRoles: ["service-provider"],
    requiredCapabilities: ["contacts:manage"],
    status: "active",
    steps: [
      {
        key: "add-customer",
        titleKey: "guidance.step.addCustomer.title",
        descriptionKey: "guidance.step.addCustomer.description",
        href: "/admin/contacts/new",
        requiredCapabilities: ["contacts:manage"],
        outcome: { type: "audit", actions: ["contacts.create"] },
      },
      {
        key: "move-customer-forward",
        titleKey: "guidance.step.moveCustomer.title",
        descriptionKey: "guidance.step.moveCustomer.description",
        href: "/admin/contacts",
        requiredCapabilities: ["contacts:manage"],
        outcome: { type: "audit", actions: ["contacts.update"] },
      },
    ],
  },
  {
    key: "core.customer-first-win",
    version: 1,
    titleKey: "guidance.flow.customer.title",
    descriptionKey: "guidance.flow.customer.description",
    audienceRoles: ["customer"],
    requiredCapabilities: [],
    status: "active",
    steps: [
      {
        key: "open-private-account",
        titleKey: "guidance.step.openPrivateAccount.title",
        descriptionKey: "guidance.step.openPrivateAccount.description",
        href: "/portal/privacy",
        requiredCapabilities: [],
        outcome: { type: "portal-account-linked" },
      },
      {
        key: "choose-contact-preference",
        titleKey: "guidance.step.chooseContactPreference.title",
        descriptionKey: "guidance.step.chooseContactPreference.description",
        href: "/portal/privacy#privacy-preferences",
        requiredCapabilities: [],
        outcome: {
          type: "audit",
          actions: ["privacy.setMyMarketingPreference"],
        },
      },
    ],
  },
];

/** Parsed once so malformed core guidance fails at import/test time. */
export const CORE_GUIDANCE_FLOWS = definitions.map((flow) =>
  guidanceFlowDefinitionSchema.parse(flow),
);

/**
 * Tests and first-owner recovery can seed the same immutable definitions as
 * the migration. Existing versions are never rewritten; revisions increment
 * `version`, which gives every user a fresh progress record.
 */
export async function seedCoreGuidanceFlows(tx: Tx): Promise<void> {
  await tx
    .insert(guidanceFlows)
    .values(
      CORE_GUIDANCE_FLOWS.map((flow) => ({
        key: flow.key,
        version: flow.version,
        titleKey: flow.titleKey,
        descriptionKey: flow.descriptionKey,
        audienceRoles: flow.audienceRoles,
        requiredCapabilities: flow.requiredCapabilities,
        steps: flow.steps,
        status: flow.status,
      })),
    )
    .onConflictDoNothing();
}
