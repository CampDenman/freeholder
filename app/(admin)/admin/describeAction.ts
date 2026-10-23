// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Audit rows, said in English (MASTER.md §4.8: "a plain-English log of
// everything their AI did").
//
// Its own module rather than a helper inside the page, because it is the one
// piece of that screen with a right and a wrong answer, and a page file cannot
// export anything a test could reach.
import { listServices } from "@/core/service";

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
  "catalog.getOrCreateCart": "admin.activity.cartStarted",
  "catalog.addCartItem": "admin.activity.cartItemAdded",
  "catalog.shopperCheckout": "admin.activity.orderPlaced",
  "catalog.checkoutCart": "admin.activity.orderPlaced",
  "catalog.bookService": "admin.activity.appointmentBooked",
  "bookings.rescheduleByToken": "admin.activity.appointmentMoved",
  "bookings.cancelByToken": "admin.activity.appointmentCancelled",
  "events.register": "admin.activity.eventRegistration",
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
  "invoicing.failPayment": "admin.activity.paymentFailed",
  "invoicing.recordProviderRefundResult": "admin.activity.refundUpdated",
  "invoicing.settleRefund": "admin.activity.refundUpdated",
  "invoicing.failRefund": "admin.activity.refundUpdated",
  "invoicing.recordProviderPayout": "admin.activity.payoutRecorded",
  "members.recordPayouts": "admin.activity.payoutRecorded",
  "members.settlePayouts": "admin.activity.payoutRecorded",
  "members.applyPayoutWebhook": "admin.activity.payoutRecorded",
  "members.reversePayouts": "admin.activity.payoutReversed",
  "members.openDispute": "admin.activity.disputeOpened",
};

/**
 * Plumbing a visitor's visit sets off around the thing they actually did:
 * the contact lookup behind a form, analytics, cart bookkeeping, demo entry.
 * Only these are left out of the owner's default feed; anything not listed
 * still shows with its service summary, so a new business event is never
 * hidden by omission.
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
 * One line of the owner's default "What changed" feed, or null to leave the
 * row out of it. A mapped action reads as business news; known visitor
 * plumbing (`OWNER_HIDDEN_ACTIONS`) stays in the full log ("Include
 * background work"); everything else keeps its service summary.
 */
export function ownerActivityLine(
  entry: { action: string; actor: string },
  t: (key: string) => string,
): string | null {
  const key = OWNER_ACTIVITY_LABELS[entry.action];
  if (key) return t(key);
  if (OWNER_HIDDEN_ACTIONS.has(entry.action)) return null;
  return describeAction(entry.action);
}
