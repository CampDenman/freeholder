// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { creditedOriginalLineFee, originalFeeResourceTargets } from "@/modules/invoicing/merchant-line-fee-amounts";
describe("original line commission credits", () => {
  it("retains the last original unit's commission rounding remainder", () => {
    expect(creditedOriginalLineFee(10, 3_000_000, 1_000_000)).toBe(3);
    expect(creditedOriginalLineFee(10, 3_000_000, 2_000_000)).toBe(6);
    expect(creditedOriginalLineFee(10, 3_000_000, 3_000_000)).toBe(10);
  });
  it("allocates a ten-cent line credit as three plus seven across original fee capacities", () => {
    expect([...originalFeeResourceTargets(10, [{ paymentId: "original-first", feeMinor: 3 }, { paymentId: "original-second", feeMinor: 17 }])])
      .toEqual([["original-first", 0], ["original-second", 10]]);
  });
  it("refuses excess units, duplicate resources and any unfunded commission credit", () => {
    expect(() => creditedOriginalLineFee(10, 1_000_000, 1_000_001)).toThrow();
    expect(() => originalFeeResourceTargets(1, [{ paymentId: "same", feeMinor: 1 }, { paymentId: "same", feeMinor: 1 }])).toThrow();
    expect(() => originalFeeResourceTargets(21, [{ paymentId: "first", feeMinor: 3 }, { paymentId: "second", feeMinor: 17 }])).toThrow();
  });
});
