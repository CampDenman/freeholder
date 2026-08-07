// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// First-party analytics (MASTER.md §4.7, §36).
//
// Two things are worth testing here and one of them is not a feature.
//
// The feature is the funnel: §4.7 claims it is this table joined to the money
// tables through `contact_id`, and that claim is only true if the join key
// gets filled in — including for everything the visitor did *before* anyone
// knew who they were.
//
// The other is restraint. §36 puts third-party pixels on the anti-roadmap, and
// a first-party replacement that quietly rebuilt the same surveillance would
// be worse than the thing it replaced. So what is *not* stored is asserted as
// carefully as what is.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { analyticsEvents } from "@/modules/analytics/schema";
import {
  contactActivity,
  identify,
  overview,
  referrerHost,
  topPages,
  topReferrers,
  track,
} from "@/modules/analytics/service";
import { classify, type RequestShape } from "@/modules/analytics/classify";
import { createContact, mergeContacts } from "@/core/contacts/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const visitor = (anonId: string, sessionId = `${anonId}-s1`) => ({
  anonId,
  sessionId,
});

describe("what a referrer is reduced to", () => {
  it("keeps the host and throws the rest away", () => {
    // The full referring URL is a fragment of somebody's browsing history.
    // "google.com" answers the owner's question; the query string does not.
    expect(referrerHost("https://www.google.com/search?q=wedding+photographer"))
      .toBe("google.com");
    expect(referrerHost("https://news.example/2026/08/an-article")).toBe(
      "news.example",
    );
  });

  it("says nothing rather than guessing", () => {
    expect(referrerHost(null)).toBeNull();
    expect(referrerHost("")).toBeNull();
    expect(referrerHost("not a url")).toBeNull();
  });
});

describe("telling a person from a program", () => {
  const CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

  /** What a browser actually sends when somebody clicks a link. */
  const browser = (over: Partial<RequestShape> = {}): RequestShape => ({
    userAgent: CHROME,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    acceptLanguage: "en-CA,en;q=0.9",
    secFetchMode: "navigate",
    secFetchDest: "document",
    secFetchSite: "none",
    secChUa: '"Chromium";v="126"',
    ...over,
  });

  it("counts a browser", () => {
    expect(classify(browser())).toEqual({ kind: "human", reasons: [] });
  });

  it("recognises crawlers that say so", () => {
    for (const agent of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0",
      "GPTBot/1.0",
    ]) {
      expect({ agent, kind: classify(browser({ userAgent: agent })).kind })
        .toEqual({ agent, kind: "bot" });
    }
  });

  it("catches a scraper wearing a browser's user-agent", () => {
    // The interesting case, and the one a pattern list can never catch: a
    // copied Chrome string, and none of the headers a browser sends with it.
    const verdict = classify({
      userAgent: CHROME,
      accept: "*/*",
      acceptLanguage: null,
      secFetchMode: null,
      secFetchDest: null,
      secFetchSite: null,
      secChUa: null,
    });
    expect(verdict.kind).toBe("bot");
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("treats a missing user-agent as a program", () => {
    expect(classify(browser({ userAgent: null })).kind).toBe("bot");
  });

  it("does not condemn an unusual browser on one signal alone", () => {
    // Somebody on an old Safari sends no fetch metadata. That is a person, and
    // calling them a bot is how a real visitor stops being counted — so one
    // signal is "suspected", never "bot".
    const verdict = classify(browser({ secFetchMode: null, secFetchDest: null, secFetchSite: null }));
    expect(verdict.kind).toBe("suspected");
    expect(verdict.reasons).toHaveLength(1);
  });

  it("knows a fetch() from somebody reading a page", () => {
    expect(classify(browser({ secFetchDest: "empty" })).kind).toBe("suspected");
  });
});

describe.runIf(hasDatabase)("recording and reading", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("stores an event, and stores nothing about the device", async () => {
    await track.call(
      {
        ...visitor("v1"),
        name: "page.viewed",
        path: "/services",
        referrer: "https://www.google.com/search?q=photographer+comox",
        locale: "en",
      },
      ANONYMOUS,
    );

    const [event] = await db().select().from(analyticsEvents);
    expect(event?.path).toBe("/services");
    expect(event?.referrer).toBe("google.com");

    // The whole row, so a column added later without thought fails here: there
    // must be nowhere to put an IP address, a user-agent or a fingerprint.
    // `visitorKind` and `botReasons` are the platform's *judgement* about a
    // request, not a record of the device that made it — which is the line
    // this assertion exists to hold.
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "anonId",
      "at",
      "botReasons",
      "contactId",
      "id",
      "locale",
      "name",
      "path",
      "props",
      "referrer",
      "sessionId",
      "visitorKind",
    ]);
  });

  it("lets an anonymous visitor be recorded, and nothing else", async () => {
    // The service is public because the caller is a page render. What keeps
    // that safe is that it writes one row and can reach nothing else.
    await expect(
      track.call({ ...visitor("v1"), name: "page.viewed", path: "/" }, ANONYMOUS),
    ).resolves.toEqual({ ok: true });

    expect((await failure(overview.call({ days: 30 }, ANONYMOUS))).code).toBe(
      "permission",
    );
    expect(
      (await failure(topPages.call({ days: 30, limit: 5 }, ANONYMOUS))).code,
    ).toBe("permission");
  });

  it("counts visitors rather than requests", async () => {
    // Three views from one browser is one visitor. A dashboard that says
    // three is a dashboard that flatters its owner.
    for (const path of ["/", "/services", "/contact"]) {
      await track.call({ ...visitor("v1"), name: "page.viewed", path }, ANONYMOUS);
    }
    await track.call({ ...visitor("v2"), name: "page.viewed", path: "/" }, ANONYMOUS);

    const totals = await overview.call({ days: 30 }, STAFF);
    expect(totals.views).toBe(4);
    expect(totals.visitors).toBe(2);
  });

  it("ranks pages and referrers", async () => {
    await track.call({ ...visitor("v1"), name: "page.viewed", path: "/services" }, ANONYMOUS);
    await track.call({ ...visitor("v2"), name: "page.viewed", path: "/services" }, ANONYMOUS);
    await track.call(
      {
        ...visitor("v3"),
        name: "page.viewed",
        path: "/",
        referrer: "https://news.example/piece",
      },
      ANONYMOUS,
    );

    const pages = await topPages.call({ days: 30, limit: 5 }, STAFF);
    expect(pages[0]).toMatchObject({ path: "/services", views: 2, visitors: 2 });

    const referrers = await topReferrers.call({ days: 30, limit: 5 }, STAFF);
    expect(referrers).toEqual([{ referrer: "news.example", visitors: 1 }]);
  });
});

describe.runIf(hasDatabase)("counting people, or counting everything", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  const traffic = async () => {
    await track.call(
      { ...visitor("person"), name: "page.viewed", path: "/services" },
      ANONYMOUS,
    );
    await track.call(
      {
        ...visitor("crawler"),
        name: "page.viewed",
        path: "/services",
        visitorKind: "bot",
        botReasons: ["identified itself as a crawler or tool"],
      },
      ANONYMOUS,
    );
    await track.call(
      {
        ...visitor("maybe"),
        name: "page.viewed",
        path: "/services",
        visitorKind: "suspected",
        botReasons: ["sent none of the headers a browser sends when navigating"],
      },
      ANONYMOUS,
    );
  };

  it("answers with people by default", async () => {
    // The number an owner means when they ask how many visitors they had.
    await traffic();
    const totals = await overview.call({ days: 30 }, STAFF);
    expect(totals.views).toBe(1);
    expect(totals.visitors).toBe(1);
  });

  it("says how much it left out, whichever way it was asked", async () => {
    // An owner deciding whether to trust the other numbers needs to know how
    // much was excluded — so this one is never filtered.
    await traffic();
    expect((await overview.call({ days: 30 }, STAFF)).automated).toBe(2);
    expect(
      (await overview.call({ days: 30, includeBots: true }, STAFF)).automated,
    ).toBe(2);
  });

  it("counts everything when the owner asks for it", async () => {
    await traffic();
    const totals = await overview.call({ days: 30, includeBots: true }, STAFF);
    expect(totals.views).toBe(3);
    expect(totals.visitors).toBe(3);
  });

  it("applies the same choice to every report, not just the headline", async () => {
    // A dashboard whose summary excludes crawlers and whose page list does not
    // is a dashboard that contradicts itself.
    await traffic();
    expect((await topPages.call({ days: 30, limit: 5 }, STAFF))[0]?.views).toBe(1);
    expect(
      (await topPages.call({ days: 30, limit: 5, includeBots: true }, STAFF))[0]
        ?.views,
    ).toBe(3);
  });

  it("keeps the reason it made the call", async () => {
    await traffic();
    const rows = await db().select().from(analyticsEvents);
    const crawler = rows.find((row) => row.anonId === "crawler");
    expect(crawler?.visitorKind).toBe("bot");
    expect(crawler?.botReasons[0]).toContain("crawler");
  });
});

describe.runIf(hasDatabase)("the funnel", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  it("claims a visitor's whole history the moment they identify themselves", async () => {
    // The point of the feature. Without the backfill, a contact's first
    // recorded moment is the form they submitted rather than the three pages
    // they read first — and "which page brings me enquiries" is unanswerable.
    for (const path of ["/", "/services", "/services/weddings"]) {
      await track.call({ ...visitor("v1"), name: "page.viewed", path }, ANONYMOUS);
    }
    const contact = await createContact.call(
      { name: "Ada", email: "ada@example.test" },
      STAFF,
    );

    const result = await identify.call(
      { anonId: "v1", contactId: contact.id },
      ANONYMOUS,
    );
    expect(result.linked).toBe(3);

    const activity = await contactActivity.call(
      { contactId: contact.id, limit: 10 },
      STAFF,
    );
    expect(activity.map((row) => row.path)).toContain("/services/weddings");
  });

  it("does not claim anybody else's history", async () => {
    await track.call({ ...visitor("v1"), name: "page.viewed", path: "/" }, ANONYMOUS);
    await track.call({ ...visitor("v2"), name: "page.viewed", path: "/" }, ANONYMOUS);
    const contact = await createContact.call({ name: "Ada" }, STAFF);

    expect(
      (await identify.call({ anonId: "v1", contactId: contact.id }, ANONYMOUS))
        .linked,
    ).toBe(1);
  });

  it("leaves an already-identified event with the contact it belongs to", async () => {
    // Two people on one browser — a shared laptop, a family. The second
    // person's identification must not rewrite the first person's history.
    const first = await createContact.call({ name: "Ada" }, STAFF);
    const second = await createContact.call({ name: "Grace" }, STAFF);

    await track.call(
      { ...visitor("shared"), name: "page.viewed", path: "/", contactId: first.id },
      ANONYMOUS,
    );
    await track.call({ ...visitor("shared"), name: "page.viewed", path: "/contact" }, ANONYMOUS);

    await identify.call({ anonId: "shared", contactId: second.id }, ANONYMOUS);

    const rows = await db().select().from(analyticsEvents);
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r.contactId]));
    expect(byPath["/"]).toBe(first.id);
    expect(byPath["/contact"]).toBe(second.id);
  });

  it("brings a visitor's history along when two contacts are merged", async () => {
    const survivor = await createContact.call(
      { name: "Ada", email: "ada@example.test" },
      STAFF,
    );
    const duplicate = await createContact.call(
      { name: "A Lovelace", email: "a.lovelace@example.test" },
      STAFF,
    );
    await track.call(
      { ...visitor("v1"), name: "page.viewed", path: "/", contactId: duplicate.id },
      ANONYMOUS,
    );

    await mergeContacts.call(
      { survivingId: survivor.id, duplicateId: duplicate.id },
      OWNER,
    );

    const [event] = await db().select().from(analyticsEvents);
    expect(event?.contactId).toBe(survivor.id);
    expect(await db().select().from(contacts)).toHaveLength(1);
  });
});
