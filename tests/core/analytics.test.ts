// Copyright (C) 2026 Camp Denman Society
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
import { looksAutomated } from "@/modules/analytics/visitor";
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

describe("who is not counted", () => {
  it("recognises the obvious crawlers", () => {
    for (const agent of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "Mozilla/5.0 HeadlessChrome/120",
    ]) {
      expect({ agent, bot: looksAutomated(agent) }).toEqual({ agent, bot: true });
    }
  });

  it("counts a browser", () => {
    expect(
      looksAutomated(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      ),
    ).toBe(false);
  });

  it("treats a missing user-agent as automated", () => {
    // Every real browser sends one. Something that does not is a script.
    expect(looksAutomated(null)).toBe(true);
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
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "anonId",
      "at",
      "contactId",
      "id",
      "locale",
      "name",
      "path",
      "props",
      "referrer",
      "sessionId",
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
