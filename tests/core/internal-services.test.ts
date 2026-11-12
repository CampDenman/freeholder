// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Internal orchestration is registered for composition, never projected as an
// HTTP/API-key/OpenAPI/LLM/MCP capability.
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenApi } from "@/core/api/openapi";
import { contractProjections } from "@/core/contract/projections";
import { ready } from "@/core/runtime";
import {
  getExternalService,
  getService,
  listExternalServices,
  listServices,
  type Actor,
} from "@/core/service";
import { hiddenFromMcp, serviceForTool, toolName, toolsFor } from "@/mcp/tools";

const INTERNAL = [
  "catalog.anonymizeSellerOrderReceipts",
  // C3.47: page events rebuild only their own public assistant document.
  "assistant.reindexPage",
  "subscriptions.recordTrialSetupDispatch",
  "subscriptions.claimTrialSetupErasure",
  "subscriptions.finishTrialSetupErasure",
  "invoicing.reserveRefundBatch",
  "catalog.reconcileReturnProviderRefunds",
  "catalog.availabilityForCart",
  "invoicing.merchantSettlement",
  "members.resolveSubscriptionPlanMarketPolicy",
  "subscriptions.paymentScope",
  "members.verifySubscriptionMerchantAccount",
  "invoicing.providerPaymentSource",
  "subscriptions.captureMarketPolicy",
  "subscriptions.marketPolicy",
  "members.resolveSubscriptionMarketPolicy",

  "invoicing.processPaymentProviderEvents",
  "invoicing.reconcilePluginRefund",
  "invoicing.captureInvoiceMarketPolicy",
  "invoicing.captureMerchantAllocations",
  "invoicing.marketPolicy",
  "members.resolveInvoiceMarketPolicy",
  "members.resolveInvoiceMerchantLineOwners",
  "members.verifyInvoiceMerchantAccount",
  // C11.10: records a carrier's answer for a text staged by messaging.sendSms,
  // from the post-commit delivery job.
  "messaging.applySmsSendResult",
  "messaging.checkSmsDelivery",
  // C11.10: the phases around a gallery package's storage reads and write.
  "galleries.buildArchiveApply",
  "galleries.buildArchiveFail",
  "galleries.buildArchiveSource",
  "notes.purgeExpired",
  "tasks.purgeExpired",
  // The record-trash sweeps (C11.14): a trash window expiring is not something
  // anybody did; the job purges eligible rows on nobody's behalf.
  "assessments.purgeExpired",
  "calculators.purgeExpired",
  "cms.purgeExpiredPages",
  "cms.resolvePageForRender",
  "collections.purgeExpired",
  // The busy demo writes backdated sample history: only the demo boot may
  // (2026-10-23 review), never a person or an agent with demo access.
  "demo.installBusy",
  "forms.purgeExpired",
  "plugins.reportRuntimeFailure",
  "plugins.seedDemoPermissions",
  "popups.purgeExpired",
  "segments.purgeExpired",
  "views.purgeExpired",
  // C8.16: a permission with an end date does not announce its own expiry,
  // so work already public is taken down on nobody's behalf.
  "projects.sweepLapsedConsent",
  // C3.37: an intake submission opens its project in the submission's own
  // transaction, by composition from forms; it is never a door of its own.
  "projects.openFromIntake",
  "ads.rollUpStats",
  // C11.10: the sandboxed creative document reads its markup through this.
  "ads.creativeTag",
  "agents.runDuePlaybooks",
  "agents.startEventPlaybooks",
  // The wake sweep (C9.02). System rather than scoped because a sleeping run
  // is woken by a job on nobody's behalf, and it needs a real ServiceContext:
  // advancing a run dispatches verbs through `ctx.callAsSystem` and queues
  // events, neither of which a plain function can do.
  "automations.wake",
  "briefing.agentAttention",
  "briefing.appointments",
  "briefing.assemble",
  "briefing.playbookSection",
  "briefing.reconnects",
  "briefing.tasks",
  "briefing.update",
  "briefing.webhookFailures",
  // Sending a campaign (C9.06). Starting one is scoped — an owner presses
  // send — but carrying it forward is not: `sendNext` and `tick` run from
  // `newsletters.tickBroadcasts` a batch at a time, on nobody's behalf, long
  // after the request that started it has ended.
  "broadcasts.sendNext",
  "broadcasts.tick",
  // Provider work is split around short system-only snapshot/apply services.
  // These names are implementation seams for workers, never public verbs.
  "catalog.recomputeCollectionMembership",
  // The member payout ledger (§44.8, C12.09). The catalog answers which
  // member sold each order line; the ledger is written from catalog.orderPaid
  // and refund.succeeded and released by a job, on nobody's behalf.
  "catalog.memberOrdersForContact",
  "catalog.orderForInvoice",
  "catalog.orderInvoiceRevenue",
  "catalog.orderInvoiceLineOwners",
  "catalog.orderSellers",
  "members.recordPayouts",
  // C12.05 / C12.25: a paid invoice for a member's subscription or booked
  // service becomes the member's payout.
  "members.recordInvoicePayout",
  "members.releaseDuePayouts",
  "members.reversePayouts",
  // C12.30: ties abuse matches to their uploads and suspends the uploader.
  "members.linkAbuseReports",
  // C12.26–C12.27: the provider payout job's claim and apply steps, and
  // verified provider webhooks; money moves on nobody's behalf.
  "members.applyPayoutWebhook",
  "members.applyProviderTransfer",
  "members.claimProviderTransfers",
  // C12.18: federation runs on nobody's behalf. Posting and deleting queue
  // activities; the inbox route applies only signature-verified activities.
  "members.federateDelete",
  "members.federatePost",
  "members.federationInbox",
  // C12.36: the sweep that deletes removed and abandoned encrypted files.
  "members.dueSealedBlobs",
  "members.forgetSealedBlobs",
  "catalogue.applyRefresh",
  "catalogue.refreshSource",
  "entitlements.issuePass",
  "entitlements.issueUnlock",
  "entitlements.syncSubscription",
  "entitlements.syncTier",
  // Paid event admission (C6.11): settlement confirming a held seat, the
  // five-minute hold sweep, and refund/void cancellation all happen on
  // nobody's behalf — a webhook, a job, or a bus event is not a person.
  "events.confirmPaidRegistration",
  "events.expireHeldRegistrations",
  "events.lapsedHolds",
  "events.expireHeldRegistration",
  "events.cancelRegistrationForInvoice",
  "forms.briefingEnquiries",
  "galleries.buildArchive",
  "galleries.expireSessions",
  "invoicing.briefingOverdue",
  // C11.10: phases of the owner payment orchestrators. The public service
  // authorizes the caller; these run as the system around provider I/O.
  "invoicing.claimPaymentCheckout",
  "invoicing.applyPaymentCheckout",
  "invoicing.recordProviderPaymentResult",
  "invoicing.claimProviderRefund",
  "invoicing.recordProviderRefundResult",
  "invoicing.savedPaymentMethodSource",
  "invoicing.applySavedPaymentMethodRevocation",
  "invoicing.claimInPersonPayment",
  "invoicing.applyInPersonPayment",
  "mail.applySenderVerification",
  "mail.recordProviderEvent",
  "media.applyWatermarkBackfill",
  "media.backfillWatermarks",
  "media.listWatermarkBackfill",
  "media.purgeExpired",
  "media.purgeExpiredClaim",
  "media.registerStoredOriginal",
  "media.retireOwnedAssetsForErasure",
  "media.stageCompletedUpload",
  "marketplace.importProviderOrder",
  "marketplace.reconcileRefund",
  "printOnDemand.workBatch",
  "voiceVideo.applyParadiseWebhook",
  "voiceVideo.recordingRoom",
  "voiceVideo.roomAccessSource",
  "forms.purgeDemoFixture",
  "privacy.completeErasureJob",
  "privacy.reopenErasureJob",
  "privacy.settleFormLeadErasure",
  "mail.settleCarrierErasure",
  "messaging.applySmsEvents",
  "messaging.applySmsEventsApply",
  "notifications.create",
  "referrals.claimTouches",
  "social.applyGbpReviews",
  "social.applyIngestedProfilePost",
  "social.applyProfileHealth",
  "social.gbpHoursSource",
  "social.gbpProfileIds",
  "social.gbpProfileSource",
  "social.healthProfileSource",
  "social.healthProfiles",
  "social.ingestProfileIds",
  "social.ingestProfileSource",
  "social.ingestedPost",
  "social.publicationSource",
  "social.recordGbpHours",
  "social.recordProfileIngest",
  "social.recordPublicationResult",
  // The renewal sweep (C9.13). System because a period ending is not
  // something anybody did: a job finds what is due and raises the invoice on
  // nobody's behalf, long after the person who subscribed has gone.
  // C9.38: verified first-payment activation and durable signup recovery.
  "subscriptions.activatePaidSignup",
  "subscriptions.finishSignups",
  "subscriptions.pendingCustomerSchedules",
  "subscriptions.renewDue",
  // The dunning sweep (C9.16). System because a retry offset expiring is not
  // something anybody did: a job finds who is past due and sends the notice
  // or takes the final action on nobody's behalf.
  "subscriptions.advanceDunning",
  // Platform charges against a stored method (C9.33). The period ending is
  // not something anybody did; a job raises the invoice and charges on
  // nobody's behalf.
  "subscriptions.chargePlatformDue",
  // A customer's plan change is granted when its proration invoice is paid
  // (C11.10); the payment event, not a person, triggers it.
  "subscriptions.completePaidPlanChange",
  // Provider schedules are the truth (C9.33). A verified webhook applies the
  // period on nobody's behalf.
  "subscriptions.reconcileProviderPeriod",
  "subscriptions.recoverDunning",
  // Provider submission happens outside service transactions; this applies
  // the durable mail ledger's outcome afterwards on nobody's behalf.
  "reports.settleExportRun",
] as const;

const CALLER_AUTHORIZED_PHASES = [
  "catalog.anonymizeSellerOrderReceipts",
  "catalog.orderInvoiceRevenue",
  "media.retireOwnedAssetsForErasure",
  "media.reserveProxyObject",
  "catalog.orderInvoiceLineOwners",
  "subscriptions.claimTrialCardSetup",
  "subscriptions.applyTrialCardSetup",
  "subscriptions.claimTrialSetupDispatch",
  "subscriptions.recordTrialSetupDispatch",
  "subscriptions.claimTrialSetupErasure",
  "subscriptions.finishTrialSetupErasure",
  "subscriptions.claimTrialSetupReconciliation",
  "subscriptions.applyTrialSetupReconciliation",
  "catalog.claimReturnProviderRefund",
  "catalog.reconcileReturnProviderRefunds",
  "invoicing.reserveRefundBatch",
  "catalog.availabilityForCart",
  "invoicing.merchantSettlement",
  "members.resolveSubscriptionPlanMarketPolicy",
  "subscriptions.paymentScope",
  "members.verifySubscriptionMerchantAccount",
  "subscriptions.captureMarketPolicy",
  "subscriptions.marketPolicy",
  "members.resolveSubscriptionMarketPolicy",
  "invoicing.providerPaymentSource",

  "invoicing.processPaymentProviderEvents",
  "invoicing.reconcilePluginRefund",
  "invoicing.captureInvoiceMarketPolicy",
  "invoicing.captureMerchantAllocations",
  "invoicing.marketPolicy",
  "members.resolveInvoiceMarketPolicy",
  "members.resolveInvoiceMerchantLineOwners",
  "members.verifyInvoiceMerchantAccount",
  // C1.38/C10.31: browser-only entry and owner host controls. These do not
  // belong in API-key, SDK, OpenAPI or MCP projections.
  "playground.enter",
  "platform.getHostUpdateStatus",
  "platform.requestHostUpdate",
  "forms.purgeDemoFixture",
  "privacy.completeErasureJob",
  "privacy.reopenErasureJob",
  "privacy.settleFormLeadErasure",
  "mail.settleCarrierErasure",
  "notes.purgeExpired",
  "tasks.purgeExpired",
  "assessments.purgeExpired",
  "calculators.purgeExpired",
  "cms.purgeExpiredPages",
  "cms.resolvePageForRender",
  "collections.purgeExpired",
  "forms.purgeExpired",
  "plugins.reportRuntimeFailure",
  "plugins.seedDemoPermissions",
  "popups.purgeExpired",
  "segments.purgeExpired",
  "views.purgeExpired",
  // The membership recompute is a job phase: it runs from
  // catalog.recomputeSegmentCollections on nobody's behalf and claims nothing
  // on an external protocol.
  "catalog.recomputeCollectionMembership",
  // Checkout composes this inside its transaction; the public door is the
  // rate-limited catalog.quoteCartPromotions (C11.10).
  "catalog.resolveCartPromotions",
  "documents.myDownload",
  // C11.10: the short phases around model calls, so no transaction waits on
  // a provider (MASTER.md §11).
  "assistant.applyAnswer",
  "assistant.prepareAnswer",
  // Validated private chat bearer and an already visitor-bound PM session;
  // these phases are only reachable through assistant.previewCall.
  "assistant.previewAccess",
  "assistant.saveCallCaption",
  "assistant.settingsSnapshot",
  "assistant.reindexPage",
  // C3.47: original-source graph phases are reachable only through the
  // matching public import parent; they never become independent tools.
  "imports.claimSourceGraph",
  "imports.applySourceGraphIndex",
  "imports.prepareSourceGraphPlan",
  "imports.claimGraphCommit",
  "imports.stageGraphBatch",
  "imports.acceptGraphBatch",
  "imports.releaseSourceGraphRead",
  "imports.releaseGraphBatchRead",
  "imports.claimSourceRebind",
  "imports.acceptSourceRebindChunk",
  // C3.22: the halves of imports.commit around WordPress media downloads.
  "imports.commitApply",
  "imports.commitSource",
  "imports.recordMedia",
  "imports.claimMedia",
  "imports.bindMediaBytes",
  "imports.verifyPreparedMedia",
  "imports.acceptPreparedMedia",
  // C3.22: source discovery read/CAS phases never become public tools.
  "imports.crawlSource",
  "imports.applyCrawl",
  // C3.22: the halves of the chunked export upload around object storage.
  "imports.applyUploadedPreview",
  "imports.beginSourceUploadApply",
  "imports.claimSourceChunk",
  "imports.recordSourceChunk",
      "imports.releaseErasedSourceUpload",
      "imports.rememberSourceWrite",
  "imports.sourceUploadState",
  "builder.recordCodeProposal",
  "builder.recordProposal",
  "builder.releaseCodeReservation",
  "builder.releaseProposalReservation",
  "builder.reserveCodeProposal",
  "builder.reserveProposal",
  "cms.applyPageTranslationDraft",
  "cms.draftPageTranslationSource",
  // C11.10: the phases around SMS, capture-storage and calendar/mail provider
  // I/O, so no service transaction is held open across it.
  "messaging.applySmsSendResult",
  "messaging.checkNumbersApply",
  "messaging.checkSmsDelivery",
  "messaging.importNumbersApply",
  "media.applyCaptureAssembly",
  "media.applyCaptureChunk",
  "media.applyCaptureOriginal",
  "media.claimCaptureAssembly",
  "media.claimCaptureChunk",
  "media.claimCaptureOriginal",
  "connections.importMailApply",
  "connections.importMailSource",
  "connections.syncCalendarsApply",
  "connections.syncCalendarsDiscover",
  "connections.syncCalendarsSource",
  "agents.claimApproval",
  "agents.completeApproval",
  "agents.proposeWriteGate",
  "agents.releaseApproval",
  "builder.claimCodeDelivery",
  "builder.recordCodeDelivery",
  "builder.releaseCodeDelivery",
  "galleries.buildArchiveApply",
  "galleries.buildArchiveFail",
  "galleries.buildArchiveSource",
  // Storage keys stay behind the gallery's controlled byte routes.
  "galleries.viewItem",
  "galleries.downloadItem",
  "galleries.downloadArchive",
  "media.privateAssetDownloadAccess",
  "invoicing.claimCustomerCheckout",
  "invoicing.applyCustomerCheckout",
  "invoicing.customerPaymentSource",
  "invoicing.applyCustomerPayment",
  "demo.installApply",
  // C1.38: the busy demo layer runs as the system after the plain demo.
  "demo.installBusy",
  "demo.installGuard",
  "connections.applyCalendarOAuthCompletion",
  "connections.applyMailReadOAuthCompletion",
  "connections.claimCalendarOAuthCompletion",
  "connections.claimMailReadOAuthCompletion",
  "connections.peekCalendarOAuthReturn",
  "connections.peekMailReadOAuthReturn",
  "mail.applyOAuthCompletion",
  "mail.claimOAuthCompletion",
  "media.abortUploadApply",
  "media.abortUploadClaim",
  "media.altTextSuggestionSource",
  "media.applyAltTextSuggestion",
  "media.applyCaptureComplete",
  "media.applyRescan",
  "media.applyStoredOriginal",
  "media.beginUploadApply",
  "media.claimProxyUpload",
  "media.claimStorageRecovery",
  "media.applyStorageRecovery",
  "media.storageTransferInventory",
  "media.claimMultipartRecovery",
  "media.applyMultipartRecovery",
  "media.claimMultipartCleanup",
  "media.completeUploadSource",
  "media.confirmCaptureApply",
  "media.confirmCaptureSource",
  "media.failDirectUpload",
  "media.purgeApply",
  "media.purgeClaim",
  "media.rescanSource",
  "media.signUploadClaim",
  "media.uploadStatusSource",
  // C12.21: the member file route asks this on every request; it returns a
  // storage key, so it never leaves the process.
  "members.fileAccess",
  // C12.18: the ActivityPub routes render these documents; the fediverse
  // reaches them over HTTP, not through the service API.
  "members.federationDocument",
  // C12.36: halves of members.uploadSealedBlob, and the check behind
  // /member-blobs/[id]; the bytes route is the only way in.
  // C12.26–C12.27: the halves of seller payout setup around the provider call.
  "members.applyPayoutAccount",
  "members.payoutSetupSource",
  // C12.32: the apply half of members.followRemote, after the lookup.
  "members.addRemoteFollow",
  // C12.33: the halves of members.setFediverseAliases and members.moveToRemote.
  "members.applyFediverseAliases",
  "members.applyMove",
  "members.moveSource",
  "members.claimSealedBlob",
  "members.confirmSealedBlob",
  "members.sealedBlobAccess",
  "signupContactImports.applyOAuthCompletion",
  "signupContactImports.applyProviderContacts",
  "signupContactImports.claimOAuthCompletion",
  "signupContactImports.providerSource",
  "social.applyOAuthCompletion",
  "social.claimOAuthCompletion",
  "social.createVariantsApply",
  "social.createVariantsSource",
  "giftRegistry.applyItemInvoice",
  "giftRegistry.claimItemInvoice",
  "marketplace.applyConnect",
  "marketplace.applySync",
  "marketplace.claimConnect",
  "marketplace.claimSync",
  "marketplace.findImported",
  "marketplace.recordImported",
  "printOnDemand.applySubmit",
  "printOnDemand.applyRefresh",
  "printOnDemand.claimRefresh",
  "printOnDemand.claimSubmit",
  "voiceVideo.applyCapture",
  "voiceVideo.applyImport",
  "voiceVideo.applyMiss",
  "voiceVideo.applyStart",
  "voiceVideo.applyStop",
  "voiceVideo.claimCapture",
  "voiceVideo.claimImport",
  "voiceVideo.claimStart",
  "voiceVideo.claimStop",
  "voiceVideo.applyParadiseWebhook",
  "voiceVideo.recordingRoom",
] as const;

const PRIVATE = [...INTERNAL, ...CALLER_AUTHORIZED_PHASES] as const;

const wildcard: Actor = {
  kind: "agent",
  keyName: "boundary-test",
  scopes: [
    "*",
    "agents.*",
    "briefing.*",
    "forms.*",
    "invoicing.*",
    "mail.*",
    "media.*",
    "messaging.*",
    "notifications.*",
  ],
};

describe("the system-service boundary", () => {
  beforeAll(async () => {
    await ready();
  }, 120_000);

  it("keeps an explicit reviewed inventory", () => {
    const actual = [...listServices().values()]
      .filter((service) => service.def.permission === "system")
      .map((service) => service.def.name)
      .sort();
    expect(actual).toEqual([...INTERNAL].sort());
  });

  it("refuses fabricated provider evidence from financial administrators, keys and plugins before ledger access (C11.10)", async () => {
    const processor = getService("invoicing.processPaymentProviderEvents");
    const input = { provider: "stripe", bodySha256: "a".repeat(64), receivedAt: new Date().toISOString(), events: [] };
    const callers: Actor[] = [
      wildcard,
      { kind: "anonymous" },
      { kind: "user", userId: "00000000-0000-4000-8000-000000000001", role: "owner", grants: [{ module: "*", access: "manage" }] },
      { kind: "user", userId: "00000000-0000-4000-8000-000000000002", role: "staff", grants: [{ module: "invoicing", access: "manage" }], keyScopes: ["invoicing.*"] },
      { kind: "plugin", name: "financial-plugin", grants: [{ module: "invoicing", access: "manage" }] },
    ];
    for (const actor of callers) {
      await expect(processor.call(input, actor)).rejects.toMatchObject({ code: "permission" });
    }
    expect(() => getExternalService(processor.def.name)).toThrow(/no service/);
  });

  it("keeps an explicit reviewed inventory of caller-authorized phases", () => {
    const actual = [...listServices().values()]
      .filter((service) => service.def.external === false)
      .map((service) => service.def.name)
      .sort();
    expect(actual).toEqual([...CALLER_AUTHORIZED_PHASES].sort());
  });

  it("keeps every internal service out of every generated projection", () => {
    const openapi = buildOpenApi({
      origin: "https://example.test",
      version: "0.1.0",
      title: "Boundary test",
    });
    const paths = openapi.paths as Record<string, unknown>;
    const projections = contractProjections();
    const tools = new Set(toolsFor(wildcard).map((tool) => tool.name));

    for (const name of PRIVATE) {
      const service = getService(name);
      expect(
        service.def.permission === "system" || service.def.external === false,
      ).toBe(true);
      expect(hiddenFromMcp(service)).toBe(true);
      expect(listExternalServices().has(name)).toBe(false);
      expect(paths).not.toHaveProperty(`/api/v1/${name}`);
      expect(projections.names).not.toContain(name);
      expect(projections.openapiPaths).not.toContain(`/api/v1/${name}`);
      expect(tools.has(toolName(name))).toBe(false);
      expect(serviceForTool(wildcard, toolName(name))).toBeUndefined();
    }
  });

  it("answers an external name probe exactly like an unknown service", () => {
    for (const name of PRIVATE) {
      let refusal: unknown;
      try {
        getExternalService(name);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({ code: "not_found" });
    }
  });
});
