// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: PREPARED/UNRUN actual factory, synthetic bounded transport.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import { merchantCashAuxiliaryBody } from "@/adapters/payments/stripe-cash-auxiliary";
import type { MerchantCashAuxiliaryRequest } from "@/adapters/payments/merchant-cash-auxiliary-types";
describe("actual original partial auxiliary generations", () => {
  it.each(["fee", "recipient"] as const)("recovers only the accepted unreadable second equal %s generation among the original resources", async kind => {
    const first = randomUUID(), second = randomUUID(), parentRef = kind === "fee" ? "fee_Actual" : "tr_Actual", rows: Array<Record<string, unknown>> = [];
    let returned = 0, posts = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init.headers);
      expect(headers.get("stripe-account")).toBeNull(); expect(headers.get("stripe-version")).toBe("2026-02-25.clover");
      if (url.pathname === "/v1/account") return Response.json({ id: "acct_Original" });
      if (url.pathname.endsWith(parentRef)) return Response.json({ id: parentRef, amount: 7, amount_refunded: returned, amount_reversed: returned, currency: "cad", account: "acct_Seller", destination: "acct_Seller", originating_transaction: "ch_Actual", source_transaction: "ch_Actual" });
      if (init.method === "POST") {
        const body = init.body instanceof URLSearchParams ? init.body : typeof init.body === "string" ? new URLSearchParams(init.body) : undefined;
        if(!body)throw new Error("The actual partial auxiliary POST must carry its original form body.");
        const operationId = body.get("metadata[freeholder_cash_auxiliary_id]");
        expect(init.body).toBe(merchantCashAuxiliaryBody(operationId!, 2)); posts++; returned += 2;
        const row = { id: `${kind === "fee" ? "fr" : "trr"}_Actual${posts}`, [kind === "fee" ? "fee" : "transfer"]: parentRef, amount: 2, currency: "cad", metadata: { freeholder_cash_auxiliary_id: operationId } }; rows.push(row);
        return posts === 2 ? new Response("{", { headers: { "content-type": "application/json" } }) : Response.json(row);
      }
      return Response.json({ data: rows, has_more: false });
    });
    const adapter = createStripePayments({ secretKey: "sk_fixture_only", fetch: fetcher }), facts: string[] = [];
    const request = (operationId: string, alreadyReturnedMinor: number): MerchantCashAuxiliaryRequest => ({ kind, operationId, targetFactId: randomUUID(), parentRef,
      providerPlatformAccountId: "acct_Original", providerApiVersion: "2026-02-25.clover", originalChargeRef: "ch_Actual", originalAccountId: "acct_Seller", originalAmountMinor: 7,
      alreadyReturnedMinor, amountMinor: 2, currency: "CAD", idempotencyKey: `original-partial:${operationId}`, frozenBody: merchantCashAuxiliaryBody(operationId, 2),
      onParentObserved: async () => {}, onResourceAcknowledged: async ref => { facts.push(ref); }, onResourceObserved: async resource => { expect(resource.bindingVerified).toBe(true); } });
    await adapter.createMerchantCashAuxiliary!(request(first, 0)); const originalSecond = request(second, 2);
    await expect(adapter.createMerchantCashAuxiliary!(originalSecond)).rejects.toThrow();
    const recovered = await adapter.recoverMerchantCashAuxiliary!(originalSecond);
    expect(recovered).toMatchObject({ providerRef: `${kind === "fee" ? "fr" : "trr"}_Actual2`, amountMinor: 2, bindingVerified: true });
    expect(posts).toBe(2); expect(returned).toBe(4); expect(new Set(facts).size).toBe(2);
  });
});
