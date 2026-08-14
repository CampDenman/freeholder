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
  /** Can initiate outbound payouts; tracking inbound provider deposits is ledger-wide. */
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
  /** Explicit customer consent captured by the provider-hosted checkout. */
  saveMethod?: boolean;
  /** Provider customer reference, never a card or bank-account number. */
  providerCustomerRef?: string;
}

export interface CheckoutSession {
  /** Checkout/session/order reference used until settlement finishes. */
  providerRef: string;
  /** Settlement reference when the provider creates it with the checkout. */
  paymentRef?: string;
  url: string;
  expiresAt?: string;
}

export interface CheckoutCaptureRequest {
  checkoutRef: string;
  idempotencyKey: string;
}

export interface CheckoutCaptureResult {
  providerRef: string;
  status: "pending" | "succeeded" | "failed";
  amountMinor?: number;
  currency?: string;
  occurredAt?: string;
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

export interface SavedMethodRevocationRequest {
  providerRef: string;
  idempotencyKey: string;
}

export interface SavedPaymentMethodEvidence {
  providerRef: string;
  providerCustomerRef?: string;
  kind: PaymentMethodOffer["kind"];
  label: string;
  brand?: string;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
}

export type PaymentProviderEvent =
  | {
      id: string;
      kind: "payment_processing" | "payment_succeeded" | "payment_failed" | "payment_cancelled";
      providerRef: string;
      checkoutRef?: string;
      amountMinor?: number;
      currency?: string;
      occurredAt: string;
      invoiceId?: string;
      contactId?: string;
      providerCustomerRef?: string;
      savedMethod?: SavedPaymentMethodEvidence;
    }
  | {
      id: string;
      kind: "refund_processing" | "refund_succeeded" | "refund_failed";
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
      reason?: string;
      evidenceDueAt?: string;
    }
  | {
      id: string;
      kind: "saved_method_added" | "saved_method_removed";
      providerCustomerRef?: string;
      contactId?: string;
      method: SavedPaymentMethodEvidence;
      occurredAt: string;
    }
  | {
      id: string;
      kind: "payout_pending" | "payout_in_transit" | "payout_paid" | "payout_failed" | "payout_cancelled";
      providerRef: string;
      amountMinor: number;
      currency: string;
      occurredAt: string;
      expectedAt?: string;
      statementRef?: string;
      failureReason?: string;
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
  captureCheckout(request: CheckoutCaptureRequest): Promise<CheckoutCaptureResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  revokeSavedMethod(request: SavedMethodRevocationRequest): Promise<void>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly PaymentProviderEvent[]>;
}
