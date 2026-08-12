// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
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
import en from "../../../locales/en.json";
import es from "../../../locales/es.json";
import fr from "../../../locales/fr.json";

// Statically imported rather than read from disk at runtime: the catalogs must
// be present in the standalone build output (§14), and a dynamic read would
// leave them behind. Adding a locale is one import and one entry — and
// tests/core/i18n-gate.test.ts then requires it to be complete, so a
// half-finished catalog fails the build rather than falling back to English
// on the strings nobody got to.
const catalogs: Record<string, Record<string, string>> = { en, es, fr };

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
