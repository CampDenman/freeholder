// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: exercise the real HTTP contract without placing vendor orders.
import { describe, expect, it, vi } from "vitest";
import { createPrintifyClient, PrintifyError, type PrintifyOrderInput } from "../../plugins/print-on-demand/printify";

const config = { token: "private-printify-token", shopId: "1234" };
const input: PrintifyOrderInput = {
  externalId: "freeholder:9c220fe8-6b8c-4aa5-9728-659d7e086cd9",
  productId: "product-123", variantId: 17887, quantity: 2,
  recipient: { firstName: "Rae", lastName: "Lane", email: "rae@example.test", country: "CA",
    street1: "10 Example Road", city: "Courtenay", postalCode: "V9N 1A1" },
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Printify HTTP adapter", () => {
  it("submits a mapped order with a durable external identity and bounded transport", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ id: "vendor-order" }));
    expect(await createPrintifyClient(config, fetcher).submit(input)).toEqual({ externalRef: "vendor-order" });
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.printify.com/v1/shops/1234/orders.json");
    expect(request).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: "Bearer private-printify-token", "User-Agent": "Freeholder" } });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request?.body as string)).toMatchObject({ external_id: input.externalId,
      line_items: [{ product_id: input.productId, variant_id: input.variantId, quantity: 2 }],
      shipping_method: 1, send_shipping_notification: false,
      address_to: { first_name: "Rae", last_name: "Lane", address1: "10 Example Road", country: "CA" },
    });
  });

  it("recovers the documented duplicate external-id response after an uncertain first request", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("socket closed after request"))
      .mockResolvedValueOnce(json({ code: 8503, order: { id: "original-order", external_id: input.externalId } }, 409));
    const client = createPrintifyClient(config, fetcher);
    await expect(client.submit(input)).rejects.toBeInstanceOf(PrintifyError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await client.submit(input)).toEqual({ externalRef: "original-order" });
    expect(fetcher.mock.calls[0]![1]?.body).toBe(fetcher.mock.calls[1]![1]?.body);
  });

  it("does not adopt another order from a conflict response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ code: 8503, order: { id: "other", external_id: "other-job" } }, 409));
    await expect(createPrintifyClient(config, fetcher).submit(input)).rejects.toThrow("could not be matched");
  });

  it("keeps credentials and customer data out of stored provider errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ message: `${config.token} ${input.recipient.email}` }, 422));
    await expect(createPrintifyClient(config, fetcher).submit(input)).rejects.toThrow("Printify refused the request (HTTP 422).");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("validates input before any provider request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createPrintifyClient({ ...config, shopId: "123/../../other" }, fetcher)).toThrow("Configure");
    await expect(createPrintifyClient(config, fetcher).submit({ ...input, quantity: 0 })).rejects.toThrow("complete delivery address");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects oversized or incomplete successful responses", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("x".repeat(1_048_577)))
      .mockResolvedValueOnce(json({ status: "ok" }));
    const client = createPrintifyClient(config, fetcher);
    await expect(client.submit(input)).rejects.toThrow("unreadable response");
    await expect(client.submit(input)).rejects.toThrow("did not return an order identifier");
  });

  it("reads shipment evidence only from the matching provider order", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: "vendor-order", status: "fulfilled",
      metadata: { shop_order_id: input.externalId }, shipments: [
        { carrier: "carrier", number: "tracking-1", url: "https://carrier.example/track/1", delivered_at: null },
        { carrier: "carrier", number: "tracking-2", url: "javascript:alert(1)" },
      ],
    })).mockResolvedValueOnce(json({ id: "vendor-order", status: "fulfilled", metadata: { shop_order_id: "other-job" } }));
    const client = createPrintifyClient(config, fetcher);
    expect(await client.getOrder("vendor-order", input.externalId)).toMatchObject({ status: "fulfilled", shipments: [
      { carrier: "carrier", number: "tracking-1", url: "https://carrier.example/track/1" },
      { carrier: "carrier", number: "tracking-2", url: null },
    ] });
    await expect(client.getOrder("vendor-order", input.externalId)).rejects.toThrow("does not match");
  });
});
