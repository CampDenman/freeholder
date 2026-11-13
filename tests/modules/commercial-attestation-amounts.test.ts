// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { recordedCommercialFeeTarget } from "@/modules/invoicing/commercial-attestation-amounts";
describe("recorded external commercial money preserves the original nonallocation fee epoch", () => {
  it("retains an original fee through no refund, a partial refund and full return", () => {
    expect(recordedCommercialFeeTarget(4200, 80, 0)).toBe(80);
    expect(recordedCommercialFeeTarget(4200, 80, 2100)).toBe(40);
    expect(recordedCommercialFeeTarget(4200, 80, 4200)).toBe(0);
  });
  it("preserves existing floor rounding rather than recalculating from a later fee rate", () => {
    expect(recordedCommercialFeeTarget(101, 3, 50)).toBe(1);
    expect(recordedCommercialFeeTarget(101, 0, 50)).toBe(0);
    expect(recordedCommercialFeeTarget(9007199254740991, 9007199254740990, 1)).toBe(9007199254740989);
  });
  it.each([[0, 0, 0], [1, 2, 0], [1, 0, 2], [10, -1, 0], [10, 1, -1], [1.1, 0, 0], [Number.MAX_SAFE_INTEGER + 1, 0, 0]])("refuses impossible or inexact original principal/fee facts %j", (amount, fee, returned) => {
    expect(() => recordedCommercialFeeTarget(amount, fee, returned)).toThrow(RangeError);
  });
});
