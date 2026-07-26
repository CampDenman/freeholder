// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The string layer (MASTER.md §4.9, §7 step 1): exists before any feature is
// built. UI strings live in ICU MessageFormat catalogs under /locales —
// community-translatable JSON; content translations live in the
// EntityTranslation table (a later step-1 PR). Money helpers enforce the
// (amount_cents, currency) convention (§2 principle 9): formatting is the
// only place cents meet decimals.
import { IntlMessageFormat } from "intl-messageformat";
import en from "../../../locales/en.json";

const catalogs: Record<string, Record<string, string>> = { en };

export const DEFAULT_LOCALE = "en";

export function availableLocales(): string[] {
  return Object.keys(catalogs);
}

const formatterCache = new Map<string, IntlMessageFormat>();

/**
 * Narrow a BCP-47 tag toward the default: fr-CA → fr → en. Locales in §4.9 are
 * regional tags, so a Québécois visitor must reach the French catalog before
 * English is considered at all — a missing region must not undo the language.
 */
export function catalogChain(locale: string): string[] {
  const parts = locale.split("-");
  const chain = parts.map((_, i) => parts.slice(0, parts.length - i).join("-"));
  return chain.includes(DEFAULT_LOCALE) ? chain : [...chain, DEFAULT_LOCALE];
}

/**
 * Translate a catalog key. Falls back along the language chain, then to the
 * key itself — loudly in dev, so missing strings surface before the i18n gate
 * finds them. Formatting always uses the *requested* locale, even when the
 * string came from a broader catalog, so numbers and dates stay regional.
 */
export function t(
  locale: string,
  key: string,
  params?: Record<string, string | number | Date>,
): string {
  let message: string | undefined;
  let from = DEFAULT_LOCALE;
  for (const candidate of catalogChain(locale)) {
    const hit = catalogs[candidate]?.[key];
    if (hit !== undefined) {
      message = hit;
      from = candidate;
      break;
    }
  }
  if (message === undefined) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`i18n: missing catalog key "${key}" (${locale})`);
    }
    return key;
  }
  const cacheKey = `${locale}|${from}|${key}`;
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new IntlMessageFormat(message, locale);
    formatterCache.set(cacheKey, formatter);
  }
  return String(formatter.format(params));
}

/**
 * All money is (amount_minor_units, currency); never floats, never auto-FX.
 *
 * "Cents" is a two-decimal assumption, and most of the world isn't. ¥1000 is
 * 1000 minor units, not 10; 1000 Kuwaiti fils is 1.000 KWD, not 10.000. The
 * exponent comes from the currency itself, and the decimal string is assembled
 * by hand and handed to Intl as a string — so no division and no rounding. The
 * bound is the caller's: a JS number holds exact integers to 2^53 (≈ $90tn in
 * cents), and this function adds no error of its own (§2 principle 9, §15.4).
 */
export function formatMoney(
  amountMinorUnits: number,
  currency: string,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isInteger(amountMinorUnits)) {
    throw new Error(
      `formatMoney expects integer minor units, got ${amountMinorUnits} — never do float math on money (MASTER.md §15.4).`,
    );
  }
  const format = new Intl.NumberFormat(locale, { style: "currency", currency });
  const exponent = format.resolvedOptions().maximumFractionDigits ?? 2;
  const sign = amountMinorUnits < 0 ? "-" : "";
  const digits = String(Math.abs(amountMinorUnits)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  const decimal = `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
  // Intl accepts a decimal string (ES2023), which is what keeps this exact for
  // amounts past 2^53. TypeScript models that parameter as a template-literal
  // type no runtime-built string can satisfy, so the assertion narrows a type
  // rather than claiming anything about the value.
  return format.format(decimal as Intl.StringNumericLiteral);
}

/** Store UTC, display in an explicit timezone (§4.9 timezone discipline). */
export function formatDateTime(
  utc: Date,
  timezone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(utc);
}
