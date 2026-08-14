// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import config from "../../../freeholder.config";
import { createManualPayments } from "./manual";
import { createFlutterwavePayments } from "./flutterwave";
import { createMolliePayments } from "./mollie";
import { createNoPayments } from "./none";
import { createPayPalPayments } from "./paypal";
import { createPaystackPayments } from "./paystack";
import { createRazorpayPayments } from "./razorpay";
import { createSquarePayments } from "./square";
import { createStripePayments } from "./stripe";
import type { PaymentAdapter } from "./types";

export * from "./types";
export { createNoPayments } from "./none";
export { createManualPayments } from "./manual";
export { createFlutterwavePayments } from "./flutterwave";
export { createMolliePayments } from "./mollie";
export { createPayPalPayments } from "./paypal";
export { createPaystackPayments } from "./paystack";
export { createRazorpayPayments } from "./razorpay";
export { createSquarePayments } from "./square";
export { createStripePayments } from "./stripe";
export * from "./providers";
export const paymentAdapters = new AdapterRegistry<PaymentAdapter>("payments", [
  createNoPayments(),
  createManualPayments(),
  createStripePayments(),
  createPayPalPayments(),
  createSquarePayments(),
  createMolliePayments(),
  createRazorpayPayments(),
  createPaystackPayments(),
  createFlutterwavePayments(),
]);

export function paymentAdapter(id: string = config.adapters.payments): PaymentAdapter {
  return paymentAdapters.get(id);
}
