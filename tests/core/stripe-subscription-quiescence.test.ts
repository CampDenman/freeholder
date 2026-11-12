// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual hard pause preserves original scope and prior invoice debt.
import { describe, expect, it, vi } from "vitest";
import { cancelOriginalStripeMerchantSchedule, inspectOriginalStripeMerchantInvoices, pauseOriginalStripeMerchantSchedule, readOriginalStripeMerchantSchedule, type OriginalStripeMerchantSchedule } from "@/adapters/payments/stripe-subscription-quiescence";
import type { StripeSubscriptionRead } from "@/adapters/payments/stripe-subscription-origin";
const resource: OriginalStripeMerchantSchedule = { subscriptionId: "00000000-0000-4000-8000-000000000080", providerSubscriptionRef: "sub_original", providerCustomerRef: "cus_original",
  providerPlatformAccountId: "acct_originalPlatform", providerScheduleApiVersion: "2026-10-28.endive", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller" };
const active = { id: "sub_original", customer: "cus_original", billing_mode: { type: "flexible" }, schedule: null, collection_method: "charge_automatically", status: "active", pending_update: null,
  metadata: { freeholder_subscription_id: resource.subscriptionId, freeholder_platform_account_id: resource.providerPlatformAccountId }, transfer_data: { destination: "acct_originalSeller" }, on_behalf_of: "acct_originalSeller" };
const paused = { ...active, status: "paused" };
const invoice = (id: string, state = "void") => ({ id, subscription: "sub_original", customer: "cus_original", status: state });
function api(respond: (path: string, init: RequestInit) => Record<string, unknown> | Promise<Record<string, unknown>>) {
  return vi.fn<StripeSubscriptionRead>().mockImplementation(async (path, init, scope) => {
    expect(scope).toMatchObject({ providerPlatformAccountId: "acct_originalPlatform", destinationAccountId: "acct_originalSeller" });
    expect(scope.providerAccountId).toBeUndefined();
    expect(new Headers(init.headers).get("stripe-version")).toBe("2026-10-28.endive");
    return respond(path, init);
  });
}
describe("original Stripe subscription hard pause (C12.38)", () => {
  it("hard-pauses the actual original resource with no new debit or unused-time credit", async () => {
    const read = api((_path, init) => init.method === "POST" ? paused : active), onPaused = vi.fn().mockResolvedValue(undefined);
    await pauseOriginalStripeMerchantSchedule(read, resource, { idempotencyKey: "original-pause-operation-80", onPaused });
    expect(read).toHaveBeenCalledTimes(2);
    const [path, init] = read.mock.calls[1]!;
    expect(path).toBe("/v1/subscriptions/sub_original/pause");
    const body = init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({ type: "subscription", "bill_for[unused_time_from][type]": "none", "bill_for[outstanding_usage_through][type]": "none", invoicing_behavior: "pending_invoice_item" });
    expect(onPaused).toHaveBeenCalledExactlyOnceWith({ providerSubscriptionRef: "sub_original", state: "paused" });
  });
  it("recovers an actual paused resource with GET only", async () => {
    const read = api(() => paused), onPaused = vi.fn().mockResolvedValue(undefined);
    await pauseOriginalStripeMerchantSchedule(read, resource, { idempotencyKey: "original-pause-operation-80", onPaused });
    expect(read).toHaveBeenCalledOnce(); expect(read.mock.calls[0]![1].method).toBe("GET"); expect(onPaused).toHaveBeenCalledOnce();
  });
  it.each([{ billing_mode: { type: "classic" } }, { schedule: "sub_sched_other" }, { metadata: {} }, { customer: "cus_replacement" }, { transfer_data: { destination: "acct_replacementSeller" } }])("refuses an unproven original schedule before a write %j", async patch => {
    const read = api(() => ({ ...active, ...patch }));
    await expect(pauseOriginalStripeMerchantSchedule(read, resource, { idempotencyKey: "original-pause-operation-80", onPaused: vi.fn() })).rejects.toMatchObject({ code: "provider_failure" });
    expect(read).toHaveBeenCalledOnce();
  });
  it("preserves the actual pause before later pending-update disagreement", async () => {
    const read = api((_path, init) => init.method === "POST" ? { ...paused, pending_update: { resumes_at: 123 } } : active), onPaused = vi.fn().mockResolvedValue(undefined);
    await expect(pauseOriginalStripeMerchantSchedule(read, resource, { idempotencyKey: "original-pause-operation-80", onPaused })).rejects.toMatchObject({ code: "provider_failure" });
    expect(onPaused).toHaveBeenCalledOnce();
  });
  it("does not replay a physical pause after its reply is lost", async () => {
    let physicallyPaused = false;
    const read = api((_path, init) => { if (init.method === "POST") { physicallyPaused = true; throw new Error("Fictional pause reply lost"); } return active; });
    const onPaused = vi.fn();
    await expect(pauseOriginalStripeMerchantSchedule(read, resource, { idempotencyKey: "original-pause-operation-80", onPaused })).rejects.toThrow("Fictional pause reply lost");
    expect(physicallyPaused).toBe(true); expect(read).toHaveBeenCalledTimes(2); expect(onPaused).not.toHaveBeenCalled();
  });
  it("does not mistake pause_collection or a local pause for an actual hard pause", async () => {
    const read = api(() => ({ ...active, pause_collection: { behavior: "void" } }));
    await expect(inspectOriginalStripeMerchantInvoices(read, resource)).rejects.toMatchObject({ code: "provider_failure" });
    expect(read).toHaveBeenCalledOnce();
  });
  it("retains every prior invoice obligation across complete pages without closing or charging any", async () => {
    const read = api((path) => path.startsWith("/v1/subscriptions/") ? paused : path.includes("starting_after") ? { data: [invoice("in_paid", "paid")], has_more: false } : { data: [invoice("in_open", "open"), invoice("in_void")], has_more: true });
    expect(await inspectOriginalStripeMerchantInvoices(read, resource)).toEqual({ state: "paused", invoices: [{ providerInvoiceRef: "in_open", state: "open" }, { providerInvoiceRef: "in_void", state: "void" }, { providerInvoiceRef: "in_paid", state: "paid" }] });
    expect(read.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    expect(read.mock.calls[1]![0]).not.toContain("status=");
  });
  it.each([{ data: [] }, { data: [invoice("in_other")], has_more: "false" }, { data: [{ ...invoice("in_other"), customer: "cus_replacement" }], has_more: false }])("refuses incomplete or different original invoice evidence %j", async response => {
    const read = api(path => path.startsWith("/v1/subscriptions/") ? paused : response);
    await expect(inspectOriginalStripeMerchantInvoices(read, resource)).rejects.toMatchObject({ code: "provider_failure" });
  });
  it("bounds looping provider pages instead of declaring no outstanding invoices", async () => {
    const read = api(path => path.startsWith("/v1/subscriptions/") ? paused : { data: [invoice("in_loop")], has_more: true });
    await expect(inspectOriginalStripeMerchantInvoices(read, resource)).rejects.toMatchObject({ code: "provider_failure" });
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("refuses a different stored protocol version before any provider read", async () => {
    const read = api(() => paused);
    await expect(readOriginalStripeMerchantSchedule(read, { ...resource, providerScheduleApiVersion: "2026-02-25.clover" as never })).rejects.toMatchObject({ code: "provider_failure" });
    expect(read).not.toHaveBeenCalled();
  });
});

describe("original Stripe merchant cancellation (C12.38)", () => {
  it("stops the original resource despite later commercial drift without billing or prorating", async () => {
    const drifted = { ...active, metadata: {}, transfer_data: { destination: "acct_changedSeller" }, on_behalf_of: "acct_changedSeller" };
    const read = api((_path, init) => init.method === "DELETE" ? { ...drifted, status: "canceled" } : drifted);
    const onCancelled = vi.fn().mockResolvedValue(undefined);
    await cancelOriginalStripeMerchantSchedule(read, resource, { onCancelled });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]![0]).toBe("/v1/subscriptions/sub_original");
    expect(Object.fromEntries(read.mock.calls[1]![1].body as URLSearchParams)).toEqual({ invoice_now: "false", prorate: "false" });
    expect(onCancelled).toHaveBeenCalledExactlyOnceWith({ providerSubscriptionRef: "sub_original", state: "cancelled", source: "delete_ack" });
  });
  it("observes an already canceled original through GET without another mutation", async () => {
    const read = api(() => ({ id: "sub_original", status: "canceled" })), onCancelled = vi.fn().mockResolvedValue(undefined);
    await cancelOriginalStripeMerchantSchedule(read, resource, { onCancelled });
    expect(read).toHaveBeenCalledOnce();
    expect(onCancelled).toHaveBeenCalledExactlyOnceWith({ providerSubscriptionRef: "sub_original", state: "cancelled", source: "readback" });
  });
  it("keeps an actual cancellation distinct when its persistence callback fails", async () => {
    const read = api((_path, init) => init.method === "DELETE" ? { id: "sub_original", status: "canceled" } : active);
    let positive = false;
    await expect(cancelOriginalStripeMerchantSchedule(read, resource, { onCancelled: async () => { positive = true; throw new Error("Fictional durable phase unavailable"); } })).rejects.toThrow("Fictional durable phase unavailable");
    expect(positive).toBe(true); expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not acknowledge an accepted future cancellation as an actual stopped resource", async () => {
    const read = api((_path, init) => init.method === "DELETE" ? { ...active, cancel_at_period_end: true } : active), onCancelled = vi.fn();
    await expect(cancelOriginalStripeMerchantSchedule(read, resource, { onCancelled })).rejects.toMatchObject({ code: "provider_failure" });
    expect(onCancelled).not.toHaveBeenCalled();
  });
  it("does not issue a cancellation after an original resource read fails", async () => {
    const read = api(async () => { throw new Error("Fictional original resource unavailable"); }), onCancelled = vi.fn();
    await expect(cancelOriginalStripeMerchantSchedule(read, resource, { onCancelled })).rejects.toThrow("Fictional original resource unavailable");
    expect(read).toHaveBeenCalledOnce(); expect(onCancelled).not.toHaveBeenCalled();
  });
});
