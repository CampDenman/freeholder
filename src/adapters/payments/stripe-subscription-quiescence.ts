// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual provider pause and original invoice obligations, never local time.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { MerchantChargeScope, MerchantScheduleInvoiceActionRequest, MerchantScheduleInvoiceInventory, MerchantScheduleResource } from "./types";
import type { StripeSubscriptionRead } from "./stripe-subscription-origin";

// Only newly created flexible schedules use this explicit protocol contract.
// Existing subscription operations keep their original adapter API version.
export const STRIPE_MERCHANT_SCHEDULE_API_VERSION = "2026-10-28.endive";
export type OriginalStripeMerchantSchedule = MerchantChargeScope & {
  providerPlatformAccountId: string;
  providerScheduleApiVersion: typeof STRIPE_MERCHANT_SCHEDULE_API_VERSION;
  subscriptionId: string;
  providerSubscriptionRef: string;
  providerCustomerRef: string;
  providerScheduleRefs?: string[];
};
export type OriginalStripeMerchantScheduleLocator = Omit<OriginalStripeMerchantSchedule, "providerCustomerRef">;
const ref = (value: unknown) => text(value) ?? text(object(value)?.id);
function unproven(): never {
  throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not prove the original merchant schedule's stopped state and invoice obligations.", true);
}
function original(resource: OriginalStripeMerchantSchedule, value: Record<string, unknown>): void {
  const metadata = object(value.metadata);
  const destination = ref(object(value.transfer_data)?.destination);
  const settlement = ref(value.on_behalf_of);
  if (value.id !== resource.providerSubscriptionRef || ref(value.customer) !== resource.providerCustomerRef
    || metadata?.freeholder_subscription_id !== resource.subscriptionId || metadata?.freeholder_platform_account_id !== resource.providerPlatformAccountId
    || object(value.billing_mode)?.type !== "flexible" || value.schedule !== null && !resource.providerScheduleRefs?.includes(ref(value.schedule) ?? "") || value.collection_method !== "charge_automatically"
    || !Object.hasOwn(value, "transfer_data") || !Object.hasOwn(value, "on_behalf_of")
    || destination !== resource.destinationAccountId || settlement !== resource.settlementMerchantAccountId) unproven();
}
function validate(resource: OriginalStripeMerchantScheduleLocator & { providerCustomerRef?: string }): void {
  validateMerchantChargeScope(resource);
  if (!resource.providerPlatformAccountId || resource.providerScheduleApiVersion !== STRIPE_MERCHANT_SCHEDULE_API_VERSION || !/^sub_[A-Za-z0-9]{1,195}$/.test(resource.providerSubscriptionRef)
    || resource.providerCustomerRef !== undefined && !/^cus_[A-Za-z0-9]{1,195}$/.test(resource.providerCustomerRef)
    || "providerScheduleRefs" in resource && resource.providerScheduleRefs !== undefined && (!Array.isArray(resource.providerScheduleRefs)
      || resource.providerScheduleRefs.length > 5000 || resource.providerScheduleRefs.some(value => typeof value !== "string" || !/^sub_sched_[A-Za-z0-9]{1,195}$/.test(value)))
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resource.subscriptionId)) unproven();
}
const protocol = (init: RequestInit): RequestInit => ({ ...init, headers: { ...init.headers, "stripe-version": STRIPE_MERCHANT_SCHEDULE_API_VERSION } });

/** Resolve only through the immutable original provider subscription resource. */
export async function resolveOriginalStripeMerchantSchedule(api: StripeSubscriptionRead, locator: OriginalStripeMerchantScheduleLocator): Promise<OriginalStripeMerchantSchedule> {
  validate(locator);
  const value = await api(`/v1/subscriptions/${encodeURIComponent(locator.providerSubscriptionRef)}`, protocol({ method: "GET" }), locator);
  const providerCustomerRef = ref(value.customer);
  if (!providerCustomerRef || !/^cus_[A-Za-z0-9]{1,195}$/.test(providerCustomerRef)) unproven();
  const resource = { ...locator, providerCustomerRef };
  original(resource, value);
  return resource;
}

export async function readOriginalStripeMerchantSchedule(api: StripeSubscriptionRead, resource: OriginalStripeMerchantSchedule) {
  validate(resource);
  const value = await api(`/v1/subscriptions/${encodeURIComponent(resource.providerSubscriptionRef)}`, protocol({ method: "GET" }), resource);
  original(resource, value);
  return value;
}

/** Caller commits the one physical POST intent before entering this function. */
export async function pauseOriginalStripeMerchantSchedule(api: StripeSubscriptionRead, resource: OriginalStripeMerchantSchedule, input: {
  idempotencyKey: string;
  onPaused: (actual: { providerSubscriptionRef: string; state: "paused" }) => Promise<void>;
}) {
  const before = await readOriginalStripeMerchantSchedule(api, resource);
  if (before.status === "paused" && before.pending_update === null) {
    await input.onPaused({ providerSubscriptionRef: resource.providerSubscriptionRef, state: "paused" });
    return;
  }
  if (!["active", "trialing", "past_due", "unpaid"].includes(String(before.status)) || before.pending_update !== null) unproven();
  const body = new URLSearchParams({ type: "subscription", "bill_for[unused_time_from][type]": "none", "bill_for[outstanding_usage_through][type]": "none", invoicing_behavior: "pending_invoice_item" });
  const actual = await api(`/v1/subscriptions/${encodeURIComponent(resource.providerSubscriptionRef)}/pause`, protocol({ method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": input.idempotencyKey }, body }), resource);
  // A later scope/pending-update contradiction cannot erase the actual pause
  // acknowledgment. This observation alone is not a quiescence certificate.
  if (actual.id === resource.providerSubscriptionRef && actual.status === "paused") await input.onPaused({ providerSubscriptionRef: resource.providerSubscriptionRef, state: "paused" });
  original(resource, actual);
  if (actual.status !== "paused" || actual.pending_update !== null) unproven();
}

/** The shared claim has already bound this exact original resource and committed
 * its single physical cancellation intent. Commercial drift must not prevent
 * stopping that original resource; it remains separate reconciliation debt.
 * This does not resolve pending invoice items or any earlier invoice/PI.
 * https://docs.stripe.com/api/subscriptions/cancel */
export async function cancelOriginalStripeMerchantSchedule(api: StripeSubscriptionRead, resource: OriginalStripeMerchantScheduleLocator & { providerCustomerRef?: string }, input: {
  onCancelled: (actual: { providerSubscriptionRef: string; state: "cancelled"; source: "readback" | "delete_ack" }) => Promise<void>;
}, readOnly = false) {
  validate(resource);
  const path = `/v1/subscriptions/${encodeURIComponent(resource.providerSubscriptionRef)}`;
  const before = await api(path, protocol({ method: "GET" }), resource);
  if (before.id !== resource.providerSubscriptionRef) unproven();
  if (before.status === "canceled") {
    await input.onCancelled({ providerSubscriptionRef: resource.providerSubscriptionRef, state: "cancelled", source: "readback" });
    return;
  }
  if (readOnly) unproven();
  // DELETE has no assumed idempotent POST replay guarantee. A lost reply must
  // be reconciled by read-only recovery under the original physical intent.
  const actual = await api(path, protocol({ method: "DELETE", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ invoice_now: "false", prorate: "false" }) }), resource);
  if (actual.id !== resource.providerSubscriptionRef || actual.status !== "canceled") unproven();
  await input.onCancelled({ providerSubscriptionRef: resource.providerSubscriptionRef, state: "cancelled", source: "delete_ack" });
}

/** A real pause stops new invoices; every earlier invoice still needs resolution. */
export async function inspectOriginalStripeMerchantInvoices(api: StripeSubscriptionRead, resource: MerchantScheduleResource): Promise<MerchantScheduleInvoiceInventory> {
  const schedule = await readOriginalStripeMerchantSchedule(api, resource);
  if (!["paused", "canceled"].includes(String(schedule.status)) || schedule.pending_update !== null) unproven();
  const invoices: MerchantScheduleInvoiceInventory["invoices"] = [];
  const seen = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ subscription: resource.providerSubscriptionRef, limit: "100" });
    if (cursor) query.set("starting_after", cursor);
    const response = await api(`/v1/invoices?${query}`, protocol({ method: "GET" }), resource);
    if (!Array.isArray(response.data)) unproven();
    for (const entry of response.data) {
      const invoice = object(entry), id = ref(invoice);
      const direct = ref(invoice?.subscription), parent = ref(object(object(invoice?.parent)?.subscription_details)?.subscription);
      if (!invoice || !id || !/^in_[A-Za-z0-9]{1,196}$/.test(id) || seen.has(id) || (direct && parent && direct !== parent)
        || (direct ?? parent) !== resource.providerSubscriptionRef || ref(invoice.customer) !== resource.providerCustomerRef
        || !["paid", "void", "draft", "open", "uncollectible"].includes(String(invoice.status))) unproven();
      seen.add(id); invoices.push(await inspectOriginalInvoiceObligations(api, resource, invoice, id));
    }
    if (typeof response.has_more !== "boolean") unproven();
    if (!response.has_more) return { state: schedule.status === "paused" ? "paused" : "cancelled", invoices };
    const next = ref(response.data.at(-1));
    if (!next || cursors.has(next)) unproven();
    cursors.add(next); cursor = next;
  }
  return unproven();
}

/** A summary's includable payments can be partial. Enumerate the actual
 * InvoicePayment relation and every PI on the original namespace instead.
 * https://docs.stripe.com/api/invoice-payment/list */
async function inspectOriginalInvoiceObligations(api: StripeSubscriptionRead, resource: MerchantScheduleResource, invoice: Record<string, unknown>, invoiceId: string): Promise<MerchantScheduleInvoiceInventory["invoices"][number]> {
  const obligations: MerchantScheduleInvoiceInventory["invoices"][number]["paymentIntents"] = [];
  const seen = new Set<string>(), intents = new Set<string>(), cursors = new Set<string>(); let cursor: string | undefined, complete = false;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ invoice: invoiceId, limit: "100" }); if (cursor) query.set("starting_after", cursor);
    const result = await api(`/v1/invoice_payments?${query}`, protocol({ method: "GET" }), resource);
    if (!Array.isArray(result.data)) unproven();
    for (const value of result.data) {
      const relation = object(value), key = ref(relation), payment = object(relation?.payment), intentId = ref(payment?.payment_intent);
      if (!relation || !key || !/^inpay_[A-Za-z0-9]{1,194}$/.test(key) || seen.has(key) || ref(relation.invoice) !== invoiceId
        || payment?.type !== "payment_intent" || !intentId || !/^pi_[A-Za-z0-9]{1,196}$/.test(intentId) || intents.has(intentId)) unproven();
      seen.add(key); intents.add(intentId);
      const intent = await api(`/v1/payment_intents/${encodeURIComponent(intentId)}`, protocol({ method: "GET" }), resource);
      const received = number(intent.amount_received), amount = number(intent.amount), currency = text(intent.currency)?.toUpperCase(), customer = ref(intent.customer);
      if (intent.id !== intentId || customer !== resource.providerCustomerRef || received === undefined || !Number.isSafeInteger(received) || received < 0
        || amount === undefined || !Number.isSafeInteger(amount) || amount < received || !currency || !/^[A-Z]{3}$/.test(currency) || typeof intent.status !== "string") unproven();
      // Retain positive actual money before later invoice amount, route, fee or
      // other-page checks. The callback is a real separately committed phase.
      await retainOriginalInvoiceIntentCash(resource, invoiceId, intentId, intent);
      if (!["paid", "canceled", "open"].includes(String(relation.status)) || relation.currency !== intent.currency
        || !Number.isSafeInteger(relation.amount_requested) || relation.amount_requested !== amount || !Number.isSafeInteger(relation.amount_paid)
        || relation.amount_paid !== received) unproven();
      obligations.push({ providerPaymentIntentRef: intentId, state: intent.status, amountMinor: amount, receivedMinor: received, currency });
    }
    if (typeof result.has_more !== "boolean") unproven();
    if (!result.has_more) { complete = true; break; }
    const next = ref(result.data.at(-1)); if (!next || cursors.has(next)) unproven(); cursors.add(next); cursor = next;
  }
  const currency = text(invoice.currency)?.toUpperCase(), total = number(invoice.total), paid = number(invoice.amount_paid), remaining = number(invoice.amount_remaining), start = number(invoice.period_start);
  if (!complete || !currency || !/^[A-Z]{3}$/.test(currency) || [total, paid, remaining, start].some(value => value === undefined || !Number.isSafeInteger(value) || value < 0)
    || (invoice.status === "void" ? remaining !== 0 || paid! > total! : BigInt(total!) !== BigInt(paid!) + BigInt(remaining!)) || obligations.some(value => value.currency !== currency)
    || obligations.reduce((sum, value) => sum + BigInt(value.receivedMinor), 0n) !== BigInt(paid!)) unproven();
  const periodStart = new Date(start! * 1000); if (!Number.isFinite(periodStart.getTime())) unproven();
  return { providerInvoiceRef: invoiceId, state: invoice.status as MerchantScheduleInvoiceInventory["invoices"][number]["state"], currency,
    totalMinor: total!, paidMinor: paid!, remainingMinor: remaining!, periodStart: periodStart.toISOString(), complete: true, paymentIntents: obligations };
}

/** This wrapper can only GET, including when the subscription is still active. */
export async function inspectOriginalStripeMerchantCancellation(api: StripeSubscriptionRead, resource: OriginalStripeMerchantScheduleLocator & { providerCustomerRef?: string }, input: {
  onCancelled: (actual: { providerSubscriptionRef: string; state: "cancelled"; source: "readback" }) => Promise<void>;
}) {
  return cancelOriginalStripeMerchantSchedule(api, resource, { onCancelled: async actual => {
    if (actual.source !== "readback") unproven();
    await input.onCancelled({ ...actual, source: "readback" });
  } }, true);
}

/** Exact original invoice/PI stop. The shared phase commits the physical intent
 * before entry. Recovery passes readOnly=true, which cannot enter a mutation.
 * Subscription drafts are intentionally refused: Stripe only deletes one-off
 * drafts (https://docs.stripe.com/api/invoices/delete). */
export async function stopOriginalStripeMerchantInvoice(api: StripeSubscriptionRead, request: MerchantScheduleInvoiceActionRequest, readOnly = false): Promise<void> {
  const subscription = await readOriginalStripeMerchantSchedule(api, request);
  if (!["paused", "canceled"].includes(String(subscription.status)) || subscription.pending_update !== null
    || !/^in_[A-Za-z0-9]{1,195}$/.test(request.providerInvoiceRef)) unproven();
  const path = `/v1/invoices/${encodeURIComponent(request.providerInvoiceRef)}`;
  const invoice = await api(path, protocol({ method: "GET" }), request);
  const direct = ref(invoice.subscription), parent = ref(object(object(invoice.parent)?.subscription_details)?.subscription);
  if (invoice.id !== request.providerInvoiceRef || ref(invoice.customer) !== request.providerCustomerRef || direct && parent && direct !== parent
    || (direct ?? parent) !== request.providerSubscriptionRef || !["paid", "void", "draft", "open", "uncollectible"].includes(String(invoice.status))) unproven();
  const inventory = await inspectOriginalInvoiceObligations(api, request, invoice, request.providerInvoiceRef);
  if (request.action === "cancel_intent") {
    const intentId = request.providerPaymentIntentRef;
    const intent = inventory.paymentIntents.find(value => value.providerPaymentIntentRef === intentId);
    if (!intentId || !/^pi_[A-Za-z0-9]{1,195}$/.test(intentId) || !intent || intent.receivedMinor !== 0) unproven();
    if (intent.state === "canceled") {
      await request.onAcknowledged({ action: "cancel_intent", providerInvoiceRef: request.providerInvoiceRef, providerPaymentIntentRef: intentId, state: "canceled" });
      return;
    }
    if (readOnly || !["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture"].includes(intent.state)) unproven();
    const actual = await api(`/v1/payment_intents/${encodeURIComponent(intentId)}/cancel`, protocol({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams() }), request);
    if (actual.id === intentId && actual.status === "canceled") await request.onAcknowledged({ action: "cancel_intent", providerInvoiceRef: request.providerInvoiceRef, providerPaymentIntentRef: intentId, state: "canceled" });
    await retainOriginalInvoiceIntentCash(request, request.providerInvoiceRef, intentId, actual);
    if (actual.id !== intentId || ref(actual.customer) !== request.providerCustomerRef || actual.status !== "canceled" || actual.amount_received !== 0 || actual.amount_capturable !== 0
      || actual.amount !== intent.amountMinor || text(actual.currency)?.toUpperCase() !== intent.currency) unproven();
    return;
  }
  if (request.action === "finalize_draft") {
    // Finalization is a distinct original operation, never deletion. Suppress
    // collection explicitly, and bind the actual draft's sole immutable price
    // to the actual admitted phase before creating a finalized invoice.
    const phase = request.admittedPhase, lines = object(invoice.lines);
    if (!phase || phase.start !== inventory.periodStart || phase.totalMinor !== inventory.totalMinor || phase.currency !== inventory.currency
      || request.providerPaymentIntentRef !== undefined || inventory.paidMinor !== 0 || inventory.paymentIntents.some(intent => intent.receivedMinor !== 0 || intent.state !== "canceled")) unproven();
    if (["open", "paid", "void"].includes(inventory.state) && invoice.auto_advance === false) {
      await request.onAcknowledged({ action: "finalize_draft", providerInvoiceRef: request.providerInvoiceRef, state: inventory.state as "open" | "paid" | "void", autoAdvance: false }); return;
    }
    if (readOnly || inventory.state !== "draft" || !lines || lines.has_more !== false || !Array.isArray(lines.data) || lines.data.length !== 1) unproven();
    const line = object(lines.data[0]), pricing = object(object(line?.pricing)?.price_details), details = object(object(line?.parent)?.subscription_item_details), interval = object(line?.period);
    if (!line || ref(pricing?.price ?? line.price) !== phase.providerPriceRef || line.quantity !== 1 || line.amount !== phase.totalMinor || text(line.currency)?.toUpperCase() !== phase.currency
      || details?.proration === true || interval?.start !== Date.parse(phase.start) / 1000 || interval.end !== Date.parse(phase.end) / 1000) unproven();
    const actual = await api(`${path}/finalize`, protocol({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ auto_advance: "false" }) }), request);
    if (actual.id === request.providerInvoiceRef && ["open", "paid"].includes(String(actual.status)) && actual.auto_advance === false) await request.onAcknowledged({ action: "finalize_draft", providerInvoiceRef: request.providerInvoiceRef, state: actual.status as "open" | "paid", autoAdvance: false });
    // Fresh complete payment enumeration retains any contradictory actual cash
    // before rejecting automatic collection or changed money/lineage.
    const completed = await inspectOriginalInvoiceObligations(api, request, actual, request.providerInvoiceRef);
    const actualDirect = ref(actual.subscription), actualParent = ref(object(object(actual.parent)?.subscription_details)?.subscription);
    if (actual.id !== request.providerInvoiceRef || ref(actual.customer) !== request.providerCustomerRef || actualDirect && actualParent && actualDirect !== actualParent
      || (actualDirect ?? actualParent) !== request.providerSubscriptionRef || actual.auto_advance !== false || !["open", "paid"].includes(completed.state)
      || completed.totalMinor !== phase.totalMinor || completed.currency !== phase.currency || completed.periodStart !== phase.start || completed.paidMinor !== 0) unproven();
    return;
  }
  if (request.action !== "void_invoice" || request.providerPaymentIntentRef !== undefined || inventory.paidMinor !== 0
    || inventory.paymentIntents.some(intent => intent.receivedMinor !== 0 || intent.state !== "canceled")) unproven();
  if (inventory.state === "void") { await request.onAcknowledged({ action: "void_invoice", providerInvoiceRef: request.providerInvoiceRef, state: "void" }); return; }
  if (readOnly || !["open", "uncollectible"].includes(inventory.state)) unproven();
  const actual = await api(`${path}/void`, protocol({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams() }), request);
  if (actual.id === request.providerInvoiceRef && actual.status === "void") await request.onAcknowledged({ action: "void_invoice", providerInvoiceRef: request.providerInvoiceRef, state: "void" });
  const actualDirect = ref(actual.subscription), actualParent = ref(object(object(actual.parent)?.subscription_details)?.subscription);
  if (actual.id !== request.providerInvoiceRef || ref(actual.customer) !== request.providerCustomerRef || actual.status !== "void"
    || actualDirect && actualParent && actualDirect !== actualParent || (actualDirect ?? actualParent) !== request.providerSubscriptionRef) unproven();
  const stopped = await inspectOriginalInvoiceObligations(api, request, actual, request.providerInvoiceRef);
  if (stopped.paidMinor !== 0 || stopped.remainingMinor !== 0 || stopped.paymentIntents.some(intent => intent.receivedMinor !== 0 || intent.state !== "canceled")) unproven();
}

/** Preserve actual positive money before any later inventory or action check. */
async function retainOriginalInvoiceIntentCash(resource: MerchantScheduleResource, invoiceId: string, intentId: string, intent: Record<string, unknown>) {
  const received = number(intent.amount_received), currency = text(intent.currency)?.toUpperCase(), customer = ref(intent.customer);
  if (intent.id !== intentId || customer !== resource.providerCustomerRef || received === undefined || !Number.isSafeInteger(received) || received < 0 || !currency || !/^[A-Z]{3}$/.test(currency)) unproven();
  if (received === 0) return;
  if (!resource.onPaidIntentObserved) unproven();
  const destinationAccountId = ref(object(intent.transfer_data)?.destination), settlementMerchantAccountId = ref(intent.on_behalf_of), rawCharge = ref(intent.latest_charge), providerChargeRef = rawCharge && /^ch_[A-Za-z0-9]{1,196}$/.test(rawCharge) ? rawCharge : undefined;
  await resource.onPaidIntentObserved({ subscriptionId: resource.subscriptionId, providerSubscriptionRef: resource.providerSubscriptionRef,
    providerPlatformAccountId: resource.providerPlatformAccountId, ...(resource.providerAccountId ? { providerAccountId: resource.providerAccountId } : {}),
    providerInvoiceRef: invoiceId, providerPaymentIntentRef: intentId, providerCustomerRef: customer,
    ...(resource.providerScheduleOperationId ? { providerScheduleOperationId: resource.providerScheduleOperationId } : {}),
    amountMinor: received, currency, ...(providerChargeRef ? { providerChargeRef } : {}),
    ...(destinationAccountId ? { destinationAccountId } : {}), ...(settlementMerchantAccountId ? { settlementMerchantAccountId } : {}),
    customerChargeVerified: intent.status === "succeeded", merchantRouteVerified: destinationAccountId === resource.destinationAccountId && settlementMerchantAccountId === resource.settlementMerchantAccountId });
}
