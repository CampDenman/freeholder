// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: one admitted physical phase mutation, original ACK before readback.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import { STRIPE_MERCHANT_SCHEDULE_API_VERSION } from "./stripe-subscription-quiescence";
import type { StripeSubscriptionRead } from "./stripe-subscription-origin";
import type { MerchantPhaseScheduleAcknowledgment, MerchantPhaseScheduleInventory, MerchantPhaseScheduleReadRequest, MerchantPhaseScheduleRequest, MerchantPhaseScheduleStopRequest, MerchantProviderPhase } from "./types";

const ref = (value: unknown) => text(value) ?? text(object(value)?.id);
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
function unproven(): never { throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not prove this original phase schedule and its actual price inventory.", true); }
function timestamp(value: string): number {
  const date = new Date(value), milliseconds = date.getTime();
  if (!Number.isSafeInteger(milliseconds) || date.toISOString() !== value || milliseconds % 1000 !== 0) unproven();
  return milliseconds / 1000;
}
const protocol = (init: RequestInit): RequestInit => ({ ...init, headers: { ...init.headers, "stripe-version": STRIPE_MERCHANT_SCHEDULE_API_VERSION } });
function validate(request: MerchantPhaseScheduleReadRequest | Omit<MerchantPhaseScheduleRequest, "onResourceAcknowledged">) {
  validateMerchantChargeScope(request);
  if (!request.providerPlatformAccountId || request.providerScheduleApiVersion !== STRIPE_MERCHANT_SCHEDULE_API_VERSION
    || request.providerApiVersion !== undefined && request.providerApiVersion !== request.providerScheduleApiVersion
    || !uuid(request.subscriptionId) || !uuid(request.operationId) || !hash(request.requestDigest)
    || !/^cus_[A-Za-z0-9]{1,195}$/.test(request.providerCustomerRef) || !/^pm_[A-Za-z0-9]{1,195}$/.test(request.providerMethodRef)
    || !/^prod_[A-Za-z0-9]{1,195}$/.test(request.providerProductRef) || (!request.destinationAccountId && !request.providerAccountId)
    || request.phases.length < 1 || request.phases.length > 10) unproven();
  for (const [index, phase] of request.phases.entries()) {
    if (!uuid(phase.termsId) || !uuid(phase.profileId) || !Number.isSafeInteger(phase.profileVersion) || phase.profileVersion < 1
      || !hash(phase.taxQuoteDigest) || !hash(phase.phaseDigest) || !/^[A-Z]{3}$/.test(phase.currency)
      || !["day", "week", "month", "year"].includes(phase.interval) || !Number.isSafeInteger(phase.intervalCount) || phase.intervalCount < 1
      || !Number.isSafeInteger(phase.siteFeeBps) || phase.siteFeeBps < 0 || phase.siteFeeBps > 10000
      || [phase.periodAmountMinor, phase.setupFeeMinor, phase.taxMinor, phase.totalMinor, phase.applicationFeeMinor].some(value => !Number.isSafeInteger(value) || value < 0)
      || BigInt(phase.totalMinor) !== BigInt(phase.periodAmountMinor) + BigInt(phase.setupFeeMinor) + BigInt(phase.taxMinor)
      || BigInt(phase.applicationFeeMinor) !== BigInt(phase.periodAmountMinor) * BigInt(phase.siteFeeBps) / 10000n + BigInt(phase.setupFeeMinor) * BigInt(phase.siteFeeBps) / 10000n
      || phase.taxOccurredAt !== phase.start || timestamp(phase.end) <= timestamp(phase.start)
      || index > 0 && (request.phases[index - 1]!.end !== phase.start || phase.setupFeeMinor !== 0)) unproven();
  }
}
function metadata(request: MerchantPhaseScheduleReadRequest | Omit<MerchantPhaseScheduleRequest, "onResourceAcknowledged">): Record<string, string> {
  return { freeholder_subscription_scope_version: "1", freeholder_subscription_id: request.subscriptionId,
    freeholder_subscription_operation_id: request.operationId, freeholder_platform_account_id: request.providerPlatformAccountId,
    freeholder_schedule_api_version: request.providerScheduleApiVersion };
}
function matchesMetadata(actual: unknown, expected: Record<string, string>) {
  const values = object(actual);
  return Object.entries(expected).every(([key, value]) => values?.[key] === value);
}
function phaseMetadata(request: MerchantPhaseScheduleReadRequest | Omit<MerchantPhaseScheduleRequest, "onResourceAcknowledged">, phase: MerchantProviderPhase) {
  return { ...metadata(request), freeholder_phase_digest: phase.phaseDigest, freeholder_phase_tax_quote_digest: phase.taxQuoteDigest,
    freeholder_subscription_terms_id: phase.termsId, freeholder_phase_start: phase.start, freeholder_phase_end: phase.end };
}
function sameRoute(request: MerchantPhaseScheduleReadRequest | MerchantPhaseScheduleRequest, value: Record<string, unknown>) {
  return Object.hasOwn(value, "transfer_data") && Object.hasOwn(value, "on_behalf_of")
    && ref(object(value.transfer_data)?.destination) === request.destinationAccountId
    && ref(value.on_behalf_of) === request.settlementMerchantAccountId
    && (object(value.transfer_data)?.amount_percent === undefined || object(value.transfer_data)?.amount_percent === null);
}
function acknowledged(value: Record<string, unknown>): MerchantPhaseScheduleAcknowledgment | null {
  const providerScheduleRef = ref(value);
  if (!providerScheduleRef || !/^sub_sched_[A-Za-z0-9]{1,195}$/.test(providerScheduleRef)) return null;
  const subscription = ref(value.subscription), customer = ref(value.customer);
  return { providerScheduleRef,
    ...(value.subscription === null ? { providerSubscriptionRef: null } : subscription && /^sub_[A-Za-z0-9]{1,195}$/.test(subscription) ? { providerSubscriptionRef: subscription } : {}),
    ...(value.customer === null ? { providerCustomerRef: null } : customer && /^cus_[A-Za-z0-9]{1,195}$/.test(customer) ? { providerCustomerRef: customer } : {}) };
}

function empty(value: unknown): boolean { return Array.isArray(value) && value.length === 0; }

/** The caller supplies exact retained admitted phases. The authenticated GETs
 * independently prove every current/future price; metadata alone never does. */
export async function inspectOriginalStripePhaseSchedule(api: StripeSubscriptionRead, request: MerchantPhaseScheduleReadRequest): Promise<MerchantPhaseScheduleInventory> {
  validate(request);
  if (!/^sub_sched_[A-Za-z0-9]{1,195}$/.test(request.providerScheduleRef)) unproven();
  const actual = await api(`/v1/subscription_schedules/${encodeURIComponent(request.providerScheduleRef)}`, protocol({ method: "GET" }), { ...request, providerApiVersion: request.providerScheduleApiVersion });
  const identity = acknowledged(actual);
  if (identity && identity.providerScheduleRef === request.providerScheduleRef) await request.onResourceAcknowledged?.(identity);
  if (!identity || identity.providerScheduleRef !== request.providerScheduleRef || identity.providerCustomerRef !== request.providerCustomerRef
    || identity.providerSubscriptionRef === undefined || actual.object !== "subscription_schedule"
    || object(actual.billing_mode)?.type !== "flexible" || actual.end_behavior !== "cancel" || !matchesMetadata(actual.metadata, metadata(request))
    || !["active", "not_started", "completed", "canceled", "released"].includes(String(actual.status))
    || !Array.isArray(actual.phases) || actual.phases.length > 10 || !empty(actual.pause_schedules)) unproven();
  if (actual.status === "active" && !identity.providerSubscriptionRef || actual.status === "not_started" && identity.providerSubscriptionRef) unproven();
  const defaults = object(actual.default_settings);
  if (!defaults || defaults.collection_method !== "charge_automatically" || ref(defaults.default_payment_method) !== request.providerMethodRef
    || object(defaults.automatic_tax)?.enabled !== false || !sameRoute(request, defaults)) unproven();
  const observed = actual.phases.map(object);
  if (observed.some(phase => !phase)) unproven();
  const applicable = observed.filter(phase => number(phase!.end_date) === undefined || number(phase!.end_date)! > timestamp(request.phases[0]!.start));
  if (applicable.length !== request.phases.length) unproven();
  const phases: MerchantPhaseScheduleInventory["phases"] = [];
  for (const [index, phase] of applicable.entries()) {
    const expected = request.phases[index]!;
    if (!phase || phase.start_date !== timestamp(expected.start) || phase.end_date !== timestamp(expected.end) || phase.currency !== expected.currency.toLowerCase()
      || phase.collection_method !== "charge_automatically" || ref(phase.default_payment_method) !== request.providerMethodRef
      || !Object.hasOwn(phase, "application_fee_percent") || (phase.application_fee_percent ?? 0) !== expected.siteFeeBps / 100
      || !sameRoute(request, phase) || object(phase.automatic_tax)?.enabled !== false || !empty(phase.default_tax_rates)
      || !empty(phase.add_invoice_items) || !empty(phase.discounts) || phase.billing_thresholds !== null || phase.trial_end !== null
      || phase.proration_behavior !== "none" || phase.billing_cycle_anchor !== "phase_start" || !matchesMetadata(phase.metadata, phaseMetadata(request, expected))
      || !Array.isArray(phase.items) || phase.items.length !== 1) unproven();
    const item = object(phase.items[0]), providerPriceRef = ref(item?.price);
    if (!item || item.quantity !== 1 || !empty(item.tax_rates) || !empty(item.discounts) || item.billing_thresholds !== null
      || !providerPriceRef || !/^price_[A-Za-z0-9]{1,195}$/.test(providerPriceRef)) unproven();
    const price = await api(`/v1/prices/${encodeURIComponent(providerPriceRef)}`, protocol({ method: "GET" }), { ...request, providerApiVersion: request.providerScheduleApiVersion });
    const recurring = object(price.recurring);
    if (price.id !== providerPriceRef || price.object !== "price" || ref(price.product) !== request.providerProductRef
      || price.currency !== expected.currency.toLowerCase() || price.unit_amount !== expected.totalMinor || price.billing_scheme !== "per_unit"
      || price.type !== "recurring" || price.tax_behavior !== "inclusive" || price.transform_quantity !== null
      || recurring?.interval !== expected.interval || (recurring.interval_count ?? 1) !== expected.intervalCount || recurring.usage_type !== "licensed") unproven();
    phases.push({ ...expected, providerPriceRef });
  }
  const current = object(actual.current_phase), currentPhaseStart = current ? number(current.start_date) : undefined;
  if (actual.status === "active" && (currentPhaseStart === undefined || !request.phases.some(phase => timestamp(phase.start) === currentPhaseStart))) unproven();
  return { ...identity, providerSubscriptionRef: identity.providerSubscriptionRef, providerCustomerRef: request.providerCustomerRef, operationId: request.operationId, requestDigest: request.requestDigest,
    providerPlatformAccountId: request.providerPlatformAccountId, chargeAccountId: request.providerAccountId ?? null,
    recipientAccountId: request.destinationAccountId ?? request.providerAccountId!, settlementMerchantAccountId: request.settlementMerchantAccountId ?? request.providerAccountId!,
    providerApiVersion: request.providerScheduleApiVersion, status: actual.status as MerchantPhaseScheduleInventory["status"],
    endBehavior: "cancel", complete: true, currentPhaseStart: currentPhaseStart === undefined ? null : new Date(currentPhaseStart * 1000).toISOString(), phases };
}

/** Pure canonical body builder: a real claim can freeze these exact fields
 * before I/O without callbacks or a self-referential digest in metadata. */
export function stripeMerchantPhaseBody(request: Omit<MerchantPhaseScheduleRequest, "onResourceAcknowledged">, updating: boolean) {
  validate(request);
  const form = new URLSearchParams({ end_behavior: "cancel", "default_settings[collection_method]": "charge_automatically",
    "default_settings[default_payment_method]": request.providerMethodRef, "default_settings[automatic_tax][enabled]": "false" });
  if (updating) form.set("proration_behavior", "none");
  else { form.set("customer", request.providerCustomerRef); form.set("start_date", String(timestamp(request.phases[0]!.start))); form.set("billing_mode[type]", "flexible"); }
  for (const [key, value] of Object.entries(metadata(request))) form.set(`metadata[${key}]`, value);
  if (request.destinationAccountId) {
    form.set("default_settings[transfer_data][destination]", request.destinationAccountId);
    form.set("default_settings[on_behalf_of]", request.settlementMerchantAccountId!);
  }
  for (const [index, phase] of request.phases.entries()) {
    const key = `phases[${index}]`;
    if (updating) form.set(`${key}[start_date]`, String(timestamp(phase.start)));
    for (const [name, value] of Object.entries({ end_date: timestamp(phase.end), currency: phase.currency.toLowerCase(), collection_method: "charge_automatically",
      default_payment_method: request.providerMethodRef, application_fee_percent: phase.siteFeeBps / 100, proration_behavior: "none", billing_cycle_anchor: "phase_start",
      discounts: "", default_tax_rates: "", billing_thresholds: "" })) form.set(`${key}[${name}]`, String(value));
    form.set(`${key}[automatic_tax][enabled]`, "false");
    for (const [name, value] of Object.entries({ currency: phase.currency.toLowerCase(), unit_amount: phase.totalMinor, product: request.providerProductRef, tax_behavior: "inclusive" })) form.set(`${key}[items][0][price_data][${name}]`, String(value));
    form.set(`${key}[items][0][price_data][recurring][interval]`, phase.interval);
    form.set(`${key}[items][0][price_data][recurring][interval_count]`, String(phase.intervalCount));
    form.set(`${key}[items][0][quantity]`, "1"); form.set(`${key}[items][0][tax_rates]`, ""); form.set(`${key}[items][0][discounts]`, "");
    for (const [name, value] of Object.entries(phaseMetadata(request, phase))) form.set(`${key}[metadata][${name}]`, value);
    if (request.destinationAccountId) { form.set(`${key}[transfer_data][destination]`, request.destinationAccountId); form.set(`${key}[on_behalf_of]`, request.settlementMerchantAccountId!); }
  }
  return form;
}

/** Exactly one POST. Unknown response/readback stays the original caller's
 * debt; retry must inspect this intent rather than create another resource. */
export async function mutateOriginalStripePhaseSchedule(api: StripeSubscriptionRead, request: MerchantPhaseScheduleRequest & { providerScheduleRef?: string; previous?: MerchantPhaseScheduleReadRequest }): Promise<MerchantPhaseScheduleInventory> {
  validate(request);
  if (!request.idempotencyKey || request.idempotencyKey.length > 200) unproven();
  if (request.providerScheduleRef && !/^sub_sched_[A-Za-z0-9]{1,195}$/.test(request.providerScheduleRef)) unproven();
  if (request.providerScheduleRef) {
    if (!request.previous || request.previous.providerScheduleRef !== request.providerScheduleRef
      || request.previous.subscriptionId !== request.subscriptionId || request.previous.providerPlatformAccountId !== request.providerPlatformAccountId
      || request.previous.providerAccountId !== request.providerAccountId || request.previous.destinationAccountId !== request.destinationAccountId
      || request.previous.settlementMerchantAccountId !== request.settlementMerchantAccountId || request.previous.providerCustomerRef !== request.providerCustomerRef
      || request.previous.providerMethodRef !== request.providerMethodRef || request.previous.providerProductRef !== request.providerProductRef) unproven();
    const prior = await inspectOriginalStripePhaseSchedule(api, request.previous);
    if (!["active", "not_started"].includes(prior.status)) unproven();
  }
  const path = request.providerScheduleRef ? `/v1/subscription_schedules/${encodeURIComponent(request.providerScheduleRef)}` : "/v1/subscription_schedules";
  const value = await api(path, protocol({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.idempotencyKey }, body: stripeMerchantPhaseBody(request, !!request.providerScheduleRef) }), { ...request, providerApiVersion: request.providerScheduleApiVersion });
  const identity = acknowledged(value);
  if (!identity) unproven();
  // Commit actual resource identity even if its scope/phase readback later
  // disagrees. That separate positive fact must not vanish with validation.
  await request.onResourceAcknowledged(identity);
  if (request.providerScheduleRef && identity.providerScheduleRef !== request.providerScheduleRef) unproven();
  return inspectOriginalStripePhaseSchedule(api, { ...request, providerScheduleRef: identity.providerScheduleRef, onResourceAcknowledged: async readIdentity => {
    if (readIdentity.providerScheduleRef !== identity.providerScheduleRef || readIdentity.providerSubscriptionRef !== identity.providerSubscriptionRef
      || readIdentity.providerCustomerRef !== identity.providerCustomerRef) await request.onResourceAcknowledged(readIdentity);
  } });
}

/** Positive provider cancellation before the originally admitted first phase,
 * not a local clock, may prove this future schedule never linked a chargeable
 * subscription. Terminal null linkage alone is deliberately insufficient. */
function neverStartedProof(value: Record<string, unknown>, request: MerchantPhaseScheduleStopRequest) {
  const canceledAt = number(value.canceled_at), createdAt = number(value.created), phases = Array.isArray(value.phases) ? value.phases.map(object) : [];
  if (!request.originalFirstPhaseStart || ref(value.customer) !== request.providerCustomerRef || value.status !== "canceled" || value.subscription !== null || value.released_subscription !== null
    || canceledAt === undefined || createdAt === undefined || !Number.isSafeInteger(canceledAt) || !Number.isSafeInteger(createdAt) || createdAt < 0 || canceledAt < createdAt || !phases.length || phases.some(phase => !phase || !Number.isSafeInteger(phase.start_date))
    || Math.min(...phases.map(phase => Number(phase!.start_date))) !== timestamp(request.originalFirstPhaseStart)
    || canceledAt >= timestamp(request.originalFirstPhaseStart)) return null;
  return { originalFirstPhaseStart: request.originalFirstPhaseStart, providerCreatedAt: new Date(createdAt * 1000).toISOString(), providerCanceledAt: new Date(canceledAt * 1000).toISOString() };
}

/** A stopped schedule is not yet a customer-erasure receipt: every linked
 * subscription and its original invoices/PI history still needs stop proof.
 * No current phase/price drift is allowed to prevent stopping the original ID. */
export async function cancelOriginalStripePhaseSchedule(api: StripeSubscriptionRead, request: MerchantPhaseScheduleStopRequest, readOnly = false): Promise<void> {
  validateMerchantChargeScope(request);
  if (!request.providerPlatformAccountId || request.providerScheduleApiVersion !== STRIPE_MERCHANT_SCHEDULE_API_VERSION
    || request.providerApiVersion !== undefined && request.providerApiVersion !== request.providerScheduleApiVersion
    || !uuid(request.subscriptionId) || !/^sub_sched_[A-Za-z0-9]{1,195}$/.test(request.providerScheduleRef)) unproven();
  const path = `/v1/subscription_schedules/${encodeURIComponent(request.providerScheduleRef)}`;
  const before = await api(path, protocol({ method: "GET" }), { ...request, providerApiVersion: request.providerScheduleApiVersion });
  if (before.id !== request.providerScheduleRef) unproven();
  const linked = new Set<string>();
  let linkedInventoryComplete = true;
  const collect = (value: Record<string, unknown>) => {
    for (const entry of [value.subscription, value.released_subscription]) {
      const id = ref(entry);
      if (id && /^sub_[A-Za-z0-9]{1,195}$/.test(id)) linked.add(id);
      else if (entry !== null) linkedInventoryComplete = false;
    }
  };
  collect(before);
  if (["canceled", "completed", "released"].includes(String(before.status))) {
    await request.onStopped({ providerScheduleRef: request.providerScheduleRef, providerSubscriptionRefs: [...linked].sort(), linkedInventoryComplete,
      state: before.status as "canceled" | "completed" | "released", source: "readback", neverStartedProof: neverStartedProof(before, request) });
    if (ref(before.customer) !== request.providerCustomerRef || !linkedInventoryComplete) unproven();
    return;
  }
  if (readOnly || !["not_started", "active"].includes(String(before.status))) unproven();
  const actual = await api(`${path}/cancel`, protocol({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ invoice_now: "false", prorate: "false" }) }), { ...request, providerApiVersion: request.providerScheduleApiVersion });
  if (actual.id !== request.providerScheduleRef || actual.status !== "canceled") unproven();
  // Parse only actual related refs, preserving uncertainty explicitly. The
  // primary terminal ACK is committed once even if related inventory is bad.
  collect(actual);
  await request.onStopped({ providerScheduleRef: request.providerScheduleRef, providerSubscriptionRefs: [...linked].sort(), linkedInventoryComplete, state: "canceled", source: "cancel_ack", neverStartedProof: neverStartedProof(actual, request) });
  if (ref(actual.customer) !== request.providerCustomerRef || !linkedInventoryComplete) unproven();
}

/** Recovery has its own admitted GET; an active result never enters cancel. */
export async function inspectOriginalStripePhaseScheduleStop(api: StripeSubscriptionRead, request: MerchantPhaseScheduleStopRequest): Promise<void> {
  return cancelOriginalStripePhaseSchedule(api, request, true);
}
