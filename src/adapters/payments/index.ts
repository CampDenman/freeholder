// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import config from "../../../freeholder.config";
import { createManualPayments } from "./manual";
import { createNoPayments } from "./none";
import { createPayPalPayments } from "./paypal";
import { createStripePayments } from "./stripe";
import type { PaymentAdapter } from "./types";

export * from "./types";
export { createNoPayments } from "./none";
export { createManualPayments } from "./manual";
export { createPayPalPayments } from "./paypal";
export { createStripePayments } from "./stripe";
export const paymentAdapters = new AdapterRegistry<PaymentAdapter>("payments", [
  createNoPayments(),
  createManualPayments(),
  createStripePayments(),
  createPayPalPayments(),
]);

export function paymentAdapter(id: string = config.adapters.payments): PaymentAdapter {
  return paymentAdapters.get(id);
}
