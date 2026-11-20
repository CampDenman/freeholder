// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Dedicated actual BEFORE-history clone. Never seeds, truncates or edits money.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as paymentAdapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { merchantFeeSource, reconcileMerchantApplicationFee } from "@/modules/invoicing/merchant-fee-service";
import { merchantPaymentRecoveryDebt } from "@/modules/invoicing/merchant-payment-debt";
import { merchantFeeRefunds } from "@/modules/invoicing/merchant-collection-schema";
import { closeDb, hasDatabase, OWNER } from "../helpers/spine";
const system = { kind: "system" } as const;
const tables = ["payments", "refunds", "merchant_fee_refunds", "merchant_fee_observations", "credit_notes", "credit_note_lines", "invoice_merchant_allocations", "invoice_merchant_allocation_lines"];
async function originalMoney(): Promise<Array<{ table: string; count: number; sha256: string }>> {
  const proof: Array<{ table: string; count: number; sha256: string }> = [];
  for (const table of tables) {
    const [row] = await db().execute<{ count: number; sha256: string }>(sql.raw(`select count(*)::int as count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') as sha256 from "${table}" t`));
    if (!row) throw Error("The actual original money proof is missing.");
    proof.push({ table, count: row.count, sha256: row.sha256 });
  }
  return proof;
}

describe.runIf(hasDatabase && process.env.TEST_UNREADABLE_FEE_HISTORY === "1")("actual populated unreadable-success fee history80", () => {
  beforeAll(ready, 60000); afterEach(() => vi.restoreAllMocks()); afterAll(closeDb);
  it("retains the genuine two-resource history and reports actual returned200 without a replacement POST", async () => {
    expect(process.env.TEST_DATABASE_URL).toContain("fee_unreadable80_populated_before_v9");
    const operations = await db().select().from(merchantFeeRefunds).orderBy(merchantFeeRefunds.attemptNumber);
    expect(operations).toHaveLength(2);
    const original = operations[0]!, known = operations[1]!;
    expect(original).toMatchObject({ status: "refused", amountMinor: 100, observedOriginalFeeMinor: 500, providerRef: null, attemptNumber: 1 });
    expect(known).toMatchObject({ status: "accepted", amountMinor: 100, providerRef: "fr_feeRace2", attemptNumber: 2, paymentId: original.paymentId });
    const before = await originalMoney(), source = await merchantFeeSource.call({ paymentId: original.paymentId }, system);
    let posts = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input).pathname;
      if (init?.method === "POST") { posts++; throw Error("Historical extra money cannot authorize another physical fee effect."); }
      if (path === "/v1/account") return Response.json({ id: source.routing.providerPlatformAccountId });
      if (path === `/v1/payment_intents/${source.payment.providerRef}`) return Response.json({ id: source.payment.providerRef, status: "succeeded", amount_received: source.payment.amountMinor,
        currency: source.payment.currency.toLowerCase(), application_fee_amount: original.observedOriginalFeeMinor, latest_charge: original.providerChargeRef, transfer_data: null, on_behalf_of: null,
        metadata: { freeholder_payment_id: original.paymentId, freeholder_platform_account_id: source.routing.providerPlatformAccountId } });
      if (path === `/v1/charges/${original.providerChargeRef}`) return Response.json({ id: original.providerChargeRef, payment_intent: source.payment.providerRef,
        paid: true, captured: true, status: "succeeded", amount_captured: source.payment.amountMinor, currency: original.currency.toLowerCase(), application_fee: original.applicationFeeRef, transfer: null });
      if (path === `/v1/application_fees/${original.applicationFeeRef}`) return Response.json({ id: original.applicationFeeRef, account: source.routing.providerAccountId,
        charge: original.providerChargeRef, amount: original.observedOriginalFeeMinor, amount_refunded: 200, currency: original.currency.toLowerCase() });
      throw Error(`Unexpected original provider read: ${path}`);
    };
    const actual = createStripePayments({ secretKey: "sk_fee_history_fixture", webhookSecrets: ["whsec_fee_history_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher });
    vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue(actual);
    expect(await reconcileMerchantApplicationFee.call({ paymentId: original.paymentId }, OWNER)).toMatchObject({ state: "review", operation: null });
    const debt = await merchantPaymentRecoveryDebt.call({ paymentId: original.paymentId }, system);
    expect(debt.pending).toBe(true); expect(debt.reasons).toContain("commission");
    expect(posts).toBe(0); expect(await originalMoney()).toEqual(before);
  });
});
