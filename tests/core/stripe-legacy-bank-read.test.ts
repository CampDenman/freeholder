// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual read facts do not invent historical create identity.
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";

function fixture(change: Record<string, unknown> = {}) {
  const paths: string[] = [], headers: Headers[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    paths.push(url.pathname); headers.push(new Headers(init.headers));
    expect(init.method).toBe("GET"); // No POST/create fallback for old rows.
    if (url.pathname === "/v1/account") {
      expect(new Headers(init.headers).get("stripe-account")).toBeNull();
      return Response.json({ id: "acct_currentAuthenticatedPlatform" });
    }
    expect(url.pathname).toBe("/v1/refunds/pyr_historical");
    expect(new Headers(init.headers).get("stripe-account")).toBe("acct_originalSeller");
    return Response.json({ id: "pyr_historical", payment_intent: "pi_historical", charge: "ch_historical", amount: 400, currency: "cad",
      status: "failed", failure_reason: "expired_or_canceled_card", failure_balance_transaction: "txn_currentReturned", ...change });
  });
  const adapter = createStripePayments({ secretKey: "sk_legacy_read_fixture_only", webhookSecrets: ["whsec_legacy_read_fixture_only"], fetch: fetcher });
  const read = adapter.inspectLegacyBankRefund?.bind(adapter);
  if (!read) throw Error("The actual Stripe factory must expose its read-only legacy inspection edge.");
  const observed = vi.fn(async () => {});
  const request = { originalRefundRef: "pyr_historical", originalPaymentRef: "pi_historical", amountMinor: 400, currency: "CAD",
    originalChargeAccountId: "acct_originalSeller", onRefundObserved: observed };
  return { read, request, observed, paths, headers };
}

describe("historical bank refund exact resource reader", () => {
  it("authenticates today's read while preserving unknown historical create protocol and platform", async () => {
    const { read, request, observed, paths, headers } = fixture();
    const result = await read(request);
    expect(result).toMatchObject({ requestedRefundRef: "pyr_historical", observedRefundRef: "pyr_historical", observedPaymentRef: "pi_historical",
      amountMinor: 400, currency: "CAD", rawProviderStatus: "failed", failureBalanceTransactionRef: "txn_currentReturned",
      readProtocolVersion: "2026-02-25.clover", readProviderPlatformAccountId: "acct_currentAuthenticatedPlatform",
      chargeAccountId: "acct_originalSeller", originalCreateProtocolVersion: null, originalCreatePlatformAccountId: null, originalBindingVerified: true });
    expect(observed).toHaveBeenCalledExactlyOnceWith(result);
    expect(paths.filter(path => path.startsWith("/v1/refunds"))).toEqual(["/v1/refunds/pyr_historical"]);
    expect(headers.every(header => header.get("stripe-version") === "2026-02-25.clover")).toBe(true);
  });
  it.each(["requires_action", "pending", "succeeded", "canceled", null, "unrecognized_bank_status"])
  ("retains actual nullable or unrecognized bank state before any terminal policy: %s", async status => {
    const { read, request, observed } = fixture({ status, failure_balance_transaction: null });
    const result = await read(request);
    expect(result.rawProviderStatus).toBe(status); expect(result.failureBalanceTransactionRef).toBeNull();
    expect(observed).toHaveBeenCalledExactlyOnceWith(result);
  });
  it.each([{ payment_intent: null }, { payment_intent: "pi_other" }, { id: "pyr_secondary" }, { amount: 401 }, { currency: "usd" }])
  ("retains a contradictory actual response without manufacturing original binding: %j", async change => {
    const { read, request, observed } = fixture(change);
    const result = await read(request);
    expect(result.originalBindingVerified).toBe(false); expect(observed).toHaveBeenCalledExactlyOnceWith(result);
  });
  it("rejects an unbound historical candidate before any platform or refund read", async () => {
    const { read, request, paths } = fixture();
    await expect(read({ ...request, originalRefundRef: "not_a_refund_resource" })).rejects.toBeDefined();
    expect(paths).toEqual([]);
  });
});

describe("historical cash inventory read authority", () => {
  function inventory(failSecondPage: boolean) {
    const order: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      expect(init.method).toBe("GET");
      if (url.pathname === "/v1/account") return Response.json({ id: "acct_currentAuthenticatedPlatform" });
      expect(new Headers(init.headers).get("stripe-account")).toBe("acct_originalSeller");
      if (url.pathname === "/v1/payment_intents/pi_historical") return Response.json({ id: "pi_historical", status: "succeeded", amount_received: 1000, currency: "cad", latest_charge: "ch_historical", amount_capturable: 0 });
      if (url.pathname === "/v1/charges/ch_historical") {
        expect(order).toEqual(["primary"]);
        return Response.json({ id: "ch_historical", payment_intent: "pi_historical", amount_captured: 1000, amount_refunded: failSecondPage ? 200 : 0,
          currency: "cad", paid: true, captured: true, refunded: false, application_fee: null, transfer: null });
      }
      if (url.pathname === "/v1/refunds") {
        if (url.searchParams.has("starting_after")) {
          expect(order).toEqual(["primary", "pyr_historical", "pyr_unassigned"]);
          throw Error("Synthetic later inventory page failure after all earlier callbacks.");
        }
        return Response.json({ has_more: failSecondPage, data: failSecondPage ? [
          { id: "pyr_historical", payment_intent: "pi_historical", charge: "ch_historical", amount: 400, currency: "cad", status: "failed" },
          { id: "pyr_unassigned", payment_intent: "pi_historical", charge: "ch_historical", amount: 200, currency: "cad", status: "succeeded" },
        ] : [] });
      }
      if (url.pathname === "/v1/disputes") return Response.json({ data: [], has_more: false });
      throw Error(`Unexpected historical cash read ${url.pathname}`);
    });
    const adapter = createStripePayments({ secretKey: "sk_legacy_inventory_fixture_only", webhookSecrets: ["whsec_legacy_inventory_fixture_only"], fetch: fetcher });
    const read = adapter.inspectLegacyBankCash?.bind(adapter);
    if (!read) throw Error("The actual factory must expose the primary-first read-only inventory edge.");
    return { read, order };
  }
  it("invokes primary and every known or unmatched refund callback before a later inventory page can fail", async () => {
    const { read, order } = inventory(true);
    await expect(read({ originalPaymentRef: "pi_historical", originalChargeAccountId: "acct_originalSeller",
      onPrimaryObserved: async fact => { expect(fact).toMatchObject({ originalCreateProtocolVersion: null, originalCreatePlatformAccountId: null,
        actual: { providerRef: "pi_historical", amountMinor: 1000, customerChargeVerified: false } }); order.push("primary"); },
      onRefundObserved: async fact => { expect(fact.actual.bindingVerified).toBe(false); order.push(fact.actual.providerRef); },
      onInventoryObserved: async () => {},
    })).rejects.toBeDefined();
    expect(order).toEqual(["primary", "pyr_historical", "pyr_unassigned"]);
  });
  it("returns observed namespace and complete inventory without claiming an original create platform or a returned-cash settlement", async () => {
    const { read, order } = inventory(false);
    const result = await read({ originalPaymentRef: "pi_historical", originalChargeAccountId: "acct_originalSeller",
      onPrimaryObserved: async () => { order.push("primary"); }, onRefundObserved: async () => {}, onInventoryObserved: async () => {}, });
    expect(result).toMatchObject({ readProviderPlatformAccountId: "acct_currentAuthenticatedPlatform", readProtocolVersion: "2026-02-25.clover",
      originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null,
      actual: { amountMinor: 1000, amountRefundedMinor: 0, refundsComplete: true, disputesComplete: true, refunds: [] } });
  });
});
