// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every table core owns, in one place (MASTER.md §11: a module declares its
// tables in its manifest). Drizzle's migration generator reads the schema
// files directly, so this barrel exists for the things that need the set:
// boot-time introspection, relations, and test truncation.
export {
  roles,
  roleGrants,
  users,
  sessions,
  loginSecurityEvents,
  staffInvitations,
  totpFactors,
  twoFactorChallenges,
  twoFactorRecoveryCodes,
  webauthnCredentials,
} from "@/core/auth/schema";
export { apiKeys } from "@/core/apikeys/schema";
export {
  agentConnections,
  agents,
  agentTasks,
  agentPlaybooks,
  agentPlaybookVersions,
} from "@/core/agents/schema";
// The runtime four (§4.17, C9.02). Agents and automations both run work, so
// runs belong to neither of them.
export { runs, runSteps, runApprovals, runSpend } from "@/core/runs/schema";
export {
  calendars,
  calendarMemberships,
  availabilityRules,
  availabilityExceptions,
  bookings,
  bookingParticipants,
  bookingWaitlist,
  bookingReminders,
  externalBusyBlocks,
} from "@/core/scheduling/schema";
export {
  bookingAudiences,
  bookingAudienceHours,
  bookingAudienceServices,
  bookingAudienceCalendars,
} from "@/core/scheduling/audience-schema";
export {
  catalogueSources,
  catalogueEntries,
  catalogueInstalls,
} from "@/core/catalogue/schema";
export {
  briefings,
  briefingContributions,
  briefingPreferences,
} from "@/core/briefing/schema";
export {
  agentConnectionGrants,
  connectedAccounts,
  connectionCapabilities,
  externalCalendars,
  externalEvents,
} from "@/core/connections/schema";
export {
  mailDeliveries,
  mailOauthStates,
  mailProviderEvents,
  mailSenders,
  mailSuppressions,
} from "@/core/mail/schema";
export {
  notificationDeliveries,
  notificationDigests,
  notificationPreferences,
  notificationReceipts,
  notificationSettings,
  notifications,
} from "@/core/notifications/schema";
export {
  webhookSubscriptions,
  webhookDeliveries,
} from "@/core/webhooks/schema";
export {
  organizations,
  contacts,
  contactRelationships,
  contactMergeOperations,
  customFieldDefinitions,
  customerMagicLinks,
  mergeCandidates,
  timelineEvents,
} from "@/core/contacts/schema";
export { tasks } from "@/core/tasks/schema";
export { notes, noteRevisions } from "@/core/notes/schema";
export { segments, segmentMembers } from "@/core/segments/schema";
export { scoringRules, contactScoreAwards } from "@/core/scoring/schema";
export {
  entitlements,
  entitlementGrants,
  passBalances,
  contentUnlocks,
} from "@/core/entitlements/schema";
export { paywalls, meterCounters } from "@/core/paywalls/schema";
export { savedViews } from "@/core/views/schema";
export {
  contactImports,
  contactImportRows,
  signupContactImportChoices,
  signupContactImportPolicies,
} from "@/core/import/contacts-schema";
export {
  conversations,
  keywordRuleEvents,
  keywordRules,
  messages,
  messageDeliveries,
  siteChatSessions,
  smsComplianceEvents,
} from "@/core/messaging/schema";
export { messagingNumbers } from "@/core/messaging/numbers-schema";
export { messagingWindows } from "@/core/messaging/policy-schema";
export { auditLog } from "@/core/events/schema";
export {
  assets,
  mediaAltTextSuggestions,
  mediaCaptureChunks,
  mediaCaptureItems,
  mediaCaptureSessions,
  mediaObjects,
  mediaUploads,
} from "@/core/media/schema";
export { redirects } from "@/core/seo/schema";
export { cspViolations, rateLimitCounters } from "@/core/security/schema";
export { businessProfile, moduleSettings } from "@/core/settings/schema";
export { designSettings } from "@/core/design/schema";
export { entityTranslations } from "@/core/i18n/schema";
export { passwordResets } from "@/core/auth/schema";
export { outboxEventDeliveries, outboxEvents } from "@/core/events/schema";
export { jobIdempotencyKeys } from "@/core/jobs/schema";
export { guidanceFlows, guidanceProgress } from "@/core/guidance/schema";
export {
  demoScenarios,
  demoScenarioRuns,
  demoRecords,
} from "@/core/demo/schema";
export {
  consentRecords,
  dataRequests,
  dataRequestArtifacts,
  privacyRetentionExceptions,
} from "@/core/privacy/schema";
export {
  businessLocations,
  openingHours,
  serviceAreas,
} from "@/core/locations/schema";
export {
  contributeSettings,
  contributions,
  contributionAssets,
  contributionEvents,
} from "@/core/contribute/schema";
export {
  installedPlugins,
  pluginRegistries,
  pluginRetentions,
  importRuns,
} from "@/core/plugins/schema";
