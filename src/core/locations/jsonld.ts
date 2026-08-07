// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// LocalBusiness structured data (MASTER.md §4.10, §5).
//
// §4.10: "Each location emits LocalBusiness (or subtype: Photographer,
// HairSalon, etc. — owner picks from schema.org business types in setup)
// JSON-LD with geo, hours, priceRange, sameAs."
//
// Plain builders over plain data, matching core/seo/jsonld.ts — no database
// handle, no request, nothing to mock. The address comes from `postalAddress`
// in nap.ts rather than from these columns directly, which is the mechanism
// behind §4.10's exact-match rule: the structured data and the visible
// address are two projections of one call.
import type { InferSelectModel } from "drizzle-orm";
import type { openingHours, serviceAreas } from "./schema";
import { postalAddress, type LocationRow } from "./nap";

export type OpeningHoursRow = InferSelectModel<typeof openingHours>;
export type ServiceAreaRow = InferSelectModel<typeof serviceAreas>;

const CONTEXT = "https://schema.org";

/** schema.org spells the days out, and starts its week on Monday. */
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Hours as OpeningHoursSpecification.
 *
 * A stated closure emits a specification with equal opens and closes, which is
 * how schema.org says "closed" — omitting the day would only say nobody
 * mentioned it, and the two are different claims to a search result that
 * offers to tell somebody whether a shop is open right now.
 *
 * Weekly rules and date overrides both live here: a weekly rule carries
 * `dayOfWeek`, a dated one carries `validFrom`/`validThrough` set to the same
 * day, which is the vocabulary's way of saying "this day only".
 */
export function openingHoursJsonLd(
  rows: OpeningHoursRow[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const times = row.closed
      ? { opens: "00:00", closes: "00:00" }
      : { opens: trimSeconds(row.opens), closes: trimSeconds(row.closes) };
    return {
      "@type": "OpeningHoursSpecification",
      ...(row.weekday !== null
        ? { dayOfWeek: `${CONTEXT}/${DAY_NAMES[row.weekday]}` }
        : { validFrom: row.onDate, validThrough: row.onDate }),
      ...times,
    };
  });
}

/** Postgres `time` reads back as HH:MM:SS; schema.org examples use HH:MM. */
function trimSeconds(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 5);
}

/**
 * Where the business will travel to (§4.10's ServiceArea).
 *
 * A radius becomes a GeoCircle, which is the type a search engine can reason
 * about geometrically; named regions become Places, which is all that can
 * honestly be said about "Vancouver Island" without inventing a polygon.
 */
export function areaServedJsonLd(
  area: ServiceAreaRow | null | undefined,
): unknown {
  if (!area) return undefined;
  if (area.kind === "radius") {
    return {
      "@type": "GeoCircle",
      geoMidpoint: {
        "@type": "GeoCoordinates",
        latitude: Number(area.centerLatitude),
        longitude: Number(area.centerLongitude),
      },
      // schema.org geoRadius is in metres, and the column is kilometres
      // because that is what an owner types into the admin.
      geoRadius: Math.round(Number(area.radiusKm) * 1000),
    };
  }
  const places = area.regions.map((name) => ({ "@type": "Place", name }));
  return places.length === 1 ? places[0] : places;
}

export interface LocalBusinessInput {
  location: LocationRow;
  hours?: OpeningHoursRow[];
  serviceArea?: ServiceAreaRow | null;
  /** Falls back to the business profile's type — see schema.ts. */
  businessSchemaType: string;
  /** Absolute URL of this location's own page, or the site root. */
  url: string;
  /** Only when this location has no address of its own to show. */
  hideAddress?: boolean;
}

/**
 * One location as schema.org.
 *
 * Every key is omitted rather than emitted empty. Structured data is read as
 * a set of claims, and `"telephone": null` is a claim about a phone number.
 */
export function localBusinessJsonLd(input: LocalBusinessInput): Record<string, unknown> {
  const { location } = input;
  const hideAddress = input.hideAddress ?? false;
  const address = postalAddress(location, { hideAddress });
  const hours = openingHoursJsonLd(input.hours ?? []);
  const areaServed = areaServedJsonLd(input.serviceArea);

  return {
    "@context": CONTEXT,
    "@type": location.schemaType ?? input.businessSchemaType,
    name: location.name,
    url: input.url,
    ...(address ? { address } : {}),
    ...(location.latitude !== null && location.longitude !== null && !hideAddress
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: Number(location.latitude),
            longitude: Number(location.longitude),
          },
        }
      : {}),
    ...(location.phone ? { telephone: location.phone } : {}),
    ...(location.email ? { email: location.email } : {}),
    ...(location.priceRange ? { priceRange: location.priceRange } : {}),
    ...(hours.length > 0 ? { openingHoursSpecification: hours } : {}),
    ...(areaServed ? { areaServed } : {}),
    // The Google Business Profile is a sameAs like any other, and the most
    // valuable one for a local business (§33) — so it is folded in here
    // rather than left as a column only the admin screen ever reads.
    ...(() => {
      const links = [
        ...(location.googleBusinessProfileUrl
          ? [location.googleBusinessProfileUrl]
          : []),
        ...location.sameAs,
      ];
      return links.length > 0 ? { sameAs: links } : {};
    })(),
  };
}
