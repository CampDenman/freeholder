// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
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
import { availableLocales, catalogKeys, DEFAULT_LOCALE } from "@/core/i18n";
import { BUSINESS_TYPES } from "@/core/settings/defaults";
import { THEME_PREFERENCES } from "@/core/design/theme";
import { CONTACT_STAGES } from "../../app/(admin)/admin/contacts/contactLabels";

const root = fileURLToPath(new URL("../..", import.meta.url));
const defaultKeys = new Set(catalogKeys(DEFAULT_LOCALE));

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
