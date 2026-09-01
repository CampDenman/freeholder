// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Serving an ad, counting the click, and billing for it (MASTER.md §4.16,
// C9.18).
//
// Three groups, in order of how much they need.
//
// The first two need nothing: the signed click-out and the choice of which ad
// runs are both pure. That is on purpose — the token is the module's only
// untrusted public surface, and "which advertiser won" is the part an
// advertiser disputes. Both deserve cases somebody can read rather than a
// query somebody has to reason about.
//
// The third is the real thing against a database: an approved creative
// serving, an unapproved one not, a house promotion filling what nobody
// bought, and the invoice that ties an ad sale to the same money path as
// everything else.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { translator } from "@/core/i18n";
import { assets } from "@/core/media/schema";
import { analyticsEvents } from "@/modules/analytics/schema";
import { adCreatives } from "@/modules/ads/schema";
import { invoices } from "@/modules/invoicing/schema";
import {
  CLICK_TOKEN_MAX_AGE_SECONDS,
  clickPath,
  safeClickUrl,
  signClickToken,
  verifyClickToken,
} from "@/modules/ads/clicks";
import {
  chooseFill,
  zonedClock,
  type Candidate,
  type CandidateCreative,
} from "@/modules/ads/select";
import { adSlot } from "@/modules/ads/blocks";
import {
  creatives,
  decideCampaign,
  invoiceCampaign,
  recordClick,
  reviewCreative,
  saveAdvertiser,
  saveCampaign,
  saveCreative,
  saveLineItem,
  saveSlot,
  serve,
  setCampaignStatus,
} from "@/modules/ads/service";
import type { ServeContext } from "@/modules/ads/targeting";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Coast Weekly",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

/* ------------------------------------------------------- the click-out */

describe("the signed click-out", () => {
  const claim = { creativeId: "c-1", url: "https://bakery.example/spring", issuedAt: 1_780_000_000 };

  it("hands back exactly what was signed", () => {
    const token = signClickToken(claim);
    expect(verifyClickToken(token, claim.issuedAt + 60)).toEqual(claim);
    // And the visitor's link is first-party, always.
    expect(clickPath(token).startsWith("/go/ad?t=")).toBe(true);
  });

  it("refuses a destination somebody edited into the token", () => {
    // This is the whole reason the URL is inside the signature rather than
    // merely alongside it. Without it, an ad link on a published page is an
    // open redirect wearing the publisher's own domain.
    const token = signClickToken(claim);
    const forged = signClickToken({ ...claim, url: "https://evil.example" });
    const [payload] = forged.split(".");
    const [, signature] = token.split(".");
    expect(verifyClickToken(`${payload}.${signature}`, claim.issuedAt + 60)).toBeNull();
  });

  it("refuses a token nobody signed, and one signed with the wrong shape", () => {
    expect(verifyClickToken("", claim.issuedAt)).toBeNull();
    expect(verifyClickToken("nonsense", claim.issuedAt)).toBeNull();
    expect(verifyClickToken("a.b", claim.issuedAt)).toBeNull();
    const token = signClickToken(claim);
    expect(verifyClickToken(`${token}x`, claim.issuedAt + 60)).toBeNull();
  });

  it("stops honouring a link scraped off a page a month ago", () => {
    const token = signClickToken(claim);
    expect(verifyClickToken(token, claim.issuedAt + CLICK_TOKEN_MAX_AGE_SECONDS - 1)).not.toBeNull();
    expect(verifyClickToken(token, claim.issuedAt + CLICK_TOKEN_MAX_AGE_SECONDS + 1)).toBeNull();
    // A token from the future is a clock problem or a forgery; either way it
    // is not one worth honouring.
    expect(verifyClickToken(token, claim.issuedAt - 3600)).toBeNull();
  });

  it("only ever calls a real web address a destination", () => {
    expect(safeClickUrl("https://bakery.example/spring")).toBe("https://bakery.example/spring");
    expect(safeClickUrl("http://bakery.example/")).toBe("http://bakery.example/");
    // The three shapes an open redirect is actually used for.
    expect(safeClickUrl("javascript:alert(1)")).toBeNull();
    expect(safeClickUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeClickUrl("/admin/settings")).toBeNull();
    // "https://bank.example@evil.test" reads as the bank and goes elsewhere.
    expect(safeClickUrl("https://bank.example@evil.test/")).toBeNull();
  });
});

/* -------------------------------------------------- choosing what runs */

describe("choosing which ad runs", () => {
  const artwork = (over: Partial<CandidateCreative> = {}): CandidateCreative => ({
    id: "cr",
    kind: "image",
    assetId: null,
    width: 728,
    height: 90,
    clickUrl: "https://example.test/",
    altText: "An ad",
    headline: null,
    body: null,
    ctaLabel: null,
    ...over,
  });

  const candidate = (over: Partial<Candidate> = {}): Candidate => ({
    lineItemId: "li",
    campaignId: "c",
    house: false,
    priority: 0,
    weight: 1,
    startsAt: null,
    endsAt: null,
    targeting: {},
    dayparting: {},
    creatives: [artwork()],
    ...over,
  });

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

  const options = {
    now: new Date("2026-06-15T12:00:00Z"),
    allowHouseFill: true,
    roll: 0.5,
    creativeRoll: 0,
  };
  const leaderboard = [{ width: 728, height: 90 }];

  it("fills unsold space with the owner's own promotion", () => {
    // §4.16: allow_house_fill "means unsold inventory shows the owner's own
    // campaign rather than a hole".
    const house = candidate({ lineItemId: "house", house: true });
    const chosen = chooseFill([house], leaderboard, ctx(), options);
    expect(chosen?.candidate.lineItemId).toBe("house");
  });

  it("leaves the space empty when the owner said not to fill it", () => {
    const house = candidate({ lineItemId: "house", house: true });
    expect(
      chooseFill([house], leaderboard, ctx(), { ...options, allowHouseFill: false }),
    ).toBeNull();
  });

  it("never lets a house promotion outrank somebody who paid", () => {
    // The failure this prevents is the owner quietly not delivering a campaign
    // they have already invoiced, because somebody typed a high priority on
    // their own promotion.
    const house = candidate({ lineItemId: "house", house: true, priority: 900 });
    const sold = candidate({ lineItemId: "sold", priority: 0 });
    expect(chooseFill([house, sold], leaderboard, ctx(), options)?.candidate.lineItemId).toBe(
      "sold",
    );
  });

  it("gives the slot to the higher-priority campaign", () => {
    const cheap = candidate({ lineItemId: "cheap", priority: 1, weight: 1000 });
    const premium = candidate({ lineItemId: "premium", priority: 5, weight: 1 });
    // Whatever the roll: priority decides the tier, weight only shares within
    // one, so a heavy weight cannot buy its way past a better price.
    for (const roll of [0, 0.25, 0.5, 0.99]) {
      expect(
        chooseFill([cheap, premium], leaderboard, ctx(), { ...options, roll })?.candidate
          .lineItemId,
      ).toBe("premium");
    }
  });

  it("shares an equal tier in proportion to weight", () => {
    const heavy = candidate({ lineItemId: "heavy", weight: 3 });
    const light = candidate({ lineItemId: "light", weight: 1 });
    const pick = (roll: number) =>
      chooseFill([heavy, light], leaderboard, ctx(), { ...options, roll })?.candidate.lineItemId;
    // Three quarters of the draw belongs to the heavier line item, which is
    // what "relative share" has to mean for the number to be honest.
    expect(pick(0)).toBe("heavy");
    expect(pick(0.74)).toBe("heavy");
    expect(pick(0.76)).toBe("light");
    expect(pick(0.99)).toBe("light");
  });

  it("passes over a line item with no artwork this size, rather than showing a hole", () => {
    // A campaign whose only creative is a 728×90 cannot fill a phone's
    // 320×50. Treating it as eligible anyway would leave the visitor an empty
    // box while the house promotion that does have a 320×50 sat unused.
    const desktopOnly = candidate({ lineItemId: "desktop-only" });
    const house = candidate({
      lineItemId: "house",
      house: true,
      creatives: [artwork({ id: "mobile", width: 320, height: 50 })],
    });
    const mobile = [{ width: 320, height: 50 }];
    const chosen = chooseFill([desktopOnly, house], mobile, ctx({ device: "mobile" }), options);
    expect(chosen?.candidate.lineItemId).toBe("house");
    expect(chosen?.creative.id).toBe("mobile");
  });

  it("still applies every C9.17 rule before choosing", () => {
    const outOfFlight = candidate({
      lineItemId: "past",
      endsAt: new Date("2026-01-01T00:00:00Z"),
    });
    const wrongPlace = candidate({
      lineItemId: "shop-only",
      targeting: { pathPatterns: ["/shop/*"] },
    });
    const wrongTime = candidate({
      lineItemId: "overnight",
      dayparting: { fromMinute: 22 * 60, toMinute: 2 * 60 },
    });
    expect(chooseFill([outOfFlight, wrongPlace, wrongTime], leaderboard, ctx(), options)).toBeNull();
  });

  it("reads the clock where the business is, not where the server is", () => {
    // A sponsor who bought weekday mornings bought them in the paper's town.
    const noon = new Date("2026-06-15T19:30:00Z");
    expect(zonedClock(noon, "America/Vancouver")).toEqual({ minuteOfDay: 12 * 60 + 30, dayOfWeek: 1 });
    expect(zonedClock(noon, "UTC")).toEqual({ minuteOfDay: 19 * 60 + 30, dayOfWeek: 1 });
    // And a zone that pushes it onto the next day changes the day too.
    expect(zonedClock(noon, "Pacific/Auckland").dayOfWeek).toBe(2);
  });
});

/* ------------------------------------------------------- against the db */

describe.runIf(hasDatabase)("serving, clicking and billing", () => {
  beforeAll(async () => {
    // The invoice path resolves `invoicing.createDraft` through the registry,
    // so the modules have to have booted.
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function slot(over: { code?: string; allowHouseFill?: boolean } = {}) {
    return saveSlot.call(
      {
        name: "Header",
        code: over.code ?? "header",
        formats: [
          { breakpoint: "desktop", sizes: [{ width: 728, height: 90 }] },
          { breakpoint: "mobile", sizes: [{ width: 320, height: 50 }] },
        ],
        allowHouseFill: over.allowHouseFill ?? true,
        status: "active",
      },
      OWNER,
    );
  }

  /** A campaign that is live, with one active line item on `slotId`. */
  async function booking(options: {
    email: string;
    name: string;
    pricing?: "cpm" | "cpc" | "flat" | "house";
    slotId: string;
    priority?: number;
    goalImpressions?: number;
    rateCents?: number;
  }) {
    const advertiser = await saveAdvertiser.call(
      { email: options.email, name: options.name },
      OWNER,
    );
    const campaign = await saveCampaign.call(
      {
        advertiserContactId: advertiser.contactId,
        name: options.name,
        pricing: options.pricing ?? "house",
        rateCents: options.rateCents ?? 0,
        priority: options.priority ?? 0,
      },
      OWNER,
    );
    const line = await saveLineItem.call(
      {
        campaignId: campaign.id,
        name: `${options.name} run`,
        slotIds: [options.slotId],
        status: "active",
        ...(options.goalImpressions ? { goalImpressions: options.goalImpressions } : {}),
      },
      OWNER,
    );
    return { advertiser, campaign, line };
  }

  async function goLive(campaignId: string, approve: boolean) {
    if (approve) await decideCampaign.call({ id: campaignId, decision: "approved" }, OWNER);
    await setCampaignStatus.call({ id: campaignId, status: "live" }, OWNER);
  }

  async function textCreative(lineItemId: string, over: Record<string, unknown> = {}) {
    return saveCreative.call(
      {
        lineItemId,
        kind: "native",
        width: 728,
        height: 90,
        clickUrl: "https://bakery.example/spring",
        headline: "Fresh bread on Bay Street",
        ctaLabel: "Visit us",
        status: "active",
        ...over,
      },
      OWNER,
    );
  }

  it("refuses artwork in a size no position it runs in accepts", async () => {
    // The same failure C9.17 refuses a line item for: the owner's only symptom
    // would be an advertiser asking why they saw no impressions.
    const position = await slot();
    const { line } = await booking({
      email: "bakery@example.test",
      name: "Coast Bakery",
      slotId: position.id,
    });
    const error = await failure(textCreative(line.id, { width: 999, height: 111 }));
    expect(error.code).toBe("validation");
  });

  it("refuses a destination that is not a web address", async () => {
    const position = await slot();
    const { line } = await booking({
      email: "bakery@example.test",
      name: "Coast Bakery",
      slotId: position.id,
    });
    for (const clickUrl of ["javascript:alert(1)", "/admin", "data:text/html,x"]) {
      const error = await failure(textCreative(line.id, { clickUrl }));
      expect(error.code).toBe("validation");
    }
  });

  it("will not let an image ad ship without a description", async () => {
    // §5 requires alt text on every public image, and a sponsor's banner is
    // not an exception to that.
    const position = await slot();
    const { line } = await booking({
      email: "bakery@example.test",
      name: "Coast Bakery",
      slotId: position.id,
    });
    const [asset] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: "ads/leaderboard.png",
        filename: "leaderboard.png",
        mime: "image/png",
        legacyBytes: 1024,
        bytes: 1024,
        width: 728,
        height: 90,
      })
      .returning();
    const error = await failure(
      saveCreative.call(
        {
          lineItemId: line.id,
          kind: "image",
          assetId: asset!.id,
          width: 728,
          height: 90,
          clickUrl: "https://bakery.example/",
          status: "active",
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("keeps a sold creative off the page until somebody has looked at it", async () => {
    const position = await slot({ allowHouseFill: false });
    const { campaign, line } = await booking({
      email: "bakery@example.test",
      name: "Coast Bakery",
      pricing: "cpm",
      rateCents: 500,
      slotId: position.id,
    });
    await goLive(campaign.id, true);
    const creative = await textCreative(line.id);
    expect(creative.reviewState).toBe("pending");

    const before = await serve.call({ code: "header", path: "/news" }, ANONYMOUS);
    expect(before!.fills.every((fill) => fill.creative === null)).toBe(true);

    await reviewCreative.call({ id: creative.id, decision: "approved" }, OWNER);
    const after = await serve.call({ code: "header", path: "/news" }, ANONYMOUS);
    const desktop = after!.fills.find((fill) => fill.breakpoint === "desktop");
    expect(desktop!.creative?.id).toBe(creative.id);
    expect(desktop!.creative?.label).toBe("sponsored");
  });

  it("sends a sold creative back for review when its target is edited", async () => {
    // §4.16: "a creative cannot be swapped for a different target after
    // approval". An edit is exactly that swap, so approval does not survive it.
    const position = await slot({ allowHouseFill: false });
    const { campaign, line } = await booking({
      email: "bakery@example.test",
      name: "Coast Bakery",
      pricing: "flat",
      rateCents: 20000,
      slotId: position.id,
    });
    await goLive(campaign.id, true);
    const creative = await textCreative(line.id);
    await reviewCreative.call({ id: creative.id, decision: "approved" }, OWNER);

    const edited = await textCreative(line.id, {
      id: creative.id,
      clickUrl: "https://somewhere-else.example/",
    });
    expect(edited.reviewState).toBe("pending");
    const served = await serve.call({ code: "header", path: "/news" }, ANONYMOUS);
    expect(served!.fills.every((fill) => fill.creative === null)).toBe(true);
  });

  it("does not make the owner review their own house promotion", async () => {
    // A house ad is the owner's own; asking them to approve it would be
    // ceremony, and ceremony is what makes people switch a gate off. It is
    // still recorded against them rather than waived.
    const position = await slot();
    const { campaign, line } = await booking({
      email: "us@example.test",
      name: "The paper",
      slotId: position.id,
    });
    await goLive(campaign.id, false);
    const creative = await textCreative(line.id);
    expect(creative.reviewState).toBe("approved");
    const [stored] = await db().select().from(adCreatives).where(eq(adCreatives.id, creative.id));
    expect(stored!.reviewedBy).not.toBeNull();

    const served = await serve.call({ code: "header", path: "/" }, ANONYMOUS);
    expect(served!.fills.find((f) => f.breakpoint === "desktop")!.creative?.label).toBe("house");
  });

  it("reserves the declared shape at every breakpoint, filled or not", async () => {
    // §4.16 reserves the space because "an ad that arrives late and pushes the
    // article down is a Core Web Vitals failure" — and it does that per
    // breakpoint, from one placement, with nothing sniffed about the device.
    await slot({ allowHouseFill: false });
    const served = await serve.call({ code: "header", path: "/" }, ANONYMOUS);
    expect(served!.fills.map((fill) => [fill.breakpoint, fill.width, fill.height])).toEqual([
      ["desktop", 728, 90],
      ["mobile", 320, 50],
    ]);
  });

  it("says nothing at all about a slot that is not live", async () => {
    await saveSlot.call({ name: "Draft", code: "draft-slot" }, OWNER);
    expect(await serve.call({ code: "draft-slot" }, ANONYMOUS)).toBeNull();
    expect(await serve.call({ code: "nosuch" }, ANONYMOUS)).toBeNull();
  });

  it("counts the click, then says where to go", async () => {
    const position = await slot();
    const { campaign, line } = await booking({
      email: "us@example.test",
      name: "The paper",
      slotId: position.id,
    });
    await goLive(campaign.id, false);
    await textCreative(line.id);

    const served = await serve.call({ code: "header", path: "/news" }, ANONYMOUS);
    const href = served!.fills.find((fill) => fill.breakpoint === "desktop")!.creative!.href;
    // The advertiser's own URL is never in the page: everything leaves through
    // the one endpoint, so the count and the destination cannot disagree.
    expect(href.startsWith("/go/ad?t=")).toBe(true);
    expect(href).not.toContain("bakery.example");

    const token = decodeURIComponent(href.slice("/go/ad?t=".length));
    const followed = await recordClick.call(
      { token, anonId: "visitor-1", sessionId: "session-1", path: "/news" },
      ANONYMOUS,
    );
    expect(followed.url).toBe("https://bakery.example/spring");

    const events = await db()
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.name, "ad.click"));
    expect(events).toHaveLength(1);
    expect(events[0]!.anonId).toBe("visitor-1");
  });

  it("refuses a click on a link nobody signed", async () => {
    const error = await failure(recordClick.call({ token: "not.a.token" }, ANONYMOUS));
    expect(error.code).toBe("validation");
    const events = await db().select().from(analyticsEvents);
    expect(events).toHaveLength(0);
  });

  it("refuses to follow a link whose destination changed after it was shown", async () => {
    // The signature pins the URL that was on the page. If the row has since
    // been edited, the visitor is not silently sent somewhere nobody reviewed.
    const position = await slot();
    const { campaign, line } = await booking({
      email: "us@example.test",
      name: "The paper",
      slotId: position.id,
    });
    await goLive(campaign.id, false);
    const creative = await textCreative(line.id);
    const served = await serve.call({ code: "header", path: "/" }, ANONYMOUS);
    const href = served!.fills.find((fill) => fill.breakpoint === "desktop")!.creative!.href;
    const token = decodeURIComponent(href.slice("/go/ad?t=".length));

    await textCreative(line.id, { id: creative.id, clickUrl: "https://elsewhere.example/" });
    const error = await failure(
      recordClick.call({ token, anonId: "v", sessionId: "s" }, ANONYMOUS),
    );
    expect(error.code).toBe("conflict");
  });

  it("labels the placement in the markup, with no way to turn it off", async () => {
    // §4.16: "sponsored placements are labelled in the markup (rel='sponsored'
    // on links, a visible label), and there is no configuration that removes
    // the label." The block has one prop — the slot's code — so there is
    // nothing to remove it with.
    const position = await slot();
    const { campaign, line } = await booking({
      email: "us@example.test",
      name: "The paper",
      slotId: position.id,
    });
    await goLive(campaign.id, false);
    await textCreative(line.id);

    const t = translator("en");
    const ctx = { locale: "en", t, business: null, path: "/news" };
    const resolved = await adSlot.resolve!({ code: "header" }, ctx);
    const markup = renderToStaticMarkup(
      createElement("div", null, adSlot.render({ props: { code: "header" }, ctx, resolved })),
    );

    expect(markup).toContain('rel="sponsored nofollow noopener"');
    expect(markup).toContain(t("ads.label.house"));
    expect(markup).toContain("/go/ad?t=");
    expect(Object.keys(adSlot.schema.shape)).toEqual(["code"]);
  });

  it("renders nothing rather than an empty grey box when nothing is running", async () => {
    // The reserved space exists because ads arrive late. This one does not —
    // it is in the server's HTML or it is not there at all — so an unsold slot
    // costs a reader no whitespace.
    await slot({ allowHouseFill: false });
    const ctx = { locale: "en", t: translator("en"), business: null, path: "/" };
    const resolved = await adSlot.resolve!({ code: "header" }, ctx);
    expect(adSlot.render({ props: { code: "header" }, ctx, resolved })).toBeNull();
  });

  it("bills an ad sale down the same money path as everything else", async () => {
    // §4.16: "Selling an ad is selling a product." So it is an ordinary
    // invoice, against the advertiser's ordinary contact.
    const position = await slot();
    const { advertiser, campaign } = await booking({
      email: "bakery@example.test",
      name: "Coast Bakery",
      pricing: "cpm",
      rateCents: 1500,
      goalImpressions: 40_000,
      slotId: position.id,
    });
    await decideCampaign.call({ id: campaign.id, decision: "approved" }, OWNER);

    const raised = await invoiceCampaign.call({ id: campaign.id }, OWNER);
    // 40,000 impressions at $15.00 per thousand.
    expect(raised.amountMinor).toBe(60_000);
    expect(raised.currency).toBe("CAD");

    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, raised.invoiceId));
    expect(invoice!.contactId).toBe(advertiser.contactId);
    expect(invoice!.sourceType).toBe("ad_campaign");
    expect(invoice!.sourceId).toBe(campaign.id);
    // A draft, not an issued invoice: guessing a tax treatment on somebody's
    // behalf is the one thing an accounting system must not do.
    expect(invoice!.status).toBe("draft");

    const again = await failure(invoiceCampaign.call({ id: campaign.id }, OWNER));
    expect(again.code).toBe("conflict");
  });

  it("refuses to invoice what nobody bought, or what nobody approved", async () => {
    const position = await slot();
    const own = await booking({
      email: "us@example.test",
      name: "The paper",
      slotId: position.id,
    });
    const house = await failure(invoiceCampaign.call({ id: own.campaign.id }, OWNER));
    expect(house.code).toBe("validation");

    const sold = await booking({
      email: "bakery@example.test",
      name: "Coast Bakery",
      pricing: "flat",
      rateCents: 25_000,
      slotId: position.id,
    });
    const unapproved = await failure(invoiceCampaign.call({ id: sold.campaign.id }, OWNER));
    expect(unapproved.code).toBe("validation");

    // And a per-thousand buy with no impression goal has nothing to bill
    // against — refused with a sentence that says what to do, rather than an
    // invoice for nothing.
    const vague = await booking({
      email: "vague@example.test",
      name: "Vague Ltd",
      pricing: "cpm",
      rateCents: 900,
      slotId: position.id,
    });
    await decideCampaign.call({ id: vague.campaign.id, decision: "approved" }, OWNER);
    const nothing = await failure(invoiceCampaign.call({ id: vague.campaign.id }, OWNER));
    expect(nothing.code).toBe("validation");
    expect(nothing.message).toContain("impression goal");
  });

  it("puts the ad slot in the block palette once the modules have booted", async () => {
    // §4.16: an ad position is "placed on the page as a block (§32)". The
    // block belongs to this module rather than to cms — cms does not know what
    // a creative is — so this is where the registration is proved.
    const { blockTypes, parseBlockTree } = await import("@/modules/cms/blocks/registry");
    expect(blockTypes()).toContain("adSlot");
    const tree = parseBlockTree([{ id: "a", type: "adSlot", props: { code: "header" } }], "page");
    expect(tree.map((node) => node.type)).toEqual(["adSlot"]);
  });

  it("lists a campaign's artwork for the screen that sells it", async () => {
    const position = await slot();
    const { campaign, line } = await booking({
      email: "us@example.test",
      name: "The paper",
      slotId: position.id,
    });
    await textCreative(line.id);
    const rows = await creatives.call({ campaignId: campaign.id }, OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lineItemId).toBe(line.id);
  });
});
