// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Provider-neutral payment boundary (MASTER.md §12, C5.01).

import type { AdapterStatus, RawProviderRequest } from "../types";

export interface PaymentAdapterCapabilities {
  refunds: boolean;
  partialRefunds: boolean;
  savedMethods: boolean;
  subscriptions: boolean;
  disputes: boolean;
  payouts: boolean;
  inPerson: boolean;
  strongCustomerAuthentication: boolean;
}

export interface PaymentMethodOffer {
  id: string;
  label: string;
  kind:
    | "card"
    | "wallet"
    | "bank_debit"
    | "bank_redirect"
    | "buy_now_pay_later"
    | "cash"
    | "bank_transfer"
    | "other";
  recurring: boolean;
}

export interface InvoiceForCharge {
  invoiceId: string;
  invoiceNumber: string;
  contactId: string;
  currency: string;
  amountMinor: number;
  description: string;
  customer: { email: string; name?: string };
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  methodIds?: readonly string[];
}

export interface CheckoutSession {
  providerRef: string;
  url: string;
  expiresAt?: string;
}

export interface RefundRequest {
  paymentId: string;
  providerRef: string;
  currency: string;
  amountMinor: number;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRef: string;
  status: "pending" | "succeeded" | "failed";
}

export type PaymentProviderEvent =
  | {
      id: string;
      kind: "payment_succeeded" | "payment_failed" | "payment_cancelled";
      providerRef: string;
      amountMinor?: number;
      currency?: string;
      occurredAt: string;
    }
  | {
      id: string;
      kind: "refund_succeeded" | "refund_failed";
      providerRef: string;
      paymentProviderRef: string;
      amountMinor?: number;
      currency?: string;
      occurredAt: string;
    }
  | {
      id: string;
      kind: "dispute_opened" | "dispute_won" | "dispute_lost";
      providerRef: string;
      paymentProviderRef: string;
      amountMinor?: number;
      currency?: string;
      occurredAt: string;
    };

export interface PaymentAdapter {
  readonly id: string;
  readonly status: AdapterStatus;
  capabilities(): PaymentAdapterCapabilities;
  supportedCurrencies(): Promise<readonly string[]>;
  supportedMethods(context: {
    country: string;
    currency: string;
    recurring: boolean;
  }): Promise<readonly PaymentMethodOffer[]>;
  createCheckout(invoice: InvoiceForCharge): Promise<CheckoutSession>;
  refund(request: RefundRequest): Promise<RefundResult>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly PaymentProviderEvent[]>;
}
