// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-attested offline money. Settlement is recorded by the service layer.

import { AdapterError } from "../types";
import type { PaymentAdapter, PaymentAdapterCapabilities } from "./types";

const capabilities: PaymentAdapterCapabilities = {
  refunds: true,
  partialRefunds: true,
  savedMethods: false,
  subscriptions: false,
  disputes: false,
  payouts: false,
  inPerson: true,
  strongCustomerAuthentication: false,
};

const unsupported = () => Promise.reject(
  new AdapterError(
    "payments",
    "manual",
    "invalid_request",
    "Offline payments are recorded by an authorized owner; they do not create a hosted checkout or webhook.",
  ),
);

export function createManualPayments(): PaymentAdapter {
  return {
    id: "manual",
    status: {
      family: "payments",
      id: "manual",
      available: true,
      message: "Cash, cheque, bank transfer, and externally processed payments can be recorded with owner evidence.",
    },
    capabilities: () => ({ ...capabilities }),
    async supportedCurrencies() { return []; },
    async supportedMethods() {
      return [
        { id: "cash", label: "Cash", kind: "cash" as const, recurring: false },
        { id: "bank_transfer", label: "Bank transfer", kind: "bank_transfer" as const, recurring: false },
        { id: "cheque", label: "Cheque", kind: "other" as const, recurring: false },
        { id: "external_card", label: "Card processed elsewhere", kind: "card" as const, recurring: false },
        { id: "other", label: "Other offline payment", kind: "other" as const, recurring: false },
      ];
    },
    createCheckout: unsupported,
    captureCheckout: unsupported,
    refund: unsupported,
    revokeSavedMethod: unsupported,
    verifyWebhook: unsupported,
  };
}
