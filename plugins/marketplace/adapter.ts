// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Channel sync stays behind this plugin (MASTER.md §36, C3.13).
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

export interface MarketplaceProvider {
  connect(input: MarketplaceConnectInput): Promise<{ externalRef: string }>;
  listOrders(input: { provider: string; externalRef: string }): Promise<MarketplaceOrder[]>;
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
    return [
      {
        externalRef: `${input.externalRef}:order-1`,
        description: "Imported marketplace order",
        amountMinor: 2_500,
        currency: "USD",
        buyerEmail: "marketplace-buyer@demo.freeholder.test",
        buyerName: "Marketplace Buyer",
      },
    ];
  },
};

export function marketplaceProvider(): MarketplaceProvider {
  return fixtureMarketplaceProvider;
}
