// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual factory/HMAC normalization, not a claim about durable DB application.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";

describe("signed original bank refund feedback", () => {
  it("preserves the full success/action/pending cycle and nullable raw facts in the original namespace", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      expect(url.pathname).toBe("/v1/account");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("stripe-account")).toBeNull();
      return Response.json({ id: "acct_originalPlatform" });
    });
    const secret = "whsec_bank_event_fixture";
    const adapter = createStripePayments({ secretKey: "sk_bank_event_fixture", webhookSecrets: [secret], fetch: fetcher });
    const now = Math.floor(Date.now() / 1000);
    const statuses = ["pending", "succeeded", "requires_action", "pending", "succeeded", "failed", "canceled", null] as const;
    for (const [index, status] of statuses.entries()) {
      const payload = { id: `evt_bank_${index}`, type: "refund.updated", created: now, account: "acct_originalSeller", api_version: "2026-10-28.endive",
        data: { object: { id: "pyr_bankOriginal", payment_intent: status === null ? null : "pi_original", charge: "ch_original",
          amount: 1000, currency: "cad", status, failure_reason: status === "failed" ? "expired_or_canceled_card" : null,
          failure_balance_transaction: status === "failed" ? "txn_bankReturned" : null } } };
      const body = Buffer.from(JSON.stringify(payload));
      const signature = createHmac("sha256", secret).update(`${now}.`).update(body).digest("hex");
      const [event] = await adapter.verifyWebhook({ body, headers: { "stripe-signature": `t=${now},v1=${signature}` }, receivedAt: new Date(now * 1000).toISOString() });
      expect(event).toMatchObject({ id: payload.id, providerRef: "pyr_bankOriginal", providerStatus: status,
        providerPlatformAccountId: "acct_originalPlatform", providerAccountId: "acct_originalSeller", observedProviderApiVersion: "2026-10-28.endive",
        observedPaymentIntentRef: status === null ? null : "pi_original", providerChargeRef: "ch_original", amountMinor: 1000, currency: "CAD" });
      expect(event && "failureBalanceTransactionRef" in event ? event.failureBalanceTransactionRef : undefined).toBe(status === "failed" ? "txn_bankReturned" : undefined);
      expect(event?.kind).toBe(status === "succeeded" ? "refund_succeeded" : status === "failed" || status === "canceled" ? "refund_failed" : "refund_processing");
    }
    expect(fetcher).toHaveBeenCalledTimes(statuses.length);
  });

  it("does not inspect a platform or normalize a bank event with an invalid signature", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createStripePayments({ secretKey: "sk_bank_event_fixture", webhookSecrets: ["whsec_bank_event_fixture"], fetch: fetcher });
    const now = Math.floor(Date.now() / 1000);
    await expect(adapter.verifyWebhook({ body: Buffer.from("{}"), headers: { "stripe-signature": `t=${now},v1=${"0".repeat(64)}` }, receivedAt: new Date(now * 1000).toISOString() }))
      .rejects.toMatchObject({ code: "authentication" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
