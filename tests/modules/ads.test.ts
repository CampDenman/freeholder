// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ad inventory (MASTER.md §4.16, C9.17).
//
// Two groups. The first is the paperwork against a database — slots,
// advertisers as contacts, the approval gate. The second is targeting, which
// is pure and needs none: deciding which ad runs is the part an advertiser
// disputes and an owner has to explain, so every case is a unit test rather
// than a query somebody has to reason about.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { adSizes, advertisers } from "@/modules/ads/schema";
import {
  addSize,
  ensureSizes,
  advertiserList,
  campaigns,
  decideCampaign,
  lineItems,
  saveAdvertiser,
  saveCampaign,
  saveLineItem,
  saveSlot,
  setCampaignStatus,
  sizes,
  slotByCode,
} from "@/modules/ads/service";
import {
  matchesTargeting,
  pathMatches,
  withinDaypart,
  withinFlight,
  withinFrequencyCap,
  type ServeContext,
} from "@/modules/ads/targeting";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Coast Weekly",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

async function activeSlot(code = "header") {
  return saveSlot.call(
    {
      name: "Header",
      code,
      formats: [
        { breakpoint: "desktop", sizes: [{ width: 728, height: 90 }] },
        { breakpoint: "mobile", sizes: [{ width: 320, height: 50 }] },
      ],
      status: "active",
    },
    OWNER,
  );
}

describe.runIf(hasDatabase)("ad inventory", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("ships the standard sizes seeded, per breakpoint", async () => {
    // §4.16: "Standard sizes ship seeded, per breakpoint." A publisher opening
    // the admin on day one has the sizes their sponsor will ask for. The list
    // lives in TypeScript and is applied by an idempotent service, because
    // reference data that exists only in a migration cannot be restored — this
    // test truncates the table, which is exactly the situation that proves it.
    const first = await ensureSizes.call({}, OWNER);
    expect(first.added).toBeGreaterThan(0);
    const again = await ensureSizes.call({}, OWNER);
    expect(again.added).toBe(0);
    expect(again.present).toBe(first.present);

    const desktop = await sizes.call({ breakpoint: "desktop" }, OWNER);
    const shapes = desktop.map((s) => `${s.width}x${s.height}`);
    expect(shapes).toContain("970x250");
    expect(shapes).toContain("728x90");
    expect(shapes).toContain("300x600");

    const mobile = await sizes.call({ breakpoint: "mobile" }, OWNER);
    expect(mobile.map((s) => `${s.width}x${s.height}`)).toContain("320x50");
  });

  it("lets a publisher add a size the standard set does not cover", async () => {
    // "Seeded, extensible": a sponsor with an odd size should be a row, not a
    // wait for a release.
    await ensureSizes.call({}, OWNER);
    const added = await addSize.call(
      { label: "Sponsor strip", width: 600, height: 80, breakpoint: "desktop" },
      OWNER,
    );
    expect(added.width).toBe(600);

    // Adding it twice is a duplicate, not an error worth a red screen.
    const again = await addSize.call(
      { label: "Sponsor strip", width: 600, height: 80, breakpoint: "desktop" },
      OWNER,
    );
    expect(again.id).toBe(added.id);
    const all = await db().select().from(adSizes).where(eq(adSizes.width, 600));
    expect(all).toHaveLength(1);
  });

  it("tells a page the shape of the hole, and nothing about who bought it", async () => {
    // Reserved space is a layout fact, not a disclosure. §4.16 wants the space
    // reserved because "an ad that arrives late and pushes the article down is
    // a Core Web Vitals failure".
    await activeSlot("header");
    const shape = await slotByCode.call({ code: "header" }, ANONYMOUS);
    expect(shape).not.toBeNull();
    expect(shape!.formats).toHaveLength(2);
    expect(JSON.stringify(shape)).not.toContain("allowThirdParty");
    expect(JSON.stringify(shape)).not.toContain("status");
  });

  it("says nothing about a slot that is not live", async () => {
    await saveSlot.call({ name: "Draft", code: "draft-slot", status: "draft" }, OWNER);
    expect(await slotByCode.call({ code: "draft-slot" }, ANONYMOUS)).toBeNull();
    expect(await slotByCode.call({ code: "nosuch" }, ANONYMOUS)).toBeNull();
  });

  it("will not let two slots share a code", async () => {
    await activeSlot("header");
    const error = await failure(
      saveSlot.call({ name: "Another", code: "header" }, OWNER),
    );
    expect(error.code).toBe("conflict");
  });

  it("makes an advertiser a contact rather than a second customer table", async () => {
    // §4.16: "Advertiser … A Contact, not a separate customer table."
    const advertiser = await saveAdvertiser.call(
      { email: "sponsor@example.test", name: "Coast Bakery", displayName: "Coast Bakery" },
      OWNER,
    );
    const [contact] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.id, advertiser.contactId));
    expect(contact!.email).toBe("sponsor@example.test");

    // Recording them again updates rather than duplicating: one contact, one
    // advertiser record.
    await saveAdvertiser.call(
      { email: "sponsor@example.test", displayName: "Coast Bakery Ltd" },
      OWNER,
    );
    const rows = await advertiserList.call({}, OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe("Coast Bakery Ltd");
  });

  it("keeps a paid campaign off the site until somebody approves it", async () => {
    const advertiser = await saveAdvertiser.call(
      { email: "sponsor@example.test", name: "Coast Bakery" },
      OWNER,
    );
    const campaign = await saveCampaign.call(
      {
        advertiserContactId: advertiser.contactId,
        name: "Spring",
        pricing: "cpm",
        rateCents: 500,
      },
      OWNER,
    );

    const error = await failure(
      setCampaignStatus.call({ id: campaign.id, status: "live" }, OWNER),
    );
    expect(error.code).toBe("validation");

    await decideCampaign.call({ id: campaign.id, decision: "approved" }, OWNER);
    const live = await setCampaignStatus.call({ id: campaign.id, status: "live" }, OWNER);
    expect(live.status).toBe("live");
  });

  it("does not make the owner approve their own house promotion", async () => {
    // A house ad is the owner's own. Asking them to approve it would be
    // ceremony, and ceremony is what makes people switch a gate off.
    const advertiser = await saveAdvertiser.call(
      { email: "me@example.test", name: "The paper" },
      OWNER,
    );
    const campaign = await saveCampaign.call(
      { advertiserContactId: advertiser.contactId, name: "Our workshop", pricing: "house" },
      OWNER,
    );
    const live = await setCampaignStatus.call({ id: campaign.id, status: "live" }, OWNER);
    expect(live.status).toBe("live");
  });

  it("refuses a campaign that ends before it starts", async () => {
    const advertiser = await saveAdvertiser.call(
      { email: "sponsor@example.test", name: "Coast Bakery" },
      OWNER,
    );
    const error = await failure(
      saveCampaign.call(
        {
          advertiserContactId: advertiser.contactId,
          name: "Backwards",
          startsAt: new Date("2026-06-01"),
          endsAt: new Date("2026-05-01"),
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("refuses a line item aimed at a position that does not exist", async () => {
    // Otherwise the owner's only symptom is an advertiser asking why they saw
    // no impressions.
    const advertiser = await saveAdvertiser.call(
      { email: "sponsor@example.test", name: "Coast Bakery" },
      OWNER,
    );
    const campaign = await saveCampaign.call(
      { advertiserContactId: advertiser.contactId, name: "Spring" },
      OWNER,
    );
    const error = await failure(
      saveLineItem.call(
        {
          campaignId: campaign.id,
          name: "Everywhere",
          slotIds: ["00000000-0000-4000-8000-000000000000"],
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("stores what runs where, when and how often", async () => {
    const slot = await activeSlot("header");
    const advertiser = await saveAdvertiser.call(
      { email: "sponsor@example.test", name: "Coast Bakery" },
      OWNER,
    );
    const campaign = await saveCampaign.call(
      { advertiserContactId: advertiser.contactId, name: "Spring" },
      OWNER,
    );
    await saveLineItem.call(
      {
        campaignId: campaign.id,
        name: "Weekday mornings, news only",
        slotIds: [slot.id],
        targeting: { pathPatterns: ["/news/*"], devices: ["desktop"] },
        dayparting: { days: [1, 2, 3, 4, 5], fromMinute: 360, toMinute: 720 },
        frequencyCap: 3,
        status: "active",
      },
      OWNER,
    );

    const items = await lineItems.call({ campaignId: campaign.id }, OWNER);
    expect(items).toHaveLength(1);
    expect(items[0]!.frequencyCap).toBe(3);
  });

  it("moves an advertiser's campaigns when two contacts merge", async () => {
    const keep = await saveAdvertiser.call(
      { email: "keep@example.test", name: "Keep" },
      OWNER,
    );
    const dupe = await saveAdvertiser.call(
      { email: "dupe@example.test", name: "Dupe" },
      OWNER,
    );
    await saveCampaign.call(
      { advertiserContactId: dupe.contactId, name: "Theirs" },
      OWNER,
    );

    const { mergeContacts } = await import("@/core/contacts/service");
    await mergeContacts.call(
      { duplicateId: dupe.contactId, survivingId: keep.contactId },
      OWNER,
    );

    const theirs = await campaigns.call({ advertiserContactId: keep.contactId }, OWNER);
    expect(theirs.map((c) => c.name)).toContain("Theirs");
    // One advertiser record survives; two answers to "what shall we call them
    // on the invoice" is one answer too many.
    const rows = await db()
      .select()
      .from(advertisers)
      .where(eq(advertisers.contactId, keep.contactId));
    expect(rows).toHaveLength(1);
  });
});

describe("ad targeting", () => {
  const ctx = (over: Partial<ServeContext> = {}): ServeContext => ({
    locale: "en",
    country: "CA",
    device: "desktop",
    path: "/news/harbour",
    referrer: null,
    minuteOfDay: 9 * 60,
    dayOfWeek: 3,
    ...over,
  });

  it("treats an unstated condition as no condition at all", () => {
    // The alternative — empty means nothing matches — turns a half-filled
    // form into a campaign that silently never runs.
    expect(matchesTargeting({}, ctx())).toBe(true);
    expect(matchesTargeting({ locales: [] }, ctx())).toBe(true);
  });

  it("requires every stated condition to hold", () => {
    expect(matchesTargeting({ devices: ["desktop"] }, ctx())).toBe(true);
    expect(matchesTargeting({ devices: ["mobile"] }, ctx())).toBe(false);
    expect(matchesTargeting({ countries: ["CA"] }, ctx())).toBe(true);
    expect(matchesTargeting({ countries: ["US"] }, ctx())).toBe(false);
    // A country rule cannot match a visitor whose country is unknown.
    expect(matchesTargeting({ countries: ["CA"] }, ctx({ country: null }))).toBe(false);
  });

  it("matches paths with a language small enough to explain", () => {
    expect(pathMatches("/news/*", "/news/harbour")).toBe(true);
    // A single star does not cross a slash; a double one does.
    expect(pathMatches("/news/*", "/news/2026/harbour")).toBe(false);
    expect(pathMatches("/news/**", "/news/2026/harbour")).toBe(true);
    expect(pathMatches("/", "/")).toBe(true);
    expect(pathMatches("/news/*", "/shop/kettle")).toBe(false);
    // Dots are literal, not "any character" — a rule for /a.b must not match
    // /axb, which a naive regex would.
    expect(pathMatches("/a.b", "/axb")).toBe(false);
  });

  it("handles a daypart that crosses midnight", () => {
    // A late-night radio sponsor runs 22:00 to 02:00, and that is a real
    // thing somebody will configure.
    const overnight = { fromMinute: 22 * 60, toMinute: 2 * 60 };
    expect(withinDaypart(overnight, ctx({ minuteOfDay: 23 * 60 }))).toBe(true);
    expect(withinDaypart(overnight, ctx({ minuteOfDay: 60 }))).toBe(true);
    expect(withinDaypart(overnight, ctx({ minuteOfDay: 12 * 60 }))).toBe(false);
  });

  it("keeps a daypart to the days it names", () => {
    const weekdays = { days: [1, 2, 3, 4, 5] };
    expect(withinDaypart(weekdays, ctx({ dayOfWeek: 3 }))).toBe(true);
    expect(withinDaypart(weekdays, ctx({ dayOfWeek: 0 }))).toBe(false);
    expect(withinDaypart({}, ctx({ dayOfWeek: 0 }))).toBe(true);
  });

  it("counts a frequency cap as a ceiling, not a target", () => {
    expect(withinFrequencyCap(3, 2)).toBe(true);
    expect(withinFrequencyCap(3, 3)).toBe(false);
    expect(withinFrequencyCap(null, 9999)).toBe(true);
  });

  it("respects a campaign's own window", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    expect(withinFlight(new Date("2026-06-01"), new Date("2026-06-30"), now)).toBe(true);
    expect(withinFlight(new Date("2026-07-01"), null, now)).toBe(false);
    expect(withinFlight(null, new Date("2026-06-01"), now)).toBe(false);
    // No dates is a campaign nobody has given a window, not one that never runs.
    expect(withinFlight(null, null, now)).toBe(true);
  });
});
