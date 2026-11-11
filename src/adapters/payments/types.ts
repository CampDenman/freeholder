// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Provider-neutral payment boundary (MASTER.md §12, C5.01).

import type { AdapterStatus, RawProviderRequest } from "../types";

export interface PaymentAdapterCapabilities {
  refunds: boolean;
  partialRefunds: boolean;
  savedMethods: boolean;
  subscriptions: boolean;
  /** Charge a stored method without a customer present (C9.33). */
  offSessionCharges: boolean;
  disputes: boolean;
  /** Can initiate outbound payouts; tracking inbound provider deposits is ledger-wide. */
  payouts: boolean;
  inPerson: boolean;
  strongCustomerAuthentication: boolean;
  /** Charge, refund and service payments on an identified seller account. */
  sellerMerchantCharges?: boolean;
}

/** Supplied by canonical ledger policy, never by a buyer's request. */
export interface PaymentAccountScope { providerAccountId?: string }

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

export interface InvoiceForCharge extends PaymentAccountScope {
  applicationFeeMinor?: number;
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

export interface CheckoutSession extends PaymentAccountScope {
  /** Checkout/session/order reference used until settlement finishes. */
  providerRef: string;
  /** Settlement reference when the provider creates it with the checkout. */
  paymentRef?: string;
  url: string;
  expiresAt?: string;
}

/**
 * Save a card without charging it.
 *
 * A card-required trial whose setup fee is zero has nothing to invoice. A
 * zero-total invoice would mark itself paid, so this session is the capture
 * instead. Providers that cannot do it leave the method off the adapter, and
 * the plan stays unavailable rather than starting an unverified trial.
 */
export interface MethodSetupRequest extends PaymentAccountScope {
  contactId: string;
  subscriptionId: string;
  customer: { email: string; name?: string };
  /** Provider customer reference, never a card or bank-account number. */
  providerCustomerRef?: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface MethodSetupSession extends PaymentAccountScope {
  providerRef: string;
  url: string;
  expiresAt?: string;
  providerCustomerRef?: string;
}

export interface CheckoutCaptureRequest extends PaymentAccountScope {
  checkoutRef: string;
  idempotencyKey: string;
}

export interface CheckoutCaptureResult extends PaymentAccountScope {
  providerRef: string;
  status: "pending" | "succeeded" | "failed";
  amountMinor?: number;
  currency?: string;
  occurredAt?: string;
  applicationFeeMinor?: number;
}

export interface RefundRequest extends PaymentAccountScope {
  /** Return the collected platform fee along with a direct-charge refund. */
  refundApplicationFee?: boolean;
  paymentId: string;
  providerRef: string;
  currency: string;
  amountMinor: number;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult extends PaymentAccountScope {
  providerRef: string;
  status: "pending" | "succeeded" | "failed";
}

export interface SavedMethodRevocationRequest extends PaymentAccountScope {
  providerRef: string;
  idempotencyKey: string;
}

export interface OffSessionChargeRequest extends PaymentAccountScope {
  applicationFeeMinor?: number;
  methodRef: string;
  customerRef?: string;
  invoiceId: string;
  contactId: string;
  currency: string;
  amountMinor: number;
  description: string;
  idempotencyKey: string;
}

export interface OffSessionChargeResult extends PaymentAccountScope {
  applicationFeeMinor?: number;
  providerRef: string;
  status: "pending" | "succeeded" | "failed";
  amountMinor?: number;
  currency?: string;
  occurredAt?: string;
  failureMessage?: string;
}

export interface RecurringScheduleRequest extends PaymentAccountScope {
  applicationFeePercent?: number;
  /** First renewal after an already paid period or free trial. */
  firstBillingAt?: string;
  customerRef: string;
  methodRef: string;
  currency: string;
  amountMinor: number;
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
  description: string;
  idempotencyKey: string;
  metadata: {
    subscriptionId: string;
    contactId: string;
    planId: string;
  };
}

export interface RecurringScheduleResult extends PaymentAccountScope {
  applicationFeePercent?: number;
  providerRef: string;
  customerRef?: string;
}

export interface RecurringScheduleUpdateRequest extends PaymentAccountScope {
  applicationFeePercent?: number;
  providerRef: string;
  amountMinor: number;
  currency: string;
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
  description: string;
  proration: "create_prorations" | "none";
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

export type PaymentProviderEvent = PaymentAccountScope & (
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
      applicationFeeMinor?: number;
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
    }
  | {
      id: string;
      kind: "subscription_period_paid" | "subscription_period_failed" | "subscription_cancelled";
      providerRef: string;
      occurredAt: string;
      amountMinor?: number;
      currency?: string;
      periodStart?: string;
      periodEnd?: string;
      invoiceProviderRef?: string;
      paymentProviderRef?: string;
      applicationFeeMinor?: number;
    });

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
  /**
   * Optional. A missing method means this provider cannot save a card without
   * a charge. Callers must check before offering a zero-fee card trial.
   */
  createMethodSetup?(request: MethodSetupRequest): Promise<MethodSetupSession>;
  captureCheckout(request: CheckoutCaptureRequest): Promise<CheckoutCaptureResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  revokeSavedMethod(request: SavedMethodRevocationRequest): Promise<void>;
  chargeSavedMethod(request: OffSessionChargeRequest): Promise<OffSessionChargeResult>;
  createRecurringSchedule(request: RecurringScheduleRequest): Promise<RecurringScheduleResult>;
  updateRecurringSchedule(request: RecurringScheduleUpdateRequest): Promise<RecurringScheduleResult>;
  cancelRecurringSchedule(request: PaymentAccountScope & { providerRef: string; idempotencyKey: string }): Promise<void>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly PaymentProviderEvent[]>;
}
