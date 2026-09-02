// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Consent-gated third-party tags and generated ads.txt (MASTER.md §4.16, C9.20).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ready } from "@/core/runtime";
import { translator } from "@/core/i18n";
import { adsTxtDomain, coversSurface, renderAdsTxtFile } from "@/modules/ads/ads-txt";
import {
  knownProviderNetwork,
  providerMarkup,
  reviewedTagHtml,
  stampNonce,
} from "@/modules/ads/tags";
import { adSlot } from "@/modules/ads/blocks";
import {
  adsTxt,
  decideCampaign,
  deleteTxtEntry,
  reviewCreative,
  saveAdvertiser,
  saveCampaign,
  saveCreative,
  saveLineItem,
  saveSlot,
  saveTxtEntry,
  serve,
  setCampaignStatus,
  txtEntries,
} from "@/modules/ads/service";
import { updateBusiness } from "@/core/settings/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Coast Weekly",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

describe("ads.txt assembly", () => {
  it("accepts an IAB domain and refuses a scheme or a path", () => {
    expect(adsTxtDomain("Google.com")).toBe("google.com");
    expect(adsTxtDomain("google.com.")).toBe("google.com");
    expect(adsTxtDomain("https://google.com")).toBeNull();
    expect(adsTxtDomain("google.com/path")).toBeNull();
    expect(adsTxtDomain("not a host")).toBeNull();
  });

  it("puts a line in the file the surface asked for, and none otherwise", () => {
    expect(coversSurface("both", "web")).toBe(true);
    expect(coversSurface("web", "app")).toBe(false);
    const body = renderAdsTxtFile(
      [
        {
          domain: "google.com",
          accountId: "pub-1",
          relationship: "DIRECT",
          certificationAuthorityId: "f08c47fec0942fa0",
          surface: "web",
        },
      ],
      "coastweekly.example",
    );
    expect(body).toBe(
      "OWNERDOMAIN=coastweekly.example\ngoogle.com, pub-1, DIRECT, f08c47fec0942fa0\n",
    );
    expect(renderAdsTxtFile([], null)).toBe("# No authorized digital sellers are listed.\n");
  });
});

describe("third-party tags", () => {
  it("refuses javascript: and data: HTML in a pasted tag", () => {
    expect(reviewedTagHtml("<script src='https://creative.example/tag.js'></script>")).toContain(
      "creative.example",
    );
    expect(reviewedTagHtml("javascript:alert(1)")).toBeNull();
    expect(reviewedTagHtml("<a href='javascript:alert(1)'>x</a>")).toBeNull();
    expect(reviewedTagHtml("<script src='data:text/html,hi'></script>")).toBeNull();
    expect(reviewedTagHtml("")).toBeNull();
  });

  it("stamps the request nonce on scripts that do not already have one", () => {
    const stamped = stampNonce("<script src='https://creative.example/tag.js'></script>", "abc123");
    expect(stamped).toContain('nonce="abc123"');
    expect(stampNonce('<script nonce="kept" src="https://x.test"></script>', "abc123")).toContain(
      'nonce="kept"',
    );
  });

  it("generates a GPT snippet only for google.com", () => {
    expect(knownProviderNetwork("google.com")).toBe(true);
    expect(knownProviderNetwork("ads.example")).toBe(false);
    const markup = providerMarkup(
      { network: "google.com", unitPath: "/123/unit" },
      { width: 728, height: 90 },
      "fh-gpt-1",
    );
    expect(markup).toContain("securepubads.g.doubleclick.net");
    expect(markup).toContain("/123/unit");
    expect(providerMarkup({ network: "other.com", unitPath: "/x" }, { width: 1, height: 1 }, "id")).toBeNull();
  });
});

describe.runIf(hasDatabase)("consent-gated serving and generated ads.txt", () => {
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

  async function position(allowThirdParty: boolean) {
    return saveSlot.call(
      {
        name: "Header",
        code: "header",
        formats: [
          { breakpoint: "desktop", sizes: [{ width: 728, height: 90 }] },
          { breakpoint: "mobile", sizes: [{ width: 320, height: 50 }] },
        ],
        allowHouseFill: true,
        allowThirdParty,
        status: "active",
      },
      OWNER,
    );
  }

  async function booking(options: {
    email: string;
    name: string;
    pricing?: "cpm" | "house";
    slotId: string;
    priority?: number;
  }) {
    const advertiser = await saveAdvertiser.call(
      { email: options.email, name: options.name },
      OWNER,
    );
    const campaign = await saveCampaign.call(
      {
        advertiserContactId: advertiser.contactId,
        name: options.name,
        pricing: options.pricing ?? "cpm",
        rateCents: options.pricing === "house" ? 0 : 1500,
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
      },
      OWNER,
    );
    return { campaign, line };
  }

  async function goLive(campaignId: string, approve: boolean) {
    if (approve) await decideCampaign.call({ id: campaignId, decision: "approved" }, OWNER);
    await setCampaignStatus.call({ id: campaignId, status: "live" }, OWNER);
  }

  it("refuses a third-party creative on a slot that does not allow them", async () => {
    const slot = await position(false);
    const { line } = await booking({
      email: "net@example.test",
      name: "Network",
      slotId: slot.id,
    });
    const error = await failure(
      saveCreative.call(
        {
          lineItemId: line.id,
          kind: "html_tag",
          width: 728,
          height: 90,
          tagHtml: "<script src='https://creative.example/tag.js'></script>",
          status: "active",
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("third-party");
  });

  it("refuses a provider creative whose network is not in ads.txt", async () => {
    const slot = await position(true);
    const { line } = await booking({
      email: "net@example.test",
      name: "Network",
      slotId: slot.id,
    });
    const error = await failure(
      saveCreative.call(
        {
          lineItemId: line.id,
          kind: "provider",
          width: 728,
          height: 90,
          provider: { network: "google.com", unitPath: "/123/unit" },
          status: "active",
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("ads.txt");
  });

  it("writes ads.txt from the rows the owner edited, and app-ads.txt from the app ones", async () => {
    await saveTxtEntry.call(
      {
        domain: "google.com",
        accountId: "pub-1",
        relationship: "DIRECT",
        certificationAuthorityId: "f08c47fec0942fa0",
        surface: "web",
      },
      OWNER,
    );
    await saveTxtEntry.call(
      {
        domain: "other.com",
        accountId: "app-9",
        relationship: "RESELLER",
        surface: "app",
      },
      OWNER,
    );
    const web = await adsTxt.call({ surface: "web" }, ANONYMOUS);
    const app = await adsTxt.call({ surface: "app" }, ANONYMOUS);
    expect(web.body).toContain("google.com, pub-1, DIRECT, f08c47fec0942fa0");
    expect(web.body).not.toContain("other.com");
    expect(app.body).toContain("other.com, app-9, RESELLER");
    expect(app.body).not.toContain("google.com");
    const listed = await txtEntries.call({}, OWNER);
    expect(listed).toHaveLength(2);
    await deleteTxtEntry.call({ id: listed[0]!.id }, OWNER);
    expect(await txtEntries.call({}, OWNER)).toHaveLength(1);
  });

  it("does not emit the tag without granted consent, and does once it is granted", async () => {
    const slot = await position(true);
    await saveTxtEntry.call(
      { domain: "google.com", accountId: "pub-1", relationship: "DIRECT" },
      OWNER,
    );
    const sold = await booking({
      email: "net@example.test",
      name: "Network",
      slotId: slot.id,
      priority: 10,
    });
    const house = await booking({
      email: "us@example.test",
      name: "The paper",
      pricing: "house",
      slotId: slot.id,
      priority: 0,
    });
    const tag = await saveCreative.call(
      {
        lineItemId: sold.line.id,
        kind: "html_tag",
        width: 728,
        height: 90,
        tagHtml: "<script src='https://creative.example/tag.js'></script>",
        status: "active",
      },
      OWNER,
    );
    await reviewCreative.call({ id: tag.id, decision: "approved" }, OWNER);
    await saveCreative.call(
      {
        lineItemId: house.line.id,
        kind: "native",
        width: 728,
        height: 90,
        clickUrl: "https://coastweekly.example/subscribe",
        headline: "Subscribe",
        status: "active",
      },
      OWNER,
    );
    await goLive(sold.campaign.id, true);
    await goLive(house.campaign.id, false);

    const waiting = await serve.call({ code: "header", path: "/" }, ANONYMOUS);
    const desktop = waiting!.fills.find((fill) => fill.breakpoint === "desktop")!;
    expect(desktop.needsThirdPartyConsent).toBe(true);
    expect(desktop.creative).toBeNull();

    const denied = await serve.call(
      { code: "header", path: "/", thirdPartyConsent: "denied" },
      ANONYMOUS,
    );
    const fallback = denied!.fills.find((fill) => fill.breakpoint === "desktop")!.creative;
    expect(fallback?.kind).toBe("native");
    expect(fallback?.headline).toBe("Subscribe");

    const granted = await serve.call(
      { code: "header", path: "/", thirdPartyConsent: "granted" },
      ANONYMOUS,
    );
    const running = granted!.fills.find((fill) => fill.breakpoint === "desktop")!.creative;
    expect(running?.kind).toBe("html_tag");
    expect(running?.tagHtml).toContain("creative.example");

    const t = translator("en");
    const ctx = { locale: "en", t, business: null, path: "/news" };
    const unresolved = await adSlot.resolve!({ code: "header" }, ctx);
    const waitingMarkup = renderToStaticMarkup(
      createElement("div", null, adSlot.render({ props: { code: "header" }, ctx, resolved: unresolved })),
    );
    expect(waitingMarkup).toContain(t("ads.consent.explanation"));
    expect(waitingMarkup).not.toContain("creative.example");

    const allowed = await adSlot.resolve!(
      { code: "header" },
      { ...ctx, thirdPartyConsent: "granted", cspNonce: "abc123" },
    );
    const allowedMarkup = renderToStaticMarkup(
      createElement("div", null, adSlot.render({
        props: { code: "header" },
        ctx: { ...ctx, thirdPartyConsent: "granted", cspNonce: "abc123" },
        resolved: allowed,
      })),
    );
    expect(allowedMarkup).toContain("creative.example");
    expect(allowedMarkup).toContain('nonce="abc123"');
    expect(allowedMarkup).not.toContain('rel="sponsored nofollow noopener"');
  });
});
