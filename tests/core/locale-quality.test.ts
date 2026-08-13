// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Catalog pseudo-locale and RTL layout gates (MASTER.md C1.17, §4.9).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  availableLocales,
  localeDirection,
  PSEUDO_LOCALE,
  t,
} from "@/core/i18n";
import { languageName, localePath } from "@/core/i18n/customer";
import { LOCALE_FIXTURES, RTL_LOCALE_FIXTURES } from "../fixtures/locales";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("locale-specific fixtures", () => {
  it.each(LOCALE_FIXTURES)(
    "$locale renders its own catalog, language name and route",
    (fixture) => {
      expect(t(fixture.locale, "common.save")).toBe(fixture.save);
      expect(t(fixture.locale, "portal.login.title")).toBe(fixture.portalTitle);
      expect([0, 1, 7].map((count) => t(fixture.locale, "contacts.count", { count })))
        .toEqual(fixture.contacts);
      expect(t(fixture.regionalLocale, "common.save")).toBe(fixture.save);
      expect(languageName(fixture.locale)).toBe(fixture.nativeName);
      expect(localeDirection(fixture.locale)).toBe(fixture.direction);
      expect(localePath("services", fixture.locale, "en")).toBe(fixture.path);
    },
  );
});

describe("the synthesized pseudo-locale", () => {
  it("expands catalog literals while preserving interpolated owner data", () => {
    const source = t("en", "setup.done.title", { name: "Aurora" });
    const pseudo = t(PSEUDO_LOCALE, "setup.done.title", { name: "Aurora" });

    expect(pseudo).toMatch(/^⟦.*⟧$/u);
    expect(pseudo).toContain("Aurora");
    expect(pseudo).toContain("ŕëàðÿ");
    expect(pseudo.length).toBeGreaterThan(source.length * 1.25);
  });

  it("keeps ICU plural selection executable", () => {
    const zero = t(PSEUDO_LOCALE, "contacts.count", { count: 0 });
    const one = t(PSEUDO_LOCALE, "contacts.count", { count: 1 });
    const many = t(PSEUDO_LOCALE, "contacts.count", { count: 7 });

    expect(zero).not.toBe(one);
    expect(one).toContain("1");
    expect(many).toContain("7");
  });

  it("cannot become a production language-chooser option", () => {
    expect(availableLocales()).not.toContain(PSEUDO_LOCALE);
    expect(localeDirection(PSEUDO_LOCALE)).toBe("ltr");
  });
});

describe("RTL layout readiness", () => {
  it.each(RTL_LOCALE_FIXTURES)(
    "$locale resolves to $direction",
    ({ locale, direction }) => {
      expect(localeDirection(locale)).toBe(direction);
    },
  );

  it("stamps the resolved direction on the document root", () => {
    const layout = readFileSync(join(root, "app", "layout.tsx"), "utf8");
    expect(layout).toContain("dir={localeDirection(locale)}");
  });

  it("keeps UI source free of physical-direction layout utilities", () => {
    const files: string[] = [];
    const visit = (path: string) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const child = join(path, entry.name);
        if (entry.isDirectory()) visit(child);
        else if (/\.(?:css|tsx?)$/.test(entry.name)) files.push(child);
      }
    };
    for (const directory of ["app", "src/ui", "src/modules"]) {
      visit(join(root, directory));
    }

    const physicalUtility = /(?:^|[\s"'`])(?:-?[mp][lr]-\S+|space-x-\S+|divide-x-\S+|border-[lr](?:-\S+)?|rounded-[lr](?:-\S+)?|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right)|origin-(?:left|right)|(?:left|right)-\S+)(?=$|[\s"'`])/g;
    const physicalCss = /\b(?:(?:margin|padding|border)-(?:left|right)|(?:left|right))\s*:/g;
    const violations = files.flatMap((file) => {
      // Prose can quite reasonably say "left:"; the contract is about CSS and
      // utility tokens, so remove comments before scanning executable source.
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return [...source.matchAll(physicalUtility), ...source.matchAll(physicalCss)]
        .map((match) => `${relative(root, file).replaceAll("\\", "/")}: ${match[0].trim()}`);
    });

    expect(files.length).toBeGreaterThan(50);
    expect(
      violations,
      `Use logical start/end utilities (for example text-start, ps-, me-, border-s-) so RTL mirrors automatically.\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
