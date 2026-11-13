// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: synthetic HTTP evidence for the inactive original phase adapter.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantPhaseScheduleRequest, MerchantProviderPhase } from "@/adapters/payments";
const phase: MerchantProviderPhase = { termsId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", profileVersion: 1,
  start: "2027-01-01T00:00:00.000Z", end: "2027-02-01T00:00:00.000Z", taxOccurredAt: "2027-01-01T00:00:00.000Z", currency: "CAD", interval: "month", intervalCount: 1,
  periodAmountMinor: 4000, setupFeeMinor: 500, taxMinor: 225, totalMinor: 4725, applicationFeeMinor: 450, siteFeeBps: 1000, taxQuoteDigest: "a".repeat(64), phaseDigest: "b".repeat(64) };
const request: MerchantPhaseScheduleRequest = { subscriptionId: "00000000-0000-4000-8000-000000000003", operationId: "00000000-0000-4000-8000-000000000004", requestDigest: "c".repeat(64),
  providerPlatformAccountId: "acct_originalPlatform", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller", providerScheduleApiVersion: "2026-10-28.endive",
  providerCustomerRef: "cus_original", providerMethodRef: "pm_original", providerProductRef: "prod_original", idempotencyKey: "original-phase-operation", phases: [phase], onResourceAcknowledged: async () => {} };
function metadata(input = request) { return { freeholder_subscription_scope_version: "1", freeholder_subscription_id: input.subscriptionId,
  freeholder_subscription_operation_id: input.operationId, freeholder_platform_account_id: input.providerPlatformAccountId, freeholder_schedule_api_version: input.providerScheduleApiVersion }; }
function actual(input = request) {
  const route = { transfer_data: input.destinationAccountId ? { destination: input.destinationAccountId } : null, on_behalf_of: input.settlementMerchantAccountId ?? null };
  return { id: "sub_sched_original", object: "subscription_schedule", customer: "cus_original", subscription: null, released_subscription: null,
    billing_mode: { type: "flexible" }, status: "not_started", end_behavior: "cancel", metadata: metadata(input), pause_schedules: [], current_phase: null,
    default_settings: { collection_method: "charge_automatically", default_payment_method: "pm_original", automatic_tax: { enabled: false }, ...route },
    phases: input.phases.map(item => ({ start_date: new Date(item.start).getTime() / 1000, end_date: new Date(item.end).getTime() / 1000, currency: "cad", collection_method: "charge_automatically",
      default_payment_method: "pm_original", application_fee_percent: item.siteFeeBps / 100, ...route, automatic_tax: { enabled: false }, default_tax_rates: [], add_invoice_items: [], discounts: [], billing_thresholds: null, trial_end: null,
      proration_behavior: "none", billing_cycle_anchor: "phase_start", metadata: { ...metadata(input), freeholder_phase_digest: item.phaseDigest, freeholder_phase_tax_quote_digest: item.taxQuoteDigest,
        freeholder_subscription_terms_id: item.termsId, freeholder_phase_start: item.start, freeholder_phase_end: item.end }, items: [{ price: "price_original", quantity: 1, tax_rates: [], discounts: [], billing_thresholds: null }] })) };
}
const price = { id: "price_original", object: "price", product: "prod_original", currency: "cad", unit_amount: 4725, billing_scheme: "per_unit", type: "recurring", tax_behavior: "inclusive", transform_quantity: null,
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } };
function edge(respond: (path: string, init: RequestInit) => Record<string, unknown> | Promise<Record<string, unknown>>) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    expect(url.origin).toBe("https://stripe.example.test");
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_originalPlatform" });
    expect(new Headers(init.headers).get("stripe-version")).toBe("2026-10-28.endive");
    return Response.json(await respond(url.pathname, init));
  });
  return { fetcher, provider: createStripePayments({ secretKey: "sk_phase_fixture", webhookSecrets: ["whsec_phase_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher }) };
}
describe("original Stripe phase adapter (inactive C12.38)", () => {
  it.each(["destination", "direct"] as const)("creates one %s schedule and proves actual prices while preserving a genuine null subscription", async kind => {
    const input = kind === "direct" ? { ...request, destinationAccountId: undefined, settlementMerchantAccountId: undefined, providerAccountId: "acct_originalSeller" } : request;
    const order: string[] = [], onResourceAcknowledged = vi.fn(async () => { order.push("durable-ack"); });
    const { provider, fetcher } = edge((path, init) => {
      if (init.method === "POST") { order.push("post"); const form = init.body as URLSearchParams;
        expect(form.get("end_behavior")).toBe("cancel"); expect(form.get("start_date")).toBe("1798761600");
        expect(form.get("phases[0][items][0][price_data][unit_amount]")).toBe("4725"); expect(form.get("phases[0][application_fee_percent]")).toBe("10");
        expect(form.get("phases[0][automatic_tax][enabled]")).toBe("false"); expect(form.get("phases[0][discounts]")).toBe("");
        expect(new Headers(init.headers).get("stripe-account")).toBe(kind === "direct" ? "acct_originalSeller" : null);
        return actual(input);
      }
      order.push(path); return path.startsWith("/v1/prices/") ? price : actual(input);
    });
    const result = await provider.createMerchantPhaseSchedule!({ ...input, onResourceAcknowledged });
    expect(result).toMatchObject({ providerScheduleRef: "sub_sched_original", providerSubscriptionRef: null, status: "not_started", phases: [{ totalMinor: 4725, applicationFeeMinor: 450, providerPriceRef: "price_original" }] });
    expect(order).toEqual(["post", "durable-ack", "/v1/subscription_schedules/sub_sched_original", "/v1/prices/price_original"]);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); expect(onResourceAcknowledged).toHaveBeenCalledOnce();
  });
  it("retains a physical schedule ACK before readback failure without another POST", async () => {
    const onResourceAcknowledged = vi.fn().mockResolvedValue(undefined);
    const { provider, fetcher } = edge((_path, init) => { if (init.method === "POST") return actual(); throw new Error("Synthetic original read unavailable"); });
    await expect(provider.createMerchantPhaseSchedule!({ ...request, onResourceAcknowledged })).rejects.toThrow("Synthetic original read unavailable");
    expect(onResourceAcknowledged).toHaveBeenCalledExactlyOnceWith({ providerScheduleRef: "sub_sched_original", providerSubscriptionRef: null, providerCustomerRef: "cus_original" });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("retains the known physical resource with unknown ACK fields without inventing customer or subscription values", async () => {
    const onResourceAcknowledged = vi.fn().mockResolvedValue(undefined);
    const { provider } = edge((_path, init) => init.method === "POST" ? { id: "sub_sched_original" } : actual());
    await provider.createMerchantPhaseSchedule!({ ...request, onResourceAcknowledged });
    expect(onResourceAcknowledged).toHaveBeenCalledExactlyOnceWith({ providerScheduleRef: "sub_sched_original" });
  });
  it("keeps an ACK independent of later actual price disagreement", async () => {
    const onResourceAcknowledged = vi.fn().mockResolvedValue(undefined);
    const { provider } = edge(path => path.startsWith("/v1/prices/") ? { ...price, unit_amount: 4726 } : actual());
    await expect(provider.createMerchantPhaseSchedule!({ ...request, onResourceAcknowledged })).rejects.toMatchObject({ code: "provider_failure" });
    expect(onResourceAcknowledged).toHaveBeenCalledOnce();
  });
  it("does not POST an update without its separately retained original inventory", async () => {
    const { provider, fetcher } = edge(() => actual());
    await expect(provider.updateMerchantPhaseSchedule!({ ...request, providerScheduleRef: "sub_sched_original", previous: undefined as never })).rejects.toMatchObject({ code: "provider_failure" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("performs read-only recovery of a known schedule rather than recreating it", async () => {
    const { provider, fetcher } = edge(path => path.startsWith("/v1/prices/") ? price : actual());
    await provider.inspectMerchantPhaseSchedule!({ ...request, providerScheduleRef: "sub_sched_original" });
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("cancels a not-started original schedule without inventing a linked subscription or charging a final invoice", async () => {
    const onStopped = vi.fn().mockResolvedValue(undefined);
    const { provider, fetcher } = edge((_path, init) => init.method === "POST" ? { ...actual(), status: "canceled" } : actual());
    await provider.cancelMerchantPhaseSchedule!({ ...request, providerScheduleRef: "sub_sched_original", onStopped });
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST"); expect(posts).toHaveLength(1);
    expect(Object.fromEntries(posts[0]![1]!.body as URLSearchParams)).toEqual({ invoice_now: "false", prorate: "false" });
    expect(onStopped).toHaveBeenCalledExactlyOnceWith({ providerScheduleRef: "sub_sched_original", providerSubscriptionRefs: [], linkedInventoryComplete: true, state: "canceled", source: "cancel_ack" });
  });
  it("preserves the original linked subscription across a canceled schedule's null current reference", async () => {
    const onStopped = vi.fn().mockResolvedValue(undefined);
    const { provider } = edge((_path, init) => init.method === "POST" ? { ...actual(), status: "canceled" } : { ...actual(), status: "active", subscription: "sub_original" });
    await provider.cancelMerchantPhaseSchedule!({ ...request, providerScheduleRef: "sub_sched_original", onStopped });
    expect(onStopped).toHaveBeenCalledExactlyOnceWith({ providerScheduleRef: "sub_sched_original", providerSubscriptionRefs: ["sub_original"], linkedInventoryComplete: true, state: "canceled", source: "cancel_ack" });
  });
});
