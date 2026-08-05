// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Location pages (MASTER.md §4.10, §5, §32).
//
// The listeners are called directly here rather than through the event bus.
// That is deliberate: the bus is tested where the bus lives, and what these
// tests are about is what a location page *is* — a real cms page, one hop
// below a real index, in the sitemap, editable, and still there when the
// location is deleted.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { pages } from "@/modules/cms/schema";
import { publishedPaths } from "@/modules/cms/service";
import {
  onLocationCreated,
  onLocationDeleted,
  onLocationUpdated,
} from "@/modules/cms/locations";
import {
  createLocationService,
  updateLocation,
} from "@/core/locations/service";
import { updateBusiness } from "@/core/settings/service";
import { resolveRedirect } from "@/core/seo/service";
import {
  ANONYMOUS,
  closeDb,
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

const CANADIAN = {
  name: "Aurora Coast Photography",
  slug: "courtenay",
  street: "210 Fifth Street",
  city: "Courtenay",
  region: "BC",
  postalCode: "V9N 1A1",
  country: "CA",
};

async function pageAt(slug: string) {
  const [page] = await db()
    .select()
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.locale, "en")))
    .limit(1);
  return page ?? null;
}

describe.runIf(hasDatabase)("a location's page", () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("is a real page, not a route that renders a row", async () => {
    // §32: "structure is data; code is vocabulary". A generated page an owner
    // could not edit would have made location pages the one exception.
    const location = await createLocationService.call(CANADIAN, OWNER);
    await onLocationCreated({ id: location.id, slug: location.slug });

    const page = await pageAt("locations/courtenay");
    expect(page).not.toBeNull();
    expect(page?.status).toBe("published");
    // Titled by the place, not the business: for the usual one-location case
    // they are the same words, and "Aurora Coast Photography · Aurora Coast
    // Photography" is what the layout would then render.
    expect(page?.title).toBe("Courtenay");
  });

  it("sits one hop below an index that exists (§5's RIBA rule)", async () => {
    const location = await createLocationService.call(CANADIAN, OWNER);
    await onLocationCreated({ id: location.id, slug: location.slug });

    const index = await pageAt("locations");
    expect(index?.status).toBe("published");
    // The index lists what exists now rather than a hand-kept list, which is
    // what makes §5's "no orphan pages" hold without anyone maintaining it.
    const blocks = index?.blocks as Array<{ type: string }>;
    expect(blocks.some((block) => block.type === "locationsIndex")).toBe(true);
  });

  it("is in the sitemap, because it is a page", async () => {
    // The payoff of §32's decision: the SEO layer needed no new source.
    const location = await createLocationService.call(CANADIAN, OWNER);
    await onLocationCreated({ id: location.id, slug: location.slug });

    const paths = (await publishedPaths.call({ locale: "en" }, ANONYMOUS)) as Array<{
      slug: string;
    }>;
    const slugs = paths.map((entry) => entry.slug);
    expect(slugs).toContain("locations");
    expect(slugs).toContain("locations/courtenay");
  });

  it("carries the NAP block rather than a copy of the address", async () => {
    // A page holding its own copy of the address is a second source of truth,
    // which is precisely what §4.10 exists to prevent: editing the location
    // would leave the page saying the old thing.
    const location = await createLocationService.call(CANADIAN, OWNER);
    await onLocationCreated({ id: location.id, slug: location.slug });

    const page = await pageAt("locations/courtenay");
    const blocks = page?.blocks as Array<{ type: string; props: Record<string, unknown> }>;
    const nap = blocks.find((block) => block.type === "nap");
    expect(nap?.props.locationId).toBe(location.id);
    expect(JSON.stringify(blocks)).not.toContain("210 Fifth Street");
  });

  it("moves with the location, leaving a redirect", async () => {
    // §5: "slugs never silently break". The redirect is cms.updatePage's, so
    // this also proves the two mechanisms are actually connected.
    const location = await createLocationService.call(CANADIAN, OWNER);
    await onLocationCreated({ id: location.id, slug: location.slug });

    await updateLocation.call({ id: location.id, slug: "comox-valley" }, OWNER);
    await onLocationUpdated({ id: location.id, slug: "comox-valley" });

    expect(await pageAt("locations/comox-valley")).not.toBeNull();
    await expect(
      resolveRedirect.call({ path: "locations/courtenay", locale: "en" }, ANONYMOUS),
    ).resolves.toMatchObject({ toPath: "locations/comox-valley" });
  });

  it("survives the location being deleted, unpublished", async () => {
    // §4.10 has a `hidden` status precisely so closing a location is not a
    // deletion — and whatever the owner wrote on the page is theirs.
    const location = await createLocationService.call(CANADIAN, OWNER);
    await onLocationCreated({ id: location.id, slug: location.slug });
    await onLocationDeleted({ id: location.id, slug: location.slug });

    const page = await pageAt("locations/courtenay");
    expect(page).not.toBeNull();
    expect(page?.status).toBe("draft");

    const paths = (await publishedPaths.call({ locale: "en" }, ANONYMOUS)) as Array<{
      slug: string;
    }>;
    expect(paths.map((entry) => entry.slug)).not.toContain("locations/courtenay");
  });

  it("does not build a second page when replayed", async () => {
    // The outbox is at-least-once (§11), so every listener has to survive
    // being handed the same event twice.
    const location = await createLocationService.call(CANADIAN, OWNER);
    await onLocationCreated({ id: location.id, slug: location.slug });
    await onLocationCreated({ id: location.id, slug: location.slug });

    const all = await db()
      .select()
      .from(pages)
      .where(eq(pages.slug, "locations/courtenay"));
    expect(all).toHaveLength(1);
  });

  it("gives a hidden location no page at all", async () => {
    const location = await createLocationService.call(
      { ...CANADIAN, slug: "winter", status: "hidden" },
      OWNER,
    );
    await onLocationCreated({ id: location.id, slug: location.slug });
    expect(await pageAt("locations/winter")).toBeNull();
    // And no index either — §4.10: no empty local scaffolding.
    expect(await pageAt("locations")).toBeNull();
  });

  it("builds nothing for a business with no locations", async () => {
    expect(await pageAt("locations")).toBeNull();
  });
});
