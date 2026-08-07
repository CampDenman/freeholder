// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The business-profile field labels, shared by the setup wizard (§13 steps
// 2–3) and the admin settings screen that edits the same fields afterwards.
//
// One definition because they are one form asked twice: a label that says
// "Currency you charge in" during setup and "Base currency" in settings is two
// names for one field, and the owner has to work out that they match.
import type { Translate } from "@/core/i18n";
import {
  ALL_CURRENCIES,
  ALL_TIMEZONES,
  BUSINESS_TYPES,
  COUNTRY_DEFAULTS,
  countryName,
  currencyName,
  withCurrent,
} from "@/core/settings/defaults";

export interface Option {
  value: string;
  label: string;
}

/**
 * The option lists, named in the reader's language.
 *
 * Built on the server rather than in the form component, because the names
 * come from `Intl.DisplayNames` and need a locale — and a client component has
 * no way to know which one this instance publishes in. Rendering them in the
 * browser is what produced "Deutschland" spelled "Germany" for a German owner.
 */
export interface BusinessOptions {
  countries: Option[];
  currencies: Option[];
  timezones: Option[];
  businessTypes: Option[];
}

export function businessOptions(
  locale: string,
  t: Translate,
  current: { currency?: string; timezone?: string } = {},
): BusinessOptions {
  return {
    countries: COUNTRY_DEFAULTS.map((entry) => ({
      value: entry.code,
      label: countryName(entry.code, locale),
    })),
    // `withCurrent` keeps a stored value selectable even if it is not in the
    // platform's list — a select whose options omit its own value silently
    // falls back to the first one, which is how a business in Vancouver
    // quietly became one in Johannesburg.
    currencies: withCurrent(ALL_CURRENCIES, current.currency).map((code) => ({
      value: code,
      label: `${code} — ${currencyName(code, locale)}`,
    })),
    timezones: withCurrent(ALL_TIMEZONES, current.timezone).map((zone) => ({
      value: zone,
      label: zone.replaceAll("_", " "),
    })),
    businessTypes: BUSINESS_TYPES.map((value) => ({
      value,
      label: t(`business.type.${value}`),
    })),
  };
}

export interface BusinessFieldLabels {
  name: string;
  namePlaceholder: string;
  tagline: string;
  taglineHint: string;
  taglinePlaceholder: string;
  schemaType: string;
  schemaTypeHint: string;
  country: string;
  countryHint: string;
  baseCurrency: string;
  timezone: string;
  units: string;
  unitsMetric: string;
  unitsImperial: string;
  firstDayOfWeek: string;
  sunday: string;
  monday: string;
  locales: string;
  localesHint: string;
}

export function businessFormLabels(t: Translate): BusinessFieldLabels {
  return {
    name: t("business.name"),
    namePlaceholder: t("business.namePlaceholder"),
    tagline: t("business.tagline"),
    taglineHint: t("business.taglineHint"),
    taglinePlaceholder: t("business.taglinePlaceholder"),
    schemaType: t("business.schemaType"),
    schemaTypeHint: t("business.schemaTypeHint"),
    country: t("business.country"),
    countryHint: t("business.countryHint"),
    baseCurrency: t("business.baseCurrency"),
    timezone: t("business.timezone"),
    units: t("business.units"),
    unitsMetric: t("business.units.metric"),
    unitsImperial: t("business.units.imperial"),
    firstDayOfWeek: t("business.firstDayOfWeek"),
    sunday: t("business.weekday.sunday"),
    monday: t("business.weekday.monday"),
    locales: t("business.locales"),
    localesHint: t("business.localesHint"),
  };
}
