// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: installed Stripe adapter preserves the explicit schedule version/scope.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantScheduleLocator } from "@/adapters/payments";
const locator: MerchantScheduleLocator = { subscriptionId: "00000000-0000-4000-8000-000000000080", providerSubscriptionRef: "sub_original",
  providerPlatformAccountId: "acct_originalPlatform", providerScheduleApiVersion: "2026-10-28.endive", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller" };
const active = { id: "sub_original", customer: "cus_original", billing_mode: { type: "flexible" }, schedule: null, collection_method: "charge_automatically", status: "active", pending_update: null,
  metadata: { freeholder_subscription_id: locator.subscriptionId, freeholder_platform_account_id: locator.providerPlatformAccountId }, transfer_data: { destination: "acct_originalSeller" }, on_behalf_of: "acct_originalSeller" };
function provider(platform = "acct_originalPlatform") {
  let paused = false, failReadback = false;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init?.headers);
    expect(headers.has("stripe-account")).toBe(false);
    if (url.pathname === "/v1/account") return Response.json({ id: platform });
    expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
    if (failReadback) throw new Error("Fictional later readback failed");
    if (url.pathname.endsWith("/pause")) { expect(init?.method).toBe("POST"); paused = true; }
    return Response.json({ ...active, status: paused ? "paused" : "active" });
  });
  return { adapter: createStripePayments({ secretKey: "sk_fictional", apiBase: "https://stripe.example.test", fetch: fetcher }), fetcher, failReadback: () => { failReadback = true; } };
}
describe("new schedule lifecycle through Stripe adapter (C12.38)", () => {
  it("derives the actual original customer from the authenticated original subscription", async () => {
    const { adapter, fetcher } = provider();
    expect(await adapter.resolveMerchantScheduleResource!(locator)).toEqual({ ...locator, providerCustomerRef: "cus_original" });
    expect(fetcher.mock.calls).toHaveLength(2);
  });
  it("rejects a replacement platform before reading or pausing its subscription namespace", async () => {
    const { adapter, fetcher } = provider("acct_replacementPlatform");
    await expect(adapter.pauseMerchantSchedule!({ ...locator, providerCustomerRef: "cus_original", idempotencyKey: "original-schedule-pause", onPaused: vi.fn() })).rejects.toMatchObject({ code: "authentication" });
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0]![1]?.method).toBe("GET");
  });
  it("records an actual pause before a later readback failure and never deletes or replays it", async () => {
    const { adapter, fetcher, failReadback } = provider(); let retained = false;
    const request = { ...locator, providerCustomerRef: "cus_original" };
    await adapter.pauseMerchantSchedule!({ ...request, idempotencyKey: "original-schedule-pause", onPaused: async () => { retained = true; } });
    expect(retained).toBe(true); failReadback();
    await expect(adapter.inspectMerchantScheduleInvoices!(request)).rejects.toThrow();
    expect(retained).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
});
