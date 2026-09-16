// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What the retrieval index is built from (MASTER.md §31, C9.22).
//
// Published pages, help articles (which are pages with a category), the
// catalog, locations and hours, and owner-written knowledge rows. A draft,
// a hidden location or a switched-off knowledge entry is not a fact the
// assistant may quote.
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { businessLocations, openingHours } from "@/core/locations/schema";
import { pages } from "@/modules/cms/schema";
import { products } from "@/modules/catalog/schema";
import type { ChunkSource } from "./contract";
import { knowledgeEntries } from "./schema";
import { clip, textFromBlocks } from "./text";

export interface CorpusDocument {
  sourceType: ChunkSource;
  sourceId: string;
  locale: string;
  title: string;
  body: string;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function collectDocuments(tx: Tx): Promise<CorpusDocument[]> {
  const docs: CorpusDocument[] = [];

  const published = await tx
    .select({
      id: pages.id,
      slug: pages.slug,
      locale: pages.locale,
      title: pages.title,
      blocks: pages.blocks,
      helpCategoryId: pages.helpCategoryId,
    })
    .from(pages)
    .where(eq(pages.status, "published"));
  for (const page of published) {
    const body = clip([page.title, textFromBlocks(page.blocks)].filter(Boolean).join("\n"));
    if (!body) continue;
    docs.push({
      sourceType: page.helpCategoryId ? "help" : "page",
      sourceId: page.id,
      locale: page.locale,
      title: page.title,
      body,
    });
  }

  const catalog = await tx
    .select({
      id: products.id,
      name: products.name,
      kind: products.kind,
      subtitle: products.subtitle,
      description: products.description,
    })
    .from(products)
    .where(and(eq(products.status, "active"), eq(products.visibility, "public")));
  for (const product of catalog) {
    const body = clip(
      [
        product.name,
        product.kind,
        product.subtitle,
        textFromBlocks(product.description),
      ]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join("\n"),
    );
    if (!body) continue;
    docs.push({
      sourceType: "product",
      sourceId: product.id,
      locale: "en",
      title: product.name,
      body,
    });
  }

  const locations = await tx
    .select()
    .from(businessLocations)
    .where(eq(businessLocations.status, "visible"));
  for (const location of locations) {
    const hours = await tx
      .select()
      .from(openingHours)
      .where(eq(openingHours.locationId, location.id));
    const hourLines = hours.map((row) => {
      const when = row.onDate ?? WEEKDAYS[row.weekday ?? 0] ?? "day";
      if (row.closed) return `${when}: closed`;
      return `${when}: ${row.opens ?? "?"}–${row.closes ?? "?"}`;
    });
    const body = clip(
      [
        location.name,
        [location.street, location.unit, location.city, location.region, location.postalCode]
          .filter(Boolean)
          .join(", "),
        location.phone,
        location.email,
        location.priceRange ? `Price range: ${location.priceRange}` : null,
        hourLines.length > 0 ? `Opening hours:\n${hourLines.join("\n")}` : null,
      ]
        .filter((part): part is string => Boolean(part && String(part).trim()))
        .join("\n"),
    );
    docs.push({
      sourceType: "location",
      sourceId: location.id,
      locale: "en",
      title: location.name,
      body,
    });
  }

  const knowledge = await tx
    .select()
    .from(knowledgeEntries)
    .where(eq(knowledgeEntries.enabled, true));
  for (const entry of knowledge) {
    docs.push({
      sourceType: "knowledge",
      sourceId: entry.id,
      locale: entry.locale,
      title: entry.title,
      body: clip(`${entry.title}\n${entry.body}`),
    });
  }

  return docs;
}
