// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual full invoice lines and price objects, after cash retention.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import type { MerchantProviderPeriodInvoiceEvidence, MerchantProviderPeriodLineEvidence, MerchantScheduleWebhookScope } from "./types";
import type { StripeSubscriptionRead } from "./stripe-subscription-origin";
const ref = (value: unknown) => text(value) ?? text(object(value)?.id);
const empty = (value: unknown) => value === null || Array.isArray(value) && value.length === 0;
const integer = (value: unknown) => { const parsed = number(value); return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : null; };
const date = (value: unknown) => { const seconds = integer(value); if (seconds === null) return null; const result = new Date(seconds * 1000); return Number.isFinite(result.getTime()) ? result.toISOString() : null; };
const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value) ? value : null;
function unproven(): never { throw new AdapterError("payments", "stripe", "provider_failure", "Retain complete actual original invoice lines and prices before applying this scheduled cash.", true); }
export async function inspectStripeSubscriptionPeriod(api: StripeSubscriptionRead, scope: MerchantScheduleWebhookScope, invoice: Record<string, unknown>, metadata: Record<string, unknown>): Promise<MerchantProviderPeriodInvoiceEvidence> {
  const invoiceRef = ref(invoice); if (!invoiceRef || !/^in_[A-Za-z0-9]{1,195}$/.test(invoiceRef)) unproven();
  const read = (path: string) => api(path, { method: "GET", headers: { "stripe-version": scope.providerScheduleApiVersion } }, { ...scope, providerApiVersion: scope.providerScheduleApiVersion });
  const lines: MerchantProviderPeriodLineEvidence[] = [], seen = new Set<string>(), cursors = new Set<string>(); let cursor: string | undefined, complete = false;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
    const collection = await read(`/v1/invoices/${encodeURIComponent(invoiceRef)}/lines?${query}`);
    if (!Array.isArray(collection.data)) unproven();
    for (const raw of collection.data) {
      const line = object(raw), id = ref(line); if (!line || !id || !/^il_[A-Za-z0-9_]{1,195}$/.test(id) || seen.has(id) || ref(line.invoice) && ref(line.invoice) !== invoiceRef) unproven();
      seen.add(id);
      const parent = object(line.parent), details = object(parent?.subscription_item_details), pricing = object(object(line.pricing)?.price_details);
      const providerPriceRef = ref(pricing?.price ?? line.price), interval = object(line.period);
      const price = providerPriceRef ? await read(`/v1/prices/${encodeURIComponent(providerPriceRef)}`) : null;
      if (price && (price.id !== providerPriceRef || price.object !== "price")) unproven();
      const recurring = object(price?.recurring);
      lines.push({ providerLineRef: id, providerPriceRef: providerPriceRef ?? null, providerProductRef: ref(price?.product) ?? null,
        quantity: integer(line.quantity), quantityDecimal: text(line.quantity_decimal) ?? null, amountMinor: integer(line.amount), currency: text(line.currency)?.toUpperCase() ?? null,
        periodStart: date(interval?.start), periodEnd: date(interval?.end), subscriptionLine: parent?.type === "subscription_item_details" || line.type === "subscription",
        proration: typeof details?.proration === "boolean" ? details.proration : typeof line.proration === "boolean" ? line.proration : null,
        unadjusted: empty(line.discount_amounts) && empty(line.discounts) && empty(line.taxes) && empty(line.pretax_credit_amounts),
        priceAmountMinor: integer(price?.unit_amount), priceCurrency: text(price?.currency)?.toUpperCase() ?? null, priceInterval: text(recurring?.interval) ?? null,
        priceIntervalCount: integer(recurring?.interval_count), licensed: recurring?.usage_type === "licensed", perUnit: price?.billing_scheme === "per_unit",
        inclusive: price?.tax_behavior === "inclusive", noTransform: price?.transform_quantity === null });
      if (lines.length > 2000) unproven();
    }
    if (typeof collection.has_more !== "boolean") unproven();
    if (!collection.has_more) { complete = true; break; }
    const next = ref(collection.data.at(-1)); if (!next || cursors.has(next)) unproven(); cursors.add(next); cursor = next;
  }
  if (!complete) unproven();
  return { providerInvoiceRef: invoiceRef, providerSubscriptionRef: scope.providerSubscriptionRef, providerCustomerRef: ref(invoice.customer) ?? null,
    providerOperationId: uuid(metadata.freeholder_subscription_operation_id), phaseDigest: sha(metadata.freeholder_phase_digest), termsId: uuid(metadata.freeholder_subscription_terms_id),
    currency: text(invoice.currency)?.toUpperCase() ?? null, subtotalMinor: integer(invoice.subtotal), totalMinor: integer(invoice.total), paidMinor: integer(invoice.amount_paid), remainingMinor: integer(invoice.amount_remaining),
    paid: invoice.status === "paid" && invoice.paid_out_of_band !== true,
    unadjusted: invoice.collection_method === "charge_automatically" && object(invoice.automatic_tax)?.enabled === false && empty(invoice.total_taxes) && empty(invoice.total_discount_amounts) && empty(invoice.discounts)
      && invoice.starting_balance === 0 && invoice.ending_balance === 0 && invoice.amount_shipping === 0 && invoice.pre_payment_credit_notes_amount === 0 && invoice.post_payment_credit_notes_amount === 0,
    complete: true, lines };
}
