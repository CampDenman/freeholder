// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual factory stop evidence never invents historical empty linkage.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantPhaseScheduleStopRequest } from "@/adapters/payments";
const request: Omit<MerchantPhaseScheduleStopRequest, "onStopped"> = { subscriptionId: "00000000-0000-4000-8000-000000000701", providerScheduleRef: "sub_sched_original",
  providerCustomerRef: "cus_original", providerPlatformAccountId: "acct_originalPlatform", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller",
  providerScheduleApiVersion: "2026-10-28.endive", originalFirstPhaseStart: "2027-06-01T00:00:00.000Z" };
const created = Date.parse("2026-11-13T00:00:00.000Z") / 1000, canceled = created + 60, start = Date.parse(request.originalFirstPhaseStart!) / 1000;
const future = { id: "sub_sched_original", customer: "cus_original", status: "not_started", created, canceled_at: null, subscription: null, released_subscription: null, phases: [{ start_date: start }] };
function edge(options: { terminal?: boolean; missingProviderDates?: boolean; priorLinked?: boolean; loseReply?: boolean } = {}) {
  let posts = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init.headers);
    expect(headers.has("stripe-account")).toBe(false);
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_originalPlatform" });
    expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
    if (init.method === "POST") {
      posts++; expect(url.pathname).toBe("/v1/subscription_schedules/sub_sched_original/cancel");
      if (typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) throw new Error("Expected the original cancellation form.");
      expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ invoice_now: "false", prorate: "false" });
      if (options.loseReply) throw new Error("Synthetic original stop reply lost");
      return Response.json({ ...future, status: "canceled", canceled_at: options.missingProviderDates ? null : canceled, ...(options.missingProviderDates ? { created: null } : {}) });
    }
    expect(init.method).toBe("GET"); expect(url.pathname).toBe("/v1/subscription_schedules/sub_sched_original");
    return Response.json(options.terminal ? { ...future, status: "canceled", canceled_at: canceled } : options.priorLinked ? { ...future, status: "active", subscription: "sub_historical" } : future);
  });
  return { provider: createStripePayments({ secretKey: "sk_original_phase_stop_fixture", apiBase: "https://stripe.example.test", fetch: fetcher }), fetcher, posts: () => posts };
}
describe("original primary schedule cancellation evidence", () => {
  it("uses one original cancellation and provider timestamps to retain positive pre-start evidence", async () => {
    const { provider, posts } = edge(), onStopped = vi.fn().mockResolvedValue(undefined);
    await provider.cancelMerchantPhaseSchedule!({ ...request, onStopped });
    expect(posts()).toBe(1);
    expect(onStopped).toHaveBeenCalledExactlyOnceWith({ providerScheduleRef: "sub_sched_original", providerSubscriptionRefs: [], linkedInventoryComplete: true, state: "canceled", source: "cancel_ack",
      neverStartedProof: { originalFirstPhaseStart: request.originalFirstPhaseStart, providerCreatedAt: new Date(created * 1000).toISOString(), providerCanceledAt: new Date(canceled * 1000).toISOString() } });
  });
  it("keeps terminal null linkage unresolved when the actual provider pre-start evidence is missing", async () => {
    const { provider } = edge({ missingProviderDates: true }), onStopped = vi.fn().mockResolvedValue(undefined);
    await provider.cancelMerchantPhaseSchedule!({ ...request, onStopped });
    expect(onStopped).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ providerSubscriptionRefs: [], neverStartedProof: null }));
  });
  it("retains a historical original linked subscription after cancellation clears its current pointer", async () => {
    const { provider } = edge({ priorLinked: true }), onStopped = vi.fn().mockResolvedValue(undefined);
    await provider.cancelMerchantPhaseSchedule!({ ...request, onStopped });
    expect(onStopped).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ providerSubscriptionRefs: ["sub_historical"], linkedInventoryComplete: true }));
  });
  it("does not replay a physically accepted cancellation whose response is lost", async () => {
    const { provider, posts } = edge({ loseReply: true }), onStopped = vi.fn();
    await expect(provider.cancelMerchantPhaseSchedule!({ ...request, onStopped })).rejects.toMatchObject({ code: "provider_failure" });
    expect(posts()).toBe(1); expect(onStopped).not.toHaveBeenCalled();
  });
  it("reads an already canceled original resource without another POST", async () => {
    const { provider, posts, fetcher } = edge({ terminal: true }), onStopped = vi.fn().mockResolvedValue(undefined);
    await provider.cancelMerchantPhaseSchedule!({ ...request, onStopped });
    expect(posts()).toBe(0); expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(onStopped).toHaveBeenCalledOnce();
    const observed: unknown = onStopped.mock.calls[0]?.[0];
    expect(observed).toMatchObject({ source: "readback" });
    expect(observed).toHaveProperty("neverStartedProof.providerCanceledAt", new Date(canceled * 1000).toISOString());
  });
  it("does not turn an active primary's GET recovery into another cancel POST", async () => {
    const { provider, posts } = edge(), onStopped = vi.fn();
    await expect(provider.inspectMerchantPhaseScheduleStop!({ ...request, onStopped })).rejects.toMatchObject({ code: "provider_failure" });
    expect(posts()).toBe(0); expect(onStopped).not.toHaveBeenCalled();
  });
  it("recovers a terminal primary with a GET-only actual readback", async () => {
    const { provider, posts, fetcher } = edge({ terminal: true }), onStopped = vi.fn().mockResolvedValue(undefined);
    await provider.inspectMerchantPhaseScheduleStop!({ ...request, onStopped });
    expect(posts()).toBe(0); expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(onStopped).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source: "readback", linkedInventoryComplete: true }));
  });

});
