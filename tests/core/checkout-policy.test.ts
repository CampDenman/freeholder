// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.21/C5.22: invoice-currency minor units must sum exactly at milestones.
import { describe, expect, it } from "vitest";
import { catalogSettingsSchema, checkoutPaymentSchema, paymentMilestones } from "@/modules/catalog/checkout-policy";

describe("checkout payment milestones", () => {
  const policy = checkoutPaymentSchema.parse({
    mode: "milestones", currency: "CAD",
    firstPayment: { type: "percent", sharePpm: 500_000 },
    milestones: [
      { label: "Down payment at checkout", sharePpm: 500_000 },
      { label: "Balance before delivery", sharePpm: 500_000 },
    ],
  });

  it("assigns an odd cent to the final payment and keeps the full price exact", () => {
    if (policy.mode !== "milestones") throw new Error("Expected milestone policy");
    const stages = paymentMilestones(7_999_901, policy);
    expect(stages.map((stage) => stage.amountMinor)).toEqual([3_999_950, 3_999_951]);
    expect(stages.reduce((sum, stage) => sum + stage.amountMinor, 0)).toBe(7_999_901);
  });

  it("refuses an incomplete or impossible owner policy", () => {
    expect(catalogSettingsSchema.safeParse({ checkoutPayment: policy }).success).toBe(false);
    expect(checkoutPaymentSchema.safeParse({ ...policy, milestones: [{ label: "Only half", sharePpm: 500_000 }] }).success).toBe(false);
    const fixed = checkoutPaymentSchema.parse({
      mode: "milestones", currency: "CAD", firstPayment: { type: "fixed", amountMinor: 250_000 },
      milestones: [{ label: "Initial", sharePpm: 250_000 }, { label: "Balance", sharePpm: 750_000 }],
    });
    if (fixed.mode !== "milestones") throw new Error("Expected milestone policy");
    expect(() => paymentMilestones(800_000, fixed)).toThrow(/first milestone/);
  });
});
