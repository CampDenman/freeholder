// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Property-style proof of volume vs tiered arithmetic (C5.14).

import { describe, expect, it } from "vitest";
import { applyPriceBreaks, applyTieredBreaks, applyVolumeBreaks } from "@/modules/catalog/price-breaks";

const bands = [
  { minQty: 1, maxQty: 9, unitAmountMinor: 1000, percentOffPpm: null },
  { minQty: 10, maxQty: null, unitAmountMinor: 800, percentOffPpm: null },
];

describe("price-break arithmetic", () => {
  it("charges every unit at the volume rate the total quantity earns", () => {
    expect(applyVolumeBreaks(1000, 9, bands)).toMatchObject({
      totalMinor: 9000,
      breakdown: [{ qty: 9, unitMinor: 1000 }],
    });
    expect(applyVolumeBreaks(1000, 12, bands)).toMatchObject({
      totalMinor: 9600,
      breakdown: [{ qty: 12, unitMinor: 800 }],
    });
  });

  it("charges each tiered band at its own rate", () => {
    expect(applyTieredBreaks(1000, 12, bands)).toMatchObject({
      totalMinor: 9000 + 2400,
      breakdown: [
        { qty: 9, unitMinor: 1000 },
        { qty: 3, unitMinor: 800 },
      ],
    });
  });

  it("applies percent-off to the list unit without floating point", () => {
    const off = applyPriceBreaks("volume", 10_000, 5, [
      { minQty: 5, maxQty: null, unitAmountMinor: null, percentOffPpm: 250_000 },
    ]);
    expect(off.totalMinor).toBe(37_500);
  });

  it("refuses overlapping bands and gapped tiers", () => {
    expect(() =>
      applyVolumeBreaks(1000, 2, [
        { minQty: 1, maxQty: 10, unitAmountMinor: 1000, percentOffPpm: null },
        { minQty: 5, maxQty: 20, unitAmountMinor: 800, percentOffPpm: null },
      ]),
    ).toThrow(/overlap/);
    expect(() =>
      applyTieredBreaks(1000, 5, [
        { minQty: 3, maxQty: null, unitAmountMinor: 800, percentOffPpm: null },
      ]),
    ).toThrow(/starts at quantity 1/);
  });

  it("volume total is never more than the 1-unit list total when later bands are cheaper", () => {
    for (const qty of [1, 9, 10, 11, 25]) {
      const volume = applyVolumeBreaks(1000, qty, bands);
      const list = 1000 * qty;
      expect(volume.totalMinor).toBeLessThanOrEqual(list);
    }
  });
});
