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
