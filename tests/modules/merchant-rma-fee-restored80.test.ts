// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Dedicated actual BEFORE-history clone. Never seeds, truncates or edits money.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as paymentAdapters from "@/adapters/payments";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { merchantFeeSource, reconcileMerchantApplicationFee } from "@/modules/invoicing/merchant-fee-service";
import { merchantPaymentRecoveryDebt } from "@/modules/invoicing/merchant-payment-debt";
import { merchantFeeRefunds } from "@/modules/invoicing/merchant-collection-schema";
import { closeDb, hasDatabase, OWNER } from "../helpers/spine";
const system = { kind: "system" } as const;
const tables = ["payments", "refunds", "merchant_fee_refunds", "merchant_fee_observations", "credit_notes", "credit_note_lines", "invoice_merchant_allocations", "invoice_merchant_allocation_lines"];
async function originalMoney() {
  const proof = [];
  for (const table of tables) proof.push(await db().execute(sql.raw(`select count(*)::int as count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') as sha256 from "${table}" t`)));
  return JSON.parse(JSON.stringify(proof));
}
describe.runIf(hasDatabase && process.env.TEST_ORIGINAL_FEE_HISTORY === "1")("actual original over-refunded line commission80", () => {
  beforeAll(ready, 60000); afterEach(() => vi.restoreAllMocks()); afterAll(closeDb);
  it("keeps the genuine confirmed112 history unchanged and reports review instead of rewriting it to100", async () => {
    expect(process.env.TEST_DATABASE_URL).toContain("rma_fee_budget80_populated_before_v8");
    const operations = await db().select().from(merchantFeeRefunds);
    expect(operations).toHaveLength(1);
    const original = operations[0]!;
    expect(original).toMatchObject({ status: "accepted", amountMinor: 112, observedOriginalFeeMinor: 500, providerRef: "fr_lineFee" });
    const before = await originalMoney(), source = await merchantFeeSource.call({ paymentId: original.paymentId }, system);
    const adapter = paymentAdapters.createManualPayments(); let posts = 0;
    vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue({ ...adapter, id: "stripe", status: { ...adapter.status, id: "stripe", available: true },
      inspectMerchantPayment: async request => {
        const evidence = { ...source.routing, providerRef: source.payment.providerRef!, status: "succeeded" as const, amountMinor: source.payment.amountMinor, currency: source.payment.currency,
          customerChargeVerified: true, merchantRouteVerified: true, merchantSettlementVerified: true, providerChargeRef: original.providerChargeRef, applicationFeeRef: original.applicationFeeRef,
          observedApplicationFeeMinor: original.observedOriginalFeeMinor, applicationFeeCurrency: original.currency, observedFeeRefundedMinor: original.amountMinor };
        await request.onPaymentObserved?.(evidence); return evidence;
      },
      refundMerchantFee: async () => { posts++; throw Error("An actual historical over-refund does not authorize a replacement fee request."); },
      recoverMerchantFeeRefund: async () => { throw Error("The retained accepted fee is already known."); },
    });
    expect(await reconcileMerchantApplicationFee.call({ paymentId: original.paymentId }, OWNER)).toMatchObject({ state: "review", operation: null });
    expect(await merchantPaymentRecoveryDebt.call({ paymentId: original.paymentId }, system)).toMatchObject({ pending: true, reasons: expect.arrayContaining(["commission"]) });
    expect(posts).toBe(0); expect(await originalMoney()).toEqual(before);
  });
});
