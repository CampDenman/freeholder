// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33: exact minor-unit unused fractions; no provider or database work.
import { describe, expect, it } from "vitest";
import { proratedAmounts, proratedDifference } from "@/modules/subscriptions/proration-amounts";
const start = new Date(0), end = new Date(1000), half = new Date(500);
describe("exact original unused-fraction proration", () => {
  it("keeps each original component's half-up rounding rather than rounding their difference", () => {
    expect(proratedAmounts(1, 2, start, end, half)).toMatchObject({ oldUnusedMinor: 1, newUnusedMinor: 1, netMinor: 0 });
    expect(proratedAmounts(5005, 10010, start, new Date(3), new Date(1))).toMatchObject({ oldUnusedMinor: 3337, newUnusedMinor: 6673, netMinor: 3336 });
  });
  it("retains a safe-integer maximum exactly before multiplication by time", () => {
    expect(proratedAmounts(0, Number.MAX_SAFE_INTEGER, start, new Date(3), new Date(2))).toMatchObject({ newUnusedMinor: 3002399751580330, netMinor: 3002399751580330 });
    expect(proratedDifference(0, Number.MAX_SAFE_INTEGER, start, end, half)).toBe(4503599627370496);
  });
  it("preserves positive, negative and zero net outcomes", () => {
    expect(proratedDifference(1000, 2000, start, end, half)).toBe(500);
    expect(proratedDifference(2000, 1000, start, end, half)).toBe(-500);
    expect(proratedDifference(1000, 1000, start, end, half)).toBe(0);
  });
  it("never grants more than the original whole component before its period starts", () => {
    expect(proratedAmounts(1000, 2000, start, end, new Date(-1000))).toMatchObject({ oldUnusedMinor: 1000, newUnusedMinor: 2000, netMinor: 1000 });
  });
  it.each([1000, 1001, 1000000])("has no unused credit or debit at/after original end %s", instant => {
    expect(proratedDifference(1000, 2000, start, end, new Date(instant))).toBe(0);
  });
  it.each([[-1, 1000], [1000, -1], [0.5, 1000], [1000, Number.MAX_SAFE_INTEGER + 1], [NaN, 1000]])("refuses invalid minor amounts %s / %s", (old, next) => {
    expect(() => proratedDifference(old, next, start, end, half)).toThrow();
  });
  it("refuses a missing or reversed original calendar instead of returning invented zero money", () => {
    expect(() => proratedDifference(1, 2, end, start, half)).toThrow();
    expect(() => proratedDifference(1, 2, start, start, half)).toThrow();
    expect(() => proratedDifference(1, 2, start, end, new Date(NaN))).toThrow();
  });
});
