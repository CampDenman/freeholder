// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: Shopify HTTP contract, identity and bounded failure behavior.
import { describe, expect, it, vi } from "vitest";
import { createShopifyProvider } from "../../plugins/marketplace/shopify";
const configuration = { shop: "example-store.myshopify.com", clientId: "client", clientSecret: "private-secret" };
const identity = { id: "gid://shopify/Shop/123", myshopifyDomain: configuration.shop };
const token = () => Response.json({ access_token: "private-token", expires_in: 86399, scope: "read_orders,read_customers" });
const connection = () => Response.json({ data: { shop: identity, currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "read_customers" }] } } });
const order = { id: "gid://shopify/Order/456", name: "#1001", email: "buyer@example.test", customer: { displayName: "Buyer Example" },
  displayFinancialStatus: "PAID", test: false, cancelledAt: null, currentTotalPriceSet: { shopMoney: { amount: "12.34", currencyCode: "CAD" } } };
function page(nodes: unknown[] = [order], hasNextPage = false, endCursor: string | null = null) {
 return Response.json({ data: { shop: identity, orders: { nodes, pageInfo: { hasNextPage, endCursor } } } });
}
const listing = { provider: "shopify", externalRef: identity.id };

describe("Shopify live provider", () => {
 it("exchanges credentials once, verifies the shop and pages paid orders", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(connection()).mockResolvedValueOnce(page([order], true, "next-page"));
  const provider = createShopifyProvider(configuration, fetcher);
  expect(await provider.connect({ name: "Store", provider: "shopify" })).toEqual({ externalRef: identity.id });
  const result = await provider.listOrders({ ...listing, cursor: "previous-page", limit: 100 });
  expect(result).toEqual({ orders: [{ externalRef: order.id, description: "Shopify #1001", amountMinor: 1234, currency: "CAD", buyerEmail: order.email, buyerName: "Buyer Example" }], nextCursor: "next-page" });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[0]![0]).toBe("https://example-store.myshopify.com/admin/oauth/access_token");
  const form = new URLSearchParams(fetcher.mock.calls[0]![1]!.body as string);
  expect(form.get("grant_type")).toBe("client_credentials");
  expect(form.get("client_secret")).toBe(configuration.clientSecret);
  const request = fetcher.mock.calls[2]![1]!;
  expect(request).toMatchObject({ redirect: "error", headers: { "X-Shopify-Access-Token": "private-token" } });
  expect(request.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(request.body as string)).toMatchObject({ variables: { first: 50, after: "previous-page" } });
 });

 it("renews an expiring token and shares concurrent renewal", async () => {
  let now = 1000;
  const fetcher = vi.fn<typeof fetch>(async url => (url as string).endsWith("access_token") ? token() : connection());
  const provider = createShopifyProvider(configuration, fetcher, () => now);
  await Promise.all([provider.connect({ name: "One", provider: "shopify" }), provider.connect({ name: "Two", provider: "shopify" })]);
  expect(fetcher.mock.calls.filter(([url]) => (url as string).endsWith("access_token"))).toHaveLength(1);
  now += 86_400_000;
  await provider.connect({ name: "Renew", provider: "shopify" });
  expect(fetcher.mock.calls.filter(([url]) => (url as string).endsWith("access_token"))).toHaveLength(2);
 });

 it("refuses credential destinations outside the configured Shopify host", () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const shop of ["https://example-store.myshopify.com", "evil.test", "example-store.myshopify.com.evil.test", "user@example-store.myshopify.com", "example-store.myshopify.com/path"]) {
   expect(() => createShopifyProvider({ ...configuration, shop }, fetcher)).toThrow("Configure");
  }
  expect(fetcher).not.toHaveBeenCalled();
 });

 it("refuses another shop's order page", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(page());
  await expect(createShopifyProvider(configuration, fetcher).listOrders({ ...listing, externalRef: "gid://shopify/Shop/999" })).rejects.toThrow("different Shopify shop");
 });

 it("refuses partial GraphQL success without leaking provider error bodies", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json({ data: { shop: identity }, errors: [{ message: "private-secret buyer@example.test" }] }));
  await expect(createShopifyProvider(configuration, fetcher).listOrders(listing)).rejects.toThrow("could not return complete order data");
 });

 it("does not invent email addresses or turn unpaid/test/cancelled orders into imports", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(page([{ ...order, test: true }, { ...order, displayFinancialStatus: "PENDING" }, { ...order, cancelledAt: "2026-01-01" }])).mockResolvedValueOnce(page([{ ...order, email: null }]));
  const provider = createShopifyProvider(configuration, fetcher);
  expect((await provider.listOrders(listing)).orders).toEqual([]);
  await expect(provider.listOrders(listing)).rejects.toThrow("no accessible customer email");
 });

 it("handles zero- and three-decimal currencies without floating-point rounding", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(page([
   { ...order, currentTotalPriceSet: { shopMoney: { amount: "123.00", currencyCode: "JPY" } } },
   { ...order, id: "gid://shopify/Order/789", currentTotalPriceSet: { shopMoney: { amount: "12.3450", currencyCode: "KWD" } } },
  ]));
  expect((await createShopifyProvider(configuration, fetcher).listOrders(listing)).orders.map(row => row.amountMinor)).toEqual([123, 12345]);
 });

 it("pages refunded orders with their refund amounts", async () => {
  const refundPage = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) =>
   Response.json({ data: { shop: identity, orders: { nodes, pageInfo: { hasNextPage, endCursor } } } });
  const refunded = { id: "gid://shopify/Order/500", name: "#1002", refunds: { nodes: [
    { id: "gid://shopify/Refund/901", createdAt: "2026-09-15T00:00:00Z", totalRefundedSet: { shopMoney: { amount: "123.00", currencyCode: "JPY" } } },
    { id: "gid://shopify/Refund/902", createdAt: "2026-09-15T01:00:00Z", totalRefundedSet: { shopMoney: { amount: "12.3450", currencyCode: "KWD" } } },
  ], pageInfo: { hasNextPage: false } } };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(refundPage([refunded], true, "refund-page"));
  const result = await createShopifyProvider(configuration, fetcher).listRefunds({ ...listing, cursor: "previous-refund-page", limit: 10 });
  expect(result).toEqual({ refunds: [
    { externalRef: "gid://shopify/Refund/901", orderExternalRef: refunded.id, amountMinor: 123, currency: "JPY" },
    { externalRef: "gid://shopify/Refund/902", orderExternalRef: refunded.id, amountMinor: 12345, currency: "KWD" },
  ], nextCursor: "refund-page" });
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toMatchObject({ variables: { first: 10, after: "previous-refund-page" } });
 });

 it("refuses another shop's refund page, repeated cursors and truncated refund lists", async () => {
  const refundPage = (nodes: unknown[], pageInfo: { hasNextPage: boolean; endCursor: string | null } = { hasNextPage: false, endCursor: null }, shopOverride = identity) =>
   Response.json({ data: { shop: shopOverride, orders: { nodes, pageInfo } } });
  const refunded = { id: "gid://shopify/Order/500", name: "#1002", refunds: { nodes: [], pageInfo: { hasNextPage: false } } };
  await expect(createShopifyProvider(configuration, vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(
   refundPage([refunded], { hasNextPage: true, endCursor: "same" }, { ...identity, id: "gid://shopify/Shop/999" })),
  ).listRefunds({ ...listing, cursor: "same" })).rejects.toThrow("different Shopify shop");
  const repeated = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(refundPage([refunded], { hasNextPage: true, endCursor: "same" }));
  await expect(createShopifyProvider(configuration, repeated).listRefunds({ ...listing, cursor: "same" })).rejects.toThrow("invalid pagination cursor");
  const truncated = { ...refunded, refunds: { nodes: [{ id: "gid://shopify/Refund/901", createdAt: "2026-09-15T00:00:00Z",
    totalRefundedSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } } }], pageInfo: { hasNextPage: true } } };
  const tooMany = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(refundPage([truncated]));
  await expect(createShopifyProvider(configuration, tooMany).listRefunds(listing)).rejects.toThrow("more refunds than one bounded page");
  const malformed = { ...refunded, refunds: { nodes: [{ id: "gid://shopify/Refund/not-a-number", createdAt: "2026-09-15T00:00:00Z",
    totalRefundedSet: { shopMoney: { amount: "1.00", currencyCode: "USD" } } }], pageInfo: { hasNextPage: false } } };
  const badShape = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(refundPage([malformed]));
  await expect(createShopifyProvider(configuration, badShape).listRefunds(listing)).rejects.toThrow("incomplete refund data");
 });

 it("refuses a repeated page cursor and incomplete permission grants", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(token()).mockResolvedValueOnce(page([order], true, "same"));
  await expect(createShopifyProvider(configuration, fetcher).listOrders({ ...listing, cursor: "same" })).rejects.toThrow("invalid pagination cursor");
  const denied = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: "token", expires_in: 86399, scope: "read_products" }));
  await expect(createShopifyProvider(configuration, denied).connect({ provider: "shopify", name: "Denied" })).rejects.toThrow("must grant read_orders");
  expect(denied).toHaveBeenCalledTimes(1);
 });
});
