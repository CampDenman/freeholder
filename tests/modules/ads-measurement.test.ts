// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// First-party ad measurement (MASTER.md §4.16, C9.19).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { analyticsEvents } from "@/modules/analytics/schema";
import { adStats } from "@/modules/ads/schema";
import { isViewable, VIEWABLE_MS, VIEWABLE_PIXEL_RATIO } from "@/modules/ads/viewability";
import { EVEN_HEADROOM, withinFrequency, withinPace } from "@/modules/ads/pacing";
import { chooseFill, type Candidate } from "@/modules/ads/select";
import {
  campaignReport,
  decideCampaign,
  invoiceCampaign,
  recordBeacon,
  reconcileCampaign,
  reviewCreative,
  rollUpStats,
  saveAdvertiser,
  saveCampaign,
  saveCreative,
  saveLineItem,
  saveSlot,
  serve,
  setCampaignStatus,
} from "@/modules/ads/service";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import type { ServeContext } from "@/modules/ads/targeting";

const BUSINESS = {
  name: "Coast Weekly",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

describe("MRC viewability", () => {
  it("needs half the pixels for one continuous second", () => {
    expect(VIEWABLE_PIXEL_RATIO).toBe(0.5);
    expect(VIEWABLE_MS).toBe(1_000);
    expect(isViewable(0.49, 5_000)).toBe(false);
    expect(isViewable(0.5, 999)).toBe(false);
    expect(isViewable(0.5, 1_000)).toBe(true);
    expect(isViewable(1, 2_000, { video: true })).toBe(true);
    expect(isViewable(1, 1_000, { video: true })).toBe(false);
  });
});

describe("pacing", () => {
  const flight = {
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: new Date("2026-01-11T00:00:00Z"),
    now: new Date("2026-01-06T00:00:00Z"),
  };

  it("stops a campaign that has hit its goal or its budget", () => {
    expect(
      withinPace({
        pacing: "asap",
        ...flight,
        goal: 1000,
        delivered: 1000,
        budgetCents: null,
        spentCents: 0,
      }),
    ).toBe(false);
    expect(
      withinPace({
        pacing: "asap",
        ...flight,
        goal: null,
        delivered: 10,
        budgetCents: 5000,
        spentCents: 5000,
      }),
    ).toBe(false);
  });

  it("lets asap run until the goal, and holds even to the line plus headroom", () => {
    expect(
      withinPace({
        pacing: "asap",
        ...flight,
        goal: 1000,
        delivered: 900,
        budgetCents: null,
        spentCents: 0,
      }),
    ).toBe(true);
    // Half the flight, half the goal: 500 is on the line.
    expect(
      withinPace({
        pacing: "even",
        ...flight,
        goal: 1000,
        delivered: 500,
        budgetCents: null,
        spentCents: 0,
      }),
    ).toBe(true);
    expect(
      withinPace({
        pacing: "even",
        ...flight,
        goal: 1000,
        delivered: Math.floor(500 * EVEN_HEADROOM) + 1,
        budgetCents: null,
        spentCents: 0,
      }),
    ).toBe(false);
  });

  it("honours a frequency cap", () => {
    expect(withinFrequency(3, 2)).toBe(true);
    expect(withinFrequency(3, 3)).toBe(false);
    expect(withinFrequency(null, 99)).toBe(true);
  });

  it("drops a paced-out line item from the auction", () => {
    const ctx: ServeContext = {
      locale: "en",
      country: "CA",
      device: "desktop",
      path: "/",
      referrer: null,
      minuteOfDay: 12 * 60,
      dayOfWeek: 1,
    };
    const spent: Candidate = {
      lineItemId: "spent",
      campaignId: "c",
      house: false,
      priority: 10,
      weight: 1,
      startsAt: flight.startsAt,
      endsAt: flight.endsAt,
      targeting: {},
      dayparting: {},
      creatives: [
        {
          id: "art",
          kind: "native",
          assetId: null,
          width: 728,
          height: 90,
          clickUrl: "https://x.example",
          altText: null,
          headline: "Hi",
          body: null,
          ctaLabel: null,
        },
      ],
      pacing: "asap",
      goalImpressions: 10,
      deliveredImpressions: 10,
    };
    expect(
      chooseFill([spent], [{ width: 728, height: 90 }], ctx, {
        now: flight.now,
        allowHouseFill: false,
        roll: 0,
        creativeRoll: 0,
      }),
    ).toBeNull();
  });
});

describe.runIf(hasDatabase)("counting, rollup, report and reconcile", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function liveNative() {
    const position = await saveSlot.call(
      {
        name: "Header",
        code: "header",
        formats: [{ breakpoint: "desktop", sizes: [{ width: 728, height: 90 }] }],
        allowHouseFill: false,
        status: "active",
      },
      OWNER,
    );
    const advertiser = await saveAdvertiser.call(
      { email: "bakery@example.test", name: "Coast Bakery" },
      OWNER,
    );
    const campaign = await saveCampaign.call(
      {
        advertiserContactId: advertiser.contactId,
        name: "Spring",
        pricing: "cpm",
        rateCents: 5_000,
        pacing: "asap",
      },
      OWNER,
    );
    const line = await saveLineItem.call(
      {
        campaignId: campaign.id,
        name: "Header run",
        slotIds: [position.id],
        goalImpressions: 1_000,
        status: "active",
      },
      OWNER,
    );
    const creative = await saveCreative.call(
      {
        lineItemId: line.id,
        kind: "native",
        width: 728,
        height: 90,
        clickUrl: "https://bakery.example/spring",
        headline: "Bread",
        status: "active",
      },
      OWNER,
    );
    await decideCampaign.call({ id: campaign.id, decision: "approved" }, OWNER);
    await setCampaignStatus.call({ id: campaign.id, status: "live" }, OWNER);
    await reviewCreative.call({ id: creative.id, decision: "approved" }, OWNER);
    return { position, campaign, line, creative };
  }

  it("records impression and viewable events on the first-party ledger", async () => {
    const { position, creative, line, campaign } = await liveNative();
    const shown = await recordBeacon.call(
      {
        kind: "impression",
        creativeId: creative.id,
        slotId: position.id,
        anonId: "visitor-1",
        sessionId: "session-1",
        path: "/news",
      },
      ANONYMOUS,
    );
    expect(shown.counted).toBe(true);
    const seen = await recordBeacon.call(
      {
        kind: "viewable",
        creativeId: creative.id,
        slotId: position.id,
        anonId: "visitor-1",
        sessionId: "session-1",
        path: "/news",
      },
      ANONYMOUS,
    );
    expect(seen.counted).toBe(true);
    expect(
      (await db().select().from(analyticsEvents).where(eq(analyticsEvents.name, "ad.impression")))
        .length,
    ).toBe(1);
    expect(
      (await db().select().from(analyticsEvents).where(eq(analyticsEvents.name, "ad.viewable"))).length,
    ).toBe(1);

    const again = await recordBeacon.call(
      {
        kind: "impression",
        creativeId: creative.id,
        slotId: position.id,
        anonId: "visitor-1",
        sessionId: "session-1",
        path: "/news",
      },
      ANONYMOUS,
    );
    expect(again.counted).toBe(false);

    await rollUpStats.call({}, { kind: "system" });
    const report = await campaignReport.call({ campaignId: campaign.id }, OWNER);
    expect(report.impressions).toBe(1);
    expect(report.viewableImpressions).toBe(1);
    expect(report.uniques).toBe(1);
    expect(report.spendCents).toBe(Math.round(5_000 / 1000));
    expect(report.bookedMinor).toBe(Math.round((5_000 * 1_000) / 1000));
    expect(line.id).toBeTruthy();
  });

  it("does not count a visitor who cannot be identified", async () => {
    const { position, creative } = await liveNative();
    const skipped = await recordBeacon.call(
      { kind: "impression", creativeId: creative.id, slotId: position.id, path: "/news" },
      ANONYMOUS,
    );
    expect(skipped.counted).toBe(false);
    expect(await db().select().from(analyticsEvents)).toHaveLength(0);
  });

  it("records booked vs delivered and will not reconcile twice", async () => {
    const { campaign, creative, position } = await liveNative();
    await invoiceCampaign.call({ id: campaign.id }, OWNER);
    await recordBeacon.call(
      {
        kind: "impression",
        creativeId: creative.id,
        slotId: position.id,
        anonId: "v",
        sessionId: "s",
        path: "/",
      },
      ANONYMOUS,
    );
    await rollUpStats.call({}, { kind: "system" });
    const first = await reconcileCampaign.call({ id: campaign.id }, OWNER);
    expect(first.bookedMinor).toBe(5_000);
    expect(first.deliveredMinor).toBe(Math.round(5_000 / 1000));
    // Draft invoices cannot take a credit note; the shortfall is still known.
    expect(first.creditedMinor).toBe(0);
    const again = await failure(reconcileCampaign.call({ id: campaign.id }, OWNER));
    expect(again.code).toBe("conflict");
  });

  it("serves a fill that includes the ids the beacon needs", async () => {
    const { position, creative, line, campaign } = await liveNative();
    const served = await serve.call({ code: "header", path: "/news" }, ANONYMOUS);
    const desktop = served!.fills.find((fill) => fill.breakpoint === "desktop");
    expect(desktop!.creative?.id).toBe(creative.id);
    expect(desktop!.creative?.slotId).toBe(position.id);
    expect(desktop!.creative?.lineItemId).toBe(line.id);
    expect(desktop!.creative?.campaignId).toBe(campaign.id);
  });

  it("rebuilds uniques from distinct visitors, not from the increment cache", async () => {
    const { position, creative, campaign } = await liveNative();
    for (const who of ["a", "a", "b"]) {
      await recordBeacon.call(
        {
          kind: "impression",
          creativeId: creative.id,
          slotId: position.id,
          anonId: who,
          sessionId: `s-${who}-${Math.random()}`,
          path: "/",
        },
        ANONYMOUS,
      );
    }
    await rollUpStats.call({}, { kind: "system" });
    const report = await campaignReport.call({ campaignId: campaign.id }, OWNER);
    expect(report.impressions).toBe(2);
    expect(report.uniques).toBe(2);
    expect((await db().select().from(adStats)).length).toBe(1);
  });
});
