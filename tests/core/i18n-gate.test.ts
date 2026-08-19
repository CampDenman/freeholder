// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The i18n gate's second half (MASTER.md §15.3).
//
// The lint rule stops a *new* hardcoded string reaching a screen. These tests
// stop the other two failure modes, both of which lint cannot see:
//
//   1. a `t("some.key")` whose key does not exist — `t` falls back to
//      returning the key, so the bug ships as the literal text
//      "contacts.field.emailHint" rendered at a business owner;
//   2. a translated catalog drifting from the default one, in either
//      direction — missing keys render English, orphaned keys are dead weight
//      that hides which strings a translator still owes.
//
// Both run against the files, not a database, so every contributor gets them.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";
import {
  isArgumentElement,
  isDateElement,
  isLiteralElement,
  isNumberElement,
  isPluralElement,
  isPoundElement,
  isSelectElement,
  isTagElement,
  isTimeElement,
} from "@formatjs/icu-messageformat-parser";
import { availableLocales, catalogKeys, DEFAULT_LOCALE } from "@/core/i18n";
import { BUSINESS_TYPES } from "@/core/settings/defaults";
import { THEME_PREFERENCES } from "@/core/design/theme";
import { CONTACT_STAGES } from "../../app/(admin)/admin/contacts/contactLabels";
import {
  CART_STATUSES,
  COUPON_KINDS,
  FULFILLMENT_STATUSES,
  GIFT_CARD_STATUSES,
  OFFER_RULE_KINDS,
  ORDER_STATUSES,
  RETURN_STATUSES,
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
} from "@/modules/catalog/contract";
import { IMPORT_STATUSES, PLUGIN_STATUSES } from "@/core/plugins/schema";
import { BOARD_COLUMNS, TASK_STATUSES } from "@/core/agents/service";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import { LOCALE_FIXTURES } from "../fixtures/locales";

const root = fileURLToPath(new URL("../..", import.meta.url));
const defaultKeys = new Set(catalogKeys(DEFAULT_LOCALE));
const catalogData: Record<string, Record<string, string>> = { en, es, fr };

type MessageAst = ReturnType<InstanceType<typeof IntlMessageFormat>["getAst"]>;
type FormatValues = NonNullable<
  Parameters<InstanceType<typeof IntlMessageFormat>["format"]>[0]
>;

/** Argument names, kinds and selector branches are API, not translator copy. */
function messageContract(message: string, locale: string): string[] {
  const found = new Set<string>();
  const walk = (elements: MessageAst) => {
    for (const element of elements) {
      if (!isLiteralElement(element) && !isPoundElement(element)) {
        found.add(`${element.type}:${element.value}`);
      }
      if (isSelectElement(element)) {
        found.add(
          `${element.type}:${element.value}:options:${Object.keys(element.options).sort().join(",")}`,
        );
        for (const option of Object.values(element.options)) walk(option.value);
      }
      if (isPluralElement(element)) {
        found.add(`${element.type}:${element.value}:pluralType:${element.pluralType}`);
        for (const option of Object.values(element.options)) walk(option.value);
      }
      if (isTagElement(element)) walk(element.children);
    }
  };
  walk(new IntlMessageFormat(message, locale).getAst());
  return [...found].sort();
}

interface PluralContract {
  pluralType: "cardinal" | "ordinal";
  options: Set<string>;
}

/** Plural categories may grow for another language; explicit branches may not vanish. */
function pluralContracts(message: string, locale: string): Map<string, PluralContract> {
  const found = new Map<string, PluralContract>();
  const walk = (elements: MessageAst) => {
    for (const element of elements) {
      if (isSelectElement(element)) {
        for (const option of Object.values(element.options)) walk(option.value);
      }
      if (isPluralElement(element)) {
        const pluralType = element.pluralType ?? "cardinal";
        const key = `${element.value}:${pluralType}`;
        const contract = found.get(key) ?? {
          pluralType,
          options: new Set<string>(),
        };
        for (const option of Object.keys(element.options)) contract.options.add(option);
        found.set(key, contract);
        for (const option of Object.values(element.options)) walk(option.value);
      }
      if (isTagElement(element)) walk(element.children);
    }
  };
  walk(new IntlMessageFormat(message, locale).getAst());
  return found;
}

/** Values that take every message through a real formatter during the gate. */
function fixtureValues(ast: MessageAst): FormatValues {
  const values: Record<string, unknown> = {};
  const priority = new Map<string, number>();
  const set = (name: string, value: unknown, rank: number) => {
    if ((priority.get(name) ?? -1) <= rank) {
      values[name] = value;
      priority.set(name, rank);
    }
  };
  const walk = (elements: MessageAst) => {
    for (const element of elements) {
      if (isArgumentElement(element)) set(element.value, "Fixture", 0);
      if (isNumberElement(element)) set(element.value, 1234, 2);
      if (isDateElement(element) || isTimeElement(element)) {
        set(element.value, new Date("2026-08-12T12:00:00Z"), 2);
      }
      if (isSelectElement(element)) {
        const branch = Object.hasOwn(element.options, "other")
          ? "other"
          : Object.keys(element.options)[0] ?? "other";
        set(element.value, branch, 3);
        for (const option of Object.values(element.options)) walk(option.value);
      }
      if (isPluralElement(element)) {
        set(element.value, 7, 4);
        for (const option of Object.values(element.options)) walk(option.value);
      }
      if (isTagElement(element)) {
        set(element.value, (chunks: unknown) => chunks, 5);
        walk(element.children);
      }
    }
  };
  walk(ast);
  return values;
}

/** Every .ts/.tsx under app/ and src/, skipping build output. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * Literal keys only. A template key — t(`contacts.stage.${stage}`) — cannot be
 * resolved without running the code, so those families are asserted by name
 * further down instead of being silently skipped.
 */
function literalKeysUsed(): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const pattern = /\bt\(\s*"([a-zA-Z0-9_.]+)"/g;
  for (const dir of ["app", "src"]) {
    for (const file of sourceFiles(join(root, dir))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(pattern)) {
        const key = match[1]!;
        const where = uses.get(key) ?? [];
        where.push(file.slice(root.length).replaceAll("\\", "/"));
        uses.set(key, where);
      }
    }
  }
  return uses;
}

describe("every key the code asks for exists", () => {
  it("finds t() calls at all", () => {
    // Guards the scanner: a regex that silently stops matching would make
    // every assertion below pass while checking nothing.
    expect(literalKeysUsed().size).toBeGreaterThan(30);
  });

  it("has a default-locale string for each one", () => {
    const missing = [...literalKeysUsed()]
      .filter(([key]) => !defaultKeys.has(key))
      // The i18n module's own tests call t() with deliberately absent keys.
      .filter(([key]) => !key.startsWith("test."))
      .map(([key, files]) => `${key}  (${[...new Set(files)].join(", ")})`);

    expect(
      missing,
      missing.length === 0
        ? ""
        : `These keys are used in code but missing from locales/${DEFAULT_LOCALE}.json:\n` +
            `${missing.join("\n")}\n\n` +
            `t() returns the key itself when a string is missing, so this ships as ` +
            `raw dotted text rendered at a business owner.`,
    ).toEqual([]);
  });
});

describe("the families built from a template key", () => {
  // These are t(`prefix.${value}`) call sites, invisible to the scanner above.
  // Each is asserted against the list the code actually iterates, so adding a
  // lifecycle stage or a schema.org type without its string fails here.
  it.each([
    ["contacts.stage", CONTACT_STAGES],
    ["contacts.stagePlural", CONTACT_STAGES],
    ["business.type", BUSINESS_TYPES],
    ["theme", THEME_PREFERENCES],
    ["catalog.kind", PRODUCT_KINDS],
    ["catalog.status", PRODUCT_STATUSES],
    ["catalog.visibility", PRODUCT_VISIBILITIES],
    ["catalog.carts.status", CART_STATUSES],
    ["catalog.orders.status", ORDER_STATUSES],
    ["catalog.fulfill.status", FULFILLMENT_STATUSES],
    ["catalog.returns.status", RETURN_STATUSES],
    ["catalog.promo.couponKind", COUPON_KINDS],
    ["catalog.promo.giftStatus", GIFT_CARD_STATUSES],
    ["catalog.promo.offerKind", OFFER_RULE_KINDS],
    ["work.status", TASK_STATUSES],
    ["work.column", BOARD_COLUMNS],
    ["plugins.status", PLUGIN_STATUSES],
    [
      "imports.status",
      IMPORT_STATUSES,
    ],
    [
      "imports.kind",
      [
        "html",
        "sitemap",
        "rss",
        "atom",
        "wordpress-rest",
        "wordpress-wxr",
        "archive",
      ],
    ],
  ])("names every member of %s", (prefix, values) => {
    const missing = values
      .map((value) => `${prefix}.${value}`)
      .filter((key) => !defaultKeys.has(key));
    expect(missing).toEqual([]);
  });
});

describe("translated catalogs match the default", () => {
  const others = availableLocales().filter((l) => l !== DEFAULT_LOCALE);

  it("ships the default locale", () => {
    expect(availableLocales()).toContain(DEFAULT_LOCALE);
    expect(defaultKeys.size).toBeGreaterThan(0);
  });

  it.each(others.length > 0 ? others : [])(
    "%s has no key the default locale lacks",
    (locale) => {
      // An orphan key is either a typo or a string deleted from the default
      // catalog and left behind here — both are dead weight that make the
      // remaining work look smaller than it is.
      const orphans = catalogKeys(locale).filter((k) => !defaultKeys.has(k));
      expect(orphans).toEqual([]);
    },
  );

  it.each(others.length > 0 ? others : [])(
    "%s translates every key",
    (locale) => {
      const translated = new Set(catalogKeys(locale));
      const untranslated = [...defaultKeys].filter((k) => !translated.has(k));
      expect(
        untranslated,
        `locales/${locale}.json is missing ${untranslated.length} keys, which will render in ` +
          `${DEFAULT_LOCALE} instead. Add them or remove the catalog.`,
      ).toEqual([]);
    },
  );
});

describe("every shipped catalog is executable", () => {
  it("has one maintained fixture for every selectable catalog", () => {
    expect(Object.keys(catalogData).sort()).toEqual(availableLocales().sort());
    expect(LOCALE_FIXTURES.map(({ locale }) => locale).sort()).toEqual(
      availableLocales().sort(),
    );
  });

  it("contains only non-empty ICU messages", () => {
    const invalid = Object.entries(catalogData).flatMap(([locale, catalog]) =>
      Object.entries(catalog)
        .filter(([, message]) => typeof message !== "string" || message.trim() === "")
        .map(([key]) => `${locale}:${key}`),
    );
    expect(invalid).toEqual([]);
  });

  it("parses and formats every message in English, French and Spanish", () => {
    const failures: string[] = [];
    for (const [locale, catalog] of Object.entries(catalogData)) {
      for (const [key, message] of Object.entries(catalog)) {
        try {
          const formatter = new IntlMessageFormat(message, locale);
          const rendered = String(formatter.format(fixtureValues(formatter.getAst())));
          if (rendered.trim() === "") failures.push(`${locale}:${key} rendered empty`);
        } catch (error) {
          failures.push(
            `${locale}:${key} ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps ICU arguments and selector branches identical to English", () => {
    const failures: string[] = [];
    for (const locale of ["fr", "es"]) {
      for (const [key, source] of Object.entries(en)) {
        const expected = messageContract(source, DEFAULT_LOCALE);
        const translated = catalogData[locale]![key]!;
        const actual = messageContract(translated, locale);
        if (expected.join("|") !== actual.join("|")) {
          failures.push(
            `${locale}:${key}\n  en ${expected.join("|")}\n  ${locale} ${actual.join("|")}`,
          );
        }

        const sourcePlurals = pluralContracts(source, DEFAULT_LOCALE);
        const translatedPlurals = pluralContracts(translated, locale);
        for (const [pluralKey, sourcePlural] of sourcePlurals) {
          const translatedPlural = translatedPlurals.get(pluralKey);
          if (!translatedPlural) continue;
          const validCategories: Set<string> = new Set(
            new Intl.PluralRules(locale, { type: translatedPlural.pluralType })
              .resolvedOptions().pluralCategories,
          );
          const required = [...sourcePlural.options].filter(
            (option) => option.startsWith("=") || validCategories.has(option),
          );
          const missing = required.filter(
            (option) => !translatedPlural.options.has(option),
          );
          const invalid = [...translatedPlural.options].filter(
            (option) => !option.startsWith("=") && !validCategories.has(option),
          );
          if (missing.length > 0 || invalid.length > 0) {
            failures.push(
              `${locale}:${key}:${pluralKey} missing [${missing.join(",")}] invalid [${invalid.join(",")}]`,
            );
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
