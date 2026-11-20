// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: commit each original PI before reading the next payment or any fee.
import { inspectStripeMerchantPayment } from "./stripe-merchant-inspection";
import { inspectStripeSubscriptionPeriod } from "./stripe-subscription-period";
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { merchantIntentEvidence, validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { StripeSubscriptionRead } from "./stripe-subscription-origin";
import type { MerchantScheduleWebhookScope, PaymentProviderEvent, PaymentWebhookRequest } from "./types";

type RecurringEvent = Extract<PaymentProviderEvent, { kind: "subscription_period_paid" | "subscription_period_failed" | "subscription_cancelled" }>;
const ref = (value: unknown) => text(value) ?? text(object(value)?.id);
function unproven(): never { throw new AdapterError("payments", "stripe", "provider_failure", "Recover the authenticated original subscription invoice and paid-intent evidence before applying this feedback.", true); }

/** Invoice metadata is a one-time Subscription snapshot, unlike line-item metadata.
 * https://docs.stripe.com/metadata#copy-metadata-to-another-object */
export function originalSubscriptionInvoiceMetadata(invoice: Record<string, unknown>): Record<string, unknown> {
  return object(object(object(invoice.parent)?.subscription_details)?.metadata) ?? object(object(invoice.subscription_details)?.metadata) ?? {};
}
function originalSubscription(invoice: Record<string, unknown>): string | undefined {
  const direct = ref(invoice.subscription), parent = ref(object(object(invoice.parent)?.subscription_details)?.subscription);
  if (direct && parent && direct !== parent) unproven();
  return direct ?? parent;
}
function period(invoice: Record<string, unknown>): { periodStart?: string; periodEnd?: string } {
  const collection = object(invoice.lines), lines = collection?.data;
  if (!Array.isArray(lines) || collection?.has_more !== false) return {};
  const intervals = lines.map(object).filter(line => line?.type === "subscription" || object(line?.parent)?.type === "subscription_item_details")
    .map(line => object(line?.period));
  if (!intervals.length) return {};
  const start = number(intervals[0]?.start), end = number(intervals[0]?.end);
  if (start === undefined || end === undefined || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start
    || intervals.some(value => value?.start !== start || value.end !== end)) return {};
  try { return { periodStart: new Date(start * 1000).toISOString(), periodEnd: new Date(end * 1000).toISOString() }; } catch { return {}; }
}

export async function collectOriginalStripeSubscriptionCash(api: StripeSubscriptionRead, scope: MerchantScheduleWebhookScope,
  base: RecurringEvent, observe: NonNullable<PaymentWebhookRequest["onSubscriptionChargeObserved"]>): Promise<PaymentProviderEvent[]> {
  validateMerchantChargeScope(scope);
  if (!base.invoiceProviderRef || !/^in_[A-Za-z0-9]{1,196}$/.test(base.invoiceProviderRef) || scope.providerScheduleApiVersion !== "2026-10-28.endive") unproven();
  const read = (path: string) => api(path, { method: "GET", headers: { "stripe-version": scope.providerScheduleApiVersion } }, { ...scope, providerApiVersion: scope.providerScheduleApiVersion });
  const invoice = await read(`/v1/invoices/${encodeURIComponent(base.invoiceProviderRef)}`);
  if (invoice.id !== base.invoiceProviderRef || originalSubscription(invoice) !== scope.providerSubscriptionRef) unproven();
  if (scope.providerScheduleOperationId) {
    const metadata = originalSubscriptionInvoiceMetadata(invoice);
    if (metadata.freeholder_subscription_id !== scope.subscriptionId || metadata.freeholder_subscription_operation_id !== scope.providerScheduleOperationId
      || metadata.freeholder_subscription_scope_version !== "1" || metadata.freeholder_platform_account_id !== scope.providerPlatformAccountId
      || metadata.freeholder_schedule_api_version !== scope.providerScheduleApiVersion) unproven();
  }
  // Real zero invoices use their own verified period lineage below; they never
  // manufacture a PaymentIntent, cash receipt or canonical payment.
  const zeroInvoice = invoice.total === 0 && invoice.amount_paid === 0;
  const invoiceCustomer = ref(invoice.customer), prepared = new Map<string, PaymentProviderEvent>();
  const records = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined, complete = false, allocationProven = true;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ invoice: base.invoiceProviderRef, limit: "100", ...(!scope.providerScheduleOperationId && !zeroInvoice ? { status: "paid" } : {}) });
    if (cursor) query.set("starting_after", cursor);
    const result = await read(`/v1/invoice_payments?${query}`);
    if (!Array.isArray(result.data) || typeof result.has_more !== "boolean") unproven();
    for (const value of result.data) {
      const payment = object(value), relation = object(payment?.payment), paymentId = text(payment?.id), intentRef = ref(relation?.payment_intent);
      if (!payment || !paymentId || records.has(paymentId) || ref(payment.invoice) !== base.invoiceProviderRef
        || relation?.type !== "payment_intent" || !intentRef || !/^pi_[A-Za-z0-9]{1,196}$/.test(intentRef)) unproven();
      records.add(paymentId);
      const intent = await read(`/v1/payment_intents/${encodeURIComponent(intentRef)}`);
      const amountMinor = number(intent.amount_received), currency = text(intent.currency)?.toUpperCase();
      if (intent.id !== intentRef || amountMinor === undefined || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || !currency || !/^[A-Z]{3}$/.test(currency)) unproven();
      if (amountMinor === 0) {
        if (intent.status !== "canceled" || payment.amount_paid !== 0) allocationProven = false;
        continue; // An actual canceled zero-received PI is not a fabricated cash receipt.
      }
      const providerCustomerRef = ref(intent.customer), chargeRef = ref(intent.latest_charge), fee = number(intent.application_fee_amount);
      const actualRoute = merchantIntentEvidence({ ...scope, providerApiVersion: scope.providerScheduleApiVersion }, intent), actualPeriod = period(invoice);
      const observed: RecurringEvent = { ...base, id: `${base.id}:${intentRef}`, kind: "subscription_period_paid", ...actualRoute,
        destinationAccountId: actualRoute.destinationAccountId, settlementMerchantAccountId: actualRoute.settlementMerchantAccountId,
        providerRef: scope.providerSubscriptionRef, subscriptionId: scope.subscriptionId, providerScheduleOperationId: scope.providerScheduleOperationId,
        providerCustomerRef: invoiceCustomer, paymentProviderRef: intentRef, amountMinor, currency, periodStart: actualPeriod.periodStart, periodEnd: actualPeriod.periodEnd,
        customerChargeVerified: Boolean(intent.status === "succeeded" && invoiceCustomer && scope.providerCustomerRef && providerCustomerRef === invoiceCustomer && scope.providerCustomerRef === invoiceCustomer),
        providerChargeRef: chargeRef, applicationFeeMinor: fee !== undefined && fee >= 0 ? fee : undefined };
      // This short callback commits independently. A later page/PI request can
      // throw safely; no ordinary invoice transaction owns this first fact.
      const retained = await observe(observed);
      prepared.set(intentRef, retained);
      if (intent.status !== "succeeded" || payment.status !== "paid" || payment.amount_paid !== amountMinor || payment.amount_requested !== amountMinor || text(payment.currency)?.toUpperCase() !== currency) allocationProven = false;
    }
    if (!result.has_more) { complete = true; break; }
    const next = ref(result.data.at(-1));
    if (!next || cursors.has(next)) unproven();
    cursors.add(next); cursor = next;
  }
  if (!complete) unproven();
  const paid = [...prepared.values()];
  if (!paid.length) {
    if (zeroInvoice && allocationProven) {
      if (!scope.providerScheduleOperationId) return [];
      const evidence = await inspectStripeSubscriptionPeriod(api, scope, invoice, originalSubscriptionInvoiceMetadata(invoice));
      const { paymentProviderRef: _paymentProviderRef, subscriptionChargeReceiptId: _subscriptionChargeReceiptId, ...zeroInvoiceBase } = base;
      return [{ ...zeroInvoiceBase, ...scope, kind: "subscription_period_paid", amountMinor: 0, currency: text(invoice.currency)?.toUpperCase(),
        subscriptionInvoiceEvidence: evidence, ...(evidence.lines.length === 1 && evidence.lines[0]?.periodStart && evidence.lines[0].periodEnd ? { periodStart: evidence.lines[0].periodStart, periodEnd: evidence.lines[0].periodEnd } : {}) }];
    }
    if (base.kind === "subscription_period_failed") return [{ ...base, ...scope, ...period(invoice) }];
    unproven();
  }
  const total = paid.reduce((sum, value) => sum + BigInt(value.kind === "subscription_period_paid" ? value.amountMinor ?? 0 : 0), 0n);
  const invoicePaid = number(invoice.amount_paid);
  if (!allocationProven || invoice.status !== "paid" || invoice.paid_out_of_band === true || invoicePaid === undefined || !Number.isSafeInteger(invoicePaid) || total !== BigInt(invoicePaid)
    || paid.some(value => value.kind === "subscription_period_paid" && value.currency !== text(invoice.currency)?.toUpperCase())) unproven();
  if (scope.providerScheduleOperationId) {
    // All primary PI facts above already committed. Reuse the common exact
    // original-money inspector for actual fee/recipient facts before lineage.
    for (const [intentRef, original] of prepared) {
      if (original.kind !== "subscription_period_paid") unproven();
      const retain = async (actual: Awaited<ReturnType<typeof inspectStripeMerchantPayment>>) => {
        const event: RecurringEvent = { ...original, providerRef: scope.providerSubscriptionRef, paymentProviderRef: actual.providerRef,
          amountMinor: actual.amountMinor, currency: actual.currency, destinationAccountId: actual.destinationAccountId, settlementMerchantAccountId: actual.settlementMerchantAccountId,
          providerChargeRef: actual.providerChargeRef, applicationFeeMinor: actual.applicationFeeMinor, observedApplicationFeeMinor: actual.observedApplicationFeeMinor,
          applicationFeeCurrency: actual.applicationFeeCurrency, customerChargeVerified: original.customerChargeVerified === true && actual.customerChargeVerified === true,
          merchantRouteVerified: actual.merchantRouteVerified };
        prepared.set(intentRef, await observe(event));
      };
      const actual = await inspectStripeMerchantPayment({ ...scope, providerRef: intentRef, providerCustomerRef: scope.providerCustomerRef,
        subscriptionOrigin: { providerApiVersion: scope.providerScheduleApiVersion, providerSubscriptionRef: scope.providerSubscriptionRef, providerInvoiceRef: base.invoiceProviderRef, providerPaymentIntentRef: intentRef },
        onPaymentObserved: retain }, (path, account) => api(path, { method: "GET", headers: { "stripe-version": scope.providerScheduleApiVersion } }, { ...account, providerApiVersion: scope.providerScheduleApiVersion }));
      await retain(actual.applicationFeeMinor === 0 && actual.merchantSettlementVerified === true && actual.currency
        ? { ...actual, observedApplicationFeeMinor: 0, applicationFeeCurrency: actual.currency } : actual);
    }
    const evidence = await inspectStripeSubscriptionPeriod(api, scope, invoice, originalSubscriptionInvoiceMetadata(invoice));
    return [...prepared.values()].map(event => event.kind === "subscription_period_paid" ? { ...event, subscriptionInvoiceEvidence: evidence,
      ...(evidence.lines.length === 1 && evidence.lines[0]?.periodStart && evidence.lines[0].periodEnd ? { periodStart: evidence.lines[0].periodStart, periodEnd: evidence.lines[0].periodEnd } : {}) } : event);
  }
  return paid;
}
