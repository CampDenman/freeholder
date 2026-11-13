// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual shared services, factory/HMAC and original money rows.
// Only the external provider edge is synthetic; no historical money is edited.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { InvoiceForCharge } from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { ready } from "@/core/runtime";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { getCustomerInvoice } from "@/modules/invoicing/customer-service";
import { beginPaymentCheckout, completePaymentCheckout, processPaymentProviderEvents, retainPaymentProviderEvidence, submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { invoiceRefundStates } from "@/modules/invoicing/merchant-refund-bank-state-service";
import { reconcileMerchantRefundCurrentState } from "@/modules/invoicing/merchant-refund-current-service";
import { replaceReturnedBankRefund } from "@/modules/invoicing/merchant-bank-replacement-service";
import { BANK_REPLACEMENT_CONFIRMATION, BANK_REPLACEMENT_STATE } from "@/modules/invoicing/merchant-bank-replacement-proof";
import { merchantRefundDispatchFinishes, merchantRefundObservations, merchantRefundRequests, merchantRefundResourceBindings } from "@/modules/invoicing/merchant-refund-schema";
import { merchantRefundCurrentReceipts, merchantRefundStateReadFinishes } from "@/modules/invoicing/merchant-refund-current-schema";
import { creditNotes, creditNoteLines, invoices, moneyStateEvents, payments, refunds } from "@/modules/invoicing/schema";
import { orderItems, returnRefundAllocations } from "@/modules/catalog/schema";
import { decideReturn, getReturn, receiveReturn, requestReturn } from "@/modules/catalog/fulfillment";
import { submitReturnProviderRefund } from "@/modules/catalog/return-refunds";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { MERCHANT_FIXTURE_BUYER_EMAIL, seedMerchantCheckout80 } from "../helpers/merchant-checkout80";

type BankStatus = "pending" | "succeeded" | "requires_action" | "failed" | "canceled" | null;
type Resource = { id: string; payment_intent: string; amount: number; currency: string; status: BankStatus; charge: string;
  metadata: Record<string, string>; failure_balance_transaction: string | null };
const BUYER = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c3" };
const secret = "whsec_bank_native_fixture_only";
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };

describe.runIf(hasDatabase)("original bank refund cash and promise80", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); }); afterAll(closeDb);

  async function setup() {
    const value = await seedMerchantCheckout80("direct"); fixture = value;
    await db().insert(users).values({ id: BUYER.userId, email: MERCHANT_FIXTURE_BUYER_EMAIL, role: "customer" });
    await db().update(contacts).set({ userId: BUYER.userId }).where(eq(contacts.id, value.buyer.id));
    const placed = await value.checkout(), invoiceId = placed.order.invoiceId!;
    let original: InvoiceForCharge | undefined;
    value.stripe.createCheckout = async request => {
      original = request;
      return { ...request, providerRef: "cs_bankOriginal", paymentRef: "pi_bankOriginal", url: "https://checkout.example.test/bank" };
    };
    value.stripe.captureCheckout = async () => {
      if (!original) throw Error("The actual original checkout must exist.");
      return { ...original, providerRef: "pi_bankOriginal", status: "succeeded", amountMinor: original.amountMinor, currency: original.currency,
        customerChargeVerified: true, merchantRouteVerified: true, merchantSettlementVerified: true, providerChargeRef: "ch_bankOriginal",
        applicationFeeRef: "fee_bankOriginal", observedApplicationFeeMinor: original.applicationFeeMinor,
        applicationFeeCurrency: original.currency, observedFeeRefundedMinor: 0 };
    };
    const begun = await beginPaymentCheckout.call({ invoiceId, provider: "stripe", successUrl: env().APP_URL, cancelUrl: env().APP_URL, idempotencyKey: randomUUID() }, OWNER);
    expect((await completePaymentCheckout.call({ paymentId: begun.payment.id, idempotencyKey: randomUUID() }, OWNER)).status).toBe("succeeded");
    expect(original?.amountMinor).toBe(4200);
    const resources = new Map<string, Resource>(), keys = new Map<string, string>(), posts: Array<{ key: string; body: string }> = [], reads: string[] = [];
    let readPause: { id: string; entered: ReturnType<typeof signal>; release: ReturnType<typeof signal> } | undefined;
    let postPause: { entered: ReturnType<typeof signal>; release: ReturnType<typeof signal> } | undefined;
    const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init.headers);
      if (url.pathname === "/v1/account") {
        expect(headers.get("stripe-account")).toBeNull(); return Response.json({ id: "acct_fixturePlatform" });
      }
      expect(headers.get("stripe-account")).toBe("acct_fixtureSeller0");
      if (url.pathname === "/v1/refunds" && init.method === "POST") {
        if (typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) throw Error("Inspect the real encoded original request.");
        const body = init.body.toString(), data = new URLSearchParams(body), key = headers.get("idempotency-key");
        if (!key) throw Error("A physical original request requires its actual key.");
        expect(data.get("payment_intent")).toBe("pi_bankOriginal");
        expect(data.get("refund_application_fee")).toBeNull(); expect(data.get("reverse_transfer")).toBeNull();
        posts.push({ key, body });
        const existing = keys.get(key);
        if (existing) return Response.json(resources.get(existing));
        const amount = Number(data.get("amount"));
        const reserved = [...resources.values()].filter(row => row.status !== "failed" && row.status !== "canceled").reduce((sum, row) => sum + row.amount, 0);
        if (!Number.isSafeInteger(amount) || amount <= 0 || reserved + amount > 4200) return Response.json({ error: { code: "charge_already_refunded", message: "The actual captured resource has no additional refundable capacity." } }, { status: 400 });
        const id = `pyr_bank${resources.size + 1}`, metadata = Object.fromEntries([...data].filter(([name]) => name.startsWith("metadata[")).map(([name, datum]) => [name.slice(9, -1), datum]));
        const resource: Resource = { id, amount, payment_intent: "pi_bankOriginal", currency: "cad", status: "succeeded", charge: "ch_bankOriginal", metadata, failure_balance_transaction: null };
        resources.set(id, resource); keys.set(key, id);
        return Response.json(resource);
      }
      if (url.pathname.startsWith("/v1/refunds/") && init.method === "GET") {
        const id = url.pathname.split("/").at(-1)!, actual = resources.get(id);
        if (!actual) throw Error("Read an actual original provider resource, not a guessed reference.");
        reads.push(id); const snapshot = structuredClone(actual);
        if (readPause?.id === id) { readPause.entered.resolve(); await readPause.release.promise; }
        return Response.json(snapshot);
      }
      throw Error(`Unexpected bank fixture request: ${init.method} ${url.pathname}`);
    });
    const adapter = createStripePayments({ secretKey: "sk_bank_native_fixture_only", webhookSecrets: [secret], apiBase: "https://stripe.example.test", fetch: fetcher });
    const create = adapter.createMerchantRefund?.bind(adapter);
    if (!create) throw Error("The actual bank-refund factory must support original creation.");
    value.stripe.createMerchantRefund = request => create({ ...request, onRefundObserved: async evidence => {
      // Keep the actual ACK and original committed observation. Only this
      // physical caller's promise is paused, not a forged business result.
      await request.onRefundObserved(evidence);
      if (postPause) { postPause.entered.resolve(); await postPause.release.promise; }
    } });
    value.stripe.recoverMerchantRefund = adapter.recoverMerchantRefund?.bind(adapter);
    async function webhook(id: string, status: BankStatus) {
      const resource = resources.get(id); if (!resource) throw Error("Change only an actual provider resource.");
      resource.status = status; resource.failure_balance_transaction = status === "failed" ? `txn_returned${id}` : null;
      const now = Math.floor(Date.now() / 1000), payload = { id: `evt_bank_${randomUUID()}`, type: "refund.updated", account: "acct_fixtureSeller0", api_version: "2026-02-25.clover", created: now, data: { object: resource } };
      const body = Buffer.from(JSON.stringify(payload)), signature = createHmac("sha256", secret).update(`${now}.`).update(body).digest("hex");
      const receivedAt = new Date(now * 1000).toISOString();
      const events = await adapter.verifyWebhook({ body, headers: { "stripe-signature": `t=${now},v1=${signature}` }, receivedAt });
      const retained = await retainPaymentProviderEvidence("stripe", events);
      await processPaymentProviderEvents.call({ provider: "stripe", bodySha256: createHash("sha256").update(body).digest("hex"), receivedAt, events: retained }, { kind: "system" });
    }
    async function requestFor(refundId: string) {
      const [request] = await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId, refundId));
      if (!request) throw Error("The real refund service must freeze its original request."); return request;
    }
    const submit = (amountMinor: number) => submitProviderRefund.call({ paymentId: begun.payment.id, amountMinor, reason: "Actual original bank refund fixture", idempotencyKey: randomUUID() }, OWNER);
    const inspect = (requestId: string) => reconcileMerchantRefundCurrentState.call({ requestId }, OWNER);
    async function balances(refundedMinor: number) {
      expect((await db().select().from(payments).where(eq(payments.id, begun.payment.id)))[0]).toMatchObject({ amountMinor: 4200, refundedMinor });
      expect((await db().select().from(invoices).where(eq(invoices.id, invoiceId)))[0]).toMatchObject({ paidMinor: 4200, refundedMinor });
      expect((await getCustomerInvoice.call({ id: invoiceId }, BUYER)).canPay).toBe(false);
    }
    return { value, placed, invoiceId, paymentId: begun.payment.id, resources, posts, reads, webhook, requestFor, submit, inspect, balances,
      pauseRead: (id: string) => readPause = { id, entered: signal(), release: signal() },
      pausePost: () => postPause = { entered: signal(), release: signal() } };
  }

  it("keeps an equal unrelated refund independent and fulfills only the explicitly authorized original chain", async () => {
    const actual = await setup(), first = await actual.submit(400), original = await actual.requestFor(first.id);
    await actual.webhook(first.providerRef!, "failed"); await actual.inspect(original.id); await actual.balances(0);
    const unrelated = await actual.submit(400);
    expect((await invoiceRefundStates.call({ invoiceId: actual.invoiceId }, OWNER)).find(row => row.id === first.id)).toMatchObject({ refundPromiseOpen: true, canReplace: true });
    const before = actual.posts.length;
    expect(await failure(replaceReturnedBankRefund.call({ requestId: original.id, confirmation: BANK_REPLACEMENT_CONFIRMATION }, actual.value.sellers[0]!))).toMatchObject({ code: "permission" });
    expect(await failure(replaceReturnedBankRefund.call({ requestId: original.id, confirmation: BANK_REPLACEMENT_CONFIRMATION }, { kind: "agent", keyName: "refund-key", scopes: ["invoicing.replaceReturnedBankRefund"] }))).toMatchObject({ code: "permission" });
    expect(actual.posts).toHaveLength(before);
    const replacement = await replaceReturnedBankRefund.call({ requestId: original.id, confirmation: BANK_REPLACEMENT_CONFIRMATION }, OWNER);
    expect(replacement).toMatchObject({ state: "fulfilled", refund: { amountMinor: 400, status: "succeeded" } });
    expect(replacement.refund.id).not.toBe(first.id); expect(replacement.refund.id).not.toBe(unrelated.id);
    await actual.balances(800);
    expect((await invoiceRefundStates.call({ invoiceId: actual.invoiceId }, OWNER)).find(row => row.id === first.id)).toMatchObject({ refundPromiseOpen: false, promiseFulfilledElsewhere: true, reviewRequired: false });
    const journal = await db().select().from(moneyStateEvents).where(eq(moneyStateEvents.toState, BANK_REPLACEMENT_STATE));
    expect(journal).toHaveLength(1); expect(journal[0]!.subjectId).toBe(first.id);
    const posts = actual.posts.length;
    expect((await replaceReturnedBankRefund.call({ requestId: original.id, confirmation: BANK_REPLACEMENT_CONFIRMATION }, OWNER)).state).toBe("fulfilled");
    expect(actual.posts).toHaveLength(posts); expect(new Set(actual.posts.map(row => row.key)).size).toBe(3);
  });

  it("retains two independent original resources across failure, action, null and restored success without mutual stale poisoning", async () => {
    const actual = await setup(), first = await actual.submit(400), second = await actual.submit(600);
    const a = await actual.requestFor(first.id), b = await actual.requestFor(second.id);
    await actual.webhook(first.providerRef!, "failed"); await actual.webhook(second.providerRef!, "requires_action");
    expect((await actual.inspect(a.id)).status).toBe("failed"); expect((await actual.inspect(b.id)).status).toBe("requires_action"); await actual.balances(0);
    const both = await invoiceRefundStates.call({ invoiceId: actual.invoiceId }, OWNER);
    expect(both.find(row => row.id === first.id)).toMatchObject({ verified: true, status: "failed", refundPromiseOpen: true });
    expect(both.find(row => row.id === second.id)).toMatchObject({ verified: true, status: "requires_action", refundPromiseOpen: true });
    await actual.webhook(second.providerRef!, null); expect((await actual.inspect(b.id)).status).toBeNull(); await actual.balances(0);
    await actual.webhook(second.providerRef!, "pending"); await actual.inspect(b.id); await actual.balances(0);
    await actual.webhook(second.providerRef!, "succeeded"); await actual.inspect(b.id); await actual.balances(600);
    const observations = await db().select().from(merchantRefundObservations).where(eq(merchantRefundObservations.requestId, b.id));
    for (const status of ["succeeded", "requires_action", null, "pending"]) expect(observations.some(row => row.status === status)).toBe(true);
    expect(actual.posts).toHaveLength(2);
  });

  it("rejects a delayed successful GET after a newer signed action fact and retains its actual read finish", async () => {
    const actual = await setup(), refund = await actual.submit(400), original = await actual.requestFor(refund.id), barrier = actual.pauseRead(refund.providerRef!);
    const first = actual.inspect(original.id).then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      expect(await Promise.race([barrier.entered.promise.then(() => "entered"), first.then(() => "ended")])).toBe("entered");
      await actual.webhook(refund.providerRef!, "requires_action"); barrier.release.resolve();
      expect(await first).toHaveProperty("error");
      expect(await db().select().from(merchantRefundCurrentReceipts)).toHaveLength(0);
      expect((await db().select().from(merchantRefundStateReadFinishes))[0]).toMatchObject({ outcome: "returned" });
      expect((await actual.inspect(original.id)).status).toBe("requires_action"); await actual.balances(0); expect(actual.posts).toHaveLength(1);
    } finally { barrier.release.resolve(); await first; }
  });

  it("refuses a provider read while the exact physical creator is paused and converges only after its real promise drains", async () => {
    const actual = await setup(), barrier = actual.pausePost();
    const first = actual.submit(400).then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      expect(await Promise.race([barrier.entered.promise.then(() => "entered"), first.then(() => "ended")])).toBe("entered");
      const [original] = await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.paymentId, actual.paymentId));
      expect((await db().select().from(merchantRefundResourceBindings).where(eq(merchantRefundResourceBindings.requestId, original!.id)))[0]).toMatchObject({ providerRef: "pyr_bank1", origin: "physical_ack" });
      expect((await db().select().from(merchantRefundObservations).where(eq(merchantRefundObservations.requestId, original!.id)))[0]).toMatchObject({ providerRef: "pyr_bank1", status: "succeeded", amountMinor: 400, bindingVerified: true });
      expect(await db().select().from(merchantRefundDispatchFinishes)).toHaveLength(0);
      expect(await failure(actual.inspect(original!.id))).toMatchObject({ code: "conflict" }); expect(actual.reads).toEqual([]); expect(actual.posts).toHaveLength(1);
      barrier.release.resolve(); const returned = await first; expect(returned).toHaveProperty("value");
      expect((await actual.inspect(original!.id)).status).toBe("succeeded"); await actual.balances(400); expect(actual.posts).toHaveLength(1);
    } finally { barrier.release.resolve(); await first; }
  });

  it("preserves the exact issued RMA credit through bank failure and discharges it only through the original replacement part", async () => {
    const actual = await setup();
    const [line] = await db().select().from(orderItems).where(eq(orderItems.orderId, actual.placed.order.id));
    const returned = await requestReturn.call({ orderId: actual.placed.order.id, reason: "Return the original item and retain its original bank credit", restock: false, items: [{ orderItemId: line!.id, quantity: 1 }] }, OWNER);
    await decideReturn.call({ id: returned.return.id, decision: "approved" }, OWNER); await receiveReturn.call({ id: returned.return.id, restock: false }, OWNER);
    await submitReturnProviderRefund.call({ id: returned.return.id, idempotencyKey: randomUUID() }, OWNER);
    const [first] = await db().select().from(refunds), original = await actual.requestFor(first!.id);
    const creditBefore = JSON.stringify({ notes: await db().select().from(creditNotes), lines: await db().select().from(creditNoteLines) });
    await actual.webhook(first!.providerRef!, "requires_action"); await actual.inspect(original.id); await actual.balances(0);
    expect((await getReturn.call({ id: returned.return.id }, OWNER)).return.status).toBe("received");
    await actual.webhook(first!.providerRef!, "failed"); await actual.inspect(original.id);
    expect(await failure(replaceReturnedBankRefund.call({ requestId: original.id, confirmation: BANK_REPLACEMENT_CONFIRMATION }, OWNER))).toMatchObject({ code: "conflict" }); expect(actual.posts).toHaveLength(1);
    await submitReturnProviderRefund.call({ id: returned.return.id, idempotencyKey: randomUUID() }, OWNER);
    expect((await getReturn.call({ id: returned.return.id }, OWNER)).return.status).toBe("refunded"); await actual.balances(4200);
    expect(JSON.stringify({ notes: await db().select().from(creditNotes), lines: await db().select().from(creditNoteLines) })).toBe(creditBefore);
    expect(await db().select().from(returnRefundAllocations)).toHaveLength(1); expect(actual.posts).toHaveLength(2);
    expect((await invoiceRefundStates.call({ invoiceId: actual.invoiceId }, OWNER)).find(row => row.id === first!.id)).toMatchObject({ refundPromiseOpen: false, promiseFulfilledElsewhere: true });
  });
});
