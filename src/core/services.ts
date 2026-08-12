// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Core's service list — the default export a manifest's `services` loader is
// expected to provide (MASTER.md §11). Adding a service to core means adding
// it to the array it already lives in; forgetting to register it is not a
// separate mistake anyone can make.
import authServices from "@/core/auth/service";
import twoFactorServices from "@/core/auth/two-factor";
import sessionManagementServices from "@/core/auth/session-management/service";
import magicLinkServices from "@/core/auth/magic-links/service";
import resetServices from "@/core/auth/reset";
import agentServices from "@/core/agents/service";
import agentExecution from "@/core/agents/execution";
import apiKeyServices from "@/core/apikeys/service";
import connectionServices from "@/core/connections/service";
import contactServices from "@/core/contacts/service";
import customFieldServices from "@/core/contacts/custom-fields";
import duplicateServices from "@/core/contacts/duplicates";
import organizationServices from "@/core/contacts/organizations";
import relationshipServices from "@/core/contacts/relationships";
import privacyServices from "@/core/privacy/service";
import doctorServices from "@/core/doctor/service";
import eventServices from "@/core/events/service";
import outboxServices from "@/core/events/outbox-service";
import i18nServices from "@/core/i18n/service";
import jobServices from "@/core/jobs/service";
import invitationServices from "@/core/invitations/service";
import locationServices from "@/core/locations/service";
import mailServices from "@/core/mail/service";
import mailOAuthServices from "@/core/mail/oauth";
import mediaServices from "@/core/media/service";
import roleServices from "@/core/roles/service";
import seoServices from "@/core/seo/service";
import settingsServices from "@/core/settings/service";
import webhookServices from "@/core/webhooks/service";
import type { Service } from "@/core/service";
import type { EventDeliveryContext } from "@/core/events";

const services: Service[] = [
  ...authServices,
  ...twoFactorServices,
  ...sessionManagementServices,
  ...magicLinkServices,
  ...resetServices,
  ...agentServices,
  ...agentExecution,
  ...apiKeyServices,
  ...connectionServices,
  ...contactServices,
  ...customFieldServices,
  ...duplicateServices,
  ...organizationServices,
  ...relationshipServices,
  ...privacyServices,
  ...doctorServices,
  ...eventServices,
  ...outboxServices,
  ...i18nServices,
  ...jobServices,
  ...invitationServices,
  ...locationServices,
  ...mailServices,
  ...mailOAuthServices,
  ...mediaServices,
  ...roleServices,
  ...seoServices,
  ...settingsServices,
  ...webhookServices,
];

export default services;

/**
 * Every committed event, offered to the owner's webhooks (§11's bus).
 *
 * Failures are swallowed by the bus itself, which is right here: an endpoint
 * being unreachable must not fail the mutation that produced the event, and
 * the delivery row already records what happened.
 */
export async function onAnyEvent(
  payload: unknown,
  eventName: string,
  context?: EventDeliveryContext,
): Promise<void> {
  const { fanOut } = await import("@/core/webhooks/service");
  await fanOut(eventName, payload, context?.eventId);
}
