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
