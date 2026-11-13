// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stripe Checkout/refund edge with exact-byte HMAC webhook verification.

import { createHmac, timingSafeEqual } from "node:crypto";
import { AdapterError } from "../types";
import { env } from "@/core/env";
import { number, object, paymentFetch, providerJson, text } from "./http";
import { applyDestinationCharge, assertMerchantAttempt, assertMerchantIntent, merchantAttemptMetadata, merchantChargeScope, merchantIntentEvidence, validateMerchantChargeScope } from "./stripe-merchant-scope";
import { stripeMerchantFees } from "./stripe-merchant-fees";
import { stripeCheckoutEvidence } from "./stripe-merchant-capture";
import { proveStripeSubscriptionPayment } from "./stripe-subscription-origin";
import { collectOriginalStripeSubscriptionCash, originalSubscriptionInvoiceMetadata } from "./stripe-subscription-cash";
import { cancelOriginalStripeMerchantSchedule, inspectOriginalStripeMerchantInvoices, pauseOriginalStripeMerchantSchedule, resolveOriginalStripeMerchantSchedule } from "./stripe-subscription-quiescence";
import { inspectStripeMerchantPayment } from "./stripe-merchant-inspection";
import { createOriginalStripePhaseProduct, inspectOriginalStripePhaseProduct } from "./stripe-subscription-phase-product";
import { cancelOriginalStripePhaseSchedule, inspectOriginalStripePhaseSchedule, mutateOriginalStripePhaseSchedule } from "./stripe-subscription-phases";
import { stripeMerchantRecovery } from "./stripe-merchant-recovery";
import { stripeMerchantIntentRecovery } from "./stripe-merchant-intent-recovery";
import { stripeReturnedCash } from "./stripe-returned-cash";
import { stripeMerchantRefundRecovery } from "./stripe-merchant-refund-recovery";
import type {
  CheckoutCaptureResult,
  CheckoutCaptureRequest,
  MerchantChargeScope,
  PaymentAccountScope,
  OffSessionChargeResult,
  PaymentAdapter,
  PaymentAdapterCapabilities,
  PaymentMethodOffer,
  PaymentProviderEvent,
  RecurringScheduleResult,
  SavedPaymentMethodEvidence,
} from "./types";

const capabilities: PaymentAdapterCapabilities = {
  refunds: true,
  partialRefunds: true,
  savedMethods: true,
  subscriptions: true,
  offSessionCharges: true,
  disputes: true,
  payouts: false,
  inPerson: false,
  strongCustomerAuthentication: true,
  sellerMerchantCharges: true,
  destinationMerchantCharges: true,
};

function accountHeaders(id?: string): Record<string, string> {
  if (!id) return {};
  if (id.length > 200 || !/^acct_[A-Za-z0-9]+$/.test(id)) throw new AdapterError("payments", "stripe", "invalid_request", "That seller payment account is invalid.");
  return { "stripe-account": id };
}

function applicationFee(form: URLSearchParams, key: string, value: number | undefined, accountId: string | undefined, amountMinor?: number, allowEntireCharge = false): void {
  if (value === undefined || value === 0) return;
  if (!accountId || !Number.isFinite(value) || value < 0 || (amountMinor !== undefined ? !Number.isSafeInteger(value) || (allowEntireCharge ? value > amountMinor : value >= amountMinor) : !validFeePercent(value))) throw new AdapterError("payments", "stripe", "invalid_request", "That seller application fee is outside its valid range.");
  form.set(key, String(value));
}

function validFeePercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 && /^\d+(?:\.\d{1,2})?$/.test(String(value));
}

function feePercent(value: unknown): number | undefined {
  if (value === null) return 0;
  return validFeePercent(value) ? value : undefined;
}

export interface StripePaymentOptions {
  secretKey?: string;
  webhookSecrets?: readonly string[];
  apiBase?: string;
  fetch?: typeof fetch;
  toleranceSeconds?: number;
}

function stripeTime(value: unknown): string {
  const seconds = number(value);
  if (seconds === undefined) {
    throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent an invalid event time.");
  }
  return new Date(seconds * 1_000).toISOString();
}

function stripeOptionalTime(value: unknown): string | undefined {
  return number(value) === undefined ? undefined : stripeTime(value);
}

function stripeMethod(value: Record<string, unknown>): SavedPaymentMethodEvidence | undefined {
  const id = text(value.id);
  const type = text(value.type);
  if (!id || !type) return undefined;
  const card = object(value.card);
  const usBank = object(value.us_bank_account);
  if (card) {
    return {
      providerRef: id,
      providerCustomerRef: text(value.customer),
      kind: "card",
      label: `${text(card.brand) ?? "Card"} ending ${text(card.last4) ?? "••••"}`,
      brand: text(card.brand),
      last4: text(card.last4),
      expiryMonth: number(card.exp_month),
      expiryYear: number(card.exp_year),
    };
  }
  if (usBank) {
    return {
      providerRef: id,
      providerCustomerRef: text(value.customer),
      kind: "bank_debit",
      label: `${text(usBank.bank_name) ?? "Bank account"} ending ${text(usBank.last4) ?? "••••"}`,
      brand: text(usBank.bank_name),
      last4: text(usBank.last4),
    };
  }
  return {
    providerRef: id,
    providerCustomerRef: text(value.customer),
    kind: type.includes("bank") || type.includes("debit") ? "bank_debit" : "other",
    label: type.replaceAll("_", " "),
  };
}

function stripeEvents(payload: Record<string, unknown>): PaymentProviderEvent[] {
  const id = text(payload.id);
  const type = text(payload.type);
  const created = stripeTime(payload.created);
  const data = object(payload.data);
  const value = object(data?.object);
  if (!id || !type || !value) {
    throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent a malformed event.");
  }
  const metadata = object(value.metadata);
  const invoiceId = text(metadata?.freeholder_invoice_id);
  const contactId = text(metadata?.freeholder_contact_id);
  const customer = typeof value.customer === "string" ? value.customer : text(object(value.customer)?.id);
  const currency = text(value.currency)?.toUpperCase();
  const amount = number(value.amount_received) ?? number(value.amount) ?? number(value.amount_total);

  if (type.startsWith("payout.")) {
    const providerRef = text(value.id);
    const payoutAmount = number(value.amount);
    const status = text(value.status);
    if (!providerRef || payoutAmount === undefined || !currency || !status) return [];
    const common = {
      id,
      providerRef,
      amountMinor: payoutAmount,
      currency,
      occurredAt: created,
      expectedAt: stripeOptionalTime(value.arrival_date),
      statementRef: text(value.statement_descriptor),
      failureReason: text(value.failure_message) ?? text(value.failure_code),
    };
    if (status === "paid") return [{ ...common, kind: "payout_paid" }];
    if (status === "in_transit") return [{ ...common, kind: "payout_in_transit" }];
    if (status === "failed") return [{ ...common, kind: "payout_failed" }];
    if (status === "canceled") return [{ ...common, kind: "payout_cancelled" }];
    if (status === "pending") return [{ ...common, kind: "payout_pending" }];
    return [];
  }

  if (type.startsWith("payment_intent.")) {
    const providerRef = text(value.id);
    if (!providerRef) return [];
    if (type === "payment_intent.processing") return [{ id, kind: "payment_processing", providerRef, amountMinor: amount, currency, occurredAt: created, invoiceId, contactId, providerCustomerRef: customer }];
    if (type === "payment_intent.succeeded") return [{ id, kind: "payment_succeeded", providerRef, amountMinor: amount, currency, occurredAt: created, invoiceId, contactId, providerCustomerRef: customer }];
    // A failed attempt can return the same PaymentIntent to requires_payment_method
    // and later succeed inside Checkout. The terminal session events below own
    // failure so an ordinary card retry cannot poison the Freeholder payment.
    if (type === "payment_intent.payment_failed") return [];
    if (type === "payment_intent.canceled") return [{ id, kind: "payment_cancelled", providerRef, amountMinor: amount, currency, occurredAt: created }];
    return [];
  }

  if (type.startsWith("checkout.session.")) {
    const checkoutRef = text(value.id);
    if (!checkoutRef) return [];
    const providerRef = text(value.payment_intent) ?? text(object(value.payment_intent)?.id) ?? checkoutRef;
    const common = { id, providerRef, checkoutRef, amountMinor: number(value.amount_total), currency, occurredAt: created, invoiceId, contactId, providerCustomerRef: customer };
    // Setup mode never moves money. verifyWebhook resolves and validates the
    // SetupIntent before this normalizer extracts its saved method.
    if (value.mode === "setup") {
      if (type !== "checkout.session.completed" || value.payment_status !== "no_payment_required" || !contactId) return [];
      const setupIntent = object(value.setup_intent);
      const methodSource = object(setupIntent?.payment_method) ?? object(value.payment_method);
      const method = methodSource ? stripeMethod(methodSource) : undefined;
      if (!method) return [];
      return [{
        id,
        kind: "saved_method_added",
        contactId,
        ...(text(metadata?.freeholder_setup_attempt_id) ? {setup:{attemptId:text(metadata?.freeholder_setup_attempt_id)!,subscriptionId:text(metadata?.freeholder_subscription_id)!,checkoutRef,setupIntentRef:text(setupIntent?.id)!, ...(text(setupIntent?.on_behalf_of) ? { settlementMerchantAccountId: text(setupIntent?.on_behalf_of)! } : {})}} : {}),
        providerCustomerRef: customer ?? method.providerCustomerRef,
        method: { ...method, providerCustomerRef: method.providerCustomerRef ?? customer },
        occurredAt: created,
      }];
    }
    if (type === "checkout.session.async_payment_succeeded" || (type === "checkout.session.completed" && value.payment_status === "paid")) {
      return [{ ...common, kind: "payment_succeeded" }];
    }
    if (type === "checkout.session.async_payment_failed") return [{ ...common, kind: "payment_failed" }];
    if (type === "checkout.session.expired") return [{ ...common, kind: "payment_cancelled" }];
    return [];
  }

  if (type.startsWith("refund.")) {
    const providerRef = text(value.id);
    const observedPaymentIntentRef = text(value.payment_intent) ?? text(object(value.payment_intent)?.id) ?? null;
    const providerChargeRef = text(value.charge) ?? text(object(value.charge)?.id);
    const paymentProviderRef = observedPaymentIntentRef ?? providerChargeRef ?? null;
    if (!providerRef) return [];
    const providerStatus = ["pending", "requires_action", "succeeded", "failed", "canceled"].includes(String(value.status))
      ? value.status as "pending" | "requires_action" | "succeeded" | "failed" | "canceled" : null;
    const common = { id, providerRef, paymentProviderRef, ...(providerChargeRef ? { providerChargeRef } : {}),
      providerStatus, observedPaymentIntentRef, observedProviderApiVersion: text(payload.api_version) ?? null,
      ...(text(value.failure_reason) ? { failureReason: text(value.failure_reason)! } : {}),
      ...(text(value.failure_balance_transaction) ?? text(object(value.failure_balance_transaction)?.id)
        ? { failureBalanceTransactionRef: (text(value.failure_balance_transaction) ?? text(object(value.failure_balance_transaction)?.id))! } : {}),
      amountMinor: number(value.amount), currency, occurredAt: created };
    if (value.status === "succeeded") return [{ ...common, kind: "refund_succeeded" }];
    if (value.status === "canceled") return [{ ...common, kind: "refund_failed", failureCode: "provider_cancelled" }];
    if (value.status === "failed" || type === "refund.failed") return [{ ...common, kind: "refund_failed" }];
    // Null/unrecognized state remains retained evidence, never terminal cash.
    return [{ ...common, kind: "refund_processing" }];
  }

  if (type.startsWith("charge.dispute.")) {
    const providerRef = text(value.id);
    const paymentProviderRef = text(value.payment_intent) ?? text(value.charge);
    if (!providerRef || !paymentProviderRef) return [];
    const status = text(value.status);
    const common = {
      id,
      providerRef,
      paymentProviderRef,
      amountMinor: number(value.amount),
      currency,
      occurredAt: created,
      reason: text(value.reason),
      evidenceDueAt: stripeOptionalTime(object(value.evidence_details)?.due_by),
    };
    if (status === "won") return [{ ...common, kind: "dispute_won" }];
    if (status === "lost") return [{ ...common, kind: "dispute_lost" }];
    return [{ ...common, kind: "dispute_opened" }];
  }

  if (type === "payment_method.attached" || type === "payment_method.detached") {
    const method = stripeMethod(value);
    if (!method) return [];
    return [{
      id,
      kind: type === "payment_method.attached" ? "saved_method_added" : "saved_method_removed",
      providerCustomerRef: method.providerCustomerRef,
      contactId,
      method,
      occurredAt: created,
    }];
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const subscriptionSource = value.subscription ?? object(object(value.parent)?.subscription_details)?.subscription;
    const subscriptionRef =
      typeof subscriptionSource === "string"
        ? subscriptionSource
        : text(object(subscriptionSource)?.id);
    if (!subscriptionRef) return [];
    const lineData = object(value.lines)?.data;
    const firstLine = Array.isArray(lineData) ? object(lineData[0]) : undefined;
    const linePeriod = object(firstLine?.period);
    return [{
      id,
      kind: type === "invoice.paid" ? "subscription_period_paid" : "subscription_period_failed",
      providerRef: subscriptionRef,
      occurredAt: created,
      amountMinor: number(value.amount_paid) ?? amount,
      currency,
      periodStart: stripeOptionalTime(linePeriod?.start ?? value.period_start ?? object(value.period)?.start),
      periodEnd: stripeOptionalTime(linePeriod?.end ?? value.period_end ?? object(value.period)?.end),
      invoiceProviderRef: text(value.id),
    }];
  }
  if (type === "customer.subscription.deleted") {
    const providerRef = text(value.id);
    if (!providerRef) return [];
    return [{
      id,
      kind: "subscription_cancelled",
      providerRef,
      occurredAt: created,
    }];
  }
  return [];
}

/** Normalize only after the caller verifies Stripe's exact-byte signature. */
export function stripePaymentEvents(payload: Record<string, unknown>): PaymentProviderEvent[] {
  const account = payload.account;
  if (account !== undefined && (typeof account !== "string" || !/^acct_[A-Za-z0-9]+$/.test(account) || account.length > 200)) throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent an invalid account scope.");
  const value = object(object(payload.data)?.object);
  return stripeEvents(payload).map(event => {
    const metadata = object(value?.metadata);
    const platform = text(metadata?.freeholder_platform_account_id);
    const paymentAttemptId = text(metadata?.freeholder_payment_id);
    if (event.kind === "saved_method_added" && platform) {
      if (!/^acct_[A-Za-z0-9]+$/.test(platform) || platform.length > 200) throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent an invalid original setup platform.");
      return { ...event, providerPlatformAccountId: platform, ...(account ? { providerAccountId: account } : {}) };
    }
    if ((platform || paymentAttemptId) && ["payment_processing", "payment_succeeded", "payment_failed", "payment_cancelled"].includes(event.kind)) {
      if (!platform || !/^acct_[A-Za-z0-9]+$/.test(platform) || !paymentAttemptId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentAttemptId)) throw new AdapterError("payments", "stripe", "invalid_request", "Stripe did not identify a complete original merchant payment attempt.");
      if (event.kind === "payment_processing" || event.kind === "payment_succeeded" || event.kind === "payment_failed" || event.kind === "payment_cancelled") {
        const intent = String(payload.type).startsWith("payment_intent.") ? value : undefined;
        const destination = object(intent?.transfer_data)?.destination;
        const destinationAccountId = typeof destination === "string" ? destination : text(object(destination)?.id);
        const settlementMerchantAccountId = typeof intent?.on_behalf_of === "string" ? intent.on_behalf_of : text(object(intent?.on_behalf_of)?.id);
        const fee = intent?.application_fee_amount === null ? 0 : number(intent?.application_fee_amount);
        return { ...event, providerPlatformAccountId: platform, ...(account ? { providerAccountId: account } : {}), paymentAttemptId,
          ...(destinationAccountId ? { destinationAccountId } : {}), ...(settlementMerchantAccountId ? { settlementMerchantAccountId } : {}),
          ...(fee !== undefined ? { applicationFeeMinor: fee } : {}),
          ...(typeof intent?.latest_charge === "string" ? { providerChargeRef: intent.latest_charge } : text(object(intent?.latest_charge)?.id) ? { providerChargeRef: text(object(intent?.latest_charge)?.id) } : {}),
          customerChargeVerified: Boolean(intent && event.kind === "payment_succeeded" && intent.status === "succeeded" && number(intent.amount_received) !== undefined),
          merchantRouteVerified: Boolean(intent && Object.hasOwn(intent, "transfer_data") && Object.hasOwn(intent, "on_behalf_of") && fee !== undefined && (object(intent.transfer_data)?.amount == null || object(intent.transfer_data)?.amount === intent.amount_received)) };
      }
    }
    if (!account) return event;
    if (event.kind === "payment_succeeded" && String(payload.type).startsWith("checkout.session.")) {
      // A Checkout Session does not prove the application's collected fee.
      // The PaymentIntent event (or a scoped API read) completes settlement.
      return { ...event, providerAccountId: account, kind: "payment_processing" };
    }
    const fee = value?.application_fee_amount === null ? 0 : number(value?.application_fee_amount);
    return { ...event, providerAccountId: account, ...(event.kind.startsWith("payment_") && fee !== undefined ? { applicationFeeMinor: fee } : {}) };
  });
}

export function createStripePayments(options: StripePaymentOptions = {}): PaymentAdapter {
  const current = env();
  const secretKey = options.secretKey ?? current.STRIPE_SECRET_KEY;
  const webhookSecrets = options.webhookSecrets ?? [current.STRIPE_WEBHOOK_SECRET, current.STRIPE_WEBHOOK_SECRET_PREVIOUS].filter((value): value is string => Boolean(value));
  const apiBase = (options.apiBase ?? "https://api.stripe.com").replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const tolerance = options.toleranceSeconds ?? 300;
  const missing = [!secretKey ? "STRIPE_SECRET_KEY" : undefined, webhookSecrets.length === 0 ? "STRIPE_WEBHOOK_SECRET" : undefined].filter(Boolean);

  async function api(path: string, init: RequestInit, original?: string | PaymentAccountScope): Promise<Record<string, unknown>> {
    if (!secretKey) throw new AdapterError("payments", "stripe", "unavailable", "Stripe is not configured.");
    const scope = typeof original === "string" ? { providerAccountId: original } : original ?? {};
    const scopedHeaders = accountHeaders(scope.providerAccountId);
    const suppliedHeaders = new Headers(init.headers), headerVersion = suppliedHeaders.get("stripe-version");
    const version = scope.providerApiVersion ?? headerVersion ?? "2026-02-25.clover";
    if (version !== "2026-02-25.clover" && version !== "2026-10-28.endive" || scope.providerApiVersion && headerVersion && scope.providerApiVersion !== headerVersion) throw new AdapterError("payments", "stripe", "invalid_request", "The original provider API protocol is inconsistent.");
    suppliedHeaders.delete("stripe-account");
    if (scope.providerPlatformAccountId) {
      accountHeaders(scope.providerPlatformAccountId);
      const actual = await platformAccountIdentity(version);
      if (actual.providerPlatformAccountId !== scope.providerPlatformAccountId) throw new AdapterError("payments", "stripe", "authentication", "Reconnect the original platform account before servicing this provider resource.");
    }
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: { ...Object.fromEntries(suppliedHeaders.entries()), authorization: `Bearer ${secretKey}`, "stripe-version": version, ...scopedHeaders },
    });
    return providerJson("stripe", response);
  }

  async function platformAccountIdentity(providerApiVersion?: PaymentAccountScope["providerApiVersion"]): Promise<{ providerPlatformAccountId: string }> {
    const account = await api("/v1/account", { method: "GET" }, providerApiVersion ? { providerApiVersion } : undefined);
    const id = text(account.id);
    if (!id || id.length > 200 || !/^acct_[A-Za-z0-9]+$/.test(id)) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not identify the authenticated platform account.", true);
    return { providerPlatformAccountId: id };
  }

  async function chargeApi(path: string, init: RequestInit, scope: MerchantChargeScope): Promise<Record<string, unknown>> {
    validateMerchantChargeScope(scope);
    return api(path, init, scope);
  }

  async function captureCheckout(request: CheckoutCaptureRequest): Promise<CheckoutCaptureResult> {
    merchantAttemptMetadata(request, request.paymentAttemptId);
    const merchant = Boolean(request.providerAccountId || request.destinationAccountId || request.providerPlatformAccountId);
    const expansion = merchant ? "?expand%5B%5D=payment_intent" : "";
    const value = await chargeApi(`/v1/checkout/sessions/${encodeURIComponent(request.checkoutRef)}${expansion}`, { method: "GET" }, request);
    return stripeCheckoutEvidence(request, value);
  }

  async function provenSetup(value:Record<string,unknown>,account?:string | MerchantChargeScope):Promise<Record<string,unknown>>{
    const metadata=object(value.metadata);
        const unproven=()=>new AdapterError("payments","stripe","provider_failure","Stripe did not prove this saved payment method on its original account.",true);
        const setupRef=text(value.setup_intent) ?? text(object(value.setup_intent)?.id);
        const customer=text(value.customer) ?? text(object(value.customer)?.id);
        if(!setupRef || !/^seti_[A-Za-z0-9]+$/.test(setupRef) || setupRef.length>200 || !customer) throw unproven();
        const query=new URLSearchParams({"expand[]":"payment_method"});
        const intent=await api(`/v1/setup_intents/${encodeURIComponent(setupRef)}?${query}`,{method:"GET"},account);
        const actualCustomer=text(intent.customer) ?? text(object(intent.customer)?.id);
        const actualMetadata=object(intent.metadata);
        const method=object(intent.payment_method);
        const methodCustomer=text(method?.customer) ?? text(object(method?.customer)?.id);
        const original = typeof account === "object" ? account : undefined;
        if (original?.providerPlatformAccountId && (actualMetadata?.freeholder_platform_account_id !== original.providerPlatformAccountId
          || text(intent.on_behalf_of) !== original.settlementMerchantAccountId)) throw unproven();
        if(intent.id!==setupRef || intent.status!=="succeeded" || intent.usage!=="off_session" || actualCustomer!==customer || methodCustomer!==customer
          || text(actualMetadata?.freeholder_contact_id)!==text(metadata?.freeholder_contact_id)
          || text(actualMetadata?.freeholder_subscription_id)!==text(metadata?.freeholder_subscription_id)
          || text(actualMetadata?.freeholder_setup_attempt_id)!==text(metadata?.freeholder_setup_attempt_id)
          || !method || !stripeMethod(method)) throw unproven();
        return {...value,setup_intent:{...intent,payment_method:{...method,customer}}};
  }
  async function matchingSetupObject(path:string,account:string | PaymentAccountScope | undefined,matches:(value:Record<string,unknown>)=>boolean){
    let cursor:string|undefined;
    const found:Record<string,unknown>[]=[];
    for(let page=0;page<10;page++){
      const separator=path.includes("?")?"&":"?";
      const response=await api(`${path}${separator}limit=100${cursor?`&starting_after=${encodeURIComponent(cursor)}`:""}`,{method:"GET"},account);
      if(!Array.isArray(response.data) || typeof response.has_more!=="boolean")throw new AdapterError("payments","stripe","provider_failure","Stripe did not return a complete setup lookup.",true);
      const rows=response.data.map(object);
      if(rows.some(row=>!row || !text(row.id)))throw new AdapterError("payments","stripe","provider_failure","Stripe returned an invalid setup lookup.",true);
      found.push(...rows.filter((row):row is Record<string,unknown>=>!!row&&matches(row)));
      if(found.length>1)throw new AdapterError("payments","stripe","provider_failure","More than one provider resource matches this original setup; reconcile it before retrying.",true);
      if(!response.has_more)return found[0];
      const next=text(rows.at(-1)?.id);
      if(!next || next===cursor)break;
      cursor=next;
    }
    throw new AdapterError("payments","stripe","provider_failure","The setup lookup exceeds its bounded recovery window; reconcile it before retrying.",true);
  }

  return {
    id: "stripe",
    status: {
      family: "payments",
      id: "stripe",
      available: missing.length === 0,
      message: missing.length === 0 ? "Stripe checkout, refunds, saved methods, disputes, payout tracking, and authenticated feedback are configured." : `Stripe is missing ${missing.join(" and ")}.`,
    },
    capabilities: () => ({ ...capabilities }),
    platformAccountIdentity,
    ...stripeMerchantFees(chargeApi),
    ...stripeMerchantRecovery(chargeApi),
    ...stripeMerchantIntentRecovery(chargeApi),
    ...stripeMerchantRefundRecovery(chargeApi),
    ...stripeReturnedCash(chargeApi),
    inspectMerchantPayment: request => inspectStripeMerchantPayment(request, (path, scope) => api(path, { method: "GET" }, scope)),
    async supportedCurrencies() { return []; },
    async supportedMethods(context) {
      const methods: PaymentMethodOffer[] = [{ id: "card", label: "Card or supported wallet", kind: "card", recurring: true }];
      if (context.country === "US" && context.currency === "USD") methods.push({ id: "us_bank_account", label: "US bank account", kind: "bank_debit", recurring: true });
      if (context.country === "CA" && context.currency === "CAD") methods.push({ id: "acss_debit", label: "Canadian bank debit", kind: "bank_debit", recurring: true });
      if (context.currency === "EUR") methods.push({ id: "sepa_debit", label: "SEPA debit", kind: "bank_debit", recurring: true });
      return methods;
    },
    async createCheckout(invoice) {
      validateMerchantChargeScope(invoice);
      const originalMetadata = merchantAttemptMetadata(invoice, invoice.paymentAttemptId);
      const form = new URLSearchParams({
        mode: "payment",
        client_reference_id: invoice.invoiceId,
        success_url: invoice.successUrl,
        cancel_url: invoice.cancelUrl,
        "line_items[0][price_data][currency]": invoice.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(invoice.amountMinor),
        "line_items[0][price_data][product_data][name]": invoice.description.slice(0, 250),
        "line_items[0][quantity]": "1",
        "metadata[freeholder_invoice_id]": invoice.invoiceId,
        "metadata[freeholder_contact_id]": invoice.contactId,
        "payment_intent_data[metadata][freeholder_invoice_id]": invoice.invoiceId,
        "payment_intent_data[metadata][freeholder_contact_id]": invoice.contactId,
      });
      for (const [key, value] of Object.entries(originalMetadata)) {
        form.set(`metadata[${key}]`, value);
        form.set(`payment_intent_data[metadata][${key}]`, value);
      }
      if (invoice.providerCustomerRef) form.set("customer", invoice.providerCustomerRef);
      else form.set("customer_email", invoice.customer.email);
      if (invoice.saveMethod) {
        form.set("payment_intent_data[setup_future_usage]", "off_session");
        if (!invoice.providerCustomerRef) form.set("customer_creation", "always");
      }
      for (const method of invoice.methodIds ?? []) form.append("payment_method_types[]", method);
      applyDestinationCharge(form, true, invoice);
      applicationFee(form, "payment_intent_data[application_fee_amount]", invoice.applicationFeeMinor, invoice.providerAccountId ?? invoice.destinationAccountId, invoice.amountMinor, Boolean(invoice.providerPlatformAccountId));
      const value = await chargeApi("/v1/checkout/sessions", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": invoice.idempotencyKey },
        body: form,
      }, invoice);
      const providerRef = text(value.id);
      const url = text(value.url);
      if (!providerRef || !url) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a checkout address.");
      return {
        providerRef,
        ...merchantChargeScope(invoice),
        paymentRef: text(value.payment_intent) ?? text(object(value.payment_intent)?.id),
        url,
        expiresAt: number(value.expires_at) === undefined ? undefined : stripeTime(value.expires_at),
      };
    },
    async createSetupCustomer(request) {
      if (request.providerPlatformAccountId || request.destinationAccountId) validateMerchantChargeScope(request);
      const form = new URLSearchParams({email:request.customer.email,"metadata[freeholder_contact_id]":request.contactId,"metadata[freeholder_subscription_id]":request.subscriptionId});
      if(request.customer.name)form.set("name",request.customer.name.slice(0,200));
      if(request.setupAttemptId)form.set("metadata[freeholder_setup_attempt_id]",request.setupAttemptId);
      if(request.providerPlatformAccountId)form.set("metadata[freeholder_platform_account_id]",request.providerPlatformAccountId);
      const customer=await api("/v1/customers",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","idempotency-key":`${request.idempotencyKey}:customer`},body:form},request);
      const providerCustomerRef=text(customer.id);
      if(!providerCustomerRef || !/^cus_[A-Za-z0-9]+$/.test(providerCustomerRef) || providerCustomerRef.length>200)throw new AdapterError("payments","stripe","provider_failure","Stripe did not return the original setup customer.",true);
      return {providerCustomerRef,...(request.providerPlatformAccountId?{providerPlatformAccountId:request.providerPlatformAccountId}:{}),...(request.providerAccountId?{providerAccountId:request.providerAccountId}:{})};
    },
    async resolveMerchantScheduleResource(request) {
      return resolveOriginalStripeMerchantSchedule(api, request);
    },
    async pauseMerchantSchedule(request) {
      return pauseOriginalStripeMerchantSchedule(api, request, request);
    },
    async cancelMerchantSchedule(request) {
      return cancelOriginalStripeMerchantSchedule(api, request, request);
    },
    async inspectMerchantScheduleInvoices(request) {
      return inspectOriginalStripeMerchantInvoices(api, request);
    },
    async createMethodSetup(request) {
      if (request.providerPlatformAccountId || request.destinationAccountId) validateMerchantChargeScope(request);
      const customerRef=request.providerCustomerRef;
      if(!customerRef)throw new AdapterError("payments","stripe","invalid_request","Commit the original setup customer before opening Checkout.");
      const form = new URLSearchParams({
        mode: "setup",
        currency:request.currency.toLowerCase(),
        customer:customerRef,
        client_reference_id: request.subscriptionId,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        "metadata[freeholder_contact_id]": request.contactId,
        "metadata[freeholder_subscription_id]": request.subscriptionId,
        "setup_intent_data[metadata][freeholder_contact_id]": request.contactId,
        "setup_intent_data[metadata][freeholder_subscription_id]": request.subscriptionId,
      });
      if(request.setupAttemptId){
        form.set("metadata[freeholder_setup_attempt_id]",request.setupAttemptId);
        form.set("setup_intent_data[metadata][freeholder_setup_attempt_id]",request.setupAttemptId);
      }
      if (request.providerPlatformAccountId) {
        form.set("metadata[freeholder_platform_account_id]",request.providerPlatformAccountId);
        form.set("setup_intent_data[metadata][freeholder_platform_account_id]",request.providerPlatformAccountId);
      }
      if (request.settlementMerchantAccountId) {
        form.set("setup_intent_data[on_behalf_of]",request.settlementMerchantAccountId);
        form.set("metadata[freeholder_setup_settlement_account_id]",request.settlementMerchantAccountId);
      }
      const value = await api("/v1/checkout/sessions", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.idempotencyKey },
        body: form,
      }, request);
      const providerRef = text(value.id);
      const url = text(value.url);
      const providerCustomerRef = typeof value.customer === "string" ? value.customer : text(object(value.customer)?.id);
      if (!providerRef || !url || providerCustomerRef!==customerRef) {
        throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a card-setup address.");
      }
      return {
        providerRef,
        ...(request.providerPlatformAccountId ? { providerPlatformAccountId: request.providerPlatformAccountId } : {}),
        ...(request.providerAccountId ? { providerAccountId: request.providerAccountId } : {}),
        url,
        expiresAt: number(value.expires_at) === undefined ? undefined : stripeTime(value.expires_at),
        providerCustomerRef,
      };
    },
    async recoverMethodSetup(request) {
      if (request.providerPlatformAccountId || request.destinationAccountId) validateMerchantChargeScope(request);
      const failed=()=>new AdapterError("payments","stripe","provider_failure","Stripe did not reconcile this original setup on its original account.",true);
      if(!request.setupAttemptId || !Number.isFinite(Date.parse(request.createdAt)))throw failed();
      const sameMetadata=(value:Record<string,unknown>)=>{
        const metadata=object(value.metadata);
        return (!request.providerPlatformAccountId || metadata?.freeholder_platform_account_id===request.providerPlatformAccountId) && text(metadata?.freeholder_setup_attempt_id)===request.setupAttemptId && text(metadata?.freeholder_subscription_id)===request.subscriptionId && text(metadata?.freeholder_contact_id)===request.contactId;
      };
      const since=Math.max(0,Math.floor(Date.parse(request.createdAt)/1000)-120);
      let customer=request.providerCustomerRef;
      if(!customer){
        const found=await matchingSetupObject(`/v1/customers?created%5Bgte%5D=${since}`,request,sameMetadata);
        if(!found)return {state:"unresolved",...(request.providerPlatformAccountId?{providerPlatformAccountId:request.providerPlatformAccountId}:{}),...(request.providerAccountId?{providerAccountId:request.providerAccountId}:{})};
        customer=text(found.id);
        if(!customer || !/^cus_[A-Za-z0-9]+$/.test(customer) || found.deleted===true)throw failed();
      }
      if(request.verifyCustomerCreation){
        if(!customer || !/^cus_[A-Za-z0-9]+$/.test(customer))throw failed();
        const original=await api(`/v1/customers/${encodeURIComponent(customer)}`,{method:"GET"},request);
        if(original.id!==customer || original.deleted===true || !sameMetadata(original))throw failed();
      }
      const base={providerCustomerRef:customer,...(request.providerPlatformAccountId?{providerPlatformAccountId:request.providerPlatformAccountId}:{}),...(request.providerAccountId?{providerAccountId:request.providerAccountId}:{})};
      const session=request.providerRef
        ? await api(`/v1/checkout/sessions/${encodeURIComponent(request.providerRef)}`,{method:"GET"},request)
        : await matchingSetupObject(`/v1/checkout/sessions?customer=${encodeURIComponent(customer)}&created%5Bgte%5D=${since}`,request,sameMetadata);
      if(!session)return {state:"customer_only",...base};
      const providerRef=text(session.id),actualCustomer=text(session.customer)??text(object(session.customer)?.id);
      if(!providerRef || (request.providerRef && providerRef!==request.providerRef) || session.mode!=="setup" || actualCustomer!==customer || !sameMetadata(session) || text(session.currency)?.toUpperCase()!==request.currency)throw failed();
      if(session.status==="expired")return {state:"expired",providerRef,...base};
      if(session.status==="open"){
        const url=text(session.url),expires=number(session.expires_at);
        if(!url || !expires || expires*1000<=Date.now())throw failed();
        return {state:"open",providerRef,url,expiresAt:stripeTime(expires),...base};
      }
      if(session.status!=="complete" || session.payment_status!=="no_payment_required")throw failed();
      const proven=await provenSetup(session,request);
      const intent=object(proven.setup_intent),created=number(intent?.created)??number(session.created);
      if(!created || created*1000<Date.parse(request.createdAt)-120_000)throw failed();
      const [event]=stripePaymentEvents({id:`setup-retrieved:${providerRef}:${text(intent?.id)}`,type:"checkout.session.completed",created,...(request.providerAccountId?{account:request.providerAccountId}:{}),data:{object:proven}});
      if(!event || event.kind!=="saved_method_added")throw failed();
      return {state:"complete",providerRef,event,...base};
    },
    captureCheckout,
    async refund(input) {
      if (input.providerApiVersion && input.subscriptionOrigin?.providerApiVersion && input.providerApiVersion !== input.subscriptionOrigin.providerApiVersion) throw new AdapterError("payments", "stripe", "invalid_request", "The scheduled refund protocol does not match its original scope.");
      const request = { ...input, ...(input.subscriptionOrigin?.providerApiVersion ? { providerApiVersion: input.subscriptionOrigin.providerApiVersion } : {}) };
      validateMerchantChargeScope(request);
      if (request.subscriptionOrigin && (!request.providerPlatformAccountId || request.subscriptionOrigin.providerPaymentIntentRef !== request.providerRef)) throw new AdapterError("payments", "stripe", "invalid_request", "The refund requires its exact original subscription charge origin.");
      if (!request.subscriptionOrigin) merchantAttemptMetadata(request, request.paymentId);
      if (request.reverseTransfer && !request.destinationAccountId) throw new AdapterError("payments", "stripe", "invalid_request", "A transfer reversal needs its original destination charge.");
      if (request.destinationAccountId && request.refundApplicationFee && !request.reverseTransfer) throw new AdapterError("payments", "stripe", "invalid_request", "A destination application-fee refund also requires its original transfer reversal.");
      if (request.providerPlatformAccountId) {
        const intent = request.subscriptionOrigin ? await proveStripeSubscriptionPayment(api, request, request.subscriptionOrigin) : await chargeApi(`/v1/payment_intents/${encodeURIComponent(request.providerRef)}`, { method: "GET" }, request);
        if (intent.id !== request.providerRef || intent.status !== "succeeded" || intent.currency !== request.currency.toLowerCase() || (number(intent.amount_received) ?? -1) < request.amountMinor) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not identify the original refund payment.", true);
        if (!request.subscriptionOrigin) assertMerchantAttempt(request, request.paymentId, intent.metadata);
        assertMerchantIntent(request, intent);
      }
      const form = new URLSearchParams({ payment_intent: request.providerRef, amount: String(request.amountMinor) });
      if (request.reason) form.set("metadata[freeholder_reason]", request.reason.slice(0, 500));
      if (request.refundApplicationFee) {
        if (!request.providerAccountId && !request.destinationAccountId) throw new AdapterError("payments", "stripe", "invalid_request", "A platform-fee refund needs its original seller account.");
        form.set("refund_application_fee", "true");
      }
      if (request.reverseTransfer) form.set("reverse_transfer", "true");
      const value = await chargeApi("/v1/refunds", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.idempotencyKey }, body: form }, request);
      const providerRef = text(value.id);
      if (!providerRef) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a refund reference.");
      if (request.providerPlatformAccountId && (value.payment_intent !== request.providerRef || value.amount !== request.amountMinor || value.currency !== request.currency.toLowerCase())) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not bind the refund to its original payment and amount.", true);
      return { providerRef, ...merchantChargeScope(request), status: value.status === "succeeded" ? "succeeded" : value.status === "failed" || value.status === "canceled" ? "failed" : "pending", ...(value.status === "canceled" ? { failureCode: "provider_cancelled" as const } : {}) };
    },
    async eraseCustomer(request) {
      const reference=request.providerCustomerRef;
      if(!/^cus_[A-Za-z0-9]+$/.test(reference) || reference.length>200)throw new AdapterError("payments","stripe","invalid_request","The original provider customer reference is invalid.");
      // Deleted Stripe customers remain retrievable. A retry confirms the
      // actual tombstone instead of treating arbitrary HTTP errors as erasure.
      const existing=await api(`/v1/customers/${encodeURIComponent(reference)}`,{method:"GET"},request);
      if(existing.id!==reference)throw new AdapterError("payments","stripe","provider_failure","Stripe did not identify the original erasure customer.",true);
      if(existing.deleted===true)return;
      const deleted=await api(`/v1/customers/${encodeURIComponent(reference)}`,{method:"DELETE",headers:{"idempotency-key":request.idempotencyKey}},request);
      if(deleted.id!==reference || deleted.deleted!==true)throw new AdapterError("payments","stripe","provider_failure","Stripe did not acknowledge customer erasure.",true);
    },
    async revokeSavedMethod(request) {
      await api(`/v1/payment_methods/${encodeURIComponent(request.providerRef)}/detach`, { method: "POST", headers: { "idempotency-key": request.idempotencyKey } }, request);
    },
    async chargeSavedMethod(request): Promise<OffSessionChargeResult> {
      validateMerchantChargeScope(request);
      const originalMetadata = merchantAttemptMetadata(request, request.paymentAttemptId);
      const form = new URLSearchParams({
        amount: String(request.amountMinor),
        currency: request.currency.toLowerCase(),
        payment_method: request.methodRef,
        confirm: "true",
        off_session: "true",
        "metadata[freeholder_invoice_id]": request.invoiceId,
        "metadata[freeholder_contact_id]": request.contactId,
        description: request.description.slice(0, 1000),
      });
      for (const [key, value] of Object.entries(originalMetadata)) form.set(`metadata[${key}]`, value);
      if (request.customerRef) form.set("customer", request.customerRef);
      applyDestinationCharge(form, false, request);
      applicationFee(form, "application_fee_amount", request.applicationFeeMinor, request.providerAccountId ?? request.destinationAccountId, request.amountMinor, Boolean(request.providerPlatformAccountId));
      const value = await chargeApi("/v1/payment_intents", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": request.idempotencyKey,
        },
        body: form,
      }, request);
      const providerRef = text(value.id);
      if (!providerRef) {
        throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a payment reference.");
      }
      const status =
        value.status === "succeeded"
          ? "succeeded"
          : value.status === "processing"
            ? "pending"
            : "failed";
      const fee = value.application_fee_amount === null ? 0 : number(value.application_fee_amount);
      if ((request.providerAccountId || request.destinationAccountId) && !request.providerPlatformAccountId && value.status === "succeeded" && fee === undefined) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not confirm the seller charge application fee.");
      let customerChargeVerified = true;
      if (request.providerPlatformAccountId && value.status === "succeeded") {
        try { assertMerchantAttempt(request, request.paymentAttemptId, value.metadata); } catch { customerChargeVerified = false; }
        if (number(value.amount_received) === undefined || !text(value.currency)) customerChargeVerified = false;
      }
      return {
        providerRef,
        ...(request.providerPlatformAccountId && value.status === "succeeded" ? { ...merchantIntentEvidence(request, value), customerChargeVerified, ...(!customerChargeVerified || fee === undefined ? { merchantRouteVerified: false } : {}) } : merchantChargeScope(request)),
        ...((request.providerAccountId || request.destinationAccountId || request.providerPlatformAccountId) && fee !== undefined ? { applicationFeeMinor: fee } : {}),
        status,
        amountMinor: request.providerPlatformAccountId && value.status === "succeeded" ? number(value.amount_received) ?? number(value.amount) : number(value.amount),
        currency: text(value.currency)?.toUpperCase(),
        occurredAt: stripeOptionalTime(value.created),
        failureMessage: text(object(value.last_payment_error)?.message),
      };
    },
    async createMerchantPhaseProduct(request) {
      return createOriginalStripePhaseProduct(api, request);
    },
    async inspectMerchantPhaseProduct(request) {
      return inspectOriginalStripePhaseProduct(api, request);
    },
    async cancelMerchantPhaseSchedule(request) {
      return cancelOriginalStripePhaseSchedule(api, request);
    },
    async createMerchantPhaseSchedule(request) {
      return mutateOriginalStripePhaseSchedule(api, request);
    },
    async updateMerchantPhaseSchedule(request) {
      return mutateOriginalStripePhaseSchedule(api, request);
    },
    async inspectMerchantPhaseSchedule(request) {
      return inspectOriginalStripePhaseSchedule(api, request);
    },
    async createRecurringSchedule(request): Promise<RecurringScheduleResult> {
      const feeFields = new URLSearchParams();
      applicationFee(feeFields, "application_fee_percent", request.applicationFeePercent, request.providerAccountId);
      const product = await api("/v1/products", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": `${request.idempotencyKey}:product` }, body: new URLSearchParams({ name: request.description.slice(0, 250) }) }, request.providerAccountId);
      const productId = text(product.id);
      if (!productId) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a product reference.");
      const form = new URLSearchParams({
        customer: request.customerRef,
        default_payment_method: request.methodRef,
        collection_method: "charge_automatically",
        "items[0][price_data][currency]": request.currency.toLowerCase(),
        "items[0][price_data][unit_amount]": String(request.amountMinor),
        "items[0][price_data][recurring][interval]": request.interval,
        "items[0][price_data][recurring][interval_count]": String(request.intervalCount),
        "items[0][price_data][product]": productId,
        "metadata[freeholder_subscription_id]": request.metadata.subscriptionId,
        "metadata[freeholder_contact_id]": request.metadata.contactId,
        "metadata[freeholder_plan_id]": request.metadata.planId,
      });
      if (request.firstBillingAt) {
        form.set("billing_cycle_anchor", String(Math.floor(new Date(request.firstBillingAt).getTime() / 1000)));
        form.set("proration_behavior", "none");
      }
      for (const [key, value] of feeFields) form.set(key, value);
      const value = await api("/v1/subscriptions", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": request.idempotencyKey,
        },
        body: form,
      }, request.providerAccountId);
      const providerRef = text(value.id);
      if (!providerRef) {
        throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a subscription reference.");
      }
      const actualFee = feePercent(value.application_fee_percent);
      if (request.providerAccountId && actualFee !== (request.applicationFeePercent ?? 0)) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not confirm the seller subscription application fee.");
      return { providerRef, customerRef: request.customerRef, ...(request.providerAccountId ? { providerAccountId: request.providerAccountId, applicationFeePercent: actualFee } : {}) };
    },
    async updateRecurringSchedule(request): Promise<RecurringScheduleResult> {
      const feeFields = new URLSearchParams();
      applicationFee(feeFields, "application_fee_percent", request.applicationFeePercent, request.providerAccountId);
      const current = await api(`/v1/subscriptions/${encodeURIComponent(request.providerRef)}`, {
        method: "GET",
      }, request.providerAccountId);
      const items = object(current.items);
      const first = Array.isArray(items?.data) ? object(items.data[0]) : undefined;
      const itemId = text(first?.id);
      const price = object(first?.price);
      const productId = text(price?.product) ?? text(object(price?.product)?.id);
      if (!itemId || !productId) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return the current subscription item and product.");
      const form = new URLSearchParams({
        proration_behavior: request.proration === "create_prorations" ? "create_prorations" : "none",
        "items[0][price_data][currency]": request.currency.toLowerCase(),
        "items[0][price_data][unit_amount]": String(request.amountMinor),
        "items[0][price_data][recurring][interval]": request.interval,
        "items[0][price_data][recurring][interval_count]": String(request.intervalCount),
        "items[0][price_data][product]": productId,
      });
      if (itemId) form.set("items[0][id]", itemId);
      for (const [key, value] of feeFields) form.set(key, value);
      const value = await api(`/v1/subscriptions/${encodeURIComponent(request.providerRef)}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": request.idempotencyKey,
        },
        body: form,
      }, request.providerAccountId);
      const actualFee = feePercent(value.application_fee_percent);
      if (request.providerAccountId && actualFee !== (request.applicationFeePercent ?? 0)) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not confirm the seller subscription application fee.");
      return { providerRef: text(value.id) ?? request.providerRef, ...(request.providerAccountId ? { providerAccountId: request.providerAccountId, applicationFeePercent: actualFee } : {}) };
    },
    async cancelRecurringSchedule(request) {
      await api(`/v1/subscriptions/${encodeURIComponent(request.providerRef)}`, {
        method: "DELETE",
        headers: { "idempotency-key": request.idempotencyKey },
      }, request.providerAccountId);
    },
    async verifyWebhook(request) {
      if (webhookSecrets.length === 0) throw new AdapterError("payments", "stripe", "unavailable", "Stripe webhook verification is not configured.");
      const header = request.headers["stripe-signature"];
      if (!header) throw new AdapterError("payments", "stripe", "authentication", "Stripe signature is missing.");
      const components = header.split(",").map((part) => part.trim().split("=", 2));
      const timestamp = Number(components.find(([key]) => key === "t")?.[1]);
      const signatures = components.filter(([key]) => key === "v1").map(([, value]) => value).filter((value): value is string => Boolean(value));
      const received = Date.parse(request.receivedAt);
      if (!Number.isSafeInteger(timestamp) || !Number.isFinite(received) || Math.abs(received / 1_000 - timestamp) > tolerance) {
        throw new AdapterError("payments", "stripe", "authentication", "Stripe signature timestamp is outside the accepted window.");
      }
      const raw = Buffer.from(request.body);
      const signed = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), raw]);
      const valid = webhookSecrets.some((secret) => {
        const expected = createHmac("sha256", secret).update(signed).digest();
        return signatures.some((signature) => {
          if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
          const actual = Buffer.from(signature, "hex");
          return actual.length === expected.length && timingSafeEqual(actual, expected);
        });
      });
      if (!valid) throw new AdapterError("payments", "stripe", "authentication", "Stripe signature is invalid.");
      let payload: unknown;
      try { payload = JSON.parse(raw.toString("utf8")); } catch { throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent invalid JSON."); }
      const parsed = object(payload);
      if (!parsed) throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent an invalid event.");
      let events = stripePaymentEvents(parsed);
      const recurring = events.find((event): event is Extract<PaymentProviderEvent, { kind: "subscription_period_paid" | "subscription_period_failed" | "subscription_cancelled" }> => event.kind === "subscription_period_paid" || event.kind === "subscription_period_failed" || event.kind === "subscription_cancelled");
      if (recurring) {
        const source = object(object(parsed.data)?.object) ?? {};
        const metadata = recurring.kind === "subscription_cancelled" ? object(source.metadata) ?? {} : originalSubscriptionInvoiceMetadata(source);
        const tagged = metadata.freeholder_subscription_scope_version === "1" || metadata.freeholder_subscription_operation_id !== undefined;
        // Resolve stored scope only AFTER exact-byte HMAC/timestamp checks and
        // BEFORE the first financial resource read. No current-account fallback.
        const original = await request.resolveSubscriptionScope?.({ providerSubscriptionRef: recurring.providerRef,
          providerInvoiceRef: recurring.invoiceProviderRef, providerAccountId: recurring.providerAccountId, metadata });
        if (tagged && !original) throw new AdapterError("payments", "stripe", "provider_failure", "Recover the original admitted merchant subscription scope before applying its tagged feedback.", true);
        if (original) {
          if (!request.onSubscriptionChargeObserved || original.providerSubscriptionRef !== recurring.providerRef
            || (original.providerAccountId ?? "") !== (recurring.providerAccountId ?? "")) throw new AdapterError("payments", "stripe", "provider_failure", "The original subscription scope and committed cash phase are required before provider inspection.", true);
          if (recurring.kind !== "subscription_cancelled") return collectOriginalStripeSubscriptionCash(api, original, recurring, request.onSubscriptionChargeObserved);
          const actual = await api(`/v1/subscriptions/${encodeURIComponent(original.providerSubscriptionRef)}`, { method: "GET", headers: { "stripe-version": original.providerScheduleApiVersion } }, { ...original, providerApiVersion: original.providerScheduleApiVersion });
          if (actual.id !== original.providerSubscriptionRef || actual.status !== "canceled") throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not prove cancellation of the original merchant subscription.", true);
          return [{ ...recurring, ...original, providerApiVersion: original.providerScheduleApiVersion }];
        }
      }
      const setupValue = object(object(parsed.data)?.object);
      const setupPlatform = setupValue?.mode === "setup" ? text(object(setupValue.metadata)?.freeholder_platform_account_id) : undefined;
      const taggedPlatform = events.find(event => event.providerPlatformAccountId)?.providerPlatformAccountId ?? setupPlatform;
      const requiresActualPlatform = Boolean(taggedPlatform) || events.some(event => event.kind.startsWith("refund_") || event.kind.startsWith("dispute_"));
      if (requiresActualPlatform) {
        const actual = await platformAccountIdentity();
        if (taggedPlatform && taggedPlatform !== actual.providerPlatformAccountId) throw new AdapterError("payments", "stripe", "authentication", "The webhook belongs to a different original platform account.");
        events = events.map(event => ({ ...event, providerPlatformAccountId: actual.providerPlatformAccountId }));
      }
      const value = object(object(parsed.data)?.object);
      const metadata=object(value?.metadata);
      // A partially tagged setup cannot reach the expanded-method normalizer
      // without the complete binding used by our setup flow.
      if(value?.mode==="setup" && (!text(metadata?.freeholder_contact_id) || !text(metadata?.freeholder_subscription_id))) return [];
      if(parsed.type==="checkout.session.completed" && value?.mode==="setup" && value.payment_status==="no_payment_required"
        && text(metadata?.freeholder_contact_id) && text(metadata?.freeholder_subscription_id)){
        // Real Checkout events normally contain a SetupIntent ID, not its
        // expanded payment method. Retrieve only after exact-byte HMAC and
        // account validation, outside any business-service transaction.
        const setupScope = setupPlatform ? { providerPlatformAccountId: setupPlatform, providerAccountId: text(parsed.account),
          settlementMerchantAccountId: text(object(value.metadata)?.freeholder_setup_settlement_account_id) } : text(parsed.account);
        const proven=await provenSetup(value,setupScope);
        return stripePaymentEvents({...parsed,data:{...object(parsed.data),object:proven}});
      }
      // A signed invoice says that its balance is paid. It does not prove
      // which connected PaymentIntent paid it or the fee actually taken.
      // Read that evidence on the original account, outside every DB TX.
      const paid = events.find(event => event.kind === "subscription_period_paid" && event.providerAccountId);
      if (!paid || paid.kind !== "subscription_period_paid" || !paid.providerAccountId) return events;
      const invoiceRef = text(value?.id);
      const amount = number(value?.amount_paid);
      const currency = text(value?.currency)?.toUpperCase();
      // Stripe can emit a zero invoice while starting a trial. It does not
      // buy another paid period and must never advance subscription access.
      if (amount === 0 && number(value?.total) === 0) return events.filter(event => event !== paid);
      const unproven = () => new AdapterError("payments", "stripe", "provider_failure", "Stripe did not prove this recurring seller payment and its application fee.");
      if (!invoiceRef || amount === undefined || amount <= 0 || !currency || value?.paid_out_of_band === true) throw unproven();
      const query = new URLSearchParams({ invoice: invoiceRef, status: "paid", limit: "2" });
      const list = await api(`/v1/invoice_payments?${query}`, { method: "GET" }, paid.providerAccountId);
      const records = list.data;
      if (list.has_more !== false || !Array.isArray(records) || records.length !== 1) throw unproven();
      const record = object(records[0]);
      const invoicePayment = object(record?.payment);
      const intentRef = text(invoicePayment?.payment_intent) ?? text(object(invoicePayment?.payment_intent)?.id);
      const linkedInvoice = text(record?.invoice) ?? text(object(record?.invoice)?.id);
      if (!record || record.status !== "paid" || linkedInvoice !== invoiceRef || record.amount_paid !== amount || record.amount_requested !== amount || text(record.currency)?.toUpperCase() !== currency || invoicePayment?.type !== "payment_intent" || !intentRef) throw unproven();
      const intent = await api(`/v1/payment_intents/${encodeURIComponent(intentRef)}`, { method: "GET" }, paid.providerAccountId);
      const fee = intent.application_fee_amount === null ? 0 : number(intent.application_fee_amount);
      if (intent.id !== intentRef || intent.status !== "succeeded" || number(intent.amount_received) !== amount || text(intent.currency)?.toUpperCase() !== currency || fee === undefined || fee < 0 || fee >= amount) throw unproven();
      const invoiceCustomer = text(value?.customer) ?? text(object(value?.customer)?.id);
      const intentCustomer = text(intent.customer) ?? text(object(intent.customer)?.id);
      if (!invoiceCustomer || intentCustomer !== invoiceCustomer) throw unproven();
      return events.map(event => event === paid ? { ...paid, paymentProviderRef: intentRef, applicationFeeMinor: fee, amountMinor: amount, currency } : event);
    },
  };
}
