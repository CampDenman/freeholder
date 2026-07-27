// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Smart defaults for first boot (MASTER.md §13 step 3): the owner picks a
// country and the currency, timezone, units and week start follow. They stay
// editable — the point is that nobody should have to answer five questions
// when one implies the rest.
//
// A starting set, not a world atlas. Adding a country is one row here, and the
// list is ordered by where a one-person creative business is most likely to be
// reading this. Timezone is the most common business zone, not the only one.

export interface CountryDefaults {
  code: string;
  currency: string;
  timezone: string;
  units: "metric" | "imperial";
  /** 0 = Sunday, matching Date#getDay. */
  firstDayOfWeek: number;
  locales: string[];
}

export const COUNTRY_DEFAULTS: readonly CountryDefaults[] = [
  { code: "CA", currency: "CAD", timezone: "America/Toronto", units: "metric", firstDayOfWeek: 0, locales: ["en", "fr-CA"] },
  { code: "US", currency: "USD", timezone: "America/New_York", units: "imperial", firstDayOfWeek: 0, locales: ["en"] },
  { code: "GB", currency: "GBP", timezone: "Europe/London", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "IE", currency: "EUR", timezone: "Europe/Dublin", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "AU", currency: "AUD", timezone: "Australia/Sydney", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "NZ", currency: "NZD", timezone: "Pacific/Auckland", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "FR", currency: "EUR", timezone: "Europe/Paris", units: "metric", firstDayOfWeek: 1, locales: ["fr"] },
  { code: "DE", currency: "EUR", timezone: "Europe/Berlin", units: "metric", firstDayOfWeek: 1, locales: ["de"] },
  { code: "ES", currency: "EUR", timezone: "Europe/Madrid", units: "metric", firstDayOfWeek: 1, locales: ["es"] },
  { code: "IT", currency: "EUR", timezone: "Europe/Rome", units: "metric", firstDayOfWeek: 1, locales: ["it"] },
  { code: "NL", currency: "EUR", timezone: "Europe/Amsterdam", units: "metric", firstDayOfWeek: 1, locales: ["nl"] },
  { code: "PT", currency: "EUR", timezone: "Europe/Lisbon", units: "metric", firstDayOfWeek: 1, locales: ["pt"] },
  { code: "SE", currency: "SEK", timezone: "Europe/Stockholm", units: "metric", firstDayOfWeek: 1, locales: ["sv"] },
  { code: "NO", currency: "NOK", timezone: "Europe/Oslo", units: "metric", firstDayOfWeek: 1, locales: ["nb"] },
  { code: "DK", currency: "DKK", timezone: "Europe/Copenhagen", units: "metric", firstDayOfWeek: 1, locales: ["da"] },
  { code: "CH", currency: "CHF", timezone: "Europe/Zurich", units: "metric", firstDayOfWeek: 1, locales: ["de", "fr"] },
  { code: "MX", currency: "MXN", timezone: "America/Mexico_City", units: "metric", firstDayOfWeek: 0, locales: ["es"] },
  { code: "BR", currency: "BRL", timezone: "America/Sao_Paulo", units: "metric", firstDayOfWeek: 0, locales: ["pt"] },
  { code: "JP", currency: "JPY", timezone: "Asia/Tokyo", units: "metric", firstDayOfWeek: 0, locales: ["ja"] },
  { code: "SG", currency: "SGD", timezone: "Asia/Singapore", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
  { code: "ZA", currency: "ZAR", timezone: "Africa/Johannesburg", units: "metric", firstDayOfWeek: 1, locales: ["en"] },
];

export const DEFAULT_COUNTRY = "CA";

export function defaultsFor(code: string): CountryDefaults {
  return (
    COUNTRY_DEFAULTS.find((c) => c.code === code) ??
    COUNTRY_DEFAULTS.find((c) => c.code === DEFAULT_COUNTRY)!
  );
}

/**
 * Country names in the reader's language, from the platform rather than a
 * hardcoded English list — "Deutschland" for a German owner (§4.9).
 */
export function countryName(code: string, locale = "en"): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

export function currencyName(code: string, locale = "en"): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

/**
 * schema.org business types the owner picks from (§13 step 2). This choice
 * drives the JSON-LD on every public page, so it is identity rather than
 * decoration — a Photographer and a HairSalon emit different structured data.
 */
export const BUSINESS_TYPES = [
  { value: "LocalBusiness", label: "General business" },
  { value: "Photographer", label: "Photography" },
  { value: "ProfessionalService", label: "Professional services" },
  { value: "HomeAndConstructionBusiness", label: "Trades and construction" },
  { value: "HealthAndBeautyBusiness", label: "Health and beauty" },
  { value: "HairSalon", label: "Hair salon" },
  { value: "FoodEstablishment", label: "Food and drink" },
  { value: "Store", label: "Shop" },
  { value: "EntertainmentBusiness", label: "Entertainment" },
  { value: "EducationalOrganization", label: "Teaching and courses" },
] as const;
