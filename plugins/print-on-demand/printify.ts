// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: Printify's documented external-id conflict response makes retries
// recover the original order. Contract: https://developers.printify.com/openapi.json
import { z } from "zod";
import { readBoundedBytes } from "@/core/http/body";

const identifier = z.string().min(1).max(200);
const recipient = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().max(200),
  email: z.email(),
  phone: z.string().trim().max(80).default(""),
  country: z.string().regex(/^[A-Z]{2}$/),
  region: z.string().trim().max(100).default(""),
  street1: z.string().trim().min(1).max(300),
  street2: z.string().trim().max(300).default(""),
  city: z.string().trim().min(1).max(200),
  postalCode: z.string().trim().min(1).max(30),
});
export const printifyOrderInput = z.object({
  externalId: identifier,
  productId: identifier,
  variantId: z.number().int().positive(),
  quantity: z.number().int().positive().max(10_000),
  shippingMethod: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
  recipient,
});
export type PrintifyOrderInput = z.input<typeof printifyOrderInput>;

const shipment = z.object({
  carrier: z.string().min(1).max(80),
  number: z.string().min(1).max(120),
  url: z.string().max(500).nullish(),
  delivered_at: z.string().max(80).nullish(),
});
const order = z.object({
  id: identifier,
  status: z.string().min(1).max(80),
  metadata: z.object({ shop_order_id: z.union([z.string(), z.number()]) }),
  shipments: z.array(shipment).max(100).default([]),
});
export interface PrintifyOrderStatus {
  externalRef: string;
  status: string;
  shipments: Array<{ carrier: string; number: string; url: string | null; deliveredAt: string | null }>;
}

export class PrintifyError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "PrintifyError";
  }
}

function safeTrackingUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function createPrintifyClient(config: { token: string; shopId: string }, fetcher: typeof fetch = fetch) {
  const token = config.token.trim();
  if (!token || /[\r\n]/.test(token) || !/^[1-9][0-9]*$/.test(config.shopId)) {
    throw new PrintifyError("Configure a Printify API token and shop ID before submitting print orders.");
  }
  const base = `https://api.printify.com/v1/shops/${config.shopId}`;

  async function request(path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "Freeholder", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error", signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PrintifyError("Printify could not be reached. Retrying keeps the same order identity.", true);
    }
    if (!response.ok && response.status !== 409) {
      // Provider bodies may contain addresses or reflected credentials. Keep
      // them out of stored job errors and API responses.
      await response.body?.cancel().catch(() => undefined);
      throw new PrintifyError(`Printify refused the request (HTTP ${response.status}).`, response.status === 429 || response.status >= 500);
    }
    try {
      const bytes = await readBoundedBytes(response, 1_048_576);
      return { status: response.status, body: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
    } catch {
      throw new PrintifyError("Printify returned an unreadable response. Retrying keeps the same order identity.", true);
    }
  }

  return {
    async submit(input: PrintifyOrderInput): Promise<{ externalRef: string }> {
      const parsed = printifyOrderInput.safeParse(input);
      if (!parsed.success) throw new PrintifyError("The print order needs a valid product, variant, quantity and complete delivery address.");
      const item = parsed.data;
      const address = item.recipient;
      const result = await request("/orders.json", {
        external_id: item.externalId,
        label: item.externalId,
        line_items: [{ product_id: item.productId, variant_id: item.variantId, quantity: item.quantity, external_id: item.externalId }],
        shipping_method: item.shippingMethod,
        send_shipping_notification: false,
        address_to: { first_name: address.firstName, last_name: address.lastName, email: address.email,
          phone: address.phone, country: address.country, region: address.region,
          address1: address.street1, address2: address.street2, city: address.city, zip: address.postalCode },
      });
      if (result.status === 409) {
        const conflict = z.object({ code: z.literal(8503), order: z.object({ id: identifier, external_id: identifier }) }).safeParse(result.body);
        if (conflict.success && conflict.data.order.external_id === item.externalId) {
          return { externalRef: conflict.data.order.id };
        }
        throw new PrintifyError("Printify reported an order conflict that could not be matched to this print job.");
      }
      const created = z.object({ id: identifier }).safeParse(result.body);
      if (!created.success) throw new PrintifyError("Printify did not return an order identifier. Retry this same print job.", true);
      return { externalRef: created.data.id };
    },

    async getOrder(externalRef: string, externalId: string): Promise<PrintifyOrderStatus> {
      if (!identifier.safeParse(externalRef).success || !identifier.safeParse(externalId).success) {
        throw new PrintifyError("This print job has no valid provider order identity.");
      }
      const response = await request(`/orders/${encodeURIComponent(externalRef)}.json`);
      const parsed = order.safeParse(response.body);
      if (!parsed.success || parsed.data.id !== externalRef || String(parsed.data.metadata.shop_order_id) !== externalId) {
        throw new PrintifyError("The Printify order does not match this print job.");
      }
      return { externalRef, status: parsed.data.status, shipments: parsed.data.shipments.map((entry) => ({
        carrier: entry.carrier, number: entry.number, url: safeTrackingUrl(entry.url), deliveredAt: entry.delivered_at ?? null,
      })) };
    },
  };
}
