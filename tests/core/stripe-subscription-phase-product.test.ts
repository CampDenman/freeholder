// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the auxiliary POST is separate from a phase or payment creation.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MerchantPhaseProductRequest } from "@/adapters/payments";
const request: MerchantPhaseProductRequest = { subscriptionId: "00000000-0000-4000-8000-000000000001", operationId: "00000000-0000-4000-8000-000000000002",
  providerPlatformAccountId: "acct_originalPlatform", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller", providerScheduleApiVersion: "2026-10-28.endive",
  name: "Actual accepted original membership", idempotencyKey: "original-auxiliary-operation", onProductAcknowledged: async () => {} };
const actual = { id: "prod_original", object: "product", active: true, name: request.name, metadata: { freeholder_subscription_id: request.subscriptionId,
  freeholder_phase_product_operation_id: request.operationId, freeholder_platform_account_id: request.providerPlatformAccountId, freeholder_schedule_api_version: request.providerScheduleApiVersion } };
function edge(respond: (path: string, init: RequestInit) => Record<string, unknown>) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init = {}) => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === "/v1/account") return Response.json({ id: "acct_originalPlatform" });
    expect(new Headers(init.headers).get("stripe-version")).toBe("2026-10-28.endive");
    expect(new Headers(init.headers).get("stripe-account")).toBeNull();
    return Response.json(respond(path, init));
  });
  return { fetcher, provider: createStripePayments({ secretKey: "sk_product_fixture", webhookSecrets: ["whsec_product_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher }) };
}
describe("original auxiliary product (inactive C12.38)", () => {
  it("performs one distinct product POST and commits its actual ACK before the verification GET", async () => {
    const order: string[] = [], onProductAcknowledged = vi.fn(async () => { order.push("committed-product-ack"); });
    const { provider, fetcher } = edge((path, init) => { order.push(`${init.method}:${path}`); if (init.method === "POST") expect(Object.fromEntries(init.body as URLSearchParams)).toMatchObject({ name: request.name, "metadata[freeholder_phase_product_operation_id]": request.operationId }); return actual; });
    expect(await provider.createMerchantPhaseProduct!({ ...request, onProductAcknowledged })).toEqual({ providerProductRef: "prod_original" });
    expect(order).toEqual(["POST:/v1/products", "committed-product-ack", "GET:/v1/products/prod_original"]);
    expect(onProductAcknowledged).toHaveBeenCalledExactlyOnceWith({ providerProductRef: "prod_original" });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("keeps the actual product ACK when later original metadata verification fails", async () => {
    const onProductAcknowledged = vi.fn().mockResolvedValue(undefined);
    const { provider } = edge((_path, init) => init.method === "POST" ? actual : { ...actual, metadata: { ...actual.metadata, freeholder_platform_account_id: "acct_replacementPlatform" } });
    await expect(provider.createMerchantPhaseProduct!({ ...request, onProductAcknowledged })).rejects.toMatchObject({ code: "provider_failure" });
    expect(onProductAcknowledged).toHaveBeenCalledExactlyOnceWith({ providerProductRef: "prod_original" });
  });
  it("does not retry a physically accepted product POST whose response is lost", async () => {
    let effects = 0; const onProductAcknowledged = vi.fn();
    const { provider, fetcher } = edge((_path, init) => { if (init.method === "POST") { effects++; throw new Error("Synthetic lost product response"); } return actual; });
    await expect(provider.createMerchantPhaseProduct!({ ...request, onProductAcknowledged })).rejects.toMatchObject({ code: "provider_failure" });
    expect(effects).toBe(1); expect(onProductAcknowledged).not.toHaveBeenCalled(); expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("recovers an actual known product with original-account GET only", async () => {
    const { provider, fetcher } = edge(() => actual);
    expect(await provider.inspectMerchantPhaseProduct!({ ...request, providerProductRef: "prod_original" })).toEqual({ providerProductRef: "prod_original" });
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
});
