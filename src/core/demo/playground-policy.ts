// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: a public playground grants content access, never operator authority.
export const PLAYGROUND_MANAGE = ["cms", "forms", "contacts", "catalog", "notes", "tasks"] as const;
// C12.16: "members" so the playground shows the member admin beside the demo community.
// 2026-10-22: the rest of the business modules are readable too. An evaluator
// who cannot open the inbox, invoices, bookings or newsletters cannot judge
// the product; reading demo data grants no authority, and every write is
// still decided by the mutation allow-list below. Operator machinery
// (platform, roles, invitations, API keys, agents, builder, demos, upstream
// contribution) stays out — `PLAYGROUND_UNAVAILABLE` explains it instead.
export const PLAYGROUND_VIEW = [
  "admin", "settings", "events", "analytics", "search", "media", "guidance", "notifications", "members",
  "crm", "segments", "invoicing", "scheduling", "connections", "newsletters", "galleries", "quotes",
  "assistant", "projects", "documents", "contracts", "reviews", "popups", "subscriptions", "entitlements",
  "paywalls", "loyalty", "referrals", "rentals", "assessments", "calculators", "attestations",
  "locations", "automations", "reporting", "ads", "social", "share", "community", "marketplace",
  "giftRegistry", "printOnDemand", "time", "voiceVideo", "seo", "i18n", "retention",
] as const;

/**
 * Admin areas the playground cannot show, with what each one does. A visitor
 * who follows a link into one gets this explanation instead of a silent
 * bounce to the overview.
 */
export const PLAYGROUND_UNAVAILABLE = [
  "platform", "roles", "invitations", "apikeys", "agents", "builder", "demo", "contribute",
] as const;

// Explicit opt-in: future services (including CMS email/SMS delivery) must not
// silently inherit permission to run in a publicly editable instance.
const MUTATIONS = new Set([
  "playground.enter", "auth.logout",
  "cms.createPage", "cms.updatePage", "cms.mergePage", "cms.publishPage", "cms.deleteDraftPage",
  "cms.touchEditLease", "cms.releaseEditLease", "cms.heartbeatPresence", "cms.leavePresence",
  "cms.updateSection", "cms.createSectionLocale", "cms.restoreRevision",
  "cms.attachLayout", "cms.detachLayout", "cms.rejoinLayout", "cms.createSection",
  "cms.saveAsSection", "cms.detachSection", "cms.deleteSection", "cms.createFromTemplate",
  "forms.create", "forms.update", "forms.delete", "forms.reviewSubmission",
  "contacts.create", "contacts.update", "contacts.merge", "contacts.undoMerge",
  "catalog.createProduct", "catalog.updateProduct", "catalog.updateProductDescription",
  "catalog.activateProduct", "catalog.publishProduct", "catalog.archiveProduct", "catalog.restoreProduct",
  "notes.write", "notes.edit", "notes.pin", "notes.remove", "notes.restore",
  "tasks.create", "tasks.update", "tasks.setStatus", "tasks.remove", "tasks.restore",
]);

/**
 * What anybody on the playground's *public site* does: send the contact form,
 * subscribe, register for an event, fill a cart, chat, share, answer a popup
 * or leave a review. Refusing these made the demo look broken to the people it
 * exists for (2026-10-22 audit), so they run — signed out or as the visitor —
 * under the same per-surface row caps as the editing surfaces below.
 *
 * None of them can reach the outside world: mail, SMS and webhooks fail closed
 * at delivery (`playgroundBlocksExternalDelivery`), and the services that move
 * money with a provider or start a credential flow stay off this list — see
 * `PLAYGROUND_PUBLIC_REFUSED`. Every public mutation must appear in exactly one
 * of the two; `tests/core/playground.test.ts` fails on an unclassified one, so
 * a new public verb is a decision, not an accident.
 */
export const PLAYGROUND_PUBLIC = [
  "forms.submit",
  "newsletters.subscribe", "newsletters.confirm", "newsletters.unsubscribe", "broadcasts.unsubscribe",
  "events.register",
  "catalog.getOrCreateCart", "catalog.addCartItem", "catalog.setCartItemQuantity", "catalog.removeCartItem",
  "catalog.saveCart", "catalog.attachCartToContact", "catalog.addWishlistItem", "catalog.removeWishlistItem",
  "catalog.applyCouponToCart", "catalog.subscribeBackInStock", "catalog.shopperCheckout", "catalog.checkoutCart",
  "messaging.startSiteChat", "messaging.postSiteChat", "messaging.endSiteChat",
  "cms.submitSiteChat", "cms.submitQuoteRequest", "cms.submitTipIntent", "cms.rateHelpArticle",
  "share.shareVia",
  "popups.record", "popups.capture",
  "reviews.submit",
  "waitlist.join", "waitlist.claim",
  "bookings.rescheduleByToken", "bookings.cancelByToken", "bookings.attachIntakeByToken",
  "assessments.respond",
  "referrals.recordTouch",
  "galleries.unlock", "galleries.redeemGuest", "galleries.setSelection", "galleries.clearSelection",
  "galleries.submitRound", "galleries.downloadItem", "galleries.addToCart",
  "quotes.markViewed", "quotes.chooseOptions", "quotes.accept", "quotes.decline", "quotes.message",
  "contracts.sign", "contracts.decline",
  "documents.open",
  "paywalls.evaluate",
  "rentals.reserve",
  "invoicing.viewCustomerInvoice",
  "community.joinBySlug", "community.requestJoinBySlug", "community.reportPostBySlug",
] as const;

/**
 * Public mutations the playground deliberately keeps refused, and why. The
 * reason is shown to nobody; it is here so the next reader does not "fix" a
 * refusal that is the point.
 */
export const PLAYGROUND_PUBLIC_REFUSED: Readonly<Record<string, string>> = {
  "auth.requestCustomerMagicLink": "Credential flow; the playground sends no mail, so the link could never arrive.",
  "auth.consumeCustomerMagicLink": "Credential flow.",
  "auth.requestPasswordReset": "Credential flow.",
  "auth.resetPassword": "Credential flow.",
  "auth.registerOwner": "The playground owner is a passwordless sentinel.",
  "auth.login": "Credential flow.",
  "auth.completeTwoFactorLogin": "Credential flow.",
  "auth.completeWebAuthnLogin": "Credential flow.",
  "auth.beginPasskeyLogin": "Credential flow.",
  "auth.completePasskeyLogin": "Credential flow.",
  "portal.requestSignIn": "Credential flow; the portal page explains this in the playground.",
  "invitations.accept": "Staff authority is never granted in the playground.",
  "agents.claimTask": "Agent workers authenticate with keys the playground never issues.",
  "agents.reportStep": "Agent workers authenticate with keys the playground never issues.",
  "agents.completeTask": "Agent workers authenticate with keys the playground never issues.",
  "agents.releaseTask": "Agent workers authenticate with keys the playground never issues.",
  "agents.proposeWrite": "Agent workers authenticate with keys the playground never issues.",
  "contribute.ingest": "Upstream contribution traffic is not demo content.",
  "contribute.recordStatus": "Upstream contribution traffic is not demo content.",
  "media.attachCaptureUpload": "Uploads are refused on the bounded playground disk.",
  "media.confirmCaptureApply": "Uploads are refused on the bounded playground disk.",
  "media.bindCaptureAsset": "Uploads are refused on the bounded playground disk.",
  "media.appendCaptureChunk": "Uploads are refused on the bounded playground disk.",
  "media.assembleCapture": "Uploads are refused on the bounded playground disk.",
  "media.claimProxyUpload": "Uploads are refused on the bounded playground disk.",
  "media.applyStoredOriginal": "Uploads are refused on the bounded playground disk.",
  "media.beginUploadApply": "Uploads are refused on the bounded playground disk.",
  "media.signUploadClaim": "Uploads are refused on the bounded playground disk.",
  "media.failDirectUpload": "Uploads are refused on the bounded playground disk.",
  "media.applyCaptureComplete": "Uploads are refused on the bounded playground disk.",
  "media.abortUploadClaim": "Uploads are refused on the bounded playground disk.",
  "media.abortUploadApply": "Uploads are refused on the bounded playground disk.",
  "media.claimCaptureChunk": "Uploads are refused on the bounded playground disk.",
  "media.applyCaptureChunk": "Uploads are refused on the bounded playground disk.",
  "media.claimCaptureAssembly": "Uploads are refused on the bounded playground disk.",
  "media.applyCaptureAssembly": "Uploads are refused on the bounded playground disk.",
  "media.claimCaptureOriginal": "Uploads are refused on the bounded playground disk.",
  "media.applyCaptureOriginal": "Uploads are refused on the bounded playground disk.",
  "agents.proposeWriteGate": "Agent workers authenticate with keys the playground never issues.",
  "assistant.prepareAnswer": "Phase of the model-backed answer the playground refuses.",
  "assistant.applyAnswer": "Phase of the model-backed answer the playground refuses.",
  "media.upload": "Uploads are refused on the bounded playground disk.",
  "media.beginUpload": "Uploads are refused on the bounded playground disk.",
  "media.signUploadParts": "Uploads are refused on the bounded playground disk.",
  "media.completeUpload": "Uploads are refused on the bounded playground disk.",
  "media.abortUpload": "Uploads are refused on the bounded playground disk.",
  "media.confirmCapture": "Uploads are refused on the bounded playground disk.",
  "invoicing.beginCustomerCheckout": "Payment provider I/O.",
  "invoicing.confirmCustomerPayment": "Payment provider I/O.",
  "giftRegistry.contribute": "Opens a payment for a registry item.",
  "invoicing.claimCustomerCheckout": "Payment provider I/O.",
  "invoicing.applyCustomerCheckout": "Payment provider I/O.",
  "invoicing.applyCustomerPayment": "Payment provider I/O.",
  "galleries.invitePartner": "Invites a third party by email.",
  "galleries.revokePartner": "Pairs with the refused invitation.",
  "galleries.requestArchive": "Builds a full-resolution archive on the bounded disk.",
  "galleries.downloadArchive": "Pairs with the refused archive build.",
  "quotes.invitePartner": "Invites a third party by email.",
  "quotes.revokePartner": "Pairs with the refused invitation.",
  "referrals.acceptInvitation": "Creates an account from an invitation.",
  "reports.downloadExport": "Owner exports are not public demo content.",
  "analytics.track": "C1.38: the shared demo collects no visitor analytics.",
  "analytics.identify": "C1.38: the shared demo collects no visitor analytics.",
  "analytics.recordWebVital": "C1.38: the shared demo collects no visitor analytics; the route answers 204 instead.",
  "analytics.recordExperimentImpressions": "C1.38: the shared demo collects no visitor analytics; callers already ignore the refusal.",
  "analytics.recordExperimentConversion": "C1.38: the shared demo collects no visitor analytics.",
  "assistant.answer": "Calls a model provider at the operator's expense.",
  "ads.recordClick": "Ad measurement joins visitor analytics, which the shared demo does not collect.",
  "ads.recordBeacon": "Ad measurement joins visitor analytics, which the shared demo does not collect.",
};

const PUBLIC = new Set<string>(PLAYGROUND_PUBLIC);

/**
 * Admin screens whose forms the visitor may actually save — the content
 * modules in PLAYGROUND_MANAGE. Every other screen is a read-only tour stop,
 * and the admin shell says so above the page before anybody fills in a form
 * the service layer will refuse.
 */
const EDITABLE_SCREENS = [
  "/admin/pages", "/admin/sections", "/admin/templates", "/admin/blog",
  "/admin/forms", "/admin/contacts", "/admin/products", "/admin/tasks",
];

export function playgroundScreenIsReadOnly(path: string): boolean {
  if (path === "/admin" || path === "/admin/unavailable" || !path.startsWith("/admin/")) return false;
  return !EDITABLE_SCREENS.some((screen) => path === screen || path.startsWith(`${screen}/`));
}

export function playgroundAllows(name: string, kind: "query" | "mutation"): boolean {
  if (kind === "query") return true; // Existing stored grants still authorize reads.
  return MUTATIONS.has(name) || PUBLIC.has(name);
}

/** The visitor-facing sentence for a refused playground action. */
export const PLAYGROUND_REFUSAL = "This action is unavailable in the public playground.";

/**
 * Whether an environment may deliver mail, SMS or webhooks to the outside
 * world. The disposable playground says no at the service layer as well as at
 * the container network: a background job (a reminder, a compliance reply, a
 * queued webhook) runs as `system`, which the mutation allow-list above
 * deliberately does not cover, and system work must still never make this
 * shared box somebody else's spam cannon.
 */
export function playgroundBlocksExternalDelivery(environment: {
  FREEHOLDER_PLAYGROUND?: string;
}): boolean {
  return environment.FREEHOLDER_PLAYGROUND === "1";
}

/**
 * Row bounds for the surfaces visitors may write, enforced before the
 * mutation opens its transaction. The playground database lives on a bounded
 * tmpfs and resets hourly; a cap per surface keeps one visitor's script from
 * filling it before the reset arrives. The allow-list decides *which*
 * mutations run — this decides when a surface is too full to take one more.
 *
 * Tables are named as strings rather than imported schema objects: this file
 * is imported by the service layer, and importing module schemas here would
 * close a static cycle back into core (the C8.16 lesson — a cycle whose
 * failure is a quiet `undefined` vocabulary in whichever worker hits it
 * first). The names are the drizzle table names; tests assert each cap
 * against the real table, so a rename fails loudly here, not silently.
 */
export interface PlaygroundRowCap {
  /** The physical table whose rows the capped mutation grows. */
  table: string;
  limit: number;
}

export const PLAYGROUND_ROW_CAPS: Readonly<Record<string, PlaygroundRowCap>> = {
  "cms.createPage": { table: "pages", limit: 50 },
  "cms.createFromTemplate": { table: "pages", limit: 50 },
  "cms.createSection": { table: "sections", limit: 100 },
  "cms.saveAsSection": { table: "sections", limit: 100 },
  "forms.create": { table: "forms", limit: 20 },
  "contacts.create": { table: "contacts", limit: 100 },
  "catalog.createProduct": { table: "products", limit: 50 },
  "notes.write": { table: "notes", limit: 200 },
  "tasks.create": { table: "tasks", limit: 100 },
  // The public site (PLAYGROUND_PUBLIC). Generous enough for an afternoon of
  // evaluators, small enough that a script cannot fill the tmpfs first.
  "forms.submit": { table: "form_submissions", limit: 500 },
  "newsletters.subscribe": { table: "newsletter_subscriptions", limit: 300 },
  "events.register": { table: "event_registrations", limit: 300 },
  "catalog.getOrCreateCart": { table: "carts", limit: 300 },
  "catalog.addCartItem": { table: "cart_items", limit: 1000 },
  "catalog.addWishlistItem": { table: "wishlist_items", limit: 500 },
  "catalog.subscribeBackInStock": { table: "back_in_stock_subscriptions", limit: 300 },
  "catalog.shopperCheckout": { table: "orders", limit: 200 },
  "catalog.checkoutCart": { table: "orders", limit: 200 },
  "messaging.startSiteChat": { table: "site_chat_sessions", limit: 200 },
  "messaging.postSiteChat": { table: "messages", limit: 2000 },
  "cms.submitSiteChat": { table: "site_chat_sessions", limit: 200 },
  "cms.submitQuoteRequest": { table: "conversations", limit: 500 },
  "cms.submitTipIntent": { table: "conversations", limit: 500 },
  "share.shareVia": { table: "shared_links", limit: 1000 },
  "popups.record": { table: "popup_events", limit: 2000 },
  "popups.capture": { table: "popup_events", limit: 2000 },
  "reviews.submit": { table: "reviews", limit: 200 },
  "waitlist.join": { table: "booking_waitlist", limit: 200 },
  "assessments.respond": { table: "assessment_responses", limit: 300 },
  "referrals.recordTouch": { table: "attribution_touches", limit: 2000 },
  "galleries.setSelection": { table: "gallery_selections", limit: 2000 },
  "galleries.addToCart": { table: "cart_items", limit: 1000 },
  "quotes.message": { table: "quote_messages", limit: 500 },
  "documents.open": { table: "document_access_logs", limit: 2000 },
  "rentals.reserve": { table: "bookings", limit: 300 },
  "community.joinBySlug": { table: "community_members", limit: 200 },
  "community.requestJoinBySlug": { table: "community_join_requests", limit: 200 },
};

/**
 * The shared table most public actions grow behind the per-action caps:
 * forms, subscriptions, registrations, chats and checkouts resolve their
 * visitor into a Contact as the system, which no per-action cap counts. Every
 * PLAYGROUND_PUBLIC verb checks this one too, so the spine cannot be filled
 * through whichever public surface has the most headroom left.
 */
export const PLAYGROUND_PUBLIC_CONTACT_CAP: PlaygroundRowCap = { table: "contacts", limit: 1_000 };

/**
 * Where the playground records how many rows each capped table held once the
 * sample site was installed (`markPlaygroundBaseline`). Caps count growth
 * past that point, so a larger demo seed never eats a visitor's headroom and
 * a full cap means visitors filled it, not the seed. A module_settings row
 * rather than a table of its own: it is one small document per reset.
 */
export const PLAYGROUND_BASELINE_MODULE = "playground";

/** Every table a playground cap counts. */
export function playgroundCappedTables(): string[] {
  return [...new Set([...Object.values(PLAYGROUND_ROW_CAPS), PLAYGROUND_PUBLIC_CONTACT_CAP].map((cap) => cap.table))];
}

/** Whether a mutation is one of the public site's verbs (PLAYGROUND_PUBLIC). */
export function isPlaygroundPublicVerb(name: string): boolean {
  return PUBLIC.has(name);
}

/**
 * Per-client budgets, spent before the shared ceiling so one script cannot
 * exhaust the playground for everybody else. The minute bucket covers every
 * visitor mutation (an editor's autosave and presence beat stay well inside
 * it); the hour bucket covers only the public verbs, whose row caps are what
 * a stranger could otherwise use up for the next visitor.
 */
export const PLAYGROUND_CLIENT_LIMITS = {
  perMinute: { limit: 60, windowSeconds: 60 },
  publicPerHour: { limit: 120, windowSeconds: 60 * 60 },
} as const;

/**
 * Bytes of answers one public submission may carry in the playground. A form
 * can ask for many long fields, and each submission is copied into the
 * conversation thread as well; on a shared tmpfs that copy is what fills the
 * disk long before any row cap is reached.
 */
export const PLAYGROUND_SUBMISSION_BYTES = 8_192;
