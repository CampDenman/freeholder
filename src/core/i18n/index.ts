// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The string layer (MASTER.md §4.9, §7 step 1): exists before any feature is
// built. UI strings live in ICU MessageFormat catalogs under /locales —
// community-translatable JSON; content translations live in the
// EntityTranslation table (a later step-1 PR). Money helpers enforce the
// (amount_cents, currency) convention (§2 principle 9): formatting is the
// only place cents meet decimals.
import { IntlMessageFormat } from "intl-messageformat";
import {
  isLiteralElement,
  isPluralElement,
  isSelectElement,
  isTagElement,
} from "@formatjs/icu-messageformat-parser";
import { renderableTimezone } from "./zoned";
import en from "../../../locales/en.json";
import es from "../../../locales/es.json";
import fr from "../../../locales/fr.json";
import ar from "../../../locales/ar.json";

// Statically imported rather than read from disk at runtime: the catalogs must
// be present in the standalone build output (§14), and a dynamic read would
// leave them behind. Adding a locale is one import and one entry — and
// tests/core/i18n-gate.test.ts then requires it to be complete, so a
// half-finished catalog fails the build rather than falling back to English
// on the strings nobody got to.
const catalogs: Record<string, Record<string, string>> = { en, es, fr, ar };

export const DEFAULT_LOCALE = "en";
/**
 * A synthesized, deliberately expanded locale for layout and catalog QA.
 *
 * It is not in `catalogs`, so it can never appear in the production language
 * chooser by accident. Tests and local previews may still ask `t()` for it to
 * expose clipped controls, concatenated copy and strings that bypass catalogs.
 */
export const PSEUDO_LOCALE = "en-XA";

export type TextDirection = "ltr" | "rtl";

// Direction belongs to the script, not the language alone: `ar-Latn` is LTR
// while ordinary Arabic maximizes to Arab and is RTL. `Intl.Locale#maximize`
// supplies the likely script for tags that omit it.
const RTL_SCRIPTS = new Set([
  "Adlm",
  "Arab",
  "Aran",
  "Hebr",
  "Mand",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
  "Yezi",
]);

/** The document direction implied by a BCP-47 locale. Invalid tags stay LTR. */
export function localeDirection(locale: string): TextDirection {
  try {
    return RTL_SCRIPTS.has(new Intl.Locale(locale).maximize().script ?? "")
      ? "rtl"
      : "ltr";
  } catch {
    return "ltr";
  }
}

export function availableLocales(): string[] {
  return Object.keys(catalogs);
}

const formatterCache = new Map<string, IntlMessageFormat>();

const PSEUDO_GLYPHS: Record<string, string> = {
  a: "à", b: "ƀ", c: "ç", d: "ð", e: "ë", f: "ƒ", g: "ğ", h: "ħ",
  i: "ï", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ", n: "ñ", o: "ö", p: "þ",
  q: "ʠ", r: "ŕ", s: "š", t: "ţ", u: "ü", v: "ṽ", w: "ŵ", x: "ẋ",
  y: "ÿ", z: "ž",
  A: "À", B: "Ƀ", C: "Ç", D: "Ð", E: "Ë", F: "Ƒ", G: "Ğ", H: "Ħ",
  I: "Ï", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṁ", N: "Ñ", O: "Ö", P: "Þ",
  Q: "Ɋ", R: "Ŕ", S: "Š", T: "Ţ", U: "Ü", V: "Ṽ", W: "Ŵ", X: "Ẋ",
  Y: "Ÿ", Z: "Ž",
};

type MessageAst = ReturnType<InstanceType<typeof IntlMessageFormat>["getAst"]>;

function pseudoLiteral(value: string): string {
  const transformed = [...value]
    .map((character) => PSEUDO_GLYPHS[character] ?? character)
    .join("");
  const letters = [...value].filter((character) => /[A-Za-z]/.test(character)).length;
  return letters > 0
    ? `${transformed}${"·".repeat(Math.max(1, Math.ceil(letters * 0.3)))}`
    : transformed;
}

/** Accent and expand only literal AST nodes, never names or other parameters. */
function pseudoAst(elements: MessageAst): MessageAst {
  return elements.map((element) => {
    if (isLiteralElement(element)) {
      return { ...element, value: pseudoLiteral(element.value) };
    }
    if (isSelectElement(element) || isPluralElement(element)) {
      return {
        ...element,
        options: Object.fromEntries(
          Object.entries(element.options).map(([key, option]) => [
            key,
            { ...option, value: pseudoAst(option.value) },
          ]),
        ),
      };
    }
    if (isTagElement(element)) {
      return { ...element, children: pseudoAst(element.children) };
    }
    return element;
  });
}

function isPseudoLocale(locale: string): boolean {
  try {
    return Intl.getCanonicalLocales(locale)[0] === PSEUDO_LOCALE;
  } catch {
    return false;
  }
}

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
  const pseudo = isPseudoLocale(locale);
  const cacheKey = `${locale}|${from}|${key}`;
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = pseudo
      ? new IntlMessageFormat(
          pseudoAst(new IntlMessageFormat(message, DEFAULT_LOCALE).getAst()),
          locale,
        )
      : new IntlMessageFormat(message, locale);
    formatterCache.set(cacheKey, formatter);
  }
  const formatted = String(formatter.format(params));
  return pseudo ? `⟦${formatted}⟧` : formatted;
}

/**
 * A `t` with the locale already bound.
 *
 * Every call site would otherwise repeat the locale it just resolved, and the
 * one that forgets does not fail — it renders English at a French visitor. So
 * the locale is decided once, per request, and passed as a function.
 */
export type Translate = (
  key: string,
  params?: Record<string, string | number | Date>,
) => string;

export function translator(locale: string): Translate {
  return (key, params) => t(locale, key, params);
}

/** Every key in a catalog. Used by the i18n gate to compare catalogs. */
export function catalogKeys(locale: string): string[] {
  return Object.keys(catalogs[locale] ?? {});
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
  const decimal = moneyDecimal(
    amountMinorUnits,
    currency,
    format.resolvedOptions().maximumFractionDigits ?? 2,
  );
  // Intl accepts a decimal string (ES2023), which is what keeps this exact for
  // amounts past 2^53. TypeScript models that parameter as a template-literal
  // type no runtime-built string can satisfy, so the assertion narrows a type
  // rather than claiming anything about the value.
  return format.format(decimal as Intl.StringNumericLiteral);
}

/**
 * The same money as a bare decimal string: 123_456 minor CAD units give
 * `"1234.56"`, and 1000 Kuwaiti fils give `"1.000"`.
 *
 * Split out of `formatMoney` because a machine-read file is not a sentence. A
 * cell QuickBooks or Xero is going to import has to say `1234.56` rather than
 * `CA$1,234.56`: the symbol, the grouping separator and the locale's decimal
 * mark are three separate ways to make an importer read the wrong number, and
 * a French locale writing `1 234,56` splits the cell in two at the comma.
 *
 * It is deliberately the *same* assembly `formatMoney` uses — pad, slice,
 * insert the point — because the only thing worse than a second money
 * formatter is a second money formatter that rounds differently. No division
 * and no floats, here or there (§15.4).
 */
export function moneyDecimal(
  amountMinorUnits: number,
  currency: string,
  exponentHint?: number,
): string {
  if (!Number.isInteger(amountMinorUnits)) {
    throw new Error(
      `money must be integer minor units, got ${amountMinorUnits} — never do float math on money (MASTER.md §15.4).`,
    );
  }
  const exponent =
    exponentHint ??
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ??
    2;
  const sign = amountMinorUnits < 0 ? "-" : "";
  const digits = String(Math.abs(amountMinorUnits)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

const RANGE_PARTS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

/**
 * A North American zone's short generic abbreviation — "PT", "MT", "CT",
 * "ET", "AT", "AKT" — in place of its standard/daylight one, or undefined to
 * keep the short name as ICU gives it. Those abbreviations encode a daylight
 * rule, and Canada's rules changed in 2026: with tz data 2026e, ICU 78.3
 * calls a December in Vancouver "PDT", in Edmonton "MDT" and in Winnipeg
 * "CDT". The generic one is right under any rule. ICU adds its region to
 * some ("PT (Canada)"), which is dropped. Only a real abbreviation is used
 * (two to five capitals); a spelled-out generic ("Germany Time"), an offset
 * ("GMT+0") or nothing keeps the short name. Elsewhere the short name stays
 * exactly as it was, so Europe keeps "CET"/"CEST" and "GMT+1".
 */
function genericAbbreviation(locale: string, timezone: string, at: Date): string | undefined {
  if (!timezone.startsWith("America/")) return undefined;
  const generic = new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: "shortGeneric" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  const cleaned = generic?.replace(/\s*\([^()]*\)$/, "");
  return cleaned && /^[A-Z]{2,5}$/.test(cleaned) ? cleaned : undefined;
}

function withZoneName(
  parts: Array<Intl.DateTimeFormatPart & { source?: string }>,
  locale: string,
  timezone: string,
  start: Date,
  end: Date,
): string {
  return parts
    .map((part) =>
      part.type === "timeZoneName"
        ? genericAbbreviation(locale, timezone, part.source === "endRange" ? end : start) ?? part.value
        : part.value,
    )
    .join("");
}

/**
 * A start–end span as a visitor reads it, in the zone it happens in: "Sun,
 * Nov 8, 4:00 – 6:00 PM PT". `formatRange` drops what the two ends share,
 * so a same-day span names its day once and a span past midnight names both.
 */
export function formatDateTimeRange(
  start: Date,
  end: Date,
  timezone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const zone = renderableTimezone(timezone).timezone;
  const format = new Intl.DateTimeFormat(locale, { ...RANGE_PARTS, timeZone: zone });
  return withZoneName(format.formatRangeToParts(start, end), locale, zone, start, end);
}

/** One instant in the same reading, for a picker option or a list line. */
export function formatDateTimeShort(utc: Date, timezone: string, locale: string = DEFAULT_LOCALE): string {
  const zone = renderableTimezone(timezone).timezone;
  const format = new Intl.DateTimeFormat(locale, { ...RANGE_PARTS, timeZone: zone });
  return withZoneName(format.formatToParts(utc), locale, zone, utc, utc);
}

/**
 * A time zone as a visitor says it — "Pacific Time (Vancouver)" — rather than
 * its IANA id. The generic name is used, not the standard/daylight one: the
 * times beside it are already in that zone, and after British Columbia's 2026
 * move to permanent UTC−7, ICU 78 names Vancouver's winter "Pacific Daylight
 * Time", which reads as wrong in December. ICU sometimes adds its own region
 * to the generic name ("Pacific Time (Canada)"); the city replaces it. `at`
 * stays for zones whose generic name changes with history. An id the runtime
 * does not know is shown as given.
 */
export function zoneLabel(
  timezone: string,
  locale: string = DEFAULT_LOCALE,
  at: Date = new Date(),
): string {
  const named = (style: "long" | "longGeneric") =>
    new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: style })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? timezone;
  let name: string;
  try {
    name = named("longGeneric");
    // A zone with no generic name (UTC, Etc/GMT+5) gets a bare offset such as
    // "GMT+00:00"; its long name ("Coordinated Universal Time") reads better.
    if (/[+−-]\d/.test(name)) name = named("long");
  } catch {
    return timezone;
  }
  // Only a place id names a city. `Etc/GMT+5` would add "(GMT+5)" beside
  // "GMT-05:00" (POSIX signs are inverted), and "UTC" has no city at all.
  const city = timezone.includes("/") && !timezone.startsWith("Etc/")
    ? timezone.split("/").at(-1)!.replace(/_/g, " ")
    : "";
  if (!city || name.includes(city)) return name;
  return `${name.replace(/\s*\([^()]*\)$/, "")} (${city})`;
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
