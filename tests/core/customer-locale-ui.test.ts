// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Keyboard and static accessibility contract for customer locale selection.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { translator } from "@/core/i18n";
import { PortalLocaleChooser } from "../../app/portal/PortalLocaleChooser";
import { auditHtml } from "../../scripts/a11y-smoke.mjs";

function page() {
  const chooser = renderToStaticMarkup(createElement(PortalLocaleChooser, {
    locale: "fr",
    policy: { defaultLocale: "en", enabledLocales: ["en", "fr", "es"] },
    path: "/portal/login",
    signedIn: false,
    t: translator("fr"),
  }));
  return `<!doctype html><html lang="fr"><head><title>Connexion</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Connexion</h1>${chooser}</main></body></html>`;
}

describe("customer locale chooser markup", () => {
  it("passes the static accessibility gate", async () => {
    expect((await auditHtml(page(), "https://example.test/fr/portal/login")).violations)
      .toEqual([]);
  });

  it("uses crawlable, keyboard-native language links with one current choice", () => {
    const document = new JSDOM(page()).window.document;
    expect(document.querySelector("nav")?.getAttribute("aria-label")).toBe("Langue");
    expect(document.querySelectorAll("a[href][hreflang]")).toHaveLength(3);
    expect(document.querySelectorAll('a[aria-current="true"]')).toHaveLength(1);
    expect(document.querySelector('a[hreflang="fr"]')?.getAttribute("href"))
      .toBe("/fr/portal/login");
    expect(document.querySelector('a[hreflang="en"]')?.getAttribute("href"))
      .toBe("/portal/login");
  });
});
