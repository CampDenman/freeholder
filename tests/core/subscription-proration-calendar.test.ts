// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: accepted trial/calendar decisions differ from actual provider preview.
import { describe, expect, it } from "vitest";
import { reviewedProrationCalendar } from "@/modules/subscriptions/proration-contract";
const start = new Date("2026-11-01T00:00:00.000Z"), end = new Date("2026-12-01T00:00:00.000Z"), at = new Date("2026-11-16T00:00:00.000Z");
const original = { billingMode: "manual" as "manual" | "platform" | "provider", policy: "create_prorations" as "none" | "create_prorations", status: "active" as "active" | "trialing",
  currentPeriodStart: start, currentPeriodEnd: end, trialEndsAt: null as Date | null, at, nextInterval: "year" as const, nextIntervalCount: 1 };
describe("reviewed subscription proration calendar decisions", () => {
  it.each(["manual", "platform", "provider"] as const)("preserves the actual accepted %s trial end without charge or old paid credit", billingMode => {
    expect(reviewedProrationCalendar({ ...original, billingMode, status: "trialing", trialEndsAt: end })).toMatchObject({ kind: "preserve_trial", trialEndsAt: end.toISOString(),
      chargeMinor: 0, oldPaidCreditMinor: 0, nextPeriodStart: end.toISOString(), nextPeriodEnd: "2027-12-01T00:00:00.000Z" });
  });
  it.each(["manual", "platform", "provider"] as const)("keeps the declared none decision for %s at the original boundary", billingMode => {
    expect(reviewedProrationCalendar({ ...original, billingMode, policy: "none" })).toMatchObject({ kind: "period_end", nextPeriodStart: end.toISOString() });
  });
  it.each(["manual", "platform"] as const)("preserves the accepted original %s interval boundary for an interval change", billingMode => {
    expect(reviewedProrationCalendar({ ...original, billingMode })).toMatchObject({ kind: "original_calendar", currentPeriodStart: start.toISOString(), currentPeriodEnd: end.toISOString(),
      nextPeriodStart: end.toISOString(), nextPeriodEnd: "2027-12-01T00:00:00.000Z" });
  });
  it("requires actual provider proration preview instead of predicting its anchor or pretending local net is bank evidence", () => {
    expect(reviewedProrationCalendar({ ...original, billingMode: "provider" })).toEqual({ kind: "actual_provider_preview", prorationAt: at.toISOString() });
  });
  it.each([new Date(start.getTime() - 1), end, new Date(end.getTime() + 1), new Date(NaN)])("refuses a noncurrent original proration instant %s", invalid => {
    expect(() => reviewedProrationCalendar({ ...original, at: invalid })).toThrow();
  });
  it("refuses to infer an accepted trial end from a mutable status flag", () => {
    expect(() => reviewedProrationCalendar({ ...original, status: "trialing" })).toThrow();
    expect(() => reviewedProrationCalendar({ ...original, status: "trialing", trialEndsAt: at })).toThrow();
  });
});
