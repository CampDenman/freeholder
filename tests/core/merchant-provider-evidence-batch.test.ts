// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { expect, it, vi } from "vitest";
import { retainPaymentProviderEvidence } from "@/modules/invoicing/payment-provider-service";
import { registerSubscriptionProviderEvidenceRetainer } from "@/modules/invoicing/merchant-provider-stage";
import type { PaymentProviderEvent } from "@/adapters/payments";

it("retains every authenticated subscription cash event before returning a later application failure", async () => {
  const events: PaymentProviderEvent[] = ["first", "second"].map(id => ({ id, kind: "subscription_period_paid", providerRef: `sub_${id}`, occurredAt: new Date().toISOString() }));
  const error = new Error("original cash retained; subsequent policy mismatch");
  const retain = vi.fn(async (_provider: string, event: PaymentProviderEvent) => {
    if (event.id === "first") throw error;
    return event;
  });
  registerSubscriptionProviderEvidenceRetainer(retain);
  await expect(retainPaymentProviderEvidence("stripe", events)).rejects.toBe(error);
  expect(retain.mock.calls.map(([, event]) => event.id)).toEqual(["first", "second"]);
});
