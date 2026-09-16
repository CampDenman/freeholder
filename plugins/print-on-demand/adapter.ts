// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Printify-style fulfillment stays behind this plugin (MASTER.md §36, C3.13).
import { z } from "zod";
import { env } from "@/core/env";
import { createPrintifyClient, PrintifyError, type PrintifyOrderStatus } from "./printify";

export interface PodSubmitInput {
  /** Immutable identity chosen from the canonical order line or manual job. */
  externalId: string;
  accountId: string | null;
  sku: string;
  provider: string;
  payload: Record<string, unknown>;
}

export interface PodSubmitResult {
  externalRef: string;
}

export interface PodProvider {
  submit(input: PodSubmitInput): Promise<PodSubmitResult>;
  getOrder(input: { provider: string; externalRef: string; externalId: string; accountId: string | null }): Promise<PrintifyOrderStatus>;
}

/** Fixture provider: succeeds unless the catalog SKU asks it to fail. */
export const fixturePodProvider: PodProvider = {
  async getOrder(input) {
    return { externalRef: input.externalRef, status: "in-production", shipments: [] };
  },
  async submit(input) {
    if (input.sku.startsWith("fail-")) {
      throw new Error("The print provider refused that SKU.");
    }
    const product =
      typeof input.payload.providerProductId === "string" && input.payload.providerProductId
        ? input.payload.providerProductId
        : input.sku;
    return { externalRef: `pod:${input.provider}:${product}` };
  },
};

export function podProvider(): PodProvider {
  // C3.13/C11.15: fixtures are executable test doubles, never proof that a
  // vendor accepted a job, opened a call, or connected an account.
  if (process.env.NODE_ENV === "test") return fixturePodProvider;
  const configuration = env();
  if (!configuration.PRINTIFY_API_TOKEN || !configuration.PRINTIFY_SHOP_ID) {
    throw new Error("No live print provider is configured. Set the Printify API token and shop ID.");
  }
  return createPrintifyPodProvider({ token: configuration.PRINTIFY_API_TOKEN, shopId: configuration.PRINTIFY_SHOP_ID });
}

export function createPrintifyPodProvider(configuration: { token: string; shopId: string }, fetcher: typeof fetch = fetch): PodProvider {
  const client = createPrintifyClient(configuration, fetcher);
  function sameAccount(input: { provider: string; accountId: string | null }) {
    if (input.provider !== "printify") throw new PrintifyError("This instance's live print provider is Printify.");
    if (input.accountId && input.accountId !== configuration.shopId) {
      throw new PrintifyError("This print job belongs to a different Printify shop. Restore that shop configuration before retrying.");
    }
  }
  return {
    async getOrder(input) {
      sameAccount(input);
      return client.getOrder(input.externalRef, input.externalId);
    },
    async submit(input) {
      sameAccount(input);
      const payload = z.object({ providerProductId: z.string().min(1), providerVariantId: z.number().int().positive(),
        quantity: z.number().int().positive(), buyerEmail: z.email(), buyerName: z.string().min(1),
        shippingAddress: z.object({ name: z.string().optional(), street1: z.string().min(1), street2: z.string().optional(), city: z.string().min(1),
          region: z.string().optional(), postalCode: z.string().min(1), country: z.string().regex(/^[A-Z]{2}$/) }),
      }).safeParse(input.payload);
      if (!payload.success) throw new PrintifyError("Map a Printify product and variant, and supply a complete customer delivery address.");
      const data = payload.data;
      const address = data.shippingAddress;
      const names = (address.name || data.buyerName).trim().split(/\s+/);
      return client.submit({ externalId: input.externalId, productId: data.providerProductId,
        variantId: data.providerVariantId, quantity: data.quantity,
        recipient: { firstName: names[0]!, lastName: names.slice(1).join(" "), email: data.buyerEmail,
          country: address.country, region: address.region, street1: address.street1, street2: address.street2,
          city: address.city, postalCode: address.postalCode },
      });
    },
  };
}
