// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paywalls over grants (MASTER.md §4.15, C9.15).
import { createElement, Fragment } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { ready } from "@/core/runtime";
import { collectJsonLd, parseBlockTree } from "@/modules/cms/blocks/registry";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockRenderContext } from "@/modules/cms/blocks/types";
import {
  appliesTo,
  previewChildCount,
  selectPreviewChildren,
} from "@/core/paywalls/evaluate";
import { meterCounters } from "@/core/paywalls/schema";
import { evaluatePaywall, savePaywall } from "@/core/paywalls/service";
import { mergeContacts } from "@/core/contacts/service";
import { fromPlainString } from "@/modules/cms/blocks/rich";
import {
  priceListEntries,
  priceLists,
  productVariants,
  products,
} from "@/modules/catalog/schema";
import { savePlan, subscribe } from "@/modules/subscriptions/service";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

function t(key: string) {
  return key;
}

function ctx(overrides: Partial<BlockRenderContext> = {}): BlockRenderContext {
  return {
    locale: "en",
    t,
    business: { name: "Studio", tagline: null },
    path: "/members/journal",
    ...overrides,
  };
}

async function htmlOf(overrides: Partial<BlockRenderContext> = {}): Promise<string> {
  const nodes = await renderBlocks(parseBlockTree(TREE, "page"), ctx(overrides));
  return renderToStaticMarkup(createElement(Fragment, null, ...nodes));
}

const TREE = [
  {
    id: "p",
    type: "paywall",
    props: { teaser: "Locked", ctaLabel: "Join", ctaHref: "/join" },
    children: [
      { id: "h", type: "heading", props: { text: "Secret heading", level: 2 } },
      { id: "a", type: "text", props: { body: fromPlainString("Secret one.") } },
      { id: "b", type: "text", props: { body: fromPlainString("Secret two.") } },
    ],
  },
];

describe("paywall helpers", () => {
  it("matches exact selectors and stars, never the wrong kind", () => {
    expect(appliesTo({ kind: "page", selector: "*" }, "page", "members/journal")).toBe(true);
    expect(appliesTo({ kind: "page", selector: "/members/journal" }, "page", "members/journal")).toBe(
      true,
    );
    expect(appliesTo({ kind: "page", selector: "other" }, "page", "members/journal")).toBe(false);
    expect(appliesTo({ kind: "product", selector: "*" }, "page", "members/journal")).toBe(false);
  });

  it("never lets a percent preview round up to the whole tree from a tiny lead-in", () => {
    expect(previewChildCount(4, "percent", 25)).toBe(1);
    expect(previewChildCount(3, "blocks", 1)).toBe(1);
    expect(selectPreviewChildren([{ type: "heading" }, { type: "text" }, { type: "text" }], "blocks", 1)).toEqual(
      [{ type: "heading" }],
    );
  });

  it("keeps a hero image with the first paragraph and drops whatever follows", () => {
    const children = [{ type: "image" }, { type: "heading" }, { type: "text" }, { type: "image" }];
    expect(selectPreviewChildren(children, "paragraphs", 1)).toEqual([
      { type: "image" },
      { type: "heading" },
    ]);
    expect(selectPreviewChildren(children, "paragraphs", 2)).toEqual([
      { type: "image" },
      { type: "heading" },
      { type: "text" },
    ]);
    expect(selectPreviewChildren([{ type: "image" }, { type: "image" }], "paragraphs", 1)).toEqual([]);
  });

  it("names the gated part in JSON-LD, not the teaser", () => {
    const json = collectJsonLd(parseBlockTree(TREE, "page"));
    expect(json.some((row) => row.cssSelector === "[data-paywall-gated]")).toBe(true);
    expect(json.some((row) => row.cssSelector === "[data-paywall-teaser]")).toBe(false);
    expect(json.some((row) => row["@type"] === "FAQPage")).toBe(false);
  });
});

describe.runIf(hasDatabase)("paywalls", () => {
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
  });

  afterAll(async () => {
    await closeDb();
  });

  async function member() {
    const { contact } = await resolveContact.call(
      { email: "member@example.test", name: "Member", country: "CA" },
      OWNER,
    );
    return contact;
  }

  async function club() {
    const [product] = await db()
      .insert(products)
      .values({
        name: "Club",
        slug: "club",
        kind: "digital",
        status: "active",
        publishedAt: new Date(),
      })
      .returning();
    const [variant] = await db()
      .insert(productVariants)
      .values({
        productId: product!.id,
        combinationKey: "default",
        sku: "club-1",
        isDefault: true,
      })
      .returning();
    const [list] = await db()
      .insert(priceLists)
      .values({ name: "CAD", currency: "CAD", active: true })
      .returning();
    await db().insert(priceListEntries).values({
      priceListId: list!.id,
      variantId: variant!.id,
      amountMinor: 2_500,
    });
    return savePlan.call(
      { productId: product!.id, name: "Monthly", interval: "month", status: "active" },
      OWNER,
    );
  }

  it("keeps gated copy out of the HTML until a matching paywall grants it", async () => {
    const html = await htmlOf();
    expect(html).toContain("Locked");
    expect(html).not.toContain("Secret heading");
  });

  it("lets a hard paywall open for a member and stay shut for a stranger", async () => {
    const wall = await savePaywall.call(
      {
        name: "Journal",
        appliesTo: { kind: "page", selector: "members/journal" },
        mode: "hard",
      },
      OWNER,
    );
    const person = await member();
    const plan = await club();
    await subscribe.call({ contactId: person.id, planId: plan.id }, OWNER);
    await db().insert(users).values({ id: CUSTOMER.userId, email: "member@example.test", role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, person.id));

    const stranger = await evaluatePaywall.call(
      { paywallId: wall.id, selector: "members/journal" },
      { kind: "anonymous" },
    );
    expect(stranger.reveal).toBe("none");
    expect(stranger.allowed).toBe(false);

    const granted = await evaluatePaywall.call(
      { paywallId: wall.id, selector: "members/journal" },
      CUSTOMER,
    );
    expect(granted.allowed).toBe(true);
    expect(granted.reveal).toBe("all");

    const html = await htmlOf({ actor: CUSTOMER });
    expect(html).toContain("Secret heading");
    expect(html).not.toContain("Locked");
  });

  it("shows a soft lead-in and never the rest", async () => {
    await savePaywall.call(
      {
        name: "Soft journal",
        appliesTo: { kind: "page", selector: "*" },
        mode: "soft",
        previewStrategy: "blocks",
        previewValue: 1,
      },
      OWNER,
    );
    const html = await htmlOf();
    expect(html).toContain("Secret heading");
    expect(html).not.toContain("Secret one.");
    expect(html).toContain("Locked");
  });

  it("meters the same visitor, crawler or not, and refuses a meter with no free views", async () => {
    const wall = await savePaywall.call(
      {
        name: "Sample",
        appliesTo: { kind: "page", selector: "*" },
        mode: "metered",
        meterCount: 1,
        seoPolicy: "flexible_sampling",
      },
      OWNER,
    );
    const first = await evaluatePaywall.call(
      { paywallId: wall.id, selector: "members/journal", anonId: "visitor-1" },
      { kind: "anonymous" },
    );
    const second = await evaluatePaywall.call(
      { paywallId: wall.id, selector: "members/journal", anonId: "visitor-1" },
      { kind: "anonymous" },
    );
    expect(first.allowed).toBe(true);
    expect(first.seoPolicy).toBe("flexible_sampling");
    expect(second.allowed).toBe(false);
    expect(second.reveal).toBe("none");

    const nameless = await evaluatePaywall.call(
      { paywallId: wall.id, selector: "members/journal" },
      { kind: "anonymous" },
    );
    expect(nameless.reveal).toBe("none");

    const refused = await failure(
      savePaywall.call(
        {
          name: "Broken meter",
          appliesTo: { kind: "page", selector: "*" },
          mode: "metered",
          meterCount: 0,
        },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
  });

  it("treats registration as a signed-in contact, not as a grant", async () => {
    const wall = await savePaywall.call(
      {
        name: "Register",
        appliesTo: { kind: "page", selector: "*" },
        mode: "registration",
      },
      OWNER,
    );
    expect(
      (await evaluatePaywall.call({ paywallId: wall.id, selector: "x" }, { kind: "anonymous" }))
        .allowed,
    ).toBe(false);
    const person = await member();
    await db().insert(users).values({ id: CUSTOMER.userId, email: "member@example.test", role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, person.id));
    expect(
      (await evaluatePaywall.call({ paywallId: wall.id, selector: "x" }, CUSTOMER)).allowed,
    ).toBe(true);
  });

  it("merges meter rows per paywall instead of dropping the duplicate's other walls", async () => {
    const journal = await savePaywall.call(
      {
        name: "Journal meter",
        appliesTo: { kind: "page", selector: "journal" },
        mode: "metered",
        meterCount: 3,
      },
      OWNER,
    );
    const extras = await savePaywall.call(
      {
        name: "Extras meter",
        appliesTo: { kind: "page", selector: "extras" },
        mode: "metered",
        meterCount: 3,
      },
      OWNER,
    );
    const keep = await member();
    const { contact: dupe } = await resolveContact.call(
      { email: "dupe@example.test", name: "Dupe", country: "CA" },
      OWNER,
    );
    const now = new Date("2026-04-01T00:00:00Z");
    const earlier = new Date("2026-03-01T00:00:00Z");
    await db().insert(meterCounters).values([
      {
        paywallId: journal.id,
        contactId: keep.id,
        windowStartsAt: now,
        count: 2,
      },
      {
        paywallId: journal.id,
        contactId: dupe.id,
        windowStartsAt: earlier,
        count: 5,
      },
      {
        paywallId: extras.id,
        contactId: dupe.id,
        windowStartsAt: now,
        count: 1,
      },
    ]);
    await mergeContacts.call({ survivingId: keep.id, duplicateId: dupe.id }, OWNER);
    const kept = await db()
      .select()
      .from(meterCounters)
      .where(eq(meterCounters.contactId, keep.id));
    expect(kept).toHaveLength(2);
    const journalMeter = kept.find((row) => row.paywallId === journal.id);
    const extrasMeter = kept.find((row) => row.paywallId === extras.id);
    expect(journalMeter?.count).toBe(5);
    expect(journalMeter?.windowStartsAt.toISOString()).toBe(earlier.toISOString());
    expect(extrasMeter?.count).toBe(1);
    expect(
      await db().select().from(meterCounters).where(eq(meterCounters.contactId, dupe.id)),
    ).toHaveLength(0);
  });
});
