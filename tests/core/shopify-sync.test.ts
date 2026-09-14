// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: real Shopify client composed with leased imports and the invoice spine.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { invoices } from "@/modules/invoicing/schema";
import * as adapter from "../../plugins/marketplace/adapter";
import { createShopifyProvider } from "../../plugins/marketplace/shopify";
import { connectMarketplaceChannel, syncMarketplaceChannel, listMarketplaceOrders } from "../../plugins/marketplace/service";
import { marketplaceChannels } from "../../plugins/marketplace/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
const SYSTEM = { kind: "system" } as const;
const shop = { id: "gid://shopify/Shop/123", myshopifyDomain: "test-shop.myshopify.com" };
const order = { id: "gid://shopify/Order/456", name: "#1001", email: "shop-buyer@example.test", customer: { displayName: "Shop Buyer" },
 displayFinancialStatus: "PAID", test: false, cancelledAt: null, currentTotalPriceSet: { shopMoney: { amount: "12.34", currencyCode: "CAD" } } };

describe.runIf(hasDatabase)("Shopify channel integration", { timeout: 30_000 }, () => {
 beforeEach(async () => { await ready(); await truncateSpine(); });
 afterEach(() => vi.restoreAllMocks());
 afterAll(closeDb);
 it("verifies a shop and imports its paid order once onto the contact and draft invoice spine", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
   if ((url as string).endsWith("access_token")) return Response.json({ access_token: "test-token", expires_in: 86399, scope: "read_orders,read_customers" });
   const body = JSON.parse(init!.body as string) as { query: string };
   return body.query.includes("FreeholderShop")
    ? Response.json({ data: { shop, currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "read_customers" }] } } })
    : Response.json({ data: { shop, orders: { nodes: [order], pageInfo: { hasNextPage: false, endCursor: null } } } });
  });
  vi.spyOn(adapter, "marketplaceProvider").mockReturnValue(createShopifyProvider({ shop: shop.myshopifyDomain, clientId: "client", clientSecret: "secret" }, fetcher));
  const channel = await connectMarketplaceChannel.call({ name: "My Shopify", provider: "shopify" }, OWNER);
  expect(channel.status).toBe("connected");
  expect(channel.externalRef).toBe(shop.id);
  expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER)).toEqual({ imported: 1, lastError: null });
  expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER)).toEqual({ imported: 0, lastError: null });
  const imported = await listMarketplaceOrders.call({ channelId: channel.id }, OWNER);
  expect(imported).toHaveLength(1);
  const [contact] = await db().select().from(contacts).where(eq(contacts.id, imported[0]!.contactId));
  expect(contact!.email).toBe(order.email);
  const [invoice] = await db().select().from(invoices).where(eq(invoices.id, imported[0]!.invoiceId));
  expect(invoice!.status).toBe("draft");
  expect(invoice!.totalMinor).toBe(1234);
  expect(fetcher.mock.calls.filter(([url]) => (url as string).endsWith("access_token"))).toHaveLength(1);
 });

 it("fences expired connection handshakes and refuses a competing retry", async () => {
  const claim = getService("marketplace.claimConnect");
  const first = await claim.call({ name: "Connect", provider: "shopify" }, SYSTEM) as { channelId: string; leaseToken: string };
  await expect(claim.call({ name: "Concurrent", provider: "shopify", channelId: first.channelId }, SYSTEM)).rejects.toMatchObject({ code: "conflict" });
  await db().update(marketplaceChannels).set({ syncLeaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(marketplaceChannels.id, first.channelId));
  const second = await claim.call({ name: "Recovered", provider: "shopify", channelId: first.channelId }, SYSTEM) as { channelId: string; leaseToken: string };
  expect(second.leaseToken).not.toBe(first.leaseToken);
  await expect(getService("marketplace.applyConnect").call({ ...first, externalRef: "stale" }, SYSTEM)).rejects.toMatchObject({ code: "conflict" });
  await getService("marketplace.applyConnect").call({ ...second, externalRef: shop.id }, SYSTEM);
  const [saved] = await db().select().from(marketplaceChannels).where(eq(marketplaceChannels.id, first.channelId));
  expect(saved!.externalRef).toBe(shop.id);
  expect(saved!.syncLeaseToken).toBeNull();
 });
});
