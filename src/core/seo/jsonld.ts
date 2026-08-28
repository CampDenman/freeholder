// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Structured data (MASTER.md §5, "JSON-LD by page type").
//
// Plain builders over plain data — no framework, no side effects — so they can
// be asserted against directly. §15.2 is meant to validate this output against
// schema.org types; keeping it as returned objects rather than emitted strings
// is what makes that gate cheap to write when it lands.
//
// What each page gets is decided by what the page *is*, not by a setting an
// owner has to find: the home page describes the site and the business, every
// other page carries a breadcrumb trail, and blocks contribute their own
// (an FAQ block emits FAQPage — see the block registry).

export interface BusinessFacts {
  name: string;
  tagline: string | null;
  /** schema.org type the owner chose in setup (§13 step 2). */
  schemaType: string;
  baseCurrency: string;
}

export type JsonLd = Record<string, unknown>;

const CONTEXT = "https://schema.org";

/** The site itself. Home page only — it describes the whole domain. */
export function websiteJsonLd(origin: string, business: BusinessFacts): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: business.name,
    url: `${origin}/`,
    ...(business.tagline ? { description: business.tagline } : {}),
  };
}

/**
 * The business behind the site.
 *
 * The owner's chosen schema.org type is used verbatim — Photographer,
 * HairSalon, ProfessionalService. §13 calls that choice "identity, not
 * decoration", and this is where it earns that: a Photographer and a HairSalon
 * emit genuinely different structured data from the same code.
 */
export function organizationJsonLd(
  origin: string,
  business: BusinessFacts,
): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": business.schemaType,
    name: business.name,
    url: `${origin}/`,
    ...(business.tagline ? { description: business.tagline } : {}),
    ...(business.baseCurrency
      ? { currenciesAccepted: business.baseCurrency }
      : {}),
  };
}

/**
 * The trail from the root to this page (§5: BreadcrumbList on all non-home).
 *
 * Derived from the path, because the path *is* the hierarchy under RIBA — a
 * page at services/weddings is one hop below services by construction, and a
 * breadcrumb that disagreed with the URL would be describing a different site
 * to a crawler than the one a visitor walks.
 */
export function breadcrumbJsonLd(
  origin: string,
  slug: string,
  titleFor: (segmentPath: string) => string,
): JsonLd | undefined {
  if (slug === "") return undefined;

  const segments = slug.split("/").filter(Boolean);
  const items = [
    { name: titleFor(""), item: `${origin}/` },
    ...segments.map((_, index) => {
      const path = segments.slice(0, index + 1).join("/");
      return { name: titleFor(path), item: `${origin}/${path}` };
    }),
  ];

  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  };
}

/** Title-case a path segment when nothing better is known about it. */
export function humanizeSegment(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface ProductOfferFacts {
  name: string;
  description?: string | null;
  url: string;
  sku?: string | null;
  brand?: string | null;
  image?: string | null;
  price?: string;
  priceCurrency?: string;
  availability?: "InStock" | "OutOfStock" | "PreOrder";
}

/**
 * A sellable thing (§5: Product + Offer on product pages).
 *
 * Price is already a decimal string from the money layer — this file does
 * not convert minor units, so it cannot invent a floating-point amount.
 * An offer is omitted when the catalog has not published a list price yet.
 */
export function productJsonLd(facts: ProductOfferFacts): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Product",
    name: facts.name,
    url: facts.url,
    ...(facts.description ? { description: facts.description } : {}),
    ...(facts.sku ? { sku: facts.sku } : {}),
    ...(facts.brand ? { brand: { "@type": "Brand", name: facts.brand } } : {}),
    ...(facts.image ? { image: facts.image } : {}),
    ...(facts.price && facts.priceCurrency
      ? {
          offers: {
            "@type": "Offer",
            url: facts.url,
            price: facts.price,
            priceCurrency: facts.priceCurrency,
            availability: `https://schema.org/${facts.availability ?? "InStock"}`,
          },
        }
      : {}),
  };
}

export function eventJsonLd(input: {
  name: string;
  url: string;
  description?: string | null;
  startDate?: string;
  endDate?: string;
  eventStatus?: "EventScheduled" | "EventCancelled" | "EventPostponed";
  venueName?: string | null;
  venueAddress?: string | null;
  remainingAttendeeCapacity?: number;
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Event",
    name: input.name,
    url: input.url,
    eventStatus: `https://schema.org/${input.eventStatus ?? "EventScheduled"}`,
    ...(input.description ? { description: input.description } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
    ...(input.remainingAttendeeCapacity !== undefined
      ? { remainingAttendeeCapacity: input.remainingAttendeeCapacity }
      : {}),
    ...(input.venueName || input.venueAddress
      ? {
          location: {
            "@type": "Place",
            ...(input.venueName ? { name: input.venueName } : {}),
            ...(input.venueAddress
              ? { address: { "@type": "PostalAddress", streetAddress: input.venueAddress } }
              : {}),
          },
        }
      : {}),
  };
}

export function serviceJsonLd(input: {
  name: string;
  url: string;
  description?: string | null;
  providerName?: string | null;
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Service",
    name: input.name,
    url: input.url,
    ...(input.description ? { description: input.description } : {}),
    ...(input.providerName
      ? { provider: { "@type": "Organization", name: input.providerName } }
      : {}),
  };
}

export function articleJsonLd(input: {
  headline: string;
  url: string;
  description?: string | null;
  dateModified?: Date;
  authorName?: string | null;
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: input.headline,
    url: input.url,
    mainEntityOfPage: input.url,
    ...(input.description ? { description: input.description } : {}),
    ...(input.dateModified
      ? { dateModified: input.dateModified.toISOString() }
      : {}),
    ...(input.authorName
      ? { author: { "@type": "Person", name: input.authorName } }
      : {}),
  };
}

export function creativeWorkJsonLd(input: {
  name: string;
  url: string;
  description?: string | null;
  dateCreated?: string | null;
  images?: Array<{ url: string; caption?: string | null }>;
  services?: Array<{ name: string; url: string }>;
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "CreativeWork",
    name: input.name,
    url: input.url,
    mainEntityOfPage: input.url,
    ...(input.description ? { description: input.description } : {}),
    ...(input.dateCreated ? { dateCreated: input.dateCreated } : {}),
    ...(input.images?.length
      ? {
          image: input.images.map((image) => ({
            "@type": "ImageObject",
            contentUrl: image.url,
            ...(image.caption ? { caption: image.caption } : {}),
          })),
        }
      : {}),
    ...(input.services?.length
      ? {
          about: input.services.map((service) => ({
            "@type": "Service",
            name: service.name,
            url: service.url,
          })),
        }
      : {}),
  };
}

export function collectionPageJsonLd(input: {
  name: string;
  url: string;
  description?: string | null;
}): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "CollectionPage",
    name: input.name,
    url: input.url,
    ...(input.description ? { description: input.description } : {}),
  };
}
