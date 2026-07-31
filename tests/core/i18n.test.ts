// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  catalogChain,
  DEFAULT_LOCALE,
  formatDateTime,
  formatMoney,
  t,
} from "@/core/i18n";

describe("t()", () => {
  it("formats ICU plurals, including the zero case", () => {
    expect(t("en", "contacts.count", { count: 0 })).toBe("No contacts yet");
    expect(t("en", "contacts.count", { count: 1 })).toBe("1 contact");
    expect(t("en", "contacts.count", { count: 7 })).toBe("7 contacts");
  });

  it("returns the key itself when the string is missing", () => {
    expect(t("en", "nope.not.a.key")).toBe("nope.not.a.key");
  });

  describe("the shipped translations actually format", () => {
    // A catalog can be complete (the i18n gate proves that) and still be
    // broken at render time, because ICU treats an apostrophe as an escape
    // character. French is full of them — "n'a", "l'instant", "d'e-mail" —
    // and a mis-parsed one silently swallows the rest of the message.
    it("renders French apostrophes literally rather than as ICU quoting", () => {
      expect(t("fr", "common.somethingWentWrong")).toBe(
        "Une erreur s'est produite. Réessayez.",
      );
      expect(t("fr", "contacts.merge.noEmail")).toBe("pas d'e-mail");
      expect(t("fr", "admin.settings.intro")).toContain(
        "L'identité de cette entreprise",
      );
    });

    it("pluralizes in French and Spanish", () => {
      expect(t("fr", "contacts.count", { count: 0 })).toBe("Aucun contact");
      expect(t("fr", "contacts.count", { count: 1 })).toBe("1 contact");
      expect(t("fr", "contacts.count", { count: 7 })).toBe("7 contacts");

      expect(t("es", "contacts.count", { count: 0 })).toBe(
        "Aún no hay contactos",
      );
      expect(t("es", "contacts.count", { count: 1 })).toBe("1 contacto");
      expect(t("es", "contacts.count", { count: 7 })).toBe("7 contactos");
    });

    it("interpolates placeholders in every shipped locale", () => {
      expect(t("es", "setup.done.title", { name: "Aurora" })).toBe(
        "Aurora está listo",
      );
      expect(t("fr", "contacts.merge.noResults", { query: "Grace" })).toBe(
        "Personne d'autre ne correspond à « Grace ».",
      );
      expect(t("es", "contacts.paging", { from: 1, to: 25, total: 60 })).toBe(
        "1–25 de 60",
      );
    });

    it("falls back along the language chain, not straight to English", () => {
      // A Québécois owner reaches the French catalog before English is
      // considered at all — a missing region must not undo the language.
      expect(t("fr-CA", "auth.login.title")).toBe("Connexion");
      expect(t("es-MX", "admin.nav.settings")).toBe("Ajustes");
    });
  });

  it("serves a regional locale from the base catalog", () => {
    expect(t("en-GB", "common.save")).toBe("Save");
  });
});

describe("catalogChain()", () => {
  it("narrows a regional tag toward the language before the default", () => {
    // The bug this guards: fr-CA jumping straight to English and silently
    // discarding a perfectly good French catalog (§4.9).
    expect(catalogChain("fr-CA")).toEqual(["fr-CA", "fr", DEFAULT_LOCALE]);
    expect(catalogChain("zh-Hant-TW")).toEqual([
      "zh-Hant-TW",
      "zh-Hant",
      "zh",
      DEFAULT_LOCALE,
    ]);
  });

  it("does not repeat the default locale", () => {
    expect(catalogChain("en")).toEqual(["en"]);
    expect(catalogChain("en-GB")).toEqual(["en-GB", "en"]);
  });
});

describe("formatMoney()", () => {
  it("respects each currency's minor unit", () => {
    // 1000 minor units is $10.00, ¥1000 and 1.000 KWD — not "10" of each.
    expect(formatMoney(1000, "USD", "en-US")).toBe("$10.00");
    expect(formatMoney(1000, "JPY", "en-US")).toContain("1,000");
    expect(formatMoney(1000, "KWD", "en-US")).toContain("1.000");
    expect(formatMoney(1000, "BHD", "en-US")).toContain("1.000");
  });

  it("pads amounts smaller than one unit", () => {
    expect(formatMoney(5, "USD", "en-US")).toBe("$0.05");
    expect(formatMoney(0, "USD", "en-US")).toBe("$0.00");
    expect(formatMoney(1, "JPY", "en-US")).toContain("1");
  });

  it("handles negative amounts (refunds, credits)", () => {
    expect(formatMoney(-1050, "USD", "en-US")).toBe("-$10.50");
  });

  it("keeps the last cent that division would lose", () => {
    // These are the amounts where `cents / 100` is demonstrably wrong:
    // 9007199254740991 formats as …409.90 via division, …409.91 exactly.
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "USD", "en-US")).toBe(
      "$90,071,992,547,409.91",
    );
    expect(formatMoney(8999999999999999, "USD", "en-US")).toBe(
      "$89,999,999,999,999.99",
    );
  });

  it("refuses non-integer input", () => {
    expect(() => formatMoney(10.5, "USD")).toThrow(/integer minor units/);
  });
});

describe("formatDateTime()", () => {
  it("renders one instant in different business timezones", () => {
    const utc = new Date("2026-07-26T02:30:00Z");
    const vancouver = formatDateTime(utc, "America/Vancouver", "en-US");
    const paris = formatDateTime(utc, "Europe/Paris", "en-US");
    expect(vancouver).toContain("Jul 25");
    expect(paris).toContain("Jul 26");
    expect(vancouver).not.toBe(paris);
  });
});
