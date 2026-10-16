// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The payout providers this build knows (C12.26–C12.27). The site owner picks
// one under Admin → Members; each needs its own credentials.
import { createPayPalPayouts } from "./paypal-payouts";
import { createRazorpayRoute } from "./razorpay-route";
import { createStripeConnect } from "./stripe-connect";
import type { PayoutProvider } from "./types";

export type { PayoutProvider } from "./types";

const factories: Record<string, () => PayoutProvider> = {
  stripe_connect: () => createStripeConnect(),
  paypal_payouts: () => createPayPalPayouts(),
  razorpay_route: () => createRazorpayRoute(),
};

let overrides: Record<string, PayoutProvider> = {};
/** Tests stand in providers with recorded HTTP. */
export function setPayoutProviderForTests(id: string, provider: PayoutProvider | null): void {
  if (provider) overrides = { ...overrides, [id]: provider };
  else delete overrides[id];
}

export const PAYOUT_PROVIDER_IDS = Object.keys(factories);

export function payoutProvider(id: string): PayoutProvider | null {
  return overrides[id] ?? factories[id]?.() ?? null;
}
