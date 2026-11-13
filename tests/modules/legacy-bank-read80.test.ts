// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual legacy services and original HMAC caller/resource proof.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as adapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { resolveContact } from "@/core/contacts/service";
import { createDraftInvoice, createPayment, issueInvoice, settlePayment } from "@/modules/invoicing/invoice-service";
import { submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { finishLegacyBankRead, flushLocalLegacyBankReadFinishes, inspectLegacyBankRefund, prepareLegacyBankRead, recordLegacyBankReadFact } from "@/modules/invoicing/legacy-bank-read-service";
import { legacyBankReads, legacyBankReadFacts, legacyBankReadFinishes } from "@/modules/invoicing/legacy-bank-read-schema";
import { merchantRefundRequests } from "@/modules/invoicing/merchant-refund-schema";
import { payments, refunds } from "@/modules/invoicing/schema";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };

describe.runIf(hasDatabase)("authentic legacy bank read lifecycle80", { timeout: 60000 }, () => {
  beforeAll(ready, 60000); beforeEach(truncateSpine); afterEach(() => vi.restoreAllMocks()); afterAll(closeDb);
  async function setup(failSecondPage = false, pauseExactRead = false) {
    const buyer = (await resolveContact.call({ email: "fictional-legacy-bank-reader@example.test" }, OWNER)).contact;
    const draft = await createDraftInvoice.call({ contactId: buyer.id, currency: "CAD", idempotencyKey: "legacy-bank-read-invoice",
      lines: [{ description: "Original legacy service", quantityMicros: 1000000, unitAmountMinor: 1000 }],
      tax: { mode: "not_applicable", reason: "Synthetic original legacy-bank test" } }, OWNER);
    const invoice = (await issueInvoice.call({ id: draft.invoice.id }, OWNER)).invoice;
    const payment = await createPayment.call({ invoiceId: invoice.id, provider: "stripe", method: "hosted_checkout", amountMinor: 1000,
      idempotencyKey: "legacy-bank-read-payment" }, OWNER);
    await settlePayment.call({ id: payment.id, providerRef: "pi_OriginalLegacyBankRead" }, OWNER);
    const entered = signal(), release = signal(), paths: string[] = [], posts: string[] = [];
    const original = { id: "pyr_OriginalLegacyBankRead", payment_intent: "pi_OriginalLegacyBankRead", charge: "ch_OriginalLegacyBankRead",
      amount: 1000, currency: "cad", status: "failed", failure_balance_transaction: "txn_OriginalLegacyBankReturned" };
    const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      paths.push(`${init.method} ${url.pathname}`); expect(new Headers(init.headers).get("stripe-account")).toBeNull();
      if (url.pathname === "/v1/account") return Response.json({ id: "acct_ReadPlatformOnly" });
      if (url.pathname === "/v1/refunds" && init.method === "POST") {
        const body = new URLSearchParams(String(init.body)); expect(body.get("payment_intent")).toBe(original.payment_intent);
        expect(body.get("amount")).toBe("1000"); expect(body.has("metadata[freeholder_refund_attempt_id]")).toBe(false);
        posts.push(new Headers(init.headers).get("idempotency-key")!); return Response.json({ ...original, status: "succeeded" });
      }
      expect(init.method).toBe("GET");
      if (url.pathname === `/v1/refunds/${original.id}`) {
        if (pauseExactRead) { entered.resolve(); await release.promise; }
        return Response.json(original);
      }
      if (url.pathname === `/v1/payment_intents/${original.payment_intent}`) return Response.json({ id: original.payment_intent,
        status: "succeeded", amount_received: 1000, currency: "cad", latest_charge: original.charge, amount_capturable: 0 });
      if (url.pathname === `/v1/charges/${original.charge}`) return Response.json({ id: original.charge, payment_intent: original.payment_intent,
        amount_captured: 1000, amount_refunded: 200, currency: "cad", paid: true, captured: true, refunded: false, application_fee: null, transfer: null });
      if (url.pathname === "/v1/refunds") {
        if (url.searchParams.has("starting_after")) throw Error("Synthetic later legacy inventory page failure");
        return Response.json({ has_more: failSecondPage, data: [original, { id: "pyr_UnassignedLegacyBankRead", payment_intent: original.payment_intent,
          charge: original.charge, amount: 200, currency: "cad", status: "succeeded" }] });
      }
      if (url.pathname === "/v1/disputes") return Response.json({ data: [], has_more: false });
      throw Error(`Unexpected legacy bank read ${init.method} ${url.pathname}`);
    });
    const factory = createStripePayments({ secretKey: "sk_legacy_native_fixture_only", webhookSecrets: ["whsec_legacy_native_fixture_only"], fetch: fetcher });
    vi.spyOn(adapters, "paymentAdapter").mockReturnValue(factory);
    const refund = await submitProviderRefund.call({ paymentId: payment.id, amountMinor: 1000, reason: "Actual original legacy bank refund",
      idempotencyKey: "legacy-bank-original-physical-key" }, OWNER);
    expect(refund.status).toBe("succeeded"); expect(posts).toHaveLength(1);
    expect(await db().select().from(merchantRefundRequests)).toHaveLength(0);
    return { payment, refund, entered, release, paths, posts };
  }

  it("retains original bank and unassigned cash facts only after the exact read wrapper settles", async () => {
    const actual = await setup(false, true), pending = inspectLegacyBankRefund.call({ refundId: actual.refund.id }, OWNER)
      .then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      expect(await Promise.race([actual.entered.promise.then(() => "entered"), pending.then(() => "ended")])).toBe("entered");
      const before = actual.paths.length;
      expect(await db().select().from(legacyBankReads)).toHaveLength(1);
      expect(await db().select().from(legacyBankReadFinishes)).toHaveLength(0);
      expect(await failure(inspectLegacyBankRefund.call({ refundId: actual.refund.id }, OWNER))).toMatchObject({ code: "conflict" });
      expect(actual.paths).toHaveLength(before); actual.release.resolve();
      expect(await pending).toHaveProperty("value");
      const answer = await pending; if (!("value" in answer)) throw answer.error;
      expect(answer.value).toMatchObject({ providerStatus: "failed", originalBindingVerified: true, cashInventoryComplete: true, unassignedRefunds: 1, requiresReview: true, factCount: 9 });
      const [read] = await db().select().from(legacyBankReads);
      expect(read?.original).toMatchObject({ refundId: actual.refund.id, originalRefundRef: "pyr_OriginalLegacyBankRead",
        originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null });
      expect((await db().select().from(legacyBankReadFinishes))[0]).toMatchObject({ readId: read!.id, outcome: "returned", factCount: 9 });
      expect((await db().select().from(refunds))[0]).toMatchObject({ id: actual.refund.id, status: "succeeded", amountMinor: 1000 });
      expect((await db().select().from(payments).where(eq(payments.id, actual.payment.id)))[0]?.refundedMinor).toBe(1000);
      expect(await db().select().from(merchantRefundRequests)).toHaveLength(0); expect(actual.posts).toHaveLength(1);
    } finally { actual.release.resolve(); await pending; }
  });

  it("retains exact refund, primary cash and every earlier resource when a later inventory page fails", async () => {
    const actual = await setup(true);
    await expect(inspectLegacyBankRefund.call({ refundId: actual.refund.id }, OWNER)).rejects.toThrow();
    const facts = await db().select().from(legacyBankReadFacts);
    expect(facts.map(fact => fact.kind)).toEqual(expect.arrayContaining(["exact_refund", "primary_cash", "inventory_refund"]));
    expect(facts).toHaveLength(7);
    const snapshots = facts.filter(fact => fact.kind === "cash_inventory"); expect(snapshots).toHaveLength(3);
    expect(snapshots.every(fact => (fact.evidence.actual as Record<string, unknown>).refundsComplete === false)).toBe(true);
    expect((await db().select().from(legacyBankReadFinishes))[0]).toMatchObject({ outcome: "threw", factCount: 7 });
    expect(await db().select().from(merchantRefundRequests)).toHaveLength(0); expect(actual.posts).toHaveLength(1);
  });

  it("refuses a fabricated finish or nonce and keeps a claimed original read unresolved", async () => {
    const actual = await setup(), before = actual.paths.length;
    const read = await prepareLegacyBankRead.call({ refundId: actual.refund.id }, { kind: "system" });
    expect(await failure(finishLegacyBankRead.call({ readId: read.readId, completionNonce: read.completionNonce }, { kind: "system" }))).toMatchObject({ code: "permission" });
    expect(await failure(recordLegacyBankReadFact.call({ readId: read.readId, completionNonce: "A".repeat(43), sequence: 1,
      fact: { kind: "exact_refund", value: {} } }, { kind: "system" }))).toMatchObject({ code: "permission" });
    expect(await failure(inspectLegacyBankRefund.call({ refundId: actual.refund.id }, OWNER))).toMatchObject({ code: "conflict" });
    expect(actual.paths).toHaveLength(before); expect(await db().select().from(legacyBankReadFacts)).toHaveLength(0);
    expect(await db().select().from(legacyBankReadFinishes)).toHaveLength(0); expect(await db().select().from(legacyBankReads)).toHaveLength(1);
  });

  it("flushes an actually returned finish after persistence failure without repeating any provider read", async () => {
    const actual = await setup();
    const failed = vi.spyOn(finishLegacyBankRead, "call").mockRejectedValueOnce(new Error("Synthetic finished-read persistence outage"));
    await expect(inspectLegacyBankRefund.call({ refundId: actual.refund.id }, OWNER)).rejects.toThrow(/persistence outage/);
    expect(await db().select().from(legacyBankReadFacts)).toHaveLength(9); expect(await db().select().from(legacyBankReadFinishes)).toHaveLength(0);
    failed.mockRestore(); const before = actual.paths.length;
    await flushLocalLegacyBankReadFinishes(actual.refund.id);
    expect(actual.paths).toHaveLength(before); expect((await db().select().from(legacyBankReadFinishes))[0]).toMatchObject({ outcome: "returned", factCount: 9 });
    expect(actual.posts).toHaveLength(1); expect(await db().select().from(merchantRefundRequests)).toHaveLength(0);
  });
});
