// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// F04 holes that blocked journeys (C11.09): the screens exist, they are in
// the nav, and they call the services rather than inventing a second path.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { catalogKeys } from "@/core/i18n";

const NAV = "app/(admin)/admin/AdminNav.tsx";
const LAYOUT = "app/(admin)/admin/layout.tsx";
const REVIEWS_PAGE = "app/(admin)/admin/reviews/page.tsx";
const REVIEW_ACTIONS = "app/(admin)/review-actions.ts";
const CALENDAR_PAGE = "app/(admin)/admin/calendar/page.tsx";
const INBOX_PAGE = "app/(admin)/admin/inbox/page.tsx";
const CONNECTION_ACTIONS = "app/(admin)/connection-actions.ts";
const QUOTE_PAGE = "app/(admin)/admin/quotes/[id]/page.tsx";
const QUOTE_FORM = "app/(admin)/admin/quotes/[id]/ConvertQuoteForm.tsx";
const QUOTE_ACTIONS = "app/(admin)/quote-actions.ts";
const LOCALES = ["en", "es", "fr"] as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("reviews admin (C11.09 F04)", () => {
  it("is reachable from the admin nav", () => {
    expect(read(NAV)).toContain('href: "/admin/reviews"');
    expect(read(LAYOUT)).toContain('reviews: t("reviews.title")');
  });

  it("requires the reviews grant rather than any signed-in session", () => {
    expect(read(REVIEWS_PAGE)).toContain('requireStaffActor("reviews")');
  });

  it("lists, moderates, replies and requests through the real services", () => {
    const page = read(REVIEWS_PAGE);
    const actions = read(REVIEW_ACTIONS);
    expect(page).toContain("listReviews.call");
    expect(page).toContain("moderateReviewAction");
    expect(page).toContain("replyToReviewAction");
    expect(page).toContain("requestReviewAction");
    expect(actions).toContain("moderateReview.call");
    expect(actions).toContain("replyToReview.call");
    expect(actions).toContain("requestReview.call");
    expect(actions).not.toMatch(/from\("reviews"\)/);
  });

  it("has empty, error and disabled states", () => {
    const page = read(REVIEWS_PAGE);
    expect(page).toContain("reviews.empty");
    expect(page).toContain("reviews.unavailable");
    expect(page).toContain("reviews.failed");
    expect(page).toContain("reviews.readOnly");
    expect(page).toContain('disabled={review.status === next}');
    expect(page).toContain('hasModuleAccess(actor, "reviews", "manage")');
  });
});

describe("calendar and mail-read begin-OAuth (C11.09 F04)", () => {
  it("starts beginCalendarOAuth from the calendar screen, including reconnect", () => {
    const page = read(CALENDAR_PAGE);
    const actions = read(CONNECTION_ACTIONS);
    expect(page).toContain("beginCalendarOAuthAction");
    expect(page).toContain('source.status === "needs_reconnect"');
    expect(page).toContain("calendar.connect.google");
    expect(page).toContain("calendar.connect.microsoft");
    expect(actions).toContain("beginCalendarOAuth.call");
    expect(actions).toContain('returnTo: "/admin/calendar"');
  });

  it("starts beginMailReadOAuth from the inbox", () => {
    const page = read(INBOX_PAGE);
    const actions = read(CONNECTION_ACTIONS);
    expect(page).toContain("beginMailReadOAuthAction");
    expect(page).toContain("inbox.connectMail.google");
    expect(page).toContain("inbox.connectMail.microsoft");
    expect(actions).toContain("beginMailReadOAuth.call");
    expect(actions).toContain('returnTo: "/admin/inbox"');
  });
});

describe("quote convert-to-invoice (C11.09 F04)", () => {
  it("calls quotes.convert from the quote page after a confirm", () => {
    expect(read(QUOTE_PAGE)).toContain("ConvertQuoteForm");
    expect(read(QUOTE_PAGE)).toContain("quotes.convertConfirm");
    expect(read(QUOTE_FORM)).toContain("convertQuoteAction");
    expect(read(QUOTE_FORM)).toContain("window.confirm");
    expect(read(QUOTE_ACTIONS)).toContain("convertQuote.call");
  });
});

describe("guidance and notifications nav (C11.09 F04)", () => {
  it("lists the pages that already existed", () => {
    expect(read(NAV)).toContain('href: "/admin/guidance"');
    expect(read(NAV)).toContain('href: "/admin/notifications"');
    expect(read(LAYOUT)).toContain('guidance: t("guidance.allTitle")');
    expect(read(LAYOUT)).toContain('notifications: t("notifications.title")');
  });
});

describe("journey-screen catalogs", () => {
  it("covers the new copy in every locale", () => {
    for (const locale of LOCALES) {
      const keys = catalogKeys(locale);
      for (const key of [
        "reviews.title",
        "reviews.empty",
        "reviews.unavailable",
        "reviews.readOnly",
        "reviews.action.approve",
        "calendar.connect.google",
        "inbox.connectMail.title",
        "quotes.action.convert",
        "quotes.convertConfirm",
      ]) {
        expect(keys, `${locale} missing ${key}`).toContain(key);
      }
    }
  });
});
