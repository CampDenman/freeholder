// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import agentWrites from "@/core/agents/writes";
import agentPlaybookServices from "@/core/agents/playbooks";
import agentPlaybookEvents from "@/core/agents/playbook-events";
import agentPlaybookSchedules from "@/core/agents/playbook-schedule";
import apiKeyServices from "@/core/apikeys/service";
import connectionServices from "@/core/connections/service";
import connectionGrantServices from "@/core/connections/grants";
import calendarOAuthServices from "@/core/connections/calendar-oauth";
import calendarSyncServices from "@/core/connections/calendar-sync";
import mailReadOAuthServices from "@/core/connections/mail-read-oauth";
import mailImportServices from "@/core/connections/mail-import";
import calendarBusyServices from "@/core/connections/busy";
import briefingServices from "@/core/briefing/service";
import briefingContributorServices from "@/core/briefing/contributors";
import briefingPlaybookSection from "@/core/briefing/playbook-section";
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
import guidanceServices from "@/core/guidance/service";
import demoServices from "@/core/demo/service";
import invitationServices from "@/core/invitations/service";
import locationServices from "@/core/locations/service";
import mailServices from "@/core/mail/service";
import mailOAuthServices from "@/core/mail/oauth";
import mediaServices from "@/core/media/service";
import notificationServices from "@/core/notifications/service";
import taskServices from "@/core/tasks/service";
import noteServices from "@/core/notes/service";
import segmentServices from "@/core/segments/service";
import scoringServices from "@/core/scoring/service";
import viewServices from "@/core/views/service";
import contactImportServices from "@/core/import/contacts-service";
import messagingServices from "@/core/messaging/service";
import schedulingServices from "@/core/scheduling/service";
import availabilityServices from "@/core/scheduling/availability-service";
import bookingServices from "@/core/scheduling/bookings";
import resolverServices from "@/core/scheduling/resolver-service";
import audienceServices from "@/core/scheduling/audiences";
import calendarFeedServices from "@/core/scheduling/ics-service";
import waitlistServices from "@/core/scheduling/waitlist";
import requirementServices from "@/core/scheduling/requirements";
import reminderServices from "@/core/scheduling/reminders";
import roleServices from "@/core/roles/service";
import cspServices from "@/core/security/csp-reports";
import seoServices from "@/core/seo/service";
import settingsServices from "@/core/settings/service";
import webhookServices from "@/core/webhooks/service";
import contributeServices from "@/core/contribute/service";
import designServices from "@/core/design/service";
import pluginServices from "@/core/plugins/service";
import importServices from "@/core/import/service";
import portabilityServices from "@/core/portability/service";
import provenanceServices from "@/core/provenance/service";
import catalogueServices from "@/core/catalogue/service";
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
  ...agentWrites,
  ...agentPlaybookServices,
  ...agentPlaybookEvents,
  ...agentPlaybookSchedules,
  ...apiKeyServices,
  ...connectionServices,
  ...connectionGrantServices,
  ...calendarOAuthServices,
  ...calendarSyncServices,
  ...mailReadOAuthServices,
  ...mailImportServices,
  ...calendarBusyServices,
  ...taskServices,
  ...noteServices,
  ...segmentServices,
  ...scoringServices,
  ...viewServices,
  ...contactImportServices,
  ...messagingServices,
  ...briefingServices,
  ...briefingContributorServices,
  ...briefingPlaybookSection,
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
  ...guidanceServices,
  ...demoServices,
  ...invitationServices,
  ...locationServices,
  ...mailServices,
  ...mailOAuthServices,
  ...mediaServices,
  ...notificationServices,
  ...schedulingServices,
  ...availabilityServices,
  ...bookingServices,
  ...resolverServices,
  ...audienceServices,
  ...calendarFeedServices,
  ...waitlistServices,
  ...requirementServices,
  ...reminderServices,
  ...roleServices,
  ...cspServices,
  ...seoServices,
  ...settingsServices,
  ...webhookServices,
  ...contributeServices,
  ...designServices,
  ...pluginServices,
  ...importServices,
  ...portabilityServices,
  ...provenanceServices,
  ...catalogueServices,
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
  const { fanOutEventNotification } = await import("@/core/notifications/service");
  const { startEventPlaybooks } = await import("@/core/agents/playbook-events");
  const { mirrorForBookingEvent } = await import("@/core/scheduling/writeback");
  const { offerForBookingEvent } = await import("@/core/scheduling/waitlist");
  const { linkSignedWaiver } = await import("@/core/scheduling/requirements");
  const { convertOnAccepted } = await import("@/modules/quotes/conversion");
  const { scoreForEvent } = await import("@/core/scoring/service");
  await Promise.all([
    fanOut(eventName, payload, context?.eventId),
    fanOutEventNotification(eventName, payload, context?.eventId),
    startEventPlaybooks(eventName, payload),
    // Writing a booking to somebody's Google calendar is a consequence of the
    // booking having committed, not part of making it (C6.06). An upstream
    // write cannot be rolled back, so it must not happen inside a transaction
    // that might still fail.
    mirrorForBookingEvent(eventName, payload),
    // A freed seat is only genuinely free once the cancellation has committed
    // (C6.08). Offering it from inside the mutation would promise somebody a
    // slot that a rollback then un-frees.
    offerForBookingEvent(eventName, payload),
    // Contracts must not know what a booking is (§11's dependency direction),
    // so scheduling listens for the signature rather than contracts calling in.
    linkSignedWaiver(eventName, payload),
    // An accepted quote becomes work once the acceptance has committed
    // (C6.13). Converting inside it would mean a brief failure in invoicing
    // rolled back the fact that the customer said yes.
    convertOnAccepted(eventName, payload),
    // Points are a consequence of something having happened (C7.05), so they
    // are awarded here rather than inside the mutation: a scoring bug must not
    // be able to roll back a quote acceptance. The outbox id is what makes a
    // redelivery cost nothing instead of doubling somebody's score.
    scoreForEvent(eventName, payload, context?.eventId),
  ]);
}
