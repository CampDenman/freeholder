// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Channel sync stays behind this plugin (MASTER.md §36, C3.13).
// The fixture never sees credentials; a real Shopify/Etsy/Amazon/eBay adapter
// replaces this module without changing the channel record or admin screen.
import { env } from "@/core/env";
import { createShopifyProvider, type ShopifyConfiguration } from "./shopify";

export interface MarketplaceConnectInput {
  name: string;
  provider: string;
}

export interface MarketplaceOrder {
  externalRef: string;
  description: string;
  amountMinor: number;
  currency: string;
  buyerEmail: string;
  buyerName: string;
}

export interface MarketplaceOrderPage {
  orders: MarketplaceOrder[];
  nextCursor: string | null;
}

export interface MarketplaceRefund {
  externalRef: string;
  orderExternalRef: string;
  amountMinor: number;
  currency: string;
}

export interface MarketplaceRefundPage {
  refunds: MarketplaceRefund[];
  nextCursor: string | null;
}

export interface MarketplaceProvider {
  connect(input: MarketplaceConnectInput): Promise<{ externalRef: string }>;
  listOrders(input: {
    provider: string;
    externalRef: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<MarketplaceOrderPage>;
  listRefunds(input: {
    provider: string;
    externalRef: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<MarketplaceRefundPage>;
}

/**
 * Fixture pages one order at a time so a two-order sync has to walk `nextCursor`.
 * Tests insert the list; nothing is hardcoded here.
 */
export const FIXTURE_PAGE_SIZE = 1;

const stagedByProvider = new Map<string, MarketplaceOrder[]>();
const stagedRefundsByProvider = new Map<string, MarketplaceRefund[]>();
let listCalls = 0;
let failAfterPages: number | null = null;

export function stageMarketplaceOrders(provider: string, orders: MarketplaceOrder[]): void {
  const current = stagedByProvider.get(provider) ?? [];
  stagedByProvider.set(provider, [...current, ...orders]);
}

export function stageMarketplaceRefunds(provider: string, refunds: MarketplaceRefund[]): void {
  const current = stagedRefundsByProvider.get(provider) ?? [];
  stagedRefundsByProvider.set(provider, [...current, ...refunds]);
}

export function marketplaceListOrderCalls(): number {
  return listCalls;
}

/** Throw on the next list after this many successful pages. `null` clears it. */
export function failMarketplaceListAfterPages(count: number | null): void {
  failAfterPages = count;
}

export function resetStagedMarketplaceOrders(): void {
  stagedByProvider.clear();
  stagedRefundsByProvider.clear();
  listCalls = 0;
  failAfterPages = null;
}

function pageStart(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Fixture provider: connect fails when the channel name asks it to. */
export const fixtureMarketplaceProvider: MarketplaceProvider = {
  async connect(input) {
    if (input.name.startsWith("fail-")) {
      throw new Error("The marketplace refused that connection.");
    }
    return { externalRef: `mkt:${input.provider}` };
  },
  async listOrders(input) {
    const staged = stagedByProvider.get(input.provider) ?? [];
    if (
      input.externalRef.startsWith("fail-") ||
      staged.some((order) => order.externalRef.startsWith("fail-"))
    ) {
      throw new Error("The marketplace could not list orders.");
    }
    if (failAfterPages != null && listCalls >= failAfterPages) {
      throw new Error("The marketplace could not list orders.");
    }
    listCalls += 1;
    const start = pageStart(input.cursor);
    const size = Math.min(Math.max(input.limit ?? FIXTURE_PAGE_SIZE, 1), FIXTURE_PAGE_SIZE);
    const orders = staged.slice(start, start + size);
    const next = start + orders.length;
    return {
      orders,
      nextCursor: next < staged.length ? String(next) : null,
    };
  },
  async listRefunds(input) {
    const staged = stagedRefundsByProvider.get(input.provider) ?? [];
    if (
      input.externalRef.startsWith("fail-") ||
      staged.some((refund) => refund.orderExternalRef.startsWith("fail-"))
    ) {
      throw new Error("The marketplace could not list refunds.");
    }
    const start = pageStart(input.cursor);
    const size = Math.min(Math.max(input.limit ?? FIXTURE_PAGE_SIZE, 1), FIXTURE_PAGE_SIZE);
    const refunds = staged.slice(start, start + size);
    const next = start + refunds.length;
    return {
      refunds,
      nextCursor: next < staged.length ? String(next) : null,
    };
  },
};

let live: { configuration: ShopifyConfiguration; provider: MarketplaceProvider } | undefined;
export function marketplaceProvider(): MarketplaceProvider {
  if (process.env.NODE_ENV === "test") return fixtureMarketplaceProvider;
  const settings = env();
  if (!settings.SHOPIFY_SHOP || !settings.SHOPIFY_CLIENT_ID || !settings.SHOPIFY_CLIENT_SECRET) {
    throw new Error("No live marketplace provider is configured. Set the Shopify shop, client ID and client secret.");
  }
  const configuration = { shop: settings.SHOPIFY_SHOP, clientId: settings.SHOPIFY_CLIENT_ID, clientSecret: settings.SHOPIFY_CLIENT_SECRET };
  if (!live || Object.entries(configuration).some(([key, value]) => live!.configuration[key as keyof ShopifyConfiguration] !== value)) {
    live = { configuration, provider: createShopifyProvider(configuration) };
  }
  return live.provider;
}
