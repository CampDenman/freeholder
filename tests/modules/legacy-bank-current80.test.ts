// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: authentic old physical callers, real current-read services and cash.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as adapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { createDraftInvoice, createPayment, createRefund, issueInvoice, settlePayment } from "@/modules/invoicing/invoice-service";
import { submitProviderRefund, processPaymentProviderEvents, retainPaymentProviderEvidence } from "@/modules/invoicing/payment-provider-service";
import { getCustomerInvoice } from "@/modules/invoicing/customer-service";
import { invoiceRefundStates } from "@/modules/invoicing/merchant-refund-bank-state-service";
import { reconcileLegacyBankRefund } from "@/modules/invoicing/legacy-bank-current-service";
import { legacyBankReads, legacyBankReadFacts, legacyBankReadFinishes, legacyBankCurrentReceipts } from "@/modules/invoicing/legacy-bank-read-schema";
import { merchantRefundRequests } from "@/modules/invoicing/merchant-refund-schema";
import { invoices, payments, refunds } from "@/modules/invoicing/schema";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
type BankStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | null;
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
const secret = "whsec_legacy_current_native_fixture_only";

describe.runIf(hasDatabase)("authentic legacy bank current money80", { timeout: 60000 }, () => {
  beforeAll(ready, 60000); beforeEach(truncateSpine); afterEach(() => vi.restoreAllMocks()); afterAll(closeDb);
  async function setup(pausePost = false) {
    const buyer = (await resolveContact.call({ email: "fictional-legacy-current@example.test" }, OWNER)).contact;
    const actor = { ...CUSTOMER, userId: randomUUID() };
    await db().insert(users).values({ id: actor.userId, email: buyer.email!, role: "customer" });
    await db().update(contacts).set({ userId: actor.userId }).where(eq(contacts.id, buyer.id));
    const draft = await createDraftInvoice.call({ contactId: buyer.id, currency: "CAD", idempotencyKey: "legacy-current-invoice",
      lines: [{ description: "Original paid legacy service", quantityMicros: 1000000, unitAmountMinor: 1000 }], tax: { mode: "not_applicable", reason: "Synthetic legacy bank current control" } }, OWNER);
    const invoice = (await issueInvoice.call({ id: draft.invoice.id }, OWNER)).invoice;
    const payment = await createPayment.call({ invoiceId: invoice.id, provider: "stripe", method: "hosted_checkout", amountMinor: 1000, idempotencyKey: "legacy-current-payment" }, OWNER);
    await settlePayment.call({ id: payment.id, providerRef: "pi_OriginalLegacyCurrent" }, OWNER);
    let status: BankStatus = "succeeded", pauseRead = false;
    const entered = signal(), release = signal(), readEntered = signal(), readRelease = signal(), paths: string[] = [], posts: string[] = [];
    const resource = () => ({ id: "pyr_OriginalLegacyCurrent", payment_intent: "pi_OriginalLegacyCurrent", charge: "ch_OriginalLegacyCurrent", amount: 400,
      currency: "cad", status, failure_balance_transaction: status === "failed" ? "txn_LegacyCurrentReturned" : null });
    const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      paths.push(`${init.method} ${url.pathname}`); expect(new Headers(init.headers).get("stripe-account")).toBeNull();
      if (url.pathname === "/v1/account") return Response.json({ id: "acct_CurrentLegacyReadOnly" });
      if (url.pathname === "/v1/refunds" && init.method === "POST") {
        const form = init.body instanceof URLSearchParams ? init.body : typeof init.body === "string" ? new URLSearchParams(init.body) : undefined;
        if (!form) throw new Error("The actual refund POST must carry a form body.");
        expect(form.get("payment_intent")).toBe("pi_OriginalLegacyCurrent"); expect(form.get("amount")).toBe("400");
        posts.push(new Headers(init.headers).get("idempotency-key")!); const actual = resource(); entered.resolve(); if (pausePost) await release.promise;
        return Response.json(actual);
      }
      expect(init.method).toBe("GET");
      if (url.pathname === "/v1/refunds/pyr_OriginalLegacyCurrent") {
        const actual = resource(); if (pauseRead) { readEntered.resolve(); await readRelease.promise; } return Response.json(actual);
      }
      if (url.pathname === "/v1/payment_intents/pi_OriginalLegacyCurrent") return Response.json({ id: "pi_OriginalLegacyCurrent", status: "succeeded", amount_received: 1000, currency: "cad", latest_charge: "ch_OriginalLegacyCurrent", amount_capturable: 0 });
      if (url.pathname === "/v1/charges/ch_OriginalLegacyCurrent") return Response.json({ id: "ch_OriginalLegacyCurrent", payment_intent: "pi_OriginalLegacyCurrent", amount_captured: 1000,
        amount_refunded: status === "succeeded" ? 400 : 0, currency: "cad", paid: true, captured: true, refunded: false, application_fee: null, transfer: null });
      if (url.pathname === "/v1/refunds") return Response.json({ data: [resource()], has_more: false });
      if (url.pathname === "/v1/disputes") return Response.json({ data: [], has_more: false });
      throw Error(`Unexpected legacy current provider request ${init.method} ${url.pathname}`);
    });
    const factory = createStripePayments({ secretKey: "sk_legacy_current_native_fixture_only", webhookSecrets: [secret], fetch: fetcher });
    vi.spyOn(adapters, "paymentAdapter").mockReturnValue(factory);
    const pending = submitProviderRefund.call({ paymentId: payment.id, amountMinor: 400, reason: "Actual original legacy bank current refund", idempotencyKey: "legacy-current-original-key" }, OWNER)
      .then(value => ({ value }), (error: unknown) => ({ error }));
    if (pausePost) expect(await Promise.race([entered.promise.then(() => "entered"), pending.then(() => "ended")])).toBe("entered");
    else { const done = await pending; if (!("value" in done)) throw done.error; }
    const [refund] = await db().select().from(refunds).where(eq(refunds.paymentId, payment.id)); if (!refund) throw Error("The actual old refund admission is unavailable.");
    const reconcile = () => reconcileLegacyBankRefund.call({ refundId: refund.id }, OWNER);
    async function balances(returnedMinor: number) {
      expect((await db().select().from(payments).where(eq(payments.id, payment.id)))[0]).toMatchObject({ amountMinor: 1000, refundedMinor: returnedMinor });
      expect((await db().select().from(invoices).where(eq(invoices.id, invoice.id)))[0]).toMatchObject({ paidMinor: 1000, refundedMinor: returnedMinor });
      expect((await getCustomerInvoice.call({ id: invoice.id }, actor)).canPay).toBe(false);
    }
    async function signedStatus(next: BankStatus) {
      status = next; const now = Math.floor(Date.now() / 1000), body = Buffer.from(JSON.stringify({ id: `evt_legacy_${randomUUID()}`, type: "refund.updated", api_version: "2026-02-25.clover", created: now, data: { object: resource() } }));
      const signature = createHmac("sha256", secret).update(`${now}.`).update(body).digest("hex"), receivedAt = new Date(now * 1000).toISOString();
      const parsed = await factory.verifyWebhook({ body, headers: { "stripe-signature": `t=${now},v1=${signature}` }, receivedAt });
      const events = await retainPaymentProviderEvidence("stripe", parsed);
      await processPaymentProviderEvents.call({ provider: "stripe", events, receivedAt, bodySha256: createHash("sha256").update(body).digest("hex") }, { kind: "system" });
    }
    return { payment, invoice, refund, factory, pending, release, paths, posts, reconcile, balances, signedStatus,
      setStatus: (value: BankStatus) => { status = value; }, pauseNextRead: () => { pauseRead = true; return { entered: readEntered, release: readRelease }; } };
  }

  it("preserves old positive cash under unknown state, projects actual bank changes and keeps new-key capacity closed until original success returns", async () => {
    const actual = await setup();
    const earlier = await createRefund.call({ paymentId: actual.payment.id, amountMinor: 20, reason: "Original unsubmitted legacy reservation", idempotencyKey: "legacy-current-existing-unsubmitted" }, OWNER);
    actual.setStatus(null);
    expect(await actual.reconcile()).toMatchObject({ status: null, applied: false, requiresReview: true }); await actual.balances(400);
    for (const status of ["requires_action", "pending", "failed", "canceled"] as const) {
      actual.setStatus(status); expect(await actual.reconcile()).toMatchObject({ status, applied: true, requiresReview: true }); await actual.balances(0);
      if (status === "requires_action") {
        await expect(submitProviderRefund.call({ paymentId: actual.payment.id, amountMinor: 400, reason: "Actual original legacy bank current refund", idempotencyKey: "legacy-current-original-key" }, OWNER)).rejects.toThrow();
        await actual.balances(0); expect(actual.posts).toHaveLength(1);
      }
    }
    expect(await failure(submitProviderRefund.call({ paymentId: actual.payment.id, amountMinor: 20, reason: "Do not bypass an owed original bank refund", idempotencyKey: "legacy-current-unrelated-new-key" }, OWNER))).toMatchObject({ code: "conflict" });
    expect(await failure(submitProviderRefund.call({ paymentId: actual.payment.id, amountMinor: 20, reason: "Original unsubmitted legacy reservation", idempotencyKey: "legacy-current-existing-unsubmitted" }, OWNER))).toMatchObject({ code: "conflict" });
    expect((await db().select().from(refunds).where(eq(refunds.id, earlier.id)))[0]).toMatchObject({ status: "created", providerRef: null });
    expect(actual.posts).toHaveLength(1);
    actual.setStatus("succeeded"); expect(await actual.reconcile()).toMatchObject({ status: "succeeded", applied: true, requiresReview: false }); await actual.balances(400);
    expect((await invoiceRefundStates.call({ invoiceId: actual.invoice.id }, OWNER)).find(row => row.id === actual.refund.id)).toMatchObject({ status: "succeeded", verified: true, refundPromiseOpen: false, canReplace: false });
    expect(await db().select().from(legacyBankCurrentReceipts)).toHaveLength(6); expect(actual.posts).toHaveLength(1);
    expect(await createRefund.call({ paymentId: actual.payment.id, amountMinor: 20, reason: "Ordinary new reservation after original success", idempotencyKey: "legacy-current-after-original-success" }, OWNER)).toMatchObject({ status: "created", providerRef: null });
    expect(actual.posts).toHaveLength(1);
    expect(await db().select().from(merchantRefundRequests)).toHaveLength(0);
  });

  it("rejects an old successful GET after a newer signed original event while retaining its actual returned read and raw facts", async () => {
    const actual = await setup(), barrier = actual.pauseNextRead();
    const pending = actual.reconcile().then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      expect(await Promise.race([barrier.entered.promise.then(() => "entered"), pending.then(() => "ended")])).toBe("entered");
      await actual.signedStatus("requires_action"); barrier.release.resolve(); expect(await pending).toHaveProperty("error");
      expect(await db().select().from(legacyBankCurrentReceipts)).toHaveLength(0);
      expect((await db().select().from(legacyBankReadFinishes))[0]?.outcome).toBe("returned");
      expect((await db().select().from(legacyBankReadFacts)).some(fact => fact.kind === "exact_refund" && fact.evidence.rawProviderStatus === "succeeded")).toBe(true);
      expect(await actual.reconcile()).toMatchObject({ status: "requires_action", applied: true }); await actual.balances(0);
      expect(await db().select().from(legacyBankCurrentReceipts)).toHaveLength(1); expect(actual.posts).toHaveLength(1);
    } finally { barrier.release.resolve(); await pending; }
  });

  it("cannot use a successful resource GET to settle an unknown original physical creator", async () => {
    const actual = await setup(true);
    try {
      const evidence: unknown[] = [];
      const peek = await actual.factory.inspectLegacyBankRefund!({ originalRefundRef: "pyr_OriginalLegacyCurrent", originalPaymentRef: "pi_OriginalLegacyCurrent", amountMinor: 400, currency: "CAD", originalChargeAccountId: null,
        onRefundObserved: async fact => { evidence.push(fact); } });
      expect(peek.rawProviderStatus).toBe("succeeded"); expect(evidence).toHaveLength(1);
      expect(await failure(actual.reconcile())).toMatchObject({ code: "conflict" });
      expect(await db().select().from(legacyBankReads)).toHaveLength(0); expect(await db().select().from(legacyBankCurrentReceipts)).toHaveLength(0);
      expect((await db().select().from(payments).where(eq(payments.id, actual.payment.id)))[0]?.refundedMinor).toBe(0);
      actual.release.resolve(); expect(await actual.pending).toHaveProperty("value");
      expect(await actual.reconcile()).toMatchObject({ status: "succeeded", applied: true }); await actual.balances(400); expect(actual.posts).toHaveLength(1);
    } finally { actual.release.resolve(); await actual.pending; }
  });
});
