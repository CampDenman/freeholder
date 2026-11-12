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
  /** Platform-owned charges with a distinct connected settlement recipient. */
  destinationMerchantCharges?: boolean;
}

/** Supplied by canonical ledger policy, never by a buyer's request. */
export interface PaymentAccountScope {
  providerAccountId?: string;
  /** Authenticated platform that originally created this provider resource. */
  providerPlatformAccountId?: string;
  /** Frozen request protocol for a versioned external schedule, never a namespace. */
  providerApiVersion?: "2026-02-25.clover" | "2026-10-28.endive";
}

/** Frozen ledger facts. A destination is never the charge object's account. */
export interface MerchantChargeScope extends PaymentAccountScope {
  /** Destination charge recipient; the charge remains on the platform. */
  destinationAccountId?: string;
  /** Stripe settlement merchant, independent of the charge namespace. */
  settlementMerchantAccountId?: string;
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

export interface InvoiceForCharge extends MerchantChargeScope {
  /** Canonical committed ledger attempt; required for new merchant routes. */
  paymentAttemptId?: string;
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

export interface CheckoutSession extends MerchantChargeScope {
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
export interface MethodSetupRequest extends MerchantChargeScope {
  /** Durable first-request witness, copied to provider metadata. */
  setupAttemptId?: string;
  currency: string;
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

/** Actual account-scoped reads of a durable setup request, never caller attestations. */
export interface MethodSetupRecovery extends PaymentAccountScope {
  state: "unresolved" | "customer_only" | "open" | "expired" | "complete";
  providerCustomerRef?: string;
  providerRef?: string;
  url?: string;
  expiresAt?: string;
  event?: PaymentProviderEvent;
}

export interface CheckoutCaptureRequest extends MerchantChargeScope {
  paymentAttemptId?: string;
  checkoutRef: string;
  idempotencyKey: string;
}

export interface CheckoutCaptureResult extends MerchantChargeScope {
  customerChargeVerified?: boolean;
  /** A paid charge remains paid while a separate settlement mismatch is reviewed. */
  merchantRouteVerified?: boolean;
  providerChargeRef?: string;
  applicationFeeRef?: string;
  transferRef?: string;
  applicationFeeCurrency?: string;
  observedApplicationFeeMinor?: number;
  observedFeeRefundedMinor?: number;
  merchantSettlementVerified?: boolean;
  providerRef: string;
  status: "pending" | "succeeded" | "failed";
  amountMinor?: number;
  currency?: string;
  occurredAt?: string;
  applicationFeeMinor?: number;
}

export interface MerchantSubscriptionChargeOrigin {
  providerApiVersion?: "2026-10-28.endive";
  providerSubscriptionRef: string;
  providerInvoiceRef: string;
  providerPaymentIntentRef: string;
}

export interface MerchantPaymentInspectionRequest extends MerchantChargeScope {
  providerPlatformAccountId: string;
  paymentAttemptId?: string;
  subscriptionOrigin?: MerchantSubscriptionChargeOrigin;
  providerRef: string;
  onPaymentObserved?: (evidence: CheckoutCaptureResult) => Promise<void>;
}

export interface RefundRequest extends MerchantChargeScope {
  subscriptionOrigin?: MerchantSubscriptionChargeOrigin;
  /** Return the collected platform fee along with a direct-charge refund. */
  refundApplicationFee?: boolean;
  /** Reverse the original destination transfer in proportion to this refund. */
  reverseTransfer?: boolean;
  paymentId: string;
  providerRef: string;
  currency: string;
  amountMinor: number;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult extends MerchantChargeScope {
  providerRef: string;
  status: "pending" | "succeeded" | "failed";
  /** A definite provider cancellation is unsuccessful, not a card decline. */
  failureCode?: "provider_cancelled";
}

/** Actual original-account refund evidence, independent of invoice application. */
export interface MerchantRefundObservation extends PaymentAccountScope {
  providerRef: string;
  paymentProviderRef: string;
  providerChargeRef?: string;
  amountMinor: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  failureCode?: "provider_cancelled";
  transferReversalRef?: string;
  sourceTransferReversalRef?: string;
  bindingVerified: boolean;
}
export interface MerchantRefundRecoveryRequest extends MerchantChargeScope {
  providerPlatformAccountId: string;
  refundAttemptId: string;
  paymentId: string;
  paymentProviderRef: string;
  amountMinor: number;
  currency: string;
  /** Only a reference already retained from this original physical operation. */
  originalRefundRef?: string;
  /** A supplied candidate must independently prove its original metadata. */
  candidateRefundRef?: string;
  onRefundObserved: (evidence: MerchantRefundObservation) => Promise<void>;
}
export type MerchantRefundRecovery =
  | { state: "unresolved" }
  | { state: "ambiguous"; refundRefs: readonly string[] }
  | { state: "observed"; evidence: MerchantRefundObservation };

export interface SavedMethodRevocationRequest extends PaymentAccountScope {
  providerRef: string;
  idempotencyKey: string;
}

export interface OffSessionChargeRequest extends MerchantChargeScope {
  paymentAttemptId?: string;
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

export interface OffSessionChargeResult extends MerchantChargeScope {
  customerChargeVerified?: boolean;
  merchantRouteVerified?: boolean;
  providerChargeRef?: string;
  applicationFeeRef?: string;
  transferRef?: string;
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

/** Only new flexible merchant agreements use the separately frozen schedule API. */
export interface MerchantScheduleLocator extends MerchantChargeScope {
  providerPlatformAccountId: string;
  providerScheduleApiVersion: "2026-10-28.endive";
  subscriptionId: string;
  providerSubscriptionRef: string;
}
export interface MerchantScheduleResource extends MerchantScheduleLocator { providerCustomerRef: string; }
export interface MerchantScheduleWebhookScope extends MerchantScheduleLocator {
  providerScheduleOperationId?: string;
  providerCustomerRef?: string;
}
/** Payment-specific committed source lookup; invoked only after raw HMAC verification. */
export interface PaymentWebhookRequest extends RawProviderRequest {
  /** Commit each authenticated original PI before any later page or fee read. */
  onSubscriptionChargeObserved?: (event: PaymentProviderEvent) => Promise<PaymentProviderEvent>;
  resolveSubscriptionScope?: (input: {
    providerSubscriptionRef: string;
    providerInvoiceRef?: string;
    providerAccountId?: string;
    metadata: Record<string, unknown>;
  }) => Promise<MerchantScheduleWebhookScope | null>;
}
export interface MerchantScheduleInvoiceInventory {
  state: "paused" | "cancelled";
  invoices: Array<{ providerInvoiceRef: string; state: "paid" | "void" | "draft" | "open" | "uncollectible" }>;
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

/** Exact frozen commission refund, independent of a customer refund's result. */
export interface MerchantFeeObservation {
  providerRef: string; applicationFeeRef: string; amountMinor: number; currency: string; bindingVerified: boolean;
}

export interface MerchantFeeRefundRequest extends MerchantChargeScope {
  onFeeRefundObserved?: (observation: MerchantFeeObservation) => Promise<void>;
  providerPlatformAccountId: string;
  applicationFeeRef: string;
  providerChargeRef: string;
  amountMinor: number;
  currency: string;
  operationId: string;
  idempotencyKey: string;
}

export interface MerchantFeeRefundResult {
  providerRef: string;
  applicationFeeRef: string;
  amountMinor: number;
  currency: string;
}

export interface MerchantPaymentRecoveryRequest extends MerchantChargeScope {
  providerPlatformAccountId: string;
  paymentAttemptId: string;
  invoiceId: string;
  contactId: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  checkoutRef?: string;
  idempotencyKey: string;
  /** Commit each positive read before another page/provider operation can fail. */
  onPaymentObserved?: (checkoutRef: string, evidence: CheckoutCaptureResult) => Promise<void>;
  /** Commit the actual physical cancellation acknowledgement before further I/O. */
  onRetirementAcknowledged?: (fact: { checkoutRef: string; paymentRef?: string; kind: "session_expired" | "intent_canceled" }) => Promise<void>;
}

export type MerchantPaymentRecovery =
  | { state: "unresolved" }
  | { state: "ambiguous"; checkoutRefs: readonly string[] }
  | { state: "open"; checkout: CheckoutSession }
  | { state: "pending" | "paid"; checkoutRef: string; evidence: CheckoutCaptureResult }
  | { state: "not_paid"; checkoutRef: string; paymentRef?: string; sessionStatus: "expired" | "complete"; intentStatus: string | null; amountReceivedMinor: 0 };

export interface MerchantIntentRecoveryRequest extends MerchantChargeScope {
  providerPlatformAccountId: string; paymentAttemptId: string; invoiceId: string; contactId: string;
  amountMinor: number; currency: string; createdAt: string; idempotencyKey: string; paymentRef?: string;
  onPaymentObserved?: (evidence: CheckoutCaptureResult) => Promise<void>;
  onRetirementAcknowledged?: (fact: { paymentRef: string; kind: "intent_canceled" }) => Promise<void>;
}
export type MerchantIntentRecovery =
  | { state: "unresolved" }
  | { state: "ambiguous"; paymentRefs: readonly string[] }
  | { state: "pending" | "paid"; paymentRef: string; evidence: CheckoutCaptureResult }
  | { state: "not_paid"; paymentRef: string; intentStatus: "canceled"; amountReceivedMinor: 0 };

export type PaymentProviderEvent = MerchantChargeScope & (
  | {
      id: string;
      kind: "payment_processing" | "payment_succeeded" | "payment_failed" | "payment_cancelled";
      providerRef: string;
      checkoutRef?: string;
      paymentAttemptId?: string;
      customerChargeVerified?: boolean;
      merchantRouteVerified?: boolean;
      providerChargeRef?: string;
      applicationFeeRef?: string;
      transferRef?: string;
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
      failureCode?: "provider_cancelled";
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
      setup?: { attemptId: string; subscriptionId: string; checkoutRef: string; setupIntentRef: string; settlementMerchantAccountId?: string };
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
      subscriptionChargeReceiptId?: string;
      subscriptionChargeObservationId?: string;
      subscriptionId?: string;
      providerScheduleOperationId?: string;
      providerCustomerRef?: string;
      customerChargeVerified?: boolean;
      merchantRouteVerified?: boolean;
      providerChargeRef?: string;
      observedApplicationFeeMinor?: number;
      applicationFeeCurrency?: string;
    });

export interface PaymentAdapter {
  readonly id: string;
  readonly status: AdapterStatus;
  capabilities(): PaymentAdapterCapabilities;
  /** Provider read outside business transactions; never an owner attestation. */
  platformAccountIdentity?(): Promise<{ providerPlatformAccountId: string }>;
  refundMerchantFee?(request: MerchantFeeRefundRequest): Promise<MerchantFeeRefundResult>;
  /** A missing lookup is unresolved, never evidence that a timed-out refund did not happen. */
  recoverMerchantFeeRefund?(request: MerchantFeeRefundRequest): Promise<MerchantFeeRefundResult | null>;
  recoverMerchantPayment?(request: MerchantPaymentRecoveryRequest): Promise<MerchantPaymentRecovery>;
  inspectMerchantPayment?(request: MerchantPaymentInspectionRequest): Promise<CheckoutCaptureResult>;
  /** Expires only the authenticated original session; never a new charge or a manual absence claim. */
  retireMerchantPayment?(request: MerchantPaymentRecoveryRequest): Promise<MerchantPaymentRecovery>;
  recoverMerchantIntent?(request: MerchantIntentRecoveryRequest): Promise<MerchantIntentRecovery>;
  retireMerchantIntent?(request: MerchantIntentRecoveryRequest): Promise<MerchantIntentRecovery>;
  recoverMerchantRefund?(request: MerchantRefundRecoveryRequest): Promise<MerchantRefundRecovery>;
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
  /** Create the customer separately so its actual reference commits before Checkout I/O. */
  createSetupCustomer?(request: MethodSetupRequest): Promise<PaymentAccountScope & { providerCustomerRef: string }>;
  createMethodSetup?(request: MethodSetupRequest): Promise<MethodSetupSession>;
  recoverMethodSetup?(request: MethodSetupRequest & { createdAt: string; providerRef?: string; verifyCustomerCreation?: boolean }): Promise<MethodSetupRecovery>;
  captureCheckout(request: CheckoutCaptureRequest): Promise<CheckoutCaptureResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  /** Erase the merchant-owned customer and its saved methods on the original account. */
  eraseCustomer?(request: PaymentAccountScope & {providerCustomerRef:string;idempotencyKey:string}):Promise<void>;
  revokeSavedMethod(request: SavedMethodRevocationRequest): Promise<void>;
  chargeSavedMethod(request: OffSessionChargeRequest): Promise<OffSessionChargeResult>;
  createRecurringSchedule(request: RecurringScheduleRequest): Promise<RecurringScheduleResult>;
  resolveMerchantScheduleResource?(request: MerchantScheduleLocator): Promise<MerchantScheduleResource>;
  pauseMerchantSchedule?(request: MerchantScheduleResource & { idempotencyKey: string; onPaused: (actual: { providerSubscriptionRef: string; state: "paused" }) => Promise<void> }): Promise<void>;
  cancelMerchantSchedule?(request: MerchantScheduleResource & { onCancelled: (actual: { providerSubscriptionRef: string; state: "cancelled"; source: "readback" | "delete_ack" }) => Promise<void> }): Promise<void>;
  inspectMerchantScheduleInvoices?(request: MerchantScheduleResource): Promise<MerchantScheduleInvoiceInventory>;
  updateRecurringSchedule(request: RecurringScheduleUpdateRequest): Promise<RecurringScheduleResult>;
  cancelRecurringSchedule(request: PaymentAccountScope & { providerRef: string; idempotencyKey: string }): Promise<void>;
  verifyWebhook(request: PaymentWebhookRequest): Promise<readonly PaymentProviderEvent[]>;
}
