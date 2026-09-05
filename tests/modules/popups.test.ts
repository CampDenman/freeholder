// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Popups, announcement surfaces and exit intent (MASTER.md §36, C9.30).
//
// Four groups, and the split is deliberate.
//
// The rules are pure, so they are tested without a database: a cap somebody
// disputes ("it kept appearing") has to be answerable with a case, not with a
// query nobody can reason about.
//
// The tally is the visitor's own copy of that cap, and it comes back from a
// browser — so its parser is tested against the things a browser sends when
// somebody edits a cookie.
//
// The accessibility group audits the real markup with axe rather than
// asserting that a class name is present. A modal whose close control loses
// its accessible name is the failure this whole surface has to not have.
//
// The database group proves the parts that only exist end to end: the cap
// actually capping, a segment actually excluding somebody, and capture writing
// consent evidence through the platform's own consent path.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { saveSegment } from "@/core/segments/service";
import { canContact } from "@/core/privacy/service";
import { consentRecords } from "@/core/privacy/schema";
import {
  confirmSubscription,
  createNewsletter,
} from "@/modules/newsletters/service";
import { newsletterSubscriptions } from "@/modules/newsletters/schema";
import { popupEvents } from "@/modules/popups/schema";
import { localPopupPath, popupAdminReturnTo } from "@/modules/popups/http";
import {
  capturePopup,
  decidePopup,
  getPopup,
  listPopups,
  popupPerformance,
  recordPopupEvent,
  removePopup,
  savePopup,
  savePopupBlocks,
  setPopupStatus,
} from "@/modules/popups/service";
import {
  eligibleForEveryHistory,
  matchesLocale,
  matchesPaths,
  NO_HISTORY,
  pathMatches,
  suppressedAfterCapture,
  suppressedAfterDismissal,
  withinFlight,
  withinFrequencyCap,
  type PopupHistory,
} from "@/modules/popups/targeting";
import {
  entryFor,
  parseTally,
  POPUP_TALLY_LIMIT,
  recordDismissedInTally,
  recordShownInTally,
  serializeTally,
} from "@/modules/popups/tally";
import { PopupChrome } from "@/modules/popups/PopupSurface";
import { auditHtml } from "../../scripts/a11y-smoke.mjs";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const NOW = new Date("2026-09-01T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

const RULES = {
  pathPatterns: [] as string[],
  locales: [] as string[],
  startsAt: null as Date | null,
  endsAt: null as Date | null,
  frequencyCap: 2,
  frequencyPeriodHours: 168,
  dismissSuppressHours: 720,
  stopAfterCapture: true,
};
const HERE = { path: "/", locale: "en" };

/* ------------------------------------------------------------ the rules */

describe("who a popup may interrupt", () => {
  it("matches paths with one star inside a segment and two across them", () => {
    expect(pathMatches("/", "/")).toBe(true);
    expect(pathMatches("/shop/*", "/shop/mugs")).toBe(true);
    expect(pathMatches("/shop/*", "/shop/mugs/blue")).toBe(false);
    expect(pathMatches("/shop/**", "/shop/mugs/blue")).toBe(true);
    // A pattern an owner typed is never compiled as a regular expression, so
    // the characters that would make one dangerous are literal here.
    expect(pathMatches("/a.b", "/axb")).toBe(false);
    expect(pathMatches("/sale today", "/sale today")).toBe(true);
    expect(pathMatches("/sale today", "/sale-anything-today")).toBe(false);
  });

  it("keeps public evidence paths and admin returns on this site", () => {
    const origin = "https://example.test";
    expect(localPopupPath("/offers?from=popup", origin)).toBe("/offers?from=popup");
    expect(localPopupPath("//elsewhere.test/path", origin)).toBeNull();
    expect(localPopupPath("/\\elsewhere.test/path", origin)).toBeNull();
    expect(localPopupPath("https://elsewhere.test/path", origin)).toBeNull();

    const id = "11111111-1111-4111-8111-111111111111";
    expect(popupAdminReturnTo(`/admin/popups/${id}`)).toBe(`/admin/popups/${id}`);
    expect(popupAdminReturnTo("//elsewhere.test")).toBe("/admin/popups");
    expect(popupAdminReturnTo("/admin/popups/../../settings")).toBe("/admin/popups");
  });

  it("treats an empty list as everywhere rather than nowhere", () => {
    // The opposite reading turns a half-filled form into a popup that
    // silently never appears, with no error anywhere to explain it.
    expect(matchesPaths([], "/anything")).toBe(true);
    expect(matchesPaths(["/shop/**"], "/about")).toBe(false);
    expect(matchesLocale([], "fr")).toBe(true);
    expect(matchesLocale(["en"], "fr")).toBe(false);
  });

  it("respects the scheduled window at both ends", () => {
    expect(withinFlight(hoursAgo(1), null, NOW)).toBe(true);
    expect(withinFlight(hoursAgo(-1), null, NOW)).toBe(false);
    expect(withinFlight(null, hoursAgo(1), NOW)).toBe(false);
    expect(withinFlight(null, null, NOW)).toBe(true);
  });

  it("caps by count inside the window, and starts a fresh window after it", () => {
    const seen = (n: number, startedHoursAgo: number): PopupHistory => ({
      ...NO_HISTORY,
      seen: n,
      windowStartedAt: hoursAgo(startedHoursAgo),
    });
    expect(withinFrequencyCap(2, 168, seen(1, 1), NOW)).toBe(true);
    expect(withinFrequencyCap(2, 168, seen(2, 1), NOW)).toBe(false);
    // Three impressions last month do not spend this month's allowance. The
    // other reading turns "twice a week" into "twice, ever".
    expect(withinFrequencyCap(2, 168, seen(9, 400), NOW)).toBe(true);
    expect(withinFrequencyCap(null, 168, seen(99, 1), NOW)).toBe(true);
  });

  it("treats closing it as an answer that stands for a while", () => {
    expect(suppressedAfterDismissal(hoursAgo(1), 720, NOW)).toBe(true);
    expect(suppressedAfterDismissal(hoursAgo(800), 720, NOW)).toBe(false);
    expect(suppressedAfterDismissal(hoursAgo(1), 0, NOW)).toBe(false);
    expect(suppressedAfterDismissal(null, 720, NOW)).toBe(false);
  });

  it("stops asking a subscriber to subscribe", () => {
    expect(suppressedAfterCapture(hoursAgo(500), true)).toBe(true);
    expect(suppressedAfterCapture(hoursAgo(500), false)).toBe(false);
    expect(suppressedAfterCapture(null, true)).toBe(false);
  });

  it("lets every record of the visitor veto, each against its own window", () => {
    const server: PopupHistory = { ...NO_HISTORY, seen: 2, windowStartedAt: hoursAgo(1) };
    const browser: PopupHistory = { ...NO_HISTORY, seen: 0, windowStartedAt: hoursAgo(1) };
    // The browser's copy says there is room; the server's says there is not.
    // Merging the two into one history would pair the larger count with the
    // more recent window and get this wrong in both directions.
    expect(eligibleForEveryHistory(RULES, HERE, [browser], NOW)).toBe(true);
    expect(eligibleForEveryHistory(RULES, HERE, [server, browser], NOW)).toBe(false);
    // And an expired window in one store does not spend the other's.
    const stale: PopupHistory = { ...NO_HISTORY, seen: 9, windowStartedAt: hoursAgo(400) };
    expect(eligibleForEveryHistory(RULES, HERE, [stale, browser], NOW)).toBe(true);
  });

  it("allows a visitor nothing is known about", () => {
    expect(eligibleForEveryHistory(RULES, HERE, [], NOW)).toBe(true);
  });
});

/* ------------------------------------------- the visitor's own cap tally */

describe("the cap a browser carries", () => {
  it("survives a round trip", () => {
    const tally = recordShownInTally([], "11111111-1111-4111-8111-111111111111", 168, NOW);
    const back = parseTally(serializeTally(tally));
    expect(back[0]?.seen).toBe(1);
    expect(back[0]?.windowStartedAt.getTime()).toBe(
      Math.floor(NOW.getTime() / 60_000) * 60_000,
    );
    expect(back[0]?.dismissedAt).toBeNull();
  });

  it("counts up inside the window and starts again after it", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const once = recordShownInTally([], id, 168, hoursAgo(1));
    const twice = recordShownInTally(once, id, 168, NOW);
    expect(entryFor(twice, id)?.seen).toBe(2);
    const later = recordShownInTally(twice, id, 168, new Date(NOW.getTime() + 200 * 3_600_000));
    expect(entryFor(later, id)?.seen).toBe(1);
  });

  it("records a dismissal without losing the count", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const shown = recordShownInTally([], id, 168, NOW);
    const closed = recordDismissedInTally(shown, id, NOW);
    expect(entryFor(closed, id)?.seen).toBe(1);
    expect(entryFor(closed, id)?.dismissedAt).not.toBeNull();
  });

  it("drops anything a browser sends that is not an entry", () => {
    // This value comes back from a visitor who is free to edit it, so every
    // failure has to be "fewer entries", never a throw on a page render.
    expect(parseTally(undefined)).toEqual([]);
    expect(parseTally("")).toEqual([]);
    expect(parseTally("nonsense")).toEqual([]);
    expect(parseTally("44444444-4444-4444-4444-444444444444.notanumber.1")).toEqual([]);
    expect(parseTally("44444444-4444-4444-4444-444444444444.1")).toEqual([]);
    expect(parseTally("44444444-4444-4444-4444-444444444444.1.29000000")).toHaveLength(1);
  });

  it("stays small enough to send on every request", () => {
    let tally = serializeTally([]);
    for (let i = 0; i < POPUP_TALLY_LIMIT + 4; i += 1) {
      const id = `5555555${i % 10}-5555-4555-8555-55555555555${i % 10}`;
      tally = serializeTally(recordShownInTally(parseTally(tally), id, 168, NOW));
    }
    expect(parseTally(tally).length).toBeLessThanOrEqual(POPUP_TALLY_LIMIT);
    expect(tally.length).toBeLessThan(1024);
  });
});

/* --------------------------------------------------------- accessibility */
//
// What a popup's *tree* may contain lives with the analyzer that decides it,
// in tests/core/cms-a11y.test.ts, so it runs in the cheap contract gate. What
// follows is the other half: the markup those rules protect.

describe("the markup a visitor meets", () => {
  const render = (surface: "modal" | "banner" | "corner") =>
    renderToStaticMarkup(
      createElement(PopupChrome, {
        id: "abc",
        title: "Join the list",
        surface,
        dismissLabel: "Close",
        // In the props rather than as a third argument: `children` is required
        // on this component, and only the props-object overload of
        // `createElement` proves it was supplied.
        children: createElement("p", null, "One email a month."),
      }),
    );

  const page = (body: string) =>
    `<!doctype html><html lang="en"><head><title>A page</title>
     <meta name="viewport" content="width=device-width, initial-scale=1"></head>
     <body><main><h1>Services</h1></main>${body}</body></html>`;

  /**
   * A `<dialog>` as the browser exposes it once `showModal()` has run.
   *
   * The substitution is not cosmetic and it is not a shortcut. Found while
   * writing this: axe inside jsdom reports **every** rule as *undecided* when
   * an open `<dialog>` is present — nothing outside it is checked because the
   * rest of the document is inert, and nothing inside it is checked either.
   * A test asserting "no violations" against that markup would have passed
   * forever while checking nothing, which is the exact failure mode
   * `tests/core/a11y-smoke.test.ts` exists to warn about.
   *
   * `role="dialog"` with `aria-modal` is what a native modal dialog *is* in
   * the accessibility tree, so auditing that audits the same attributes and
   * the same content, and every rule reaches a verdict. The positive control
   * below is what proves it.
   */
  const asOpenedModal = (markup: string) =>
    markup
      .replace("<dialog", '<div role="dialog" aria-modal="true"')
      .replace("</dialog>", "</div>");

  it("passes axe as a banner", async () => {
    const result = await auditHtml(page(render("banner")), "https://example.test/");
    expect(result.violations).toEqual([]);
  });

  it("passes axe as a modal, in the role the browser gives it", async () => {
    const result = await auditHtml(
      page(asOpenedModal(render("modal"))),
      "https://example.test/",
    );
    expect(result.violations).toEqual([]);
  });

  it("is audited by an audit that can actually fail", async () => {
    // The positive control. Take the accessible name off the close button and
    // the same audit must report it — otherwise the two assertions above are
    // silence rather than evidence.
    const broken = asOpenedModal(render("modal")).replace(' aria-label="Close"', "");
    const result = await auditHtml(page(broken), "https://example.test/");
    expect(result.violations.map((violation) => violation.id)).toContain("button-name");
  });

  it("puts a named, keyboard-reachable close control first inside the dialog", () => {
    const dom = new JSDOM(page(render("modal").replace("<dialog", "<dialog open")));
    const dialog = dom.window.document.querySelector("dialog")!;

    // Named: the dialog itself, so a screen reader announces what opened
    // rather than the word "dialog".
    const labelledBy = dialog.getAttribute("aria-labelledby")!;
    expect(dom.window.document.getElementById(labelledBy)?.textContent).toBe(
      "Join the list",
    );

    // Reachable: a real <button>, so it is in the tab order without a
    // tabindex, and it is the first focusable thing `showModal()` will land
    // on. Nothing anywhere in the tree fights the natural order.
    const focusable = [
      ...dialog.querySelectorAll("a[href], button, input, select, textarea, [tabindex]"),
    ];
    expect(focusable[0]?.tagName).toBe("BUTTON");
    expect(focusable[0]?.getAttribute("type")).toBe("button");
    expect(focusable[0]?.getAttribute("aria-label")).toBe("Close");
    expect(
      [...dialog.querySelectorAll("[tabindex]")].filter(
        (node) => Number(node.getAttribute("tabindex")) > 0,
      ),
    ).toEqual([]);

    // Escape is the browser's, not ours: a native modal dialog closes on it,
    // which is exactly why this surface is one rather than a labelled div.
    expect(dialog.tagName).toBe("DIALOG");
    dom.window.close();
  });

  it("does not make a banner or a corner card modal", () => {
    // A non-modal surface must not take focus or trap it. It is a labelled
    // region with a close button, and that is all it should be.
    for (const surface of ["banner", "corner"] as const) {
      const markup = render(surface);
      expect(markup).not.toContain("<dialog");
      expect(markup).toContain("aria-labelledby");
      expect(markup).not.toContain("aria-modal");
    }
  });
});

/* ------------------------------------------------------- against Postgres */

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

const HEADING = [
  { id: "h", type: "heading", props: { text: "Join the list", level: 2, align: "start" } },
];

describe.runIf(hasDatabase)("popups against the spine", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    await updateBusiness.call(BUSINESS, OWNER);
    // Truncating covers every installed module's tables, and that set grows
    // with the platform. The default hook timeout stopped being enough some
    // modules ago.
  }, 60_000);

  afterAll(closeDb);

  async function livePopup(overrides: Record<string, unknown> = {}) {
    const created = await savePopup.call(
      {
        slug: "spring-offer",
        name: "Spring offer",
        title: "Join the list",
        surface: "modal",
        trigger: "delay",
        triggerValue: 5,
        frequencyCap: 2,
        frequencyPeriodHours: 168,
        ...overrides,
      },
      OWNER,
    );
    await savePopupBlocks.call({ id: created.id, blocks: HEADING }, OWNER);
    await setPopupStatus.call({ id: created.id, status: "active" }, OWNER);
    return created;
  }

  it("will not go live carrying an accessibility error", async () => {
    const created = await savePopup.call(
      { slug: "bad", name: "Bad", title: "Bad" },
      OWNER,
    );
    await savePopupBlocks.call(
      {
        id: created.id,
        blocks: [{ id: "h", type: "heading", props: { text: "No", level: 1, align: "start" } }],
      },
      OWNER,
    );
    const refused = await failure(
      setPopupStatus.call({ id: created.id, status: "active" }, OWNER),
    );
    expect(refused.code).toBe("validation");
    expect(refused.message).toContain("already has its H1");
    expect((await getPopup.call({ id: created.id }, OWNER)).status).toBe("draft");
  });

  it("refuses a capture popup with no words to show beside the box", async () => {
    const refused = await failure(
      savePopup.call(
        { slug: "no-words", name: "No words", title: "Join", captureMode: "email" },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
  });

  it("requires address ownership to be proved through a newsletter confirmation", async () => {
    const refused = await failure(
      savePopup.call(
        {
          slug: "no-confirmation",
          name: "No confirmation",
          title: "Join",
          captureMode: "email",
          consentStatement: "Send me studio news.",
        },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    expect(refused.message).toContain("newsletter");
  });

  it("shows a live popup and tells the visitor nothing about its targeting", async () => {
    const popup = await livePopup();
    const decided = await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS);
    expect(decided?.id).toBe(popup.id);
    expect(decided?.title).toBe("Join the list");
    // The public projection is a disclosure decision, not a convenience.
    expect(decided).not.toHaveProperty("frequencyCap");
    expect(decided).not.toHaveProperty("segmentId");
    expect(decided).not.toHaveProperty("audience");
    expect(decided).not.toHaveProperty("slug");
  });

  it("does not show a draft, a paused one, or one off its path", async () => {
    const popup = await livePopup({ pathPatterns: ["/shop/**"] });
    expect(await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS)).toBeNull();
    expect(
      (await decidePopup.call({ path: "/shop/mugs", locale: "en" }, ANONYMOUS))?.id,
    ).toBe(popup.id);
    await setPopupStatus.call({ id: popup.id, status: "paused" }, OWNER);
    expect(
      await decidePopup.call({ path: "/shop/mugs", locale: "en" }, ANONYMOUS),
    ).toBeNull();
  });

  it("does not record a shown event after a popup stops running", async () => {
    const popup = await livePopup();
    await setPopupStatus.call({ id: popup.id, status: "paused" }, OWNER);
    const refused = await failure(
      recordPopupEvent.call({ popupId: popup.id, kind: "shown" }, ANONYMOUS),
    );
    expect(refused.code).toBe("not_found");
    expect(
      await db().select().from(popupEvents).where(eq(popupEvents.popupId, popup.id)),
    ).toEqual([]);
  });

  it("caps a visitor the server can identify, and the cap survives the tab closing", async () => {
    const popup = await livePopup({ frequencyCap: 2 });
    const visitorKey = "visitor-1";
    const here = { path: "/", locale: "en", visitorKey };

    expect((await decidePopup.call(here, ANONYMOUS))?.id).toBe(popup.id);
    await recordPopupEvent.call(
      { popupId: popup.id, kind: "shown", visitorKey },
      ANONYMOUS,
    );
    // One impression spent, one left: a new request with no browser state at
    // all — the tab was closed and the tally cookie is gone — still counts it.
    expect((await decidePopup.call(here, ANONYMOUS))?.id).toBe(popup.id);
    await recordPopupEvent.call(
      { popupId: popup.id, kind: "shown", visitorKey },
      ANONYMOUS,
    );
    expect(await decidePopup.call(here, ANONYMOUS)).toBeNull();

    // And somebody else is unaffected, because the cap is per visitor.
    expect(
      (await decidePopup.call({ path: "/", locale: "en", visitorKey: "visitor-2" }, ANONYMOUS))
        ?.id,
    ).toBe(popup.id);
  });

  it("counts impressions over a rolling window, not since the first one ever", async () => {
    // The bug this exists for: taking the earliest impression as the start of
    // the window means one view a year ago opens a window that has long
    // expired, and every view since rides free inside it.
    const popup = await livePopup({ frequencyCap: 2, frequencyPeriodHours: 24 });
    const visitorKey = "long-memory";
    await db()
      .insert(popupEvents)
      .values([
        { popupId: popup.id, visitorKey, kind: "shown", occurredAt: new Date(Date.now() - 400 * 3_600_000) },
        { popupId: popup.id, visitorKey, kind: "shown", occurredAt: new Date(Date.now() - 2 * 3_600_000) },
        { popupId: popup.id, visitorKey, kind: "shown", occurredAt: new Date(Date.now() - 1 * 3_600_000) },
      ]);
    expect(
      await decidePopup.call({ path: "/", locale: "en", visitorKey }, ANONYMOUS),
    ).toBeNull();

    // Only the ancient one, and the allowance is untouched.
    await db().delete(popupEvents).where(eq(popupEvents.popupId, popup.id));
    await db()
      .insert(popupEvents)
      .values({
        popupId: popup.id,
        visitorKey,
        kind: "shown",
        occurredAt: new Date(Date.now() - 400 * 3_600_000),
      });
    expect(
      (await decidePopup.call({ path: "/", locale: "en", visitorKey }, ANONYMOUS))?.id,
    ).toBe(popup.id);
  });

  it("caps a visitor the server cannot identify, using their own tally", async () => {
    // Nobody has an analytics identifier here, which is the ordinary case on
    // an opt-in site. The count lives in the cookie the endpoint hands back.
    const popup = await livePopup({ frequencyCap: 1 });
    expect(
      (await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS))?.id,
    ).toBe(popup.id);

    const first = await recordPopupEvent.call(
      { popupId: popup.id, kind: "shown" },
      ANONYMOUS,
    );
    expect(first.tally.length).toBeGreaterThan(0);
    expect(
      await decidePopup.call({ path: "/", locale: "en", tally: first.tally }, ANONYMOUS),
    ).toBeNull();
    // The ledger row exists either way, so the owner's numbers are complete
    // even for the visitors it cannot name.
    const rows = await db()
      .select()
      .from(popupEvents)
      .where(and(eq(popupEvents.popupId, popup.id), eq(popupEvents.kind, "shown")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.visitorKey).toBeNull();
  });

  it("stops asking somebody who has closed it", async () => {
    const popup = await livePopup({ frequencyCap: null, dismissSuppressHours: 720 });
    const closed = await recordPopupEvent.call(
      { popupId: popup.id, kind: "dismissed" },
      ANONYMOUS,
    );
    expect(
      await decidePopup.call({ path: "/", locale: "en", tally: closed.tally }, ANONYMOUS),
    ).toBeNull();
  });

  it("excludes somebody a segment excludes, and includes somebody it includes", async () => {
    const segment = await saveSegment.call(
      {
        name: "Canadians",
        definition: { match: "all", rules: [{ field: "contact.country", op: "is", value: "CA" }] },
      },
      OWNER,
    );
    const popup = await livePopup({ audience: "inSegment", segmentId: segment.id });

    // A signed-in customer whose contact is in the segment.
    const inside = await customerActor("inside@example.test", "CA");
    expect((await decidePopup.call({ path: "/", locale: "en" }, inside))?.id).toBe(popup.id);

    // The same popup, the same page, somebody the segment does not name.
    const outside = await customerActor("outside@example.test", "FR");
    expect(await decidePopup.call({ path: "/", locale: "en" }, outside)).toBeNull();

    // And an anonymous visitor, who belongs to no list of contacts at all.
    expect(await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS)).toBeNull();

    // Inverted, the same segment reaches exactly the other two.
    await savePopup.call(
      {
        id: popup.id,
        slug: "spring-offer",
        name: "Spring offer",
        title: "Join the list",
        audience: "notInSegment",
        segmentId: segment.id,
        frequencyCap: 2,
      },
      OWNER,
    );
    expect(await decidePopup.call({ path: "/", locale: "en" }, inside)).toBeNull();
    expect((await decidePopup.call({ path: "/", locale: "en" }, outside))?.id).toBe(popup.id);
    expect((await decidePopup.call({ path: "/", locale: "en" }, ANONYMOUS))?.id).toBe(popup.id);
  });

  it("takes an address only with consent, and writes the evidence on the spine", async () => {
    const newsletter = await createNewsletter.call(
      { name: "Studio notes", slug: "studio-notes" },
      OWNER,
    );
    const popup = await livePopup({
      captureMode: "email",
      newsletterId: newsletter.id,
      consentStatement: "One email a month about new work. Unsubscribe any time.",
      consentVersion: "2026-09",
    });

    const refused = await failure(
      capturePopup.call(
        { popupId: popup.id, email: "reader@example.test", consent: false },
        ANONYMOUS,
      ),
    );
    expect(refused.code).toBe("validation");
    expect(
      await db().select().from(contacts).where(eq(contacts.email, "reader@example.test")),
    ).toEqual([]);

    const taken = await capturePopup.call(
      { popupId: popup.id, email: "reader@example.test", consent: true, path: "/" },
      { kind: "anonymous", request: { ip: "203.0.113.9" } },
    );
    expect(taken.ok).toBe(true);
    expect(taken.pending).toBe(true);
    expect(taken.message).toBeNull();

    // One contact, resolved rather than created, on the same spine as
    // everything else (§4.1).
    const [contact] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "reader@example.test"));
    expect(contact?.source).toBe("popup:spring-offer");

    // The tick box starts double opt-in; it does not let somebody grant
    // marketing consent for an address they have not proved they control.
    const beforeConfirmation = await canContact.call(
      { contactId: contact!.id, purpose: "marketing", channel: "email" },
      OWNER,
    );
    expect(beforeConfirmation.allowed).toBe(false);
    const [subscription] = await db()
      .select()
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.contactId, contact!.id));
    await confirmSubscription.call({ token: subscription!.confirmToken }, ANONYMOUS);

    const allowed = await canContact.call(
      { contactId: contact!.id, purpose: "marketing", channel: "email" },
      OWNER,
    );
    expect(allowed.allowed).toBe(true);
    const [evidence] = await db()
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, contact!.id));
    expect(evidence).toMatchObject({
      termsVersion: "2026-09",
      sourceUrl: "/",
      ip: "203.0.113.9",
      evidence: {
        popup: "spring-offer",
        statement: "One email a month about new work. Unsubscribe any time.",
      },
    });

    // Not asked again, because they have already answered.
    expect(
      await decidePopup.call({ path: "/", locale: "en", tally: taken.tally }, ANONYMOUS),
    ).toBeNull();
  });

  it("counts what happened, for the owner to read", async () => {
    const popup = await livePopup({ frequencyCap: null });
    await recordPopupEvent.call({ popupId: popup.id, kind: "shown" }, ANONYMOUS);
    await recordPopupEvent.call({ popupId: popup.id, kind: "shown" }, ANONYMOUS);
    await recordPopupEvent.call({ popupId: popup.id, kind: "dismissed" }, ANONYMOUS);

    const [counts] = await popupPerformance.call({ sinceDays: 30 }, OWNER);
    expect(counts).toMatchObject({ popupId: popup.id, shown: 2, dismissed: 1, captured: 0 });
  });

  it("keeps slugs unique and cleans up after itself", async () => {
    const popup = await livePopup();
    const clash = await failure(
      savePopup.call(
        { slug: "spring-offer", name: "Another", title: "Another" },
        OWNER,
      ),
    );
    expect(clash.code).toBe("conflict");

    await recordPopupEvent.call({ popupId: popup.id, kind: "shown" }, ANONYMOUS);
    const unconfirmed = await failure(
      removePopup.call({ id: popup.id, confirm: false }, OWNER),
    );
    expect(unconfirmed.code).toBe("validation");
    await removePopup.call({ id: popup.id, confirm: true }, OWNER);
    expect(await listPopups.call({}, OWNER)).toEqual([]);
    expect(
      await db().select().from(popupEvents).where(eq(popupEvents.popupId, popup.id)),
    ).toEqual([]);
  });
});

/**
 * A signed-in customer, as an actor.
 *
 * `decide` derives the contact from whoever is calling rather than accepting a
 * contact id, so a test that wants to be somebody has to actually be them —
 * which is the property being relied on.
 */
async function customerActor(email: string, country: string) {
  const userId = crypto.randomUUID();
  await db().insert(users).values({ id: userId, email, role: "customer" });
  await db().insert(contacts).values({ userId, name: email, email, country });
  return {
    kind: "user" as const,
    userId,
    role: "customer",
    grants: [] as { module: string; access: "view" | "manage" }[],
  };
}
