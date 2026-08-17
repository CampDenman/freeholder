// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.21: product, event and newsletter URLs share the public entity registry.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { updateBusiness } from "@/core/settings/service";
import { publishedPaths } from "@/modules/cms/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { activateProduct, createProduct } from "@/modules/catalog/service";
import { createEvent, publishEvent } from "@/modules/events/service";
import { createIssue, createNewsletter, publishIssue } from "@/modules/newsletters/service";
import { entitiesOfKind, toPublicEntity } from "@/core/seo/entities";
import { renderEntityFeed } from "@/core/seo/feeds";
import { eventJsonLd } from "@/core/seo/jsonld";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("C2.21 public entity feeds", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Aurora Coast Photography",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  });
  afterAll(closeDb);

  it("fills product, event and newsletter feeds from the same published paths", async () => {
    const tax = await createTaxCategory.call({ code: "standard", name: "Standard" }, OWNER);
    const product = await createProduct.call(
      { name: "Print set", slug: "print-set", kind: "physical", taxCategoryId: tax.id },
      OWNER,
    );
    await activateProduct.call({ id: product.id, expectedVersion: product.version }, OWNER);

    const event = await createEvent.call(
      { name: "Coast workshop", slug: "coast-workshop", venueName: "Studio 3" },
      OWNER,
    );
    await publishEvent.call({ id: event.id, expectedVersion: event.version }, OWNER);

    const newsletter = await createNewsletter.call({ name: "Coast notes", slug: "coast-notes" }, OWNER);
    const issue = await createIssue.call(
      { newsletterId: newsletter.id, slug: "august-light", title: "August light", body: "Hello." },
      OWNER,
    );
    await publishIssue.call({ id: issue.id, expectedVersion: issue.version }, OWNER);

    const paths = await publishedPaths.call({ locale: "en" }, ANONYMOUS);
    const entities = paths.map((entry) => toPublicEntity(entry, "en"));
    expect(entitiesOfKind(entities, "product").map((row) => row.slug)).toContain("products/print-set");
    expect(entitiesOfKind(entities, "event").map((row) => row.slug)).toContain("events/coast-workshop");
    expect(entitiesOfKind(entities, "newsletter").map((row) => row.slug)).toContain(
      "newsletters/august-light",
    );

    expect(
      renderEntityFeed({
        origin: "https://example.test",
        kind: "products",
        title: "Products",
        entities,
      }),
    ).toContain("https://example.test/products/print-set");
    expect(
      renderEntityFeed({
        origin: "https://example.test",
        kind: "events",
        title: "Events",
        entities,
      }),
    ).toContain("https://example.test/events/coast-workshop");
    expect(
      renderEntityFeed({
        origin: "https://example.test",
        kind: "newsletters",
        title: "Newsletters",
        entities,
      }),
    ).toContain("https://example.test/newsletters/august-light");
  });
});

describe("Event JSON-LD", () => {
  it("describes a scheduled event with a venue", () => {
    expect(
      eventJsonLd({
        name: "Coast workshop",
        url: "https://example.test/events/coast-workshop",
        startDate: "2026-09-01T17:00:00.000Z",
        venueName: "Studio 3",
        venueAddress: "210 Fifth Street",
      }),
    ).toMatchObject({
      "@type": "Event",
      name: "Coast workshop",
      eventStatus: "https://schema.org/EventScheduled",
      location: { "@type": "Place", name: "Studio 3" },
    });
  });
});
