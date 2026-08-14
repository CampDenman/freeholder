// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.02-C5.05 pure arithmetic and tax property examples.

import { describe, expect, it } from "vitest";
import type { TaxQuoteRequest } from "@/adapters/tax";
import {
  extendMinor,
  roundRatio,
  safeMinor,
  subtractMinor,
  sumMinor,
} from "@/modules/invoicing/money";
import {
  calculateTaxQuote,
  type TaxRuleSet,
} from "@/modules/invoicing/tax-engine";
import { taxTemplates } from "@/modules/invoicing/tax-templates";

const request: TaxQuoteRequest = {
  currency: "CAD",
  pricesIncludeTax: false,
  origin: { country: "CA", region: "BC" },
  destination: { country: "CA", region: "BC" },
  items: [
    {
      id: "standard",
      quantityMicros: 1_000_000,
      unitAmountMinor: 10_000,
      discountMinor: 0,
      category: "standard",
      requiresShipping: true,
    },
    {
      id: "book",
      quantityMicros: 1_000_000,
      unitAmountMinor: 2_000,
      discountMinor: 0,
      category: "books",
      requiresShipping: true,
    },
  ],
  shippingMinor: 1_000,
  occurredAt: "2026-08-14T12:00:00.000Z",
};

function rules(overrides: Partial<TaxRuleSet> = {}): TaxRuleSet {
  return {
    zoneId: "zone",
    zoneName: "British Columbia",
    pricesIncludeTax: false,
    roundingScope: "line",
    roundingMode: "half_up",
    rules: [
      {
        id: "gst",
        name: "GST",
        jurisdiction: "Canada",
        ratePpm: 50_000,
        compound: false,
        priority: 0,
        appliesToShipping: true,
      },
      {
        id: "pst",
        name: "PST",
        jurisdiction: "British Columbia",
        ratePpm: 70_000,
        compound: false,
        priority: 10,
        appliesToShipping: false,
        categoryCode: "standard",
      },
    ],
    ...overrides,
  };
}

describe("fixed-point money", () => {
  it("extends fractional quantities with explicit half-up or bankers rounding", () => {
    expect(extendMinor(1_999, 1_500_000, "half_up")).toBe(2_999);
    expect(extendMinor(1_999, 1_500_000, "bankers")).toBe(2_998);
    expect(roundRatio(5n, 2n, "half_up")).toBe(3n);
    expect(roundRatio(5n, 2n, "bankers")).toBe(2n);
    expect(roundRatio(7n, 2n, "bankers")).toBe(4n);
  });

  it("rejects floats, negatives, underflow, and unsafe totals", () => {
    expect(() => extendMinor(19.99, 1_000_000)).toThrow("minor unit");
    expect(() => subtractMinor(1, 2)).toThrow("cannot be negative");
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow("safe money range");
    expect(() => safeMinor(-1n)).toThrow("safe money range");
  });
});

describe("built-in tax engine", () => {
  it("applies category and shipping rules without confusing locale and location", () => {
    const quote = calculateTaxQuote(request, rules());
    expect(quote.lines.map((line) => [line.itemId, line.name, line.taxMinor])).toEqual([
      ["standard", "GST", 500],
      ["book", "GST", 100],
      [undefined, "GST", 50],
      ["standard", "PST", 700],
    ]);
    expect(quote.totalTaxMinor).toBe(1_350);
    expect(quote.includedTaxMinor).toBe(0);
  });

  it("lets an exact category row replace, rather than stack on, a generic jurisdiction rate", () => {
    const quote = calculateTaxQuote(
      { ...request, shippingMinor: 0 },
      rules({
        rules: [
          rules().rules[0]!,
          {
            ...rules().rules[0]!,
            id: "books-gst",
            ratePpm: 0,
            categoryCode: "books",
          },
        ],
      }),
    );
    expect(quote.lines.map((line) => [line.itemId, line.taxMinor])).toEqual([
      ["standard", 500],
      ["book", 0],
    ]);
  });

  it("represents Québec's 9.975% exactly with integer parts per million", () => {
    const quote = calculateTaxQuote(
      { ...request, items: [request.items[0]!], shippingMinor: 0 },
      rules({
        zoneName: "Québec",
        rules: [
          {
            id: "qst",
            name: "QST",
            jurisdiction: "Québec",
            ratePpm: 99_750,
            compound: false,
            priority: 0,
            appliesToShipping: false,
          },
        ],
      }),
    );
    expect(quote.lines[0]).toMatchObject({
      ratePartsPerMillion: 99_750,
      taxMinor: 998,
    });
  });

  it("supports sequential compound rates for historical and owner-defined regimes", () => {
    const quote = calculateTaxQuote(
      { ...request, items: [request.items[0]!], shippingMinor: 0 },
      rules({
        rules: [
          {
            id: "first",
            name: "First",
            jurisdiction: "Example",
            ratePpm: 50_000,
            compound: false,
            priority: 0,
            appliesToShipping: false,
          },
          {
            id: "second",
            name: "Second",
            jurisdiction: "Example",
            ratePpm: 100_000,
            compound: true,
            priority: 10,
            appliesToShipping: false,
          },
        ],
      }),
    );
    expect(quote.lines.map((line) => line.taxMinor)).toEqual([500, 1_050]);
    expect(quote.totalTaxMinor).toBe(1_550);
  });

  it("extracts multiple included rates from one gross price without double-counting", () => {
    const quote = calculateTaxQuote(
      {
        ...request,
        pricesIncludeTax: true,
        items: [{ ...request.items[0]!, unitAmountMinor: 11_200 }],
        shippingMinor: 0,
      },
      rules({ pricesIncludeTax: true, rules: rules().rules.slice(0, 2) }),
    );
    expect(quote.lines.map((line) => line.taxMinor)).toEqual([500, 700]);
    expect(quote.totalTaxMinor).toBe(1_200);
    expect(quote.includedTaxMinor).toBe(1_200);
  });

  it("allocates invoice-rounded pennies deterministically", () => {
    const tiny: TaxQuoteRequest = {
      ...request,
      items: [
        { ...request.items[0]!, id: "a", unitAmountMinor: 1, requiresShipping: false },
        { ...request.items[0]!, id: "b", unitAmountMinor: 1, requiresShipping: false },
        { ...request.items[0]!, id: "c", unitAmountMinor: 1, requiresShipping: false },
      ],
      shippingMinor: 0,
    };
    const quote = calculateTaxQuote(
      tiny,
      rules({
        roundingScope: "invoice",
        rules: [{
          id: "rate",
          name: "Rate",
          jurisdiction: "Example",
          ratePpm: 500_000,
          compound: false,
          priority: 0,
          appliesToShipping: false,
        }],
      }),
    );
    expect(quote.lines.map((line) => line.taxMinor)).toEqual([1, 1, 0]);
    expect(quote.totalTaxMinor).toBe(2);
  });

  it("creates explicit zero lines for exemptions and refuses ambiguous included compound tax", () => {
    const exempt = calculateTaxQuote(request, rules({
      exemption: { kind: "reverse_charge", legend: "Tax not charged — reverse charge applies." },
    }));
    expect(exempt.totalTaxMinor).toBe(0);
    expect(exempt.lines).toHaveLength(3);
    expect(exempt.explanation[0]).toContain("reverse charge");

    expect(() =>
      calculateTaxQuote(
        { ...request, pricesIncludeTax: true },
        rules({
          pricesIncludeTax: true,
          rules: [{ ...rules().rules[0]!, compound: true }],
        }),
      ),
    ).toThrow("refuses an ambiguous extraction");
  });
});

describe("source-attributed tax starters", () => {
  it("covers every target regime with unique, dated definitions", () => {
    expect(new Set(taxTemplates.map((template) => template.key)).size).toBe(taxTemplates.length);
    expect(taxTemplates).toHaveLength(94);
    expect(taxTemplates.filter((template) => template.group === "canada")).toHaveLength(13);
    expect(taxTemplates.filter((template) => template.group === "european_union")).toHaveLength(27);
    expect(taxTemplates.filter((template) => template.group === "united_states")).toHaveLength(51);
    expect(new Set(taxTemplates.map((template) => template.group))).toEqual(
      new Set([
        "canada",
        "european_union",
        "united_kingdom",
        "united_states",
        "australia",
        "new_zealand",
      ]),
    );
    expect(taxTemplates.every((template) => template.source.checkedOn === "2026-08-14")).toBe(true);
    expect(taxTemplates.every((template) => template.activationLimitation)).toBe(true);
  });

  it("preserves rate precision and current standard-rate corrections", () => {
    expect(taxTemplates.find((template) => template.key === "ca-qc")?.rates).toMatchObject([
      { name: "GST", ratePpm: 50_000 },
      { name: "QST", ratePpm: 99_750 },
    ]);
    expect(taxTemplates.find((template) => template.key === "ca-ns")?.rates[0]?.ratePpm).toBe(140_000);
    expect(taxTemplates.find((template) => template.key === "eu-fi")?.rates[0]?.ratePpm).toBe(255_000);
    expect(taxTemplates.find((template) => template.key === "eu-ro")?.rates[0]?.ratePpm).toBe(210_000);
    expect(taxTemplates.find((template) => template.key === "nz-standard")?.rates[0]?.ratePpm).toBe(150_000);
  });
});
