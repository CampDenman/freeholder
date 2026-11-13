// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: separate controlled-draft transport; existing future-only phase DTOs stay strict.
import type { MerchantChargeScope } from "./types";
export interface MerchantControlledSubscriptionScope extends MerchantChargeScope {
  providerApiVersion: "2026-10-28.endive";
  providerPlatformAccountId: string;
  subscriptionId: string;
  termsId: string;
  generation: number;
  providerCustomerRef: string;
  providerMethodRef: string;
  providerProductRef: string;
  currency: string;
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
  /** Preparatory transport never changes these accepted application facts. */
  acceptedPeriodEnd: string;
  acceptedTrialEnd: string | null;
}
export interface MerchantControlledObservation {
  kind: "bootstrap_subscription" | "pause_subscription" | "subscription_read" | "invoice_read" | "proration_preview" | "intent_read" | "cash_observed" | "invoice_payments_read" | "invoice_lines_read" | "price_read" | "product_created" | "product_read" | "subscription_list_read" | "calendar_updated" | "calendar_canceled" | "invoice_list_read";
  raw: Record<string, unknown>;
}
export interface MerchantControlledObserver {
  /** The admitted original caller retains these actual bytes before interpretation. */
  onObserved(actual: MerchantControlledObservation): Promise<void>;
}
export interface MerchantControlledBootstrapRequest extends MerchantControlledSubscriptionScope, MerchantControlledObserver {
  operationId: string;
  requestDigest: string;
  idempotencyKey: string;
}
export interface MerchantControlledSubscriptionReadRequest extends MerchantControlledSubscriptionScope, MerchantControlledObserver {
  bootstrapOperationId: string;
  bootstrapRequestDigest: string;
  providerSubscriptionRef: string;
}
export interface MerchantControlledSubscriptionPauseRequest extends MerchantControlledSubscriptionReadRequest {
  operationId: string;
  requestDigest: string;
  idempotencyKey: string;
}
export interface MerchantControlledSubscriptionAcknowledgment {
  providerSubscriptionRef: string;
  providerInvoiceRef: string | null;
}
export interface MerchantControlledBootstrapInventory extends MerchantControlledSubscriptionAcknowledgment {
  providerApiVersion: "2026-10-28.endive";
  providerPlatformAccountId: string;
  chargeAccountId: string | null;
  status: "active" | "incomplete";
  collectionPausedAsDraft: boolean;
  /** Always false: preparation/pausing is not cancellation or financial closure. */
  financiallyQuiesced: false;
  positiveCollectionAdmissible: false;
  components: Array<{ kind: "principal"; subscriptionItemRef: string; providerPriceRef: string; providerProductRef: string;
    amountMinor: 0; actualPeriodStart: string; actualPeriodEnd: string }>;
  merchantTaxAuthority: "canonical_merchant_tax_ledger";
  fixedTaxRequiredBeforeCollection: true;
  actualAnchor: string;
  actualPeriodStart: string;
  actualPeriodEnd: string;
  actualTrialEnd: null;
  originalAcceptedTrialEnd: string | null;
  completeZeroRecurringItem: true;
  /** Separate actual invoice/payment enumeration is still required. */
  firstInvoiceFinancialState: "unverified";
}

/** Only an actual retained current controlled-calendar read may supply this
 * original item/anchor. A preview is never an issued invoice or payment. */
export interface MerchantControlledProrationPreviewRequest extends MerchantControlledSubscriptionReadRequest {
  operationId: string;
  requestDigest: string;
  idempotencyKey: string;
  originalComponents: Array<{ kind: "principal"; subscriptionItemRef: string; providerPriceRef: string; providerProductRef: string;
    amountMinor: number; actualPeriodStart: string; actualPeriodEnd: string; taxQuoteDigest: string; profileId: string; profileVersion: number }>;
  originalAnchor: string;
  originalProviderTrialEnd: string|null;
  originalPeriodStart: string;
  originalPeriodEnd: string;
  prorationAt: string;
  currentReadDigest: string;
  target: { providerProductRef: string; principalMinor: number; interval: "day" | "week" | "month" | "year"; intervalCount: number };
  /** null is an initial NET discovery preview, never final gross consent. */
  taxComponent: null | { providerProductRef:string; amountMinor:number; periodStart:string; periodEnd:string; taxQuoteDigest:string; profileId:string; profileVersion:number };
}
export interface MerchantControlledProrationPreview {
  providerPreviewRef: string;
  providerSubscriptionRef: string;
  providerCustomerRef: string;
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  amountDueMinor: number;
  prorationAt: string;
  requestedAnchor: "unchanged";
  originalAnchor: string;
  trialPolicy: "preserve_original_end";
  originalTrialEnd: string | null;
  /** Complete actual provider rows, retained before any canonical application. */
  actualLines: Array<{ providerLineRef: string; amountMinor: number; periodStart: string; periodEnd: string; proration: boolean; component: "principal" | "merchant_declared_tax_collection"; raw: Record<string,unknown> }>;
  actualRaw: Record<string,unknown>;
  /** An estimate cannot mark an invoice paid, mint credit or grant access. */
  suppliesPaidAuthority: false;
  sealedTaxIncluded:boolean;
}

export interface MerchantControlledInvoiceReadRequest extends MerchantControlledSubscriptionReadRequest {
 providerInvoiceRef: string;
}
export interface MerchantControlledInvoiceInventory {
 providerInvoiceRef: string;providerSubscriptionRef: string;providerCustomerRef: string;currency:string;
 status:"draft"|"open"|"paid"|"void"|"uncollectible";totalMinor:number;paidMinor:number;remainingMinor:number;
 autoAdvance:boolean;completePayments:true;completeLines:true;
 actualCash:Array<Record<string,unknown>>;actualPayments:Array<Record<string,unknown>>;actualIntents:Array<Record<string,unknown>>;actualLines:Array<Record<string,unknown>>;
 actualInvoice:Record<string,unknown>;actualPrices:Array<Record<string,unknown>>;
 /** Complete provider enumeration alone is never canonical applied/returned or stopped-calendar proof. */
 suppliesPaidAuthority:false;financiallyQuiesced:false;
}

export interface MerchantControlledProductRequest extends MerchantControlledSubscriptionScope, MerchantControlledObserver {
 operationId:string;requestDigest:string;idempotencyKey:string;name:string;component:"merchant_declared_tax_collection";
}
export interface MerchantControlledProductReadRequest extends MerchantControlledProductRequest { createdProductRef:string;originalProductOperationId:string;originalProductRequestDigest:string; }

export interface MerchantControlledBootstrapDiscoveryRequest extends MerchantControlledSubscriptionScope,MerchantControlledObserver {
 bootstrapOperationId:string;bootstrapRequestDigest:string;
}

export interface MerchantControlledCalendarUpdateRequest extends MerchantControlledProrationPreviewRequest {
 acceptedQuoteDigest:string;collectionId:string;
}

/** An identity read reports actual calendar state; it never supplies paid or
 * complete financial-stop authority. Cancellation still requires every actual
 * invoice/payment and original disposition to be closed independently. */
export interface MerchantControlledCalendarInventory {
 providerSubscriptionRef:string;providerInvoiceRef:string|null;providerCustomerRef:string;
 status:"active"|"incomplete"|"incomplete_expired"|"trialing"|"past_due"|"unpaid"|"canceled"|"paused";
 collectionPausedAsDraft:boolean;calendarCanceled:boolean;
 actualRaw:Record<string,unknown>;currentReadDigest:string;
 suppliesPaidAuthority:false;financiallyQuiesced:false;
}
export type MerchantControlledCalendarCancelRequest = MerchantControlledSubscriptionPauseRequest;
export interface MerchantControlledInvoiceListInventory {
 providerSubscriptionRef:string;providerInvoiceRefs:string[];actualInvoices:Array<Record<string,unknown>>;
 complete:true;suppliesPaidAuthority:false;financiallyQuiesced:false;
}
