// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Audit rows, said in English (MASTER.md §4.8: "a plain-English log of
// everything their AI did").
//
// Its own module rather than a helper inside the page, because it is the one
// piece of that screen with a right and a wrong answer, and a page file cannot
// export anything a test could reach.
import { listServices } from "@/core/service";
import type { Translate } from "@/core/i18n";

/**
 * A log line for someone who did not build this.
 *
 * Every service already carries a `summary` written for a human — "Merge a
 * duplicate contact into the one that survives." — so the activity feed reads
 * it rather than inventing prose from the service name. Deriving it was always
 * a guess, and it guessed wrong the moment a module's name was not a plural
 * noun: `cms.ensureDefaults` rendered as "Cm — ensure defaults".
 *
 * The fallback stays because an audit row outlives the service that wrote it.
 * A renamed or removed module leaves rows naming something the registry no
 * longer has, and that history still has to read as English. It no longer
 * singularizes anything, since nothing here knows whether the leading word is
 * a plural noun, an acronym or a coined name.
 */
export function describeAction(action: string): string {
  return listServices().get(action)?.def.summary ?? humanizeAction(action);
}

function humanizeAction(action: string): string {
  const [subject, verb] = action.split(".");
  if (!subject || !verb) return action;
  const readable = verb
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} — ${readable}`;
}

/**
 * Things visitors, customers and the platform do that an owner reads as
 * business news, keyed to plain locale strings. A service summary is written
 * for whoever calls the service ("Open a guest or authorized contact cart and
 * issue its private access token"): right for the full diagnostic trail,
 * wrong for an owner's "What changed".
 */
export const OWNER_ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  "forms.submit": "admin.activity.formSubmitted",
  "forms.reviewSubmission": "admin.activity.formReviewed",
  "catalog.getOrCreateCart": "admin.activity.cartStarted",
  "catalog.addCartItem": "admin.activity.cartItemAdded",
  "catalog.shopperCheckout": "admin.activity.orderPlaced",
  "catalog.checkoutCart": "admin.activity.orderPlaced",
  "catalog.cancelOrder": "admin.activity.orderCancelled",
  "catalog.shipFulfillment": "admin.activity.orderShipped",
  "catalog.deliverFulfillment": "admin.activity.orderDelivered",
  "catalog.requestReturn": "admin.activity.returnRequested",
  "catalog.refundReturn": "admin.activity.refundUpdated",
  "catalog.bookService": "admin.activity.appointmentBooked",
  "catalog.moveMyBooking": "admin.activity.appointmentMoved",
  "bookings.rescheduleByToken": "admin.activity.appointmentMoved",
  "bookings.cancelByToken": "admin.activity.appointmentCancelled",
  "bookings.create": "admin.activity.bookingCreated",
  "bookings.reschedule": "admin.activity.bookingMoved",
  "bookings.setStatus": "admin.activity.bookingUpdated",
  "events.register": "admin.activity.eventRegistration",
  "events.confirmPaidRegistration": "admin.activity.eventRegistration",
  "events.cancelRegistration": "admin.activity.eventRegistrationCancelled",
  "events.checkIn": "admin.activity.eventCheckIn",
  "newsletters.subscribe": "admin.activity.newsletterSubscribed",
  "newsletters.unsubscribe": "admin.activity.newsletterUnsubscribed",
  "reviews.submit": "admin.activity.reviewLeft",
  "quotes.accept": "admin.activity.quoteAccepted",
  "contracts.sign": "admin.activity.contractSigned",
  "messaging.startSiteChat": "admin.activity.chatStarted",
  "cms.submitSiteChat": "admin.activity.chatStarted",
  "cms.submitQuoteRequest": "admin.activity.quoteRequested",
  "waitlist.join": "admin.activity.waitlistJoined",
  "rentals.reserve": "admin.activity.rentalReserved",
  "invoicing.applyCustomerPayment": "admin.activity.invoicePaid",
  "invoicing.createDraft": "admin.activity.invoiceDrafted",
  "invoicing.issue": "admin.activity.invoiceIssued",
  "invoicing.send": "admin.activity.invoiceSent",
  "invoicing.viewCustomerInvoice": "admin.activity.invoiceViewed",
  "invoicing.markViewed": "admin.activity.invoiceViewed",
  "invoicing.void": "admin.activity.invoiceVoided",
  "conversations.record": "admin.activity.messageReceived",
  "conversations.replyAsContact": "admin.activity.messageReceived",
  "messaging.postSiteChat": "admin.activity.messageReceived",
  "conversations.reply": "admin.activity.messageReplied",
  "members.join": "admin.activity.memberJoined",
  "community.joinBySlug": "admin.activity.communityJoined",
  "members.linkAbuseReports": "admin.activity.uploadHeld",
  // Money the platform records from a provider is news, not machinery
  // (`events.recentActivity`: "webhook-applied payment stay").
  "invoicing.processPaymentProviderEvents": "admin.activity.paymentUpdated",
  "invoicing.recordProviderPaymentResult": "admin.activity.paymentUpdated",
  "invoicing.settlePayment": "admin.activity.paymentReceived",
  "invoicing.applyPaymentCheckout": "admin.activity.paymentReceived",
  "invoicing.applyCustomerCheckout": "admin.activity.paymentReceived",
  "invoicing.completePaymentCheckout": "admin.activity.paymentReceived",
  "invoicing.recordOfflinePayment": "admin.activity.paymentReceived",
  "invoicing.applyInPersonPayment": "admin.activity.paymentReceived",
  "invoicing.confirmCustomerPayment": "admin.activity.paymentReceived",
  "invoicing.failPayment": "admin.activity.paymentFailed",
  "invoicing.createRefund": "admin.activity.refundUpdated",
  "invoicing.startRefund": "admin.activity.refundUpdated",
  "invoicing.recordOfflineRefund": "admin.activity.refundUpdated",
  "invoicing.refundInPersonPayment": "admin.activity.refundUpdated",
  "invoicing.recordProviderRefundResult": "admin.activity.refundUpdated",
  "invoicing.settleRefund": "admin.activity.refundUpdated",
  "invoicing.failRefund": "admin.activity.refundUpdated",
  "invoicing.recordProviderPayout": "admin.activity.payoutRecorded",
  "invoicing.reconcileProviderPayout": "admin.activity.payoutRecorded",
  "members.recordPayouts": "admin.activity.payoutRecorded",
  "members.settlePayouts": "admin.activity.payoutRecorded",
  "members.applyPayoutWebhook": "admin.activity.payoutRecorded",
  "members.reversePayouts": "admin.activity.payoutReversed",
  "members.openDispute": "admin.activity.disputeOpened",
  // Money, sign-in, keys, roles and grants never fall through to the
  // generic line: an owner reads each as what it is (2026-10-23 review).
  "auth.registerOwner": "admin.activity.ownerRegistered",
  "auth.login": "admin.activity.signedIn",
  "auth.completePasskeyLogin": "admin.activity.signedIn",
  "auth.completeTwoFactorLogin": "admin.activity.signedIn",
  "auth.completeWebAuthnLogin": "admin.activity.signedIn",
  "auth.consumeCustomerMagicLink": "admin.activity.signedIn",
  "auth.beginPasskeyLogin": "admin.activity.signInStarted",
  "auth.requestCustomerMagicLink": "admin.activity.signInLinkRequested",
  "auth.logout": "admin.activity.signedOut",
  "auth.revokeSession": "admin.activity.signedOut",
  "auth.revokeOtherSessions": "admin.activity.signedOut",
  "auth.changePassword": "admin.activity.passwordChanged",
  "auth.resetPassword": "admin.activity.passwordChanged",
  "auth.requestPasswordReset": "admin.activity.passwordResetRequested",
  "auth.verifyStepUpCode": "admin.activity.identityConfirmed",
  "auth.beginWebAuthnStepUp": "admin.activity.identityConfirmed",
  "auth.finishWebAuthnStepUp": "admin.activity.identityConfirmed",
  "auth.beginTotpEnrollment": "admin.activity.securityChanged",
  "auth.confirmTotpEnrollment": "admin.activity.securityChanged",
  "auth.beginWebAuthnRegistration": "admin.activity.securityChanged",
  "auth.finishWebAuthnRegistration": "admin.activity.securityChanged",
  "auth.regenerateRecoveryCodes": "admin.activity.securityChanged",
  "auth.removeTotpFactor": "admin.activity.securityChanged",
  "auth.removeWebAuthnFactor": "admin.activity.securityChanged",
  "apikeys.create": "admin.activity.apiKeyCreated",
  "apikeys.createMine": "admin.activity.apiKeyCreated",
  "apikeys.revoke": "admin.activity.apiKeyRevoked",
  "apikeys.revokeMine": "admin.activity.apiKeyRevoked",
  "roles.create": "admin.activity.rolesChanged",
  "roles.update": "admin.activity.rolesChanged",
  "roles.delete": "admin.activity.rolesChanged",
  "roles.assign": "admin.activity.roleAssigned",
  "connections.grantToAgent": "admin.activity.agentAccessGranted",
  "entitlements.grant": "admin.activity.accessGranted",
  "privacy.grantMediaConsent": "admin.activity.consentRecorded",
  "media.grantCapturePermission": "admin.activity.recordingAllowed",
  "catalog.grantDigitalFulfillment": "admin.activity.downloadsGranted",
  "webhooks.rotateSecret": "admin.activity.secretRotated",
  "calendars.issueFeed": "admin.activity.calendarLinkChanged",
  "calendars.revokeFeed": "admin.activity.calendarLinkChanged",
  "catalog.createPriceList": "admin.activity.pricesChanged",
  "catalog.setPriceListEntry": "admin.activity.pricesChanged",
  "catalog.setPriceBreak": "admin.activity.pricesChanged",
  "galleries.addPriceSheetItem": "admin.activity.pricesChanged",
  "galleries.removePriceSheetItem": "admin.activity.pricesChanged",
  "catalog.setPriceRule": "admin.activity.paymentOptionsChanged",
  "catalog.removePriceRule": "admin.activity.paymentOptionsChanged",
  "invoicing.createCreditNote": "admin.activity.creditNoteDrafted",
  "invoicing.issueCreditNote": "admin.activity.creditNoteIssued",
  "invoicing.voidCreditNote": "admin.activity.creditNoteVoided",
  "marketplace.reconcileRefund": "admin.activity.creditNoteIssued",
  "invoicing.createDepositAndBalance": "admin.activity.invoiceDrafted",
  "invoicing.createFlexiblePayment": "admin.activity.invoiceDrafted",
  "time.invoice": "admin.activity.invoiceDrafted",
  "ads.invoiceCampaign": "admin.activity.invoiceDrafted",
  "giftRegistry.invoiceItem": "admin.activity.invoiceDrafted",
  "giftRegistry.claimItemInvoice": "admin.activity.invoiceDrafted",
  "giftRegistry.applyItemInvoice": "admin.activity.invoiceDrafted",
  "invoicing.assessLateFee": "admin.activity.lateFeeAdded",
  "invoicing.adjustCustomerBalance": "admin.activity.balanceChanged",
  "invoicing.applyCustomerBalance": "admin.activity.balanceChanged",
  "catalog.applyGiftCardToInvoice": "admin.activity.balanceChanged",
  "invoicing.createPaymentPlan": "admin.activity.paymentPlanChanged",
  "invoicing.refreshPaymentPlans": "admin.activity.paymentPlanChanged",
  "invoicing.cancelPaymentPlan": "admin.activity.paymentPlanChanged",
  "invoicing.createPayment": "admin.activity.paymentStarted",
  "invoicing.startPayment": "admin.activity.paymentStarted",
  "invoicing.beginPaymentCheckout": "admin.activity.paymentStarted",
  "invoicing.claimPaymentCheckout": "admin.activity.paymentStarted",
  "invoicing.beginInPersonPayment": "admin.activity.paymentStarted",
  "invoicing.claimInPersonPayment": "admin.activity.paymentStarted",
  "invoicing.beginCustomerCheckout": "admin.activity.paymentStarted",
  "invoicing.claimCustomerCheckout": "admin.activity.paymentStarted",
  "catalog.issueGiftCard": "admin.activity.giftCardIssued",
  "catalog.sendGiftCard": "admin.activity.giftCardSent",
  "subscriptions.chargePlatformInvoice": "admin.activity.paymentStarted",
  "subscriptions.chargePlatformDue": "admin.activity.paymentStarted",
  "invoicing.cancelPayment": "admin.activity.paymentCancelled",
  "invoicing.recordProviderBalanceTransaction": "admin.activity.paymentUpdated",
  "invoicing.revokeSavedPaymentMethod": "admin.activity.savedMethodRemoved",
  "invoicing.applySavedPaymentMethodRevocation": "admin.activity.savedMethodRemoved",
  "catalog.payOrder": "admin.activity.orderPaid",
  "catalog.releaseOrderPaymentMilestone": "admin.activity.paymentMilestoneReleased",
  "events.cancelRegistrationForInvoice": "admin.activity.eventRegistrationCancelled",
  "invoicing.cancelRefund": "admin.activity.refundCancelled",
  "invoicing.refundCustomerBalancePayment": "admin.activity.refundUpdated",
  "invoicing.submitProviderRefund": "admin.activity.refundUpdated",
  "invoicing.claimProviderRefund": "admin.activity.refundUpdated",
  "members.releaseDuePayouts": "admin.activity.payoutRecorded",
  "members.recordInvoicePayout": "admin.activity.payoutRecorded",
  "referrals.buildPayoutBatch": "admin.activity.payoutRecorded",
  "referrals.approvePayoutBatch": "admin.activity.payoutRecorded",
  "referrals.markPayoutBatchPaid": "admin.activity.payoutRecorded",
  "members.savePayoutInstructions": "admin.activity.payoutDetailsChanged",
  "members.setPayoutAccountStatus": "admin.activity.payoutDetailsChanged",
  "members.applyPayoutAccount": "admin.activity.payoutDetailsChanged",
  "members.startPayoutSetup": "admin.activity.payoutDetailsChanged",
  "members.refreshPayoutAccount": "admin.activity.payoutDetailsChanged",
  "members.withdrawDispute": "admin.activity.disputeUpdated",
  "members.resolveDispute": "admin.activity.disputeUpdated",
};

/**
 * Plumbing a visitor's visit sets off around the thing they actually did:
 * the contact lookup behind a form, analytics, cart bookkeeping, demo entry.
 * Only these are left out of the owner's default feed; anything not listed
 * still shows, so a new business event is never hidden by omission.
 */
export const OWNER_HIDDEN_ACTIONS: ReadonlySet<string> = new Set([
  "contacts.resolve",
  "analytics.track",
  "analytics.identify",
  "analytics.recordExperimentConversion",
  "catalog.attachCartToContact",
  "catalog.quoteCartPromotions",
  "catalog.resolveCartPromotions",
  "playground.enter",
]);

/**
 * The part of the site an unmapped action touched, as a locale noun phrase.
 * A module missing here reads as "your site" rather than as its code name.
 */
export const OWNER_ACTIVITY_AREAS: Readonly<Record<string, string>> = {
  automations: "admin.activity.area.automations",
  bookings: "admin.activity.area.bookings",
  broadcasts: "admin.activity.area.broadcasts",
  catalog: "admin.activity.area.catalog",
  cms: "admin.activity.area.cms",
  community: "admin.activity.area.community",
  contacts: "admin.activity.area.contacts",
  contracts: "admin.activity.area.contracts",
  conversations: "admin.activity.area.conversations",
  events: "admin.activity.area.events",
  forms: "admin.activity.area.forms",
  galleries: "admin.activity.area.galleries",
  invoicing: "admin.activity.area.invoicing",
  media: "admin.activity.area.media",
  members: "admin.activity.area.members",
  messaging: "admin.activity.area.messaging",
  newsletters: "admin.activity.area.newsletters",
  projects: "admin.activity.area.projects",
  quotes: "admin.activity.area.quotes",
  rentals: "admin.activity.area.rentals",
  reviews: "admin.activity.area.reviews",
  settings: "admin.activity.area.settings",
  subscriptions: "admin.activity.area.subscriptions",
  tasks: "admin.activity.area.tasks",
};

/**
 * One line of the owner's default "What changed" feed, or null to leave the
 * row out of it. A mapped action reads as business news; known visitor
 * plumbing (`OWNER_HIDDEN_ACTIONS`) stays in the full log ("Include
 * background work"); anything else says which part of the site changed.
 *
 * Never the service summary: those are written for whoever calls the
 * service ("Allocate a gapless number and issue an immutable draft
 * invoice."), and an owner read them verbatim on the demo (2026-10-23
 * pre-launch check). The summary stays in the full log.
 */
export function ownerActivityLine(
  entry: { action: string; actor: string },
  t: Translate,
): string | null {
  const key = OWNER_ACTIVITY_LABELS[entry.action];
  if (key) return t(key);
  if (OWNER_HIDDEN_ACTIONS.has(entry.action)) return null;
  const areaKey = OWNER_ACTIVITY_AREAS[entry.action.split(".")[0] ?? ""];
  const area = t(areaKey ?? "admin.activity.area.site");
  // Said by who did it (the `actorString` kinds): only the platform's own
  // work reads as "Freeholder updated…".
  if (entry.actor.startsWith("user:")) return t("admin.activity.teamUpdated", { area });
  if (entry.actor.startsWith("agent:")) return t("admin.activity.agentUpdated", { area });
  if (entry.actor === "system") return t("admin.activity.platformUpdated", { area });
  return t("admin.activity.visitorUpdated", { area });
}

/**
 * Actions an owner must never see as the generic "updated {area}" line:
 * money (payments, refunds, payouts, disputes, prices, balances, credit,
 * invoices), sign-in, API keys, roles, grants and secrets. Every registered
 * mutation this matches needs its own `OWNER_ACTIVITY_LABELS` entry, which
 * `tests/core/audit-labels.test.ts` enforces.
 */
export function needsOwnLine(action: string): boolean {
  const [module = "", verb = ""] = action.split(".");
  if (["auth", "apikeys", "roles"].includes(module)) return true;
  return (
    /^(pay|refund|charge)/.test(verb) ||
    /grant|Grant|Payment|Refund|Payout|Dispute|Price|Balance|Credit|Charge|LateFee|GiftCard|Invoice|Secret|Feed/.test(verb) ||
    (module === "invoicing" && /^(issue|void|send|createDraft|cancel|apply|settle|fail|record|reconcile|submit|claim|begin|start|complete|confirm|revoke|adjust|assess)/.test(verb))
  );
}
