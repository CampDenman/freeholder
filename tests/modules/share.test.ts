// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sharing in the DNA (MASTER.md §34, C9.28).
//
// Three of these tests are the ones worth reading first, because each of them
// is a promise the feature would otherwise only appear to keep.
//
//   - A stored path that is not ours cannot redirect anybody. The row is
//     inserted straight into the database, past every validator, because the
//     check that matters is the one standing between a stranger's request and
//     the browser — not the one that was supposed to stop the row existing.
//   - An entity whose sharing is switched off stops the links that are already
//     out in the world, not merely the buttons. A control that only hid
//     buttons would be a setting an owner believed and the platform ignored.
//   - A tracked link's numbers come from analytics. The test drives a visit
//     through `analytics.track` and reads it back through `share.linkReport`,
//     which is the whole claim: sharing reports into the traffic figures
//     rather than growing a second set that disagrees with them.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { users } from "@/core/auth/schema";
import { createContact } from "@/core/contacts/service";
import type { Actor } from "@/core/service";
import { updateBusiness } from "@/core/settings/service";
import { siteOrigin } from "@/core/seo/origin";
import { track } from "@/modules/analytics/service";
import { shareTargets, sharedLinks } from "@/modules/share/schema";
import {
  canonicalShareUrl,
  destinationFor,
  internalPath,
  mintRef,
  refFromCampaign,
  campaignFor,
} from "@/modules/share/links";
import {
  channelsFor,
  intentUrl,
  isOnSiteChannel,
  SHARE_CHANNELS,
  shareText,
} from "@/modules/share/intents";
import {
  linkReport,
  forgetTarget,
  resolveLink,
  saveTarget,
  shareVia,
  targetFor,
  targets,
} from "@/modules/share/service";
import {
  ANONYMOUS,
  CUSTOMER,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

const ORIGIN = "https://example.test";

/* ------------------------------------------------- the parts with no database */

describe("what counts as a path this site serves", () => {
  it("normalises the shapes that mean the same page", () => {
    expect(internalPath("/services/weddings/")).toBe("services/weddings");
    expect(internalPath("services/weddings")).toBe("services/weddings");
    expect(internalPath("/")).toBe("");
    expect(internalPath("")).toBe("");
  });

  it("refuses everything that could mean somewhere else", () => {
    // A scheme is the obvious one. The others are the ones that get through:
    // a protocol-relative URL is read by a browser as a host, and a traversal
    // is how a path escapes the prefix somebody thought it was confined to.
    expect(internalPath("https://evil.example/x")).toBeNull();
    expect(internalPath("javascript:alert(1)")).toBeNull();
    expect(internalPath("data:text/html,<script>")).toBeNull();
    expect(internalPath("//evil.example/x")).toBeNull();
    expect(internalPath("/services/../../etc")).toBeNull();
    expect(internalPath("services\\weddings")).toBeNull();
    expect(internalPath("services/wed dings")).toBeNull();
  });

  it("never resolves to another origin", () => {
    expect(canonicalShareUrl("services/weddings", ORIGIN)).toBe(
      `${ORIGIN}/services/weddings`,
    );
    expect(canonicalShareUrl("", ORIGIN)).toBe(`${ORIGIN}/`);
    expect(canonicalShareUrl("https://evil.example/x", ORIGIN)).toBeNull();
    expect(canonicalShareUrl("//evil.example/x", ORIGIN)).toBeNull();
  });

  it("carries the campaign that makes the click countable", () => {
    const destination = destinationFor({
      path: "portfolio/coast",
      ref: "abc123",
      channel: "whatsapp",
      origin: ORIGIN,
    });
    const url = new URL(destination!);
    expect(url.origin).toBe(ORIGIN);
    expect(url.searchParams.get("utm_source")).toBe("whatsapp");
    expect(url.searchParams.get("utm_medium")).toBe("share");
    expect(url.searchParams.get("utm_campaign")).toBe("share:abc123");
    expect(refFromCampaign(campaignFor("abc123"))).toBe("abc123");
    // Somebody else's campaign is not a share, however much it looks like one.
    expect(refFromCampaign("spring-sale")).toBeNull();
  });
});

describe("channel intents", () => {
  it("sends people only to the hosts named in the code", () => {
    const url = "https://example.test/s/abc123";
    for (const channel of SHARE_CHANNELS) {
      const intent = intentUrl(channel, url, "A title — Aurora");
      if (isOnSiteChannel(channel)) {
        // Copy and the native share sheet have no off-site address, and a
        // caller that treated null as failure would break the two ways most
        // people actually share things on a phone.
        expect(intent).toBeNull();
        continue;
      }
      expect(intent).not.toBeNull();
      // Nothing the caller supplied reaches the scheme or the host: the title
      // and the URL only ever appear inside an encoded query parameter.
      expect(intent!.startsWith("https://") || intent!.startsWith("mailto:") || intent!.startsWith("sms:")).toBe(true);
      expect(intent).toContain(encodeURIComponent(url));
    }
  });

  it("cannot be talked into another host by the title", () => {
    const intent = intentUrl(
      "facebook",
      "https://example.test/s/abc123",
      "https://evil.example/#",
    );
    expect(new URL(intent!).host).toBe("www.facebook.com");
  });

  it("offers every channel until an owner narrows it", () => {
    expect(channelsFor(null)).toEqual([...SHARE_CHANNELS]);
    expect(channelsFor([])).toEqual([]);
    expect(channelsFor(["whatsapp", "link"])).toEqual(["link", "whatsapp"]);
    // Order comes from the code, not from the stored array, so re-ticking a
    // box does not rearrange somebody's share bar.
    expect(channelsFor(["whatsapp", "link"])).toEqual(channelsFor(["link", "whatsapp"]));
  });

  it("says whose work it is, for the previews that never load", () => {
    expect(shareText("Coast weddings", "Aurora Coast Photography")).toBe(
      "Coast weddings — Aurora Coast Photography",
    );
    expect(shareText("Aurora", "Aurora")).toBe("Aurora");
    expect(shareText("Coast weddings", null)).toBe("Coast weddings");
  });

  it("mints refs from a fixed alphabet", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(mintRef()).toMatch(/^[a-z0-9]{10}$/);
    }
  });
});

/* --------------------------------------------------------- with a database */

describe.runIf(hasDatabase)("sharing", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  async function share(path = "portfolio/coast", channel: "link" | "whatsapp" = "link") {
    return shareVia.call({ path, locale: "en", channel, title: "Coast" }, ANONYMOUS);
  }

  it("is on for a page nobody has said anything about", async () => {
    // §34: "present by default, removable per entity". The absence of a row is
    // the default, which is why there is no sync step and nothing to publish.
    const target = await targetFor.call({ path: "portfolio/coast" }, ANONYMOUS);
    expect(target.shareable).toBe(true);
    expect(target.id).toBeNull();
    expect(target.channels).toEqual([...SHARE_CHANNELS]);
    expect(await targets.call({}, OWNER)).toEqual([]);
  });

  it("records one row for each act of sharing", async () => {
    const first = await share();
    const second = await share();
    // Not deduplicated on purpose: "this was shared twice" is the sentence
    // §34 promises, and reusing the row would have made it "this could be
    // shared in one way".
    expect(first.ref).not.toBe(second.ref);
    const listed = await targets.call({}, OWNER);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ path: "portfolio/coast", shares: 2 });
  });

  it("hands back a link that leads to the page, carrying its campaign", async () => {
    const shared = await share("portfolio/coast", "whatsapp");
    expect(shared.url).toBe(`${siteOrigin()}/s/${shared.ref}`);
    expect(shared.intentUrl).toContain("wa.me");

    const resolved = await resolveLink.call({ ref: shared.ref }, ANONYMOUS);
    const destination = new URL(resolved!.destination);
    expect(destination.origin).toBe(new URL(siteOrigin()).origin);
    expect(destination.pathname).toBe("/portfolio/coast");
    expect(destination.searchParams.get("utm_campaign")).toBe(`share:${shared.ref}`);
  });

  it("gives one answer to an unknown ref", async () => {
    expect(await resolveLink.call({ ref: "nosuchref" }, ANONYMOUS)).toBeNull();
  });

  it("refuses a target it does not own, however the row got there", async () => {
    // Straight into the database, past `saveTarget` and past `internalPath`.
    // The rule this asserts is not "the writer validates" — it is "the
    // redirect refuses", which is the one that still holds when the row came
    // from a bad migration or a hand-edited database years later.
    const [target] = await db()
      .insert(shareTargets)
      .values({ path: "https://evil.example/steal", locale: "en" })
      .returning();
    const ref = mintRef();
    await db()
      .insert(sharedLinks)
      .values({ targetId: target!.id, ref, channel: "link" });

    expect(await resolveLink.call({ ref }, ANONYMOUS)).toBeNull();
  });

  it("stops the links already out in the world when sharing is switched off", async () => {
    const shared = await share();
    expect(await resolveLink.call({ ref: shared.ref }, ANONYMOUS)).not.toBeNull();

    await saveTarget.call(
      { path: "portfolio/coast", shareable: false },
      OWNER,
    );

    // The control an owner sets, enforced. Refusing only new buttons would
    // have left every link somebody had already sent working.
    expect(await resolveLink.call({ ref: shared.ref }, ANONYMOUS)).toBeNull();
    // And no new ones can be minted.
    const refused = await failure(share());
    expect(refused.code).toBe("permission");
    // And the public share bar has nothing to render.
    const target = await targetFor.call({ path: "portfolio/coast" }, ANONYMOUS);
    expect(target.shareable).toBe(false);
  });

  it("switches back on without losing the links it had", async () => {
    const shared = await share();
    await saveTarget.call({ path: "portfolio/coast", shareable: false }, OWNER);
    await saveTarget.call({ path: "portfolio/coast", shareable: true }, OWNER);
    expect(await resolveLink.call({ ref: shared.ref }, ANONYMOUS)).not.toBeNull();
  });

  it("honours the channels an owner left ticked", async () => {
    await saveTarget.call(
      { path: "portfolio/coast", channels: ["link", "email"] },
      OWNER,
    );
    const allowed = await share("portfolio/coast", "link");
    expect(allowed.ref).toBeTruthy();

    const refused = await failure(share("portfolio/coast", "whatsapp"));
    expect(refused.code).toBe("permission");

    const target = await targetFor.call({ path: "portfolio/coast" }, ANONYMOUS);
    expect(target.channels).toEqual(["link", "email"]);
  });

  it("treats every channel ticked as no restriction at all", async () => {
    const saved = await saveTarget.call(
      { path: "portfolio/coast", channels: [...SHARE_CHANNELS] },
      OWNER,
    );
    // One state, one meaning: stored as the empty default rather than as a
    // list that has to be kept in step with the code's own channel list.
    expect(saved.channels).toBeNull();
  });

  it("limits a caller across paths instead of giving every path a fresh budget", () => {
    const subject = shareVia.def.rateLimit!.subject as (
      input: { path: string },
      actor: Actor,
    ) => string | undefined;
    const actor: Actor = { kind: "anonymous", request: { ip: "203.0.113.9" } };
    expect(subject({ path: "one" }, actor)).toBe("ip:203.0.113.9");
    expect(subject({ path: "two" }, actor)).toBe("ip:203.0.113.9");
  });

  it("offers no channels when an owner unticks every one", async () => {
    const saved = await saveTarget.call(
      { path: "portfolio/coast", channels: [] },
      OWNER,
    );
    expect(saved.channels).toEqual([]);
    expect((await targetFor.call({ path: "portfolio/coast" }, ANONYMOUS)).channels).toEqual([]);
    expect((await failure(share())).code).toBe("permission");
  });

  it("refuses to store a share target that is not a page on this site", async () => {
    const refused = await failure(
      saveTarget.call({ path: "https://evil.example/x" }, OWNER),
    );
    expect(refused.code).toBe("validation");
  });

  it("accepts only on-site paths or http(s) addresses for social images", async () => {
    expect(
      (await failure(
        saveTarget.call(
          { path: "portfolio/coast", imageUrl: "javascript:alert(1)" },
          OWNER,
        ),
      )).code,
    ).toBe("validation");
    expect(
      (await failure(
        saveTarget.call({ path: "portfolio/coast", imageUrl: "//evil.example/card" }, OWNER),
      )).code,
    ).toBe("validation");
    expect(
      (await saveTarget.call({ path: "portfolio/coast", imageUrl: "/media/card.webp" }, OWNER))
        .imageUrl,
    ).toBe("/media/card.webp");
  });

  it("requires explicit confirmation before forgetting tracked links", async () => {
    const saved = await saveTarget.call({ path: "portfolio/coast" }, OWNER);
    const refused = await failure(
      forgetTarget.call({ id: saved.id, confirm: false }, OWNER),
    );
    expect(refused.code).toBe("validation");
    expect(await forgetTarget.call({ id: saved.id, confirm: true }, OWNER)).toEqual({ ok: true });
  });

  it("gives an entity its own social face without touching its search face", async () => {
    await saveTarget.call(
      {
        path: "portfolio/coast",
        socialTitle: "Twelve hours on the coast",
        socialDescription: "A wedding, start to finish.",
      },
      OWNER,
    );
    const target = await targetFor.call({ path: "portfolio/coast" }, ANONYMOUS);
    expect(target.socialTitle).toBe("Twelve hours on the coast");
    expect(target.canonicalUrl).toBe(`${siteOrigin()}/portfolio/coast`);
  });

  it("records who shared it when the sharer is signed in", async () => {
    const contact = await createContact.call(
      { name: "Rae Lane", email: "rae@example.test" },
      OWNER,
    );
    await db().insert(users).values({
      id: CUSTOMER.userId,
      email: "rae@example.test",
      role: "customer",
    });
    await db()
      .update(contacts)
      .set({ userId: CUSTOMER.userId })
      .where(eq(contacts.id, contact.id));

    await shareVia.call(
      { path: "portfolio/coast", locale: "en", channel: "link", title: "Coast" },
      CUSTOMER,
    );

    const report = await linkReport.call({}, OWNER);
    // Derived from the session, never claimed by the caller: a sharer is a
    // Contact on the spine, and a forged one would be a forged customer row.
    expect(report[0]).toMatchObject({
      sharerContactId: contact.id,
      sharerName: "Rae Lane",
    });
  });

  it("reads its numbers out of analytics rather than counting again", async () => {
    const shared = await share("portfolio/coast", "whatsapp");

    // The visit a redirected browser would have produced: the page records
    // itself, sees the campaign in the query and files a first-party touch.
    await track.call(
      {
        anonId: "visitor-1",
        sessionId: "session-1",
        name: "page.viewed",
        path: "/portfolio/coast",
        campaign: {
          source: "whatsapp",
          medium: "share",
          campaign: `share:${shared.ref}`,
          term: null,
          content: null,
        },
      },
      ANONYMOUS,
    );

    const report = await linkReport.call({}, OWNER);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      ref: shared.ref,
      channel: "whatsapp",
      path: "portfolio/coast",
      visitors: 1,
      conversions: 0,
      sharerContactId: null,
    });
  });
});
