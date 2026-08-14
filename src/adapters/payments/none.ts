// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../types";
import type { PaymentAdapter, PaymentAdapterCapabilities } from "./types";

const capabilities: PaymentAdapterCapabilities = {
  refunds: false,
  partialRefunds: false,
  savedMethods: false,
  subscriptions: false,
  disputes: false,
  payouts: false,
  inPerson: false,
  strongCustomerAuthentication: false,
};

export function createNoPayments(): PaymentAdapter {
  const message = "Online payments are not configured. Enable a payment provider first.";
  const failure = () => Promise.reject(unavailable("payments", "none", message));
  return {
    id: "none",
    status: { family: "payments", id: "none", available: false, message },
    capabilities: () => ({ ...capabilities }),
    async supportedCurrencies() { return []; },
    async supportedMethods() { return []; },
    createCheckout: failure,
    captureCheckout: failure,
    refund: failure,
    revokeSavedMethod: failure,
    verifyWebhook: failure,
  };
}
