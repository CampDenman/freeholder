// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.18 deterministic shipping quotes.

import { describe, expect, it } from "vitest";
import { matchZone, quoteMethods, selectBox, totals } from "@/modules/catalog/shipping-quote";

const domestic = {
  id: "zone-ca",
  name: "Canada",
  countries: ["CA"],
  regions: ["BC"],
  postalPatterns: ["V9N"],
  priority: 1,
};
const world = {
  id: "zone-world",
  name: "World",
  countries: [],
  regions: [],
  postalPatterns: [],
  priority: 0,
};

describe("shipping quotes", () => {
  it("matches the most specific zone", () => {
    expect(matchZone({ country: "CA", region: "BC", postal: "V9N1A1" }, [world, domestic])?.id).toBe("zone-ca");
    expect(matchZone({ country: "US" }, [world, domestic])?.id).toBe("zone-world");
  });

  it("quotes flat, free-over-threshold, weight bands and skips digital items", () => {
    const items = [
      { quantity: 2, weightG: 400, priceMinor: 5000, requiresShipping: true },
      { quantity: 1, weightG: 0, priceMinor: 2000, requiresShipping: false },
    ];
    expect(totals(items)).toMatchObject({ quantity: 2, weightG: 800, subtotalMinor: 10_000 });
    const quoted = quoteMethods({
      destination: { country: "CA", postal: "V9N1A1" },
      currency: "CAD",
      items,
      zones: [domestic],
      boxes: [],
      methods: [
        {
          id: "flat",
          zoneId: "zone-ca",
          name: "Parcel",
          kind: "flat",
          handlingFeeMinor: 100,
          amountMinor: 1200,
          thresholdMinor: null,
          locationId: null,
          minDays: 3,
          maxDays: 7,
          bands: [],
        },
        {
          id: "free",
          zoneId: "zone-ca",
          name: "Free over $80",
          kind: "free",
          handlingFeeMinor: 0,
          amountMinor: null,
          thresholdMinor: 8000,
          locationId: null,
          minDays: 5,
          maxDays: 10,
          bands: [],
        },
        {
          id: "weight",
          zoneId: "zone-ca",
          name: "By weight",
          kind: "weight",
          handlingFeeMinor: 0,
          amountMinor: null,
          thresholdMinor: null,
          locationId: null,
          minDays: 4,
          maxDays: 8,
          bands: [{ minValue: 0, maxValue: 1000, amountMinor: 900, perUnitMinor: 0 }],
        },
      ],
    });
    expect(quoted.needed).toBe(true);
    expect(quoted.quotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ methodId: "flat", amountMinor: 1300 }),
        expect.objectContaining({ methodId: "free", amountMinor: 0 }),
        expect.objectContaining({ methodId: "weight", amountMinor: 900 }),
      ]),
    );
  });

  it("picks the smallest box that fits volume and weight", () => {
    const box = selectBox(
      [{ quantity: 1, weightG: 200, priceMinor: 1000, lengthMm: 100, widthMm: 80, heightMm: 40 }],
      [
        { id: "big", name: "Big", innerLengthMm: 400, innerWidthMm: 400, innerHeightMm: 400, maxWeightG: 5000, tareWeightG: 80 },
        { id: "small", name: "Small", innerLengthMm: 150, innerWidthMm: 100, innerHeightMm: 50, maxWeightG: 500, tareWeightG: 20 },
      ],
    );
    expect(box?.id).toBe("small");
  });
});
