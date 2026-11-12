// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual provider pause and original invoice obligations, never local time.
import { AdapterError } from "../types";
import { object, text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { MerchantChargeScope } from "./types";
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
};
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
    || object(value.billing_mode)?.type !== "flexible" || value.schedule !== null || value.collection_method !== "charge_automatically"
    || !Object.hasOwn(value, "transfer_data") || !Object.hasOwn(value, "on_behalf_of")
    || destination !== resource.destinationAccountId || settlement !== resource.settlementMerchantAccountId) unproven();
}
function validate(resource: OriginalStripeMerchantSchedule): void {
  validateMerchantChargeScope(resource);
  if (!resource.providerPlatformAccountId || resource.providerScheduleApiVersion !== STRIPE_MERCHANT_SCHEDULE_API_VERSION || !/^sub_[A-Za-z0-9]{1,195}$/.test(resource.providerSubscriptionRef)
    || !/^cus_[A-Za-z0-9]{1,195}$/.test(resource.providerCustomerRef)
    || !/^[0-9a-f-]{36}$/i.test(resource.subscriptionId)) unproven();
}
const protocol = (init: RequestInit): RequestInit => ({ ...init, headers: { ...init.headers, "stripe-version": STRIPE_MERCHANT_SCHEDULE_API_VERSION } });

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

/** A real pause stops new invoices; every earlier invoice still needs resolution. */
export async function inspectOriginalStripeMerchantInvoices(api: StripeSubscriptionRead, resource: OriginalStripeMerchantSchedule): Promise<{
  state: "paused" | "cancelled";
  invoices: Array<{ providerInvoiceRef: string; state: "paid" | "void" | "draft" | "open" | "uncollectible" }>;
}> {
  const schedule = await readOriginalStripeMerchantSchedule(api, resource);
  if (!["paused", "canceled"].includes(String(schedule.status)) || schedule.pending_update !== null) unproven();
  const invoices: Array<{ providerInvoiceRef: string; state: "paid" | "void" | "draft" | "open" | "uncollectible" }> = [];
  const seen = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ subscription: resource.providerSubscriptionRef, limit: "100" });
    if (cursor) query.set("starting_after", cursor);
    const response = await api(`/v1/invoices?${query}`, protocol({ method: "GET" }), resource);
    if (!Array.isArray(response.data) || typeof response.has_more !== "boolean") unproven();
    for (const entry of response.data) {
      const invoice = object(entry), id = ref(invoice);
      const direct = ref(invoice?.subscription), parent = ref(object(object(invoice?.parent)?.subscription_details)?.subscription);
      if (!invoice || !id || !/^in_[A-Za-z0-9]{1,196}$/.test(id) || seen.has(id) || (direct && parent && direct !== parent)
        || (direct ?? parent) !== resource.providerSubscriptionRef || ref(invoice.customer) !== resource.providerCustomerRef
        || !["paid", "void", "draft", "open", "uncollectible"].includes(String(invoice.status))) unproven();
      seen.add(id); invoices.push({ providerInvoiceRef: id, state: invoice.status as typeof invoices[number]["state"] });
    }
    if (!response.has_more) return { state: schedule.status === "paused" ? "paused" : "cancelled", invoices };
    const next = ref(response.data.at(-1));
    if (!next || cursors.has(next)) unproven();
    cursors.add(next); cursor = next;
  }
  return unproven();
}
