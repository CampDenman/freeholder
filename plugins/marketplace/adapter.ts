// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Channel sync stays behind this plugin (MASTER.md §36, C3.13).
// The fixture never sees credentials; a real Shopify/Etsy/Amazon/eBay adapter
// replaces this module without changing the channel record or admin screen.
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

export interface MarketplaceProvider {
  connect(input: MarketplaceConnectInput): Promise<{ externalRef: string }>;
  listOrders(input: {
    provider: string;
    externalRef: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<MarketplaceOrderPage>;
}

/**
 * Fixture pages one order at a time so a two-order sync has to walk `nextCursor`.
 * Tests insert the list; nothing is hardcoded here.
 */
const FIXTURE_PAGE_SIZE = 1;

const stagedByProvider = new Map<string, MarketplaceOrder[]>();

export function stageMarketplaceOrders(provider: string, orders: MarketplaceOrder[]): void {
  const current = stagedByProvider.get(provider) ?? [];
  stagedByProvider.set(provider, [...current, ...orders]);
}

export function resetStagedMarketplaceOrders(): void {
  stagedByProvider.clear();
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
    if (input.externalRef.startsWith("fail-")) {
      throw new Error("The marketplace could not list orders.");
    }
    const staged = stagedByProvider.get(input.provider) ?? [];
    const start = pageStart(input.cursor);
    const size = Math.min(Math.max(input.limit ?? FIXTURE_PAGE_SIZE, 1), FIXTURE_PAGE_SIZE);
    const orders = staged.slice(start, start + size);
    const next = start + orders.length;
    return {
      orders,
      nextCursor: next < staged.length ? String(next) : null,
    };
  },
};

export function marketplaceProvider(): MarketplaceProvider {
  return fixtureMarketplaceProvider;
}
