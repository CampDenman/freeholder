// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual adapter factory with intercepted bounded provider transport.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import { merchantCashAuxiliaryBody } from "@/adapters/payments/stripe-cash-auxiliary";
import type { MerchantCashAuxiliaryRequest } from "@/adapters/payments/merchant-cash-auxiliary-types";
function fixture(kind: "fee" | "recipient") {
  const operationId = randomUUID(), seen: string[] = [], facts: unknown[] = [], parentRef = kind === "fee" ? "fee_Actual" : "tr_Actual";
  let unreadable = false, wrongMoney = false, resources = 0, absent = false;
  const row = () => ({ id: kind === "fee" ? "fr_Actual" : "trr_Actual", [kind === "fee" ? "fee" : "transfer"]: parentRef,
    amount: wrongMoney ? 74 : 73, currency: "cad", metadata: { freeholder_cash_auxiliary_id: operationId } });
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    seen.push(`${init.method} ${url.pathname}`);
    const headers = new Headers(init.headers); expect(headers.get("stripe-account")).toBeNull(); expect(headers.get("stripe-version")).toBe("2026-10-28.endive");
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_OriginalPlatform" });
    if (url.pathname.endsWith(parentRef)) return Response.json({ id: parentRef, amount: 100, currency: "cad", amount_refunded: resources ? 100 : 27, amount_reversed: resources ? 100 : 27,
      account: "acct_OriginalSeller", destination: "acct_OriginalSeller", charge: "ch_Actual", originating_transaction: "ch_Actual", source_transaction: "ch_Actual" });
    if (init.method === "POST") { expect(init.body).toBe(merchantCashAuxiliaryBody(operationId, 73)); resources++; if (unreadable) return new Response("{", { headers: { "content-type": "application/json" } }); return Response.json(row()); }
    if (url.pathname.endsWith("fr_Actual") || url.pathname.endsWith("trr_Actual")) return Response.json(row());
    return Response.json({ data: absent ? [] : [row()], has_more: false });
  });
  const adapter = createStripePayments({ secretKey: "sk_fixture_only", fetch: fetcher });
  const request: MerchantCashAuxiliaryRequest = { kind, operationId, parentRef, providerPlatformAccountId: "acct_OriginalPlatform", providerApiVersion: "2026-10-28.endive",
    originalChargeRef: "ch_Actual", originalAccountId: "acct_OriginalSeller", originalAmountMinor: 100, alreadyReturnedMinor: 27, amountMinor: 73, currency: "CAD",
    idempotencyKey: `original-cash-auxiliary:${operationId}`, frozenBody: merchantCashAuxiliaryBody(operationId, 73),
    onParentObserved: async value => { facts.push({ parent: value }); }, onResourceAcknowledged: async ref => { facts.push({ ack: ref }); }, onResourceObserved: async value => { facts.push({ resource: value }); } };
  return { adapter, request, seen, facts, unreadable: () => { unreadable = true; }, wrongMoney: () => { wrongMoney = true; }, absent: () => { absent = true; }, posts: () => resources };
}
describe("original fee and recipient return transport", () => {
  it.each(["fee", "recipient"] as const)("uses only the original platform/version and exact frozen %s resource, retaining ACK before money", async kind => {
    const f = fixture(kind); await f.adapter.createMerchantCashAuxiliary!(f.request); expect(f.posts()).toBe(1);
    expect(f.facts[1]).toEqual({ ack: kind === "fee" ? "fr_Actual" : "trr_Actual" }); expect(f.facts[2]).toMatchObject({ resource: { amountMinor: 73, bindingVerified: true } });
    expect(f.seen.some(path => path === `POST /v1/${kind === "fee" ? "application_fees/fee_Actual/refunds" : "transfers/tr_Actual/reversals"}`)).toBe(true);
  });
  it.each(["fee", "recipient"] as const)("recovers a genuinely unreadable accepted %s response by GET without another POST", async kind => {
    const f = fixture(kind); f.unreadable(); await expect(f.adapter.createMerchantCashAuxiliary!(f.request)).rejects.toThrow();
    expect((await f.adapter.recoverMerchantCashAuxiliary!(f.request))?.bindingVerified).toBe(true); expect(f.posts()).toBe(1);
  });
  it.each(["fee", "recipient"] as const)("retains a %s ACK and contradictory actual money before rejecting policy", async kind => {
    const f = fixture(kind); f.wrongMoney(); await expect(f.adapter.createMerchantCashAuxiliary!(f.request)).rejects.toThrow();
    expect(f.facts[1]).toHaveProperty("ack"); expect(f.facts[2]).toMatchObject({ resource: { amountMinor: 74, bindingVerified: false } });
  });
  it("does not turn an empty recovery inventory into another provider creation", async () => {
    const f = fixture("recipient"); f.absent(); expect(await f.adapter.recoverMerchantCashAuxiliary!(f.request)).toBeNull(); expect(f.posts()).toBe(0);
  });
});
