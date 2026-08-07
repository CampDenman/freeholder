// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The NAP render helper (MASTER.md §4.10).
//
// §4.10's rule, in full: "Primary location's NAP renders identically
// everywhere (exact-match string discipline) — the render helper is the only
// way to output NAP, so it *can't* drift."
//
// That is a statement about local SEO with a real mechanism behind it. Search
// engines corroborate a business by comparing the address on its site against
// directories, and "Unit 3, 210 Fifth St" versus "210 5th Street #3" is two
// businesses as far as that comparison is concerned. The failure mode is never
// deliberate: the footer is built once, the contact page is built six months
// later by someone reading the same database columns, and they differ by a
// comma. So there is one function, every surface calls it, and a second
// formatter would have to be written on purpose.
//
// It returns *parts* as well as strings, because JSON-LD needs the components
// separately — but they are the same components, from the same call, so the
// PostalAddress a crawler reads and the address a visitor reads cannot
// disagree.
import type { InferSelectModel } from "drizzle-orm";
import type { businessLocations } from "./schema";

export type LocationRow = InferSelectModel<typeof businessLocations>;

/** Everything a surface may render, and nothing it may reformat. */
export interface RenderedNAP {
  name: string;
  /**
   * The address as lines, in the order this country writes them. Rendered
   * one-per-line in HTML and joined with ", " for a single-line context —
   * both from here, so neither invents an order.
   */
  addressLines: string[];
  /** The lines as one string. The exact-match string §4.10 is talking about. */
  addressLine: string;
  /** True when there is no address to show — a service-area business. */
  addressHidden: boolean;
  phone: string | null;
  /** `tel:` form: digits, and a leading + if it is international. */
  phoneHref: string | null;
  email: string | null;
  country: string;
}

/**
 * Countries that write the postal code before the town on its own line —
 * "75001 Paris" rather than "Paris, NY 10001".
 *
 * A list rather than a library: full address formatting is a large problem
 * with a long tail, and the tail is not what NAP consistency turns on. What
 * matters is that a French address does not read as an American one, and that
 * whatever this produces, it produces every time. A country not listed gets
 * the fallback order, which is wrong for some of them — an honest limitation,
 * recorded here rather than hidden behind an approximation that looks total.
 */
const POSTAL_BEFORE_CITY = new Set([
  "AT", "BE", "CH", "CZ", "DE", "DK", "ES", "FI", "FR", "GR", "HR", "HU",
  "IS", "IT", "LT", "LU", "LV", "NL", "NO", "PL", "PT", "RO", "SE", "SI",
  "SK", "TR",
]);

/** Countries where the postcode sits on its own line after the town. */
const POSTAL_ON_ITS_OWN_LINE = new Set(["GB", "IE", "MT"]);

/**
 * A phone number as `tel:` wants it.
 *
 * Everything a human uses to read a number — spaces, brackets, dashes, dots —
 * is noise to a dialler, and a `tel:` link that keeps them is a link some
 * phones refuse. The displayed number is left exactly as the owner typed it,
 * because that is the string directories are matched against.
 */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (!digits) return null;
  // A + is only meaningful leading. "+1 (250) 555-0100" keeps its one.
  const international = digits.startsWith("+");
  const bare = digits.replace(/\+/g, "");
  return bare ? `tel:${international ? "+" : ""}${bare}` : null;
}

/**
 * The one way to turn a location row into something a surface can show.
 *
 * `hideAddress` is for a service-area business: §4.10 says a go-to-customer
 * business shows "no storefront address". It is passed rather than inferred
 * because an owner may have an address on file — for shipping, for tax — that
 * they do not want a visitor at their door about.
 */
export function renderNAP(
  location: LocationRow,
  options: { hideAddress?: boolean } = {},
): RenderedNAP {
  const hidden = options.hideAddress ?? false;

  const street = [location.street, location.unit].filter(Boolean).join(", ");
  const city = location.city ?? "";
  const region = location.region ?? "";
  const postal = location.postalCode ?? "";

  let cityLines: string[];
  if (POSTAL_BEFORE_CITY.has(location.country)) {
    cityLines = [[postal, city].filter(Boolean).join(" "), region];
  } else if (POSTAL_ON_ITS_OWN_LINE.has(location.country)) {
    cityLines = [city, region, postal];
  } else {
    // US, CA, AU, NZ and the fallback: "Courtenay, BC V9N 1A1".
    const tail = [region, postal].filter(Boolean).join(" ");
    cityLines = [[city, tail].filter(Boolean).join(city && tail ? ", " : "")];
  }

  const addressLines = hidden
    ? []
    : [street, ...cityLines].map((line) => line.trim()).filter(Boolean);

  return {
    name: location.name,
    addressLines,
    addressLine: addressLines.join(", "),
    addressHidden: hidden,
    phone: location.phone,
    phoneHref: telHref(location.phone),
    email: location.email,
    country: location.country,
  };
}

/**
 * The address parts, for schema.org PostalAddress.
 *
 * Deliberately beside `renderNAP` rather than in the JSON-LD builder: these
 * are the same columns the visible address is drawn from, and putting them in
 * one file is what makes "they cannot disagree" checkable by reading it.
 * Returns undefined when there is nothing to say, so the caller emits no
 * `address` key at all rather than an object full of nulls.
 */
export function postalAddress(
  location: LocationRow,
  options: { hideAddress?: boolean } = {},
): Record<string, string> | undefined {
  if (options.hideAddress) return undefined;

  const street = [location.street, location.unit].filter(Boolean).join(", ");
  const parts: Record<string, string> = {
    "@type": "PostalAddress",
    addressCountry: location.country,
  };
  if (street) parts.streetAddress = street;
  if (location.city) parts.addressLocality = location.city;
  if (location.region) parts.addressRegion = location.region;
  if (location.postalCode) parts.postalCode = location.postalCode;

  // Country alone is not an address; emitting it would tell a crawler this
  // business is somewhere in Canada, which is worse than saying nothing.
  return Object.keys(parts).length > 2 ? parts : undefined;
}
