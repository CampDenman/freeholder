// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: actual consent chooses an exact future start; no clock repair/backdating.
import { describe, expect, it } from "vitest";
import { reviewedResumptionStart } from "@/modules/subscriptions/commercial-amendment-calendar";
const original = new Date("2026-12-01T00:00:00.000Z"), previous = new Date("2026-11-01T00:00:00.000Z"), now = new Date("2026-12-02T12:00:00.000Z");
describe("explicit replacement calendar consent", () => {
  it("keeps an unmissed original next-period boundary exactly", () => { expect(reviewedResumptionStart(undefined, original, previous, new Date("2026-11-30T00:00:00.000Z"))).toBe(original); });
  it("accepts an explicit exact future date after the missed original period", () => { expect(reviewedResumptionStart("2026-12-03T00:00:00.000Z", original, previous, now).toISOString()).toBe("2026-12-03T00:00:00.000Z"); });
  it.each([
    ["no fresh date", undefined], ["a backdated date", "2026-11-30T00:00:00.000Z"], ["the missed date", original.toISOString()],
    ["the current clock instant", now.toISOString()], ["subsecond provider rounding", "2026-12-03T00:00:00.001Z"], ["an invalid date", "invalid"],
    ["an ambiguous local date", "2026-12-03T00:00:00"], ["another text representation", "2026-12-03T00:00:00+00:00"],
  ] as const)("refuses %s", (_label, value) => { expect(() => reviewedResumptionStart(value, original, previous, now)).toThrow(); });
  it("does not silently replace a future acceptance even before its original boundary", () => {
    expect(() => reviewedResumptionStart(undefined, original, original, new Date("2026-11-30T00:00:00.000Z"))).toThrow();
  });
  it("does not move an unmissed period to an arbitrary caller-supplied date", () => {
    expect(() => reviewedResumptionStart("2026-12-03T00:00:00.000Z", original, previous, new Date("2026-11-30T00:00:00.000Z"))).toThrow();
  });
  it("cannot rewrite an already accepted later start when the older period is overdue", () => {
    expect(() => reviewedResumptionStart("2026-12-03T00:00:00.000Z", original, new Date("2026-12-04T00:00:00.000Z"), now)).toThrow();
  });
});
