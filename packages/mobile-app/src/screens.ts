// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What the app's screens are, and what each one is allowed to ask for
// (MASTER.md §35, §35.1, C10.13).
//
// §35.1: "The app is a client, never a second implementation. Every screen
// calls the generated SDK (§28) against the instance's own API."
//
// That rule is easy to state and easy to erode one screen at a time, so it is
// written down here as data rather than left to each view. A screen declares
// the services it reads, whether it may write, and what it says when it has
// nothing to show. A view that needs something not on its screen's list has to
// change the list, in a diff somebody reviews — which is the point.
//
// Nothing here imports React or Expo. The contract is testable on its own, and
// the application that renders it (C10.23, C10.24) lives outside this package
// so that a React Native dependency graph never lands in the workspace install
// that every CI job pays for.

export const SCREEN_IDS = [
  "home",
  "catalog",
  "service",
  "product",
  "booking",
  "bookings",
  "invoices",
  "invoice",
  "galleries",
  "gallery",
  "messages",
  "newsletters",
  "account",
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

/**
 * Whether a screen may be opened by somebody who has not signed in.
 *
 * Browsing is public because a customer who has just installed the app should
 * be able to see what the business offers before being asked who they are.
 * Everything about *them* is not.
 */
export type ScreenAudience = "public" | "signed-in";

export interface ScreenContract {
  id: ScreenId;
  audience: ScreenAudience;
  /** i18n key for the screen title. Resolved against the instance's locale. */
  titleKey: string;
  /** Services this screen reads. Queries only — see `writes`. */
  reads: readonly string[];
  /**
   * Services this screen may call as a mutation, and only in response to a
   * deliberate tap.
   *
   * Empty for most screens. §35.1's offline rule means a write is never
   * queued, so a screen with no writes is a screen that works identically with
   * and without signal — which is most of them.
   */
  writes: readonly string[];
  /** Required argument, when the screen is about one thing. */
  param?: "id" | "token" | "slug";
  /** What the screen says with nothing to show. Never a blank page. */
  emptyKey: string;
  /** Whether the screen is worth keeping for offline reading (§35.1). */
  cacheable: boolean;
}

/**
 * Every screen the customer app has.
 *
 * The `reads` lists are the actual platform service names, so a typo is a
 * failing test rather than a screen that renders an error on a customer's
 * phone a week after review.
 */
export const SCREENS: Record<ScreenId, ScreenContract> = {
  home: {
    id: "home",
    audience: "public",
    titleKey: "app.home.title",
    reads: ["settings.getDesign", "portal.myRecords"],
    writes: [],
    emptyKey: "app.home.empty",
    cacheable: true,
  },
  catalog: {
    id: "catalog",
    audience: "public",
    titleKey: "app.catalog.title",
    // Services are products with a `service_offerings` row attached, so one
    // listing covers both. There is no separate "list services" call, and
    // inventing one in the app would be the second implementation §35.1 bans.
    reads: ["catalog.listVisibleProducts"],
    writes: [],
    emptyKey: "app.catalog.empty",
    cacheable: true,
  },
  service: {
    id: "service",
    audience: "public",
    titleKey: "app.service.title",
    reads: ["catalog.getServiceOffering", "catalog.bookingRequirements", "scheduling.slots"],
    writes: [],
    param: "slug",
    emptyKey: "app.service.empty",
    cacheable: true,
  },
  product: {
    id: "product",
    audience: "public",
    titleKey: "app.product.title",
    reads: ["catalog.resolveVisibleProduct"],
    writes: [],
    param: "slug",
    emptyKey: "app.product.empty",
    cacheable: true,
  },
  booking: {
    id: "booking",
    audience: "signed-in",
    titleKey: "app.booking.title",
    reads: ["bookings.byToken"],
    // Creation remains on the web; these capabilities manage an own booking.
    writes: ["bookings.rescheduleByToken", "bookings.cancelByToken"],
    param: "token",
    emptyKey: "app.booking.empty",
    cacheable: false,
  },
  bookings: {
    id: "bookings",
    audience: "signed-in",
    titleKey: "app.bookings.title",
    reads: ["portal.myProfile", "bookings.list", "bookings.myLinks"],
    writes: [],
    emptyKey: "app.bookings.empty",
    cacheable: true,
  },
  invoices: {
    id: "invoices",
    audience: "signed-in",
    titleKey: "app.invoices.title",
    reads: ["portal.myRecords"],
    writes: [],
    emptyKey: "app.invoices.empty",
    cacheable: true,
  },
  invoice: {
    id: "invoice",
    audience: "signed-in",
    titleKey: "app.invoice.title",
    reads: ["invoicing.customerInvoice", "invoicing.customerInvoiceLink"],
    // Paying is a web handoff, not an in-app purchase: §35.1 keeps the
    // business's money out of a 15–30% store cut, and the store rules permit
    // web checkout for goods consumed outside the app.
    writes: [],
    param: "id",
    emptyKey: "app.invoice.empty",
    cacheable: true,
  },
  galleries: {
    id: "galleries",
    audience: "signed-in",
    titleKey: "app.galleries.title",
    reads: ["portal.myRecords"],
    writes: [],
    emptyKey: "app.galleries.empty",
    cacheable: true,
  },
  gallery: {
    id: "gallery",
    audience: "signed-in",
    titleKey: "app.gallery.title",
    reads: ["galleries.viewSession", "galleries.viewItem"],
    // Proofing is the one thing §35 calls the killer feature, and a favourite
    // is a decision about the customer's own selection rather than about
    // availability — so it is a write the platform can accept at any time.
    writes: ["galleries.openWithLogin", "galleries.setSelection", "galleries.clearSelection", "galleries.submitRound"],
    param: "slug",
    emptyKey: "app.gallery.empty",
    cacheable: true,
  },
  messages: {
    id: "messages",
    audience: "signed-in",
    titleKey: "app.messages.title",
    reads: ["portal.myProfile", "conversations.list"],
    // C10.28 adds the customer's own reply service and thread view. Never
    // substitute conversations.reply, which sends as the business.
    writes: [],
    emptyKey: "app.messages.empty",
    cacheable: true,
  },
  newsletters: {
    id: "newsletters",
    audience: "signed-in",
    titleKey: "app.newsletters.title",
    reads: ["portal.myProfile", "newsletters.listPublic", "newsletters.listPublicIssues"],
    writes: ["newsletters.subscribe", "privacy.setMyMarketingPreference"],
    emptyKey: "app.newsletters.empty",
    cacheable: true,
  },
  account: {
    id: "account",
    audience: "signed-in",
    titleKey: "app.account.title",
    reads: ["portal.myProfile", "portal.myRecords"],
    writes: [],
    emptyKey: "app.account.empty",
    cacheable: false,
  },
};

/** The tabs a customer sees, in the order they look for them. */
export const TAB_ORDER: readonly ScreenId[] = [
  "home",
  "catalog",
  "bookings",
  "galleries",
  "account",
];

export function screensNeedingSignIn(): ScreenId[] {
  return SCREEN_IDS.filter((id) => SCREENS[id].audience === "signed-in");
}

/** Every service any screen touches, for the scope an app's key would need. */
export function servicesUsed(): string[] {
  const names = new Set<string>();
  for (const screen of Object.values(SCREENS)) {
    for (const name of screen.reads) names.add(name);
    for (const name of screen.writes) names.add(name);
  }
  return [...names].sort();
}
