// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.06 database proof for offline money and authenticated provider convergence.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import * as adapters from "@/adapters/payments";
import { providerJson } from "@/adapters/payments/http";
import { AdapterError } from "@/adapters/types";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { auditLog } from "@/core/events/schema";
import { createContact } from "@/core/contacts/service";
import {
  createDraftInvoice,
  createPayment,
  getInvoice,
  issueInvoice,
  settlePayment,
  startPayment,
} from "@/modules/invoicing/invoice-service";
import * as providerService from "@/modules/invoicing/payment-provider-service";
import {
  beginPaymentCheckout,
  completePaymentCheckout,
  listPaymentDisputes,
  reconcilePaymentProviders,
  listSavedPaymentMethods,
  processPaymentProviderEvents,
  recordOfflinePayment,
  recordOfflineRefund,
  revokeSavedPaymentMethod,
  submitProviderRefund,
} from "@/modules/invoicing/payment-provider-service";
import {
  paymentDisputes,
  paymentMethods,
  paymentProviderEvents,
  payments,
  providerPayouts,
  refunds,
} from "@/modules/invoicing/schema";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const noTax = { mode: "not_applicable" as const, reason: "Tax does not apply to this test transaction." };

async function issuedInvoice(key: string, amountMinor = 10_000) {
  const contact = await createContact.call({ name: `Buyer ${key}`, email: `${key}@example.test` }, OWNER);
  const draft = await createDraftInvoice.call({
    contactId: contact.id,
    currency: "CAD",
    idempotencyKey: `draft-${key}`,
    lines: [{ description: "Service", quantityMicros: 1_000_000, unitAmountMinor: amountMinor, discountMinor: 0, taxCategoryCode: "standard", requiresShipping: false, snapshot: {} }],
    shippingMinor: 0,
    tax: noTax,
  }, OWNER);
  const issued = await issueInvoice.call({ id: draft.invoice.id }, OWNER);
  return { contact, invoice: issued.invoice };
}

const digest = "a".repeat(64);
const receivedAt = "2026-08-14T12:01:00.000Z";

/**
 * Sessions on this database holding a transaction open while waiting on the
 * client. A service transaction left open across a provider await shows up
 * here; test files run serially, so nothing else is counted.
 */
async function openTransactions(): Promise<number> {
  const rows = await db().execute<{ open: number }>(sql`
    select count(*)::int as open from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid() and state like 'idle in transaction%'
  `);
  return Number(rows[0]?.open ?? 0);
}

describe.runIf(hasDatabase)("payment provider services", () => {
  beforeEach(async () => { vi.restoreAllMocks(); await truncateSpine(); });

  it("records partial and complete offline money plus refunds through the one ledger", async () => {
    const { invoice } = await issuedInvoice("offline");
    const first = await recordOfflinePayment.call({
      invoiceId: invoice.id,
      method: "bank_transfer",
      amountMinor: 6_000,
      reference: "BANK-001",
      evidence: "Matched to the bank statement by the owner.",
      processedAt: "2026-08-14T10:00:00Z",
      idempotencyKey: "offline-payment-1",
    }, OWNER);
    expect(first).toMatchObject({ provider: "manual", providerRef: "manual:BANK-001", status: "succeeded", amountMinor: 6_000 });
    const duplicate = await recordOfflinePayment.call({
      invoiceId: invoice.id,
      method: "bank_transfer",
      amountMinor: 6_000,
      reference: "BANK-001",
      evidence: "Matched to the bank statement by the owner.",
      processedAt: "2026-08-14T10:00:00Z",
      idempotencyKey: "offline-payment-1",
    }, OWNER);
    expect(duplicate.id).toBe(first.id);
    expect((await getInvoice.call({ id: invoice.id }, OWNER)).invoice).toMatchObject({ status: "partially_paid", paidMinor: 6_000 });

    const second = await recordOfflinePayment.call({
      invoiceId: invoice.id,
      method: "cash",
      amountMinor: 4_000,
      evidence: "Cash counted and receipt issued in person.",
      idempotencyKey: "offline-payment-2",
    }, OWNER);
    expect((await getInvoice.call({ id: invoice.id }, OWNER)).invoice).toMatchObject({ status: "paid", paidMinor: 10_000 });
    await recordOfflineRefund.call({
      paymentId: second.id,
      amountMinor: 1_000,
      reason: "Partial service cancellation",
      reference: "CASH-REFUND-1",
      idempotencyKey: "offline-refund-1",
    }, OWNER);
    const bundle = await getInvoice.call({ id: invoice.id }, OWNER);
    expect(bundle.invoice.refundedMinor).toBe(1_000);
    expect(bundle.refunds[0]).toMatchObject({ provider: "manual", providerRef: "manual-refund:CASH-REFUND-1", status: "succeeded" });
  });

  it("settles a verified provider event once, persists consented masked method evidence, and refuses amount drift", async () => {
    const { contact, invoice } = await issuedInvoice("stripe-event");
    const payment = await createPayment.call({
      invoiceId: invoice.id,
      provider: "stripe",
      method: "hosted_checkout",
      amountMinor: 10_000,
      idempotencyKey: "stripe-payment-1",
      metadata: { saveMethodRequested: true },
    }, OWNER);
    await startPayment.call({ id: payment.id, providerRef: "pi_1", providerCheckoutRef: "cs_1" }, OWNER);
    const event = {
      id: "evt_success_1",
      kind: "payment_succeeded" as const,
      providerRef: "pi_1",
      checkoutRef: "cs_1",
      amountMinor: 10_000,
      currency: "CAD",
      occurredAt: "2026-08-14T12:00:00.000Z",
      invoiceId: invoice.id,
      contactId: contact.id,
      providerCustomerRef: "cus_1",
      savedMethod: {
        providerRef: "pm_1",
        providerCustomerRef: "cus_1",
        kind: "card" as const,
        label: "visa ending 4242",
        brand: "visa",
        last4: "4242",
        expiryMonth: 12,
        expiryYear: 2030,
      },
    };
    await expect(processPaymentProviderEvents.call({ provider: "stripe", bodySha256: digest, receivedAt, events: [event] }, { kind: "system" })).resolves.toEqual({ processed: 1, duplicates: 0 });
    await expect(processPaymentProviderEvents.call({ provider: "stripe", bodySha256: digest, receivedAt, events: [event] }, { kind: "system" })).resolves.toEqual({ processed: 0, duplicates: 1 });
    expect((await getInvoice.call({ id: invoice.id }, OWNER)).invoice).toMatchObject({ status: "paid", paidMinor: 10_000 });
    const methods = await listSavedPaymentMethods.call({ contactId: contact.id }, OWNER);
    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({ provider: "stripe", last4: "4242", status: "active" });
    expect(methods[0]).not.toHaveProperty("providerMethodRef");
    expect(methods[0]).not.toHaveProperty("providerCustomerRef");
    expect(await db().select().from(paymentProviderEvents)).toHaveLength(1);

    const other = await issuedInvoice("stripe-mismatch", 5_000);
    const otherPayment = await createPayment.call({ invoiceId: other.invoice.id, provider: "stripe", method: "hosted_checkout", amountMinor: 5_000, idempotencyKey: "stripe-payment-2", metadata: {} }, OWNER);
    await startPayment.call({ id: otherPayment.id, providerRef: "pi_2", providerCheckoutRef: "cs_2" }, OWNER);
    const error = await failure(processPaymentProviderEvents.call({
      provider: "stripe",
      bodySha256: "b".repeat(64),
      receivedAt,
      events: [{ id: "evt_bad_amount", kind: "payment_succeeded", providerRef: "pi_2", amountMinor: 5_001, currency: "CAD", occurredAt: "2026-08-14T12:02:00.000Z" }],
    }, { kind: "system" }));
    expect(error).toMatchObject({ code: "conflict" });
    expect(await db().select().from(paymentProviderEvents).where(eq(paymentProviderEvents.providerEventId, "evt_bad_amount"))).toHaveLength(0);
    expect((await db().select().from(payments).where(eq(payments.id, otherPayment.id)))[0]?.status).toBe("processing");
  });

  it("tracks dispute deadlines and ignores late provider state without losing immutable receipts", async () => {
    const { invoice } = await issuedInvoice("dispute");
    const payment = await createPayment.call({ invoiceId: invoice.id, provider: "stripe", method: "hosted_checkout", amountMinor: 10_000, idempotencyKey: "disputed-payment", metadata: {} }, OWNER);
    await startPayment.call({ id: payment.id, providerRef: "pi_disputed", providerCheckoutRef: "cs_disputed" }, OWNER);
    await processPaymentProviderEvents.call({
      provider: "stripe", bodySha256: digest, receivedAt,
      events: [{ id: "evt_paid", kind: "payment_succeeded", providerRef: "pi_disputed", amountMinor: 10_000, currency: "CAD", occurredAt: "2026-08-14T11:00:00.000Z" }],
    }, { kind: "system" });
    const opened = { id: "evt_dispute_open", kind: "dispute_opened" as const, providerRef: "dp_1", paymentProviderRef: "pi_disputed", amountMinor: 4_000, currency: "CAD", reason: "fraudulent", evidenceDueAt: "2026-08-21T12:00:00.000Z", occurredAt: "2026-08-14T12:00:00.000Z" };
    await processPaymentProviderEvents.call({ provider: "stripe", bodySha256: digest, receivedAt, events: [opened] }, { kind: "system" });
    await processPaymentProviderEvents.call({ provider: "stripe", bodySha256: digest, receivedAt, events: [{ ...opened, id: "evt_dispute_won", kind: "dispute_won", occurredAt: "2026-08-20T12:00:00.000Z" }] }, { kind: "system" });
    await processPaymentProviderEvents.call({ provider: "stripe", bodySha256: digest, receivedAt, events: [{ ...opened, id: "evt_dispute_late", occurredAt: "2026-08-15T12:00:00.000Z" }] }, { kind: "system" });
    const disputes = await listPaymentDisputes.call({ limit: 10 }, OWNER);
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({ providerRef: "dp_1", paymentId: payment.id, amountMinor: 4_000, status: "won" });
    expect(disputes[0]?.closedAt).toEqual(new Date("2026-08-20T12:00:00.000Z"));
    expect(await db().select().from(paymentProviderEvents).where(and(eq(paymentProviderEvents.provider, "stripe"), eq(paymentProviderEvents.providerObjectRef, "dp_1")))).toHaveLength(3);
    expect((await db().select().from(paymentDisputes))[0]?.providerStatusAt).toEqual(new Date("2026-08-20T12:00:00.000Z"));
  });

  it("converges authenticated payout events and ignores older provider state", async () => {
    const paid = {
      id: "evt_payout_paid",
      kind: "payout_paid" as const,
      providerRef: "po_event_1",
      amountMinor: 9_200,
      currency: "CAD",
      occurredAt: "2026-08-16T12:00:00.000Z",
      expectedAt: "2026-08-16T12:00:00.000Z",
      statementRef: "FREEHOLDER",
    };
    await expect(processPaymentProviderEvents.call({ provider: "stripe", bodySha256: digest, receivedAt, events: [paid] }, { kind: "system" })).resolves.toEqual({ processed: 1, duplicates: 0 });
    await processPaymentProviderEvents.call({ provider: "stripe", bodySha256: "b".repeat(64), receivedAt, events: [{ ...paid, id: "evt_payout_old", kind: "payout_pending", occurredAt: "2026-08-15T12:00:00.000Z" }] }, { kind: "system" });
    expect((await db().select().from(providerPayouts))[0]).toMatchObject({ providerRef: "po_event_1", status: "paid", amountMinor: 9_200, statementRef: "FREEHOLDER" });
    expect((await db().select().from(paymentProviderEvents).where(eq(paymentProviderEvents.providerEventId, "evt_payout_old")))[0]).toMatchObject({ status: "ignored", detail: "payout_older_event_ignored" });
  });

  it("refuses a saved method reassignment across contacts", async () => {
    const first = await issuedInvoice("method-owner-a");
    const second = await issuedInvoice("method-owner-b");
    await db().insert(paymentMethods).values({
      contactId: first.contact.id,
      provider: "stripe",
      providerMethodRef: "pm_owned",
      providerCustomerRef: "cus_a",
      kind: "card",
      label: "card ending 4242",
      last4: "4242",
      status: "active",
      consentSource: "provider_checkout",
      consentedAt: new Date("2026-08-14T10:00:00Z"),
      providerStatusAt: new Date("2026-08-14T10:00:00Z"),
    });
    const error = await failure(processPaymentProviderEvents.call({
      provider: "stripe",
      bodySha256: digest,
      receivedAt,
      events: [{
        id: "evt_method_reassign",
        kind: "saved_method_added",
        contactId: second.contact.id,
        providerCustomerRef: "cus_b",
        occurredAt: "2026-08-15T10:00:00.000Z",
        method: { providerRef: "pm_owned", providerCustomerRef: "cus_b", kind: "card", label: "card ending 4242", last4: "4242" },
      }],
    }, { kind: "system" }));
    expect(error).toMatchObject({ code: "conflict" });
    expect((await db().select().from(paymentMethods).where(eq(paymentMethods.providerMethodRef, "pm_owned")))[0]?.contactId).toBe(first.contact.id);
  });

  describe("provider I/O outside service transactions (C11.10)", () => {
    function hostedStripe() {
      const manual = adapters.createManualPayments();
      const createCheckout = vi.fn<adapters.PaymentAdapter["createCheckout"]>();
      const captureCheckout = vi.fn<adapters.PaymentAdapter["captureCheckout"]>();
      const refund = vi.fn<adapters.PaymentAdapter["refund"]>();
      const revokeSavedMethod = vi.fn<adapters.PaymentAdapter["revokeSavedMethod"]>().mockResolvedValue();
      vi.spyOn(adapters, "paymentAdapter").mockReturnValue({
        ...manual,
        id: "stripe",
        capabilities: () => ({ ...manual.capabilities(), savedMethods: true }),
        createCheckout,
        captureCheckout,
        refund,
        revokeSavedMethod,
      });
      return { createCheckout, captureCheckout, refund, revokeSavedMethod };
    }
    const back = () => new URL("/admin/payments", env().APP_URL).href;

    async function settledStripePayment(key: string) {
      const { invoice } = await issuedInvoice(key);
      const payment = await createPayment.call({ invoiceId: invoice.id, provider: "stripe", method: "hosted_checkout", amountMinor: 10_000, idempotencyKey: `pay-${key}`, metadata: {} }, OWNER);
      await startPayment.call({ id: payment.id, providerRef: `pi_${key}`, providerCheckoutRef: `cs_${key}` }, OWNER);
      return settlePayment.call({ id: payment.id, providerRef: `pi_${key}` }, OWNER);
    }

    it("commits the hosted checkout attempt before the provider is called and applies the answer afterwards", async () => {
      const { createCheckout, captureCheckout } = hostedStripe();
      const { invoice } = await issuedInvoice("owner-checkout");
      const seen: { open?: number; rows?: unknown; captureOpen?: number } = {};
      createCheckout.mockImplementation(async () => {
        seen.open = await openTransactions();
        seen.rows = await db().select().from(payments);
        return { providerRef: "cs_owner", paymentRef: "pi_owner", url: "https://checkout.example.test/pay" };
      });
      const begun = await beginPaymentCheckout.call({ invoiceId: invoice.id, provider: "stripe", successUrl: back(), cancelUrl: back(), idempotencyKey: "owner-checkout-1" }, OWNER);
      expect(seen.open).toBe(0);
      expect(seen.rows).toMatchObject([{ status: "created", idempotencyKey: "owner-checkout-1" }]);
      expect(createCheckout).toHaveBeenCalledTimes(1);
      expect(begun.payment).toMatchObject({ status: "processing", providerRef: "pi_owner", providerCheckoutRef: "cs_owner" });

      captureCheckout.mockImplementation(async () => {
        seen.captureOpen = await openTransactions();
        return { providerRef: "pi_owner", status: "succeeded", amountMinor: 10_000, currency: "CAD" };
      });
      const completed = await completePaymentCheckout.call({ paymentId: begun.payment.id, idempotencyKey: "owner-capture-1" }, OWNER);
      expect(seen.captureOpen).toBe(0);
      expect(completed.status).toBe("succeeded");
      expect((await getInvoice.call({ id: invoice.id }, OWNER)).invoice).toMatchObject({ status: "paid", paidMinor: 10_000 });
    });

    it("keeps a recoverable checkout attempt when the provider times out, and a same-key retry converges", async () => {
      const { createCheckout } = hostedStripe();
      const { invoice } = await issuedInvoice("owner-timeout");
      const input = { invoiceId: invoice.id, provider: "stripe" as const, successUrl: back(), cancelUrl: back(), idempotencyKey: "owner-timeout-1" };
      createCheckout.mockRejectedValueOnce(new Error("socket hang up after the provider accepted"));
      await expect(beginPaymentCheckout.call(input, OWNER)).rejects.toThrow();
      expect(await db().select().from(payments)).toMatchObject([{ status: "created", idempotencyKey: "owner-timeout-1" }]);

      createCheckout.mockResolvedValueOnce({ providerRef: "cs_retry", paymentRef: "pi_retry", url: "https://checkout.example.test/pay" });
      const retried = await beginPaymentCheckout.call(input, OWNER);
      expect(await db().select().from(payments)).toHaveLength(1);
      expect(retried.payment).toMatchObject({ status: "processing", providerRef: "pi_retry" });
      expect(createCheckout.mock.calls.map(([request]) => request.idempotencyKey)).toEqual(["owner-timeout-1", "owner-timeout-1"]);
    });

    it("commits the refund reservation before the provider is called and converges a retry after a lost answer", async () => {
      const { refund } = hostedStripe();
      const payment = await settledStripePayment("owner-refund");
      const input = { paymentId: payment.id, amountMinor: 4_000, reason: "Customer returned part of the order", idempotencyKey: "owner-refund-1" };
      const seen: { open?: number; reserved?: unknown } = {};
      refund.mockImplementationOnce(async () => {
        seen.open = await openTransactions();
        seen.reserved = await db().select().from(refunds);
        throw new Error("connection reset after the provider accepted");
      });
      await expect(submitProviderRefund.call(input, OWNER)).rejects.toThrow();
      expect(seen.open).toBe(0);
      expect(seen.reserved).toMatchObject([{ status: "created", amountMinor: 4_000 }]);
      // The attempt survives the failure, still reserving its amount.
      expect(await db().select().from(refunds)).toMatchObject([{ status: "created", idempotencyKey: "owner-refund-1" }]);

      refund.mockResolvedValueOnce({ providerRef: "re_1", status: "succeeded" });
      const settled = await submitProviderRefund.call(input, OWNER);
      expect(settled).toMatchObject({ status: "succeeded", providerRef: "re_1" });
      expect(await db().select().from(refunds)).toHaveLength(1);
      expect(refund.mock.calls.map(([request]) => request.idempotencyKey)).toEqual(["owner-refund-1", "owner-refund-1"]);
      expect((await getInvoice.call({ id: payment.invoiceId }, OWNER)).invoice.refundedMinor).toBe(4_000);
    });

    it("records a definitive provider refusal and releases the refund reservation", async () => {
      const { refund } = hostedStripe();
      const payment = await settledStripePayment("owner-refused");
      refund.mockRejectedValueOnce(new AdapterError("payments", "stripe", "invalid_request", "Refund amount is invalid.", false, "amount_too_small"));
      expect(await failure(submitProviderRefund.call({ paymentId: payment.id, amountMinor: 4_000, reason: "Refused by provider", idempotencyKey: "owner-refused-1" }, OWNER))).toMatchObject({ code: "validation" });
      expect(await db().select().from(refunds)).toMatchObject([{ status: "failed", failureCode: "provider_refused" }]);
    });

    const sameKeyInFlight = () => new AdapterError("payments", "stripe", "invalid_request", "The payment provider refused the request (idempotency_error).", false, "idempotency_error");
    const ago = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

    it("carries the provider's own error code, so a 409 same-key conflict is distinguishable from a refusal", async () => {
      const response = new Response(JSON.stringify({ error: { type: "idempotency_error", message: "A request with this key is in flight." } }), { status: 409 });
      const error = await providerJson("stripe", response).then(() => undefined, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ code: "invalid_request", providerCode: "idempotency_error" });
    });

    it("keeps the refund reservation and checkout attempt when the provider reports a same-key request in flight", async () => {
      const { refund, createCheckout } = hostedStripe();
      const payment = await settledStripePayment("owner-in-flight");
      refund.mockRejectedValueOnce(sameKeyInFlight());
      await expect(submitProviderRefund.call({ paymentId: payment.id, amountMinor: 4_000, reason: "Double-clicked refund", idempotencyKey: "owner-in-flight-refund" }, OWNER)).rejects.toThrow();
      // The first request may still refund the money: the amount stays reserved.
      expect(await db().select().from(refunds)).toMatchObject([{ status: "created" }]);

      const { invoice } = await issuedInvoice("checkout-in-flight");
      createCheckout.mockRejectedValueOnce(sameKeyInFlight());
      await expect(beginPaymentCheckout.call({ invoiceId: invoice.id, provider: "stripe", successUrl: back(), cancelUrl: back(), idempotencyKey: "checkout-in-flight-1" }, OWNER)).rejects.toThrow();
      expect(await db().select().from(payments).where(eq(payments.invoiceId, invoice.id))).toMatchObject([{ status: "created" }]);
    });

    it("never sends a failed checkout attempt to the provider again under its key", async () => {
      const { createCheckout } = hostedStripe();
      const { invoice } = await issuedInvoice("checkout-refused");
      const input = { invoiceId: invoice.id, provider: "stripe" as const, successUrl: back(), cancelUrl: back(), idempotencyKey: "checkout-refused-1" };
      createCheckout.mockRejectedValueOnce(new AdapterError("payments", "stripe", "invalid_request", "Amount too small.", false, "amount_too_small"));
      await expect(beginPaymentCheckout.call(input, OWNER)).rejects.toThrow();
      expect(await db().select().from(payments)).toMatchObject([{ status: "failed", failureCode: "provider_refused" }]);
      createCheckout.mockResolvedValue({ providerRef: "cs_again", paymentRef: "pi_again", url: "https://checkout.example.test/pay" });
      expect(await failure(beginPaymentCheckout.call(input, OWNER))).toMatchObject({ code: "conflict" });
      expect(createCheckout).toHaveBeenCalledTimes(1);
    });

    it("refuses a same-key retry once an open attempt outlives the provider's idempotency window", async () => {
      const { createCheckout, refund } = hostedStripe();
      const { invoice } = await issuedInvoice("checkout-old");
      const input = { invoiceId: invoice.id, provider: "stripe" as const, successUrl: back(), cancelUrl: back(), idempotencyKey: "checkout-old-1" };
      createCheckout.mockRejectedValueOnce(new Error("timeout"));
      await expect(beginPaymentCheckout.call(input, OWNER)).rejects.toThrow();
      await db().update(payments).set({ createdAt: ago(24) }).where(eq(payments.invoiceId, invoice.id));
      createCheckout.mockResolvedValue({ providerRef: "cs_late", paymentRef: "pi_late", url: "https://checkout.example.test/pay" });
      expect(await failure(beginPaymentCheckout.call(input, OWNER))).toMatchObject({ code: "conflict" });
      expect(createCheckout).toHaveBeenCalledTimes(1);

      const paid = await settledStripePayment("refund-old");
      const refundInput = { paymentId: paid.id, amountMinor: 1_000, reason: "Late retry of a lost refund", idempotencyKey: "refund-old-1" };
      refund.mockRejectedValueOnce(new Error("timeout"));
      await expect(submitProviderRefund.call(refundInput, OWNER)).rejects.toThrow();
      await db().update(refunds).set({ createdAt: ago(24) }).where(eq(refunds.paymentId, paid.id));
      refund.mockResolvedValue({ providerRef: "re_late", status: "succeeded" });
      expect(await failure(submitProviderRefund.call(refundInput, OWNER))).toMatchObject({ code: "conflict" });
      expect(refund).toHaveBeenCalledTimes(1);
    });

    it("lets an API key scoped only to the public checkout services run them end to end", async () => {
      const { createCheckout, captureCheckout } = hostedStripe();
      const { invoice } = await issuedInvoice("narrow-key");
      createCheckout.mockResolvedValue({ providerRef: "cs_key", paymentRef: "pi_key", url: "https://checkout.example.test/pay" });
      captureCheckout.mockResolvedValue({ providerRef: "pi_key", status: "succeeded", amountMinor: 10_000, currency: "CAD" });
      const begun = await beginPaymentCheckout.call(
        { invoiceId: invoice.id, provider: "stripe", successUrl: back(), cancelUrl: back(), idempotencyKey: "narrow-key-1" },
        { kind: "agent", keyName: "checkout-only", scopes: ["invoicing.beginPaymentCheckout"] },
      );
      expect(begun.payment.status).toBe("processing");
      const completed = await completePaymentCheckout.call(
        { paymentId: begun.payment.id, idempotencyKey: "narrow-key-capture" },
        { kind: "agent", keyName: "complete-only", scopes: ["invoicing.completePaymentCheckout"] },
      );
      expect(completed.status).toBe("succeeded");
      // Still refused for a key that names neither.
      expect(await failure(beginPaymentCheckout.call(
        { invoiceId: invoice.id, provider: "stripe", successUrl: back(), cancelUrl: back(), idempotencyKey: "narrow-key-2" },
        { kind: "agent", keyName: "other", scopes: ["invoicing.listPayments"] },
      ))).toMatchObject({ code: "permission" });
    });

    it("does not attach a checkout to an invoice that was paid while the provider was answering", async () => {
      const { createCheckout } = hostedStripe();
      const { invoice } = await issuedInvoice("paid-meanwhile");
      createCheckout.mockImplementation(async () => {
        await recordOfflinePayment.call({ invoiceId: invoice.id, method: "bank_transfer", amountMinor: 10_000, reference: "PAID-ELSEWHERE", evidence: "Paid by transfer during checkout.", idempotencyKey: "paid-meanwhile-offline" }, OWNER);
        return { providerRef: "cs_meanwhile", paymentRef: "pi_meanwhile", url: "https://checkout.example.test/pay" };
      });
      expect(await failure(beginPaymentCheckout.call({ invoiceId: invoice.id, provider: "stripe", successUrl: back(), cancelUrl: back(), idempotencyKey: "paid-meanwhile-1" }, OWNER))).toMatchObject({ code: "conflict" });
      expect(await db().select().from(payments).where(eq(payments.provider, "stripe"))).toMatchObject([{ status: "created", providerCheckoutRef: null }]);
    });

    it("records a provider's already-refunded answer for review instead of as a plain refusal", async () => {
      const { refund } = hostedStripe();
      const payment = await settledStripePayment("already-refunded");
      refund.mockRejectedValueOnce(new AdapterError("payments", "stripe", "invalid_request", "The payment provider refused the request (charge_already_refunded).", false, "charge_already_refunded"));
      await expect(submitProviderRefund.call({ paymentId: payment.id, amountMinor: 4_000, reason: "Refunded in the provider dashboard", idempotencyKey: "already-refunded-1" }, OWNER)).rejects.toThrow();
      const [recorded] = await db().select().from(refunds);
      expect(recorded).toMatchObject({ status: "failed", failureCode: "provider_already_refunded" });
      const books = await reconcilePaymentProviders.call({}, OWNER);
      expect(books.refundsNeedingReview).toMatchObject([{ id: recorded!.id, failureCode: "provider_already_refunded" }]);
    });

    it("elevates orchestrator phases only as the system and keeps who asked in the audit", async () => {
      expect(Object.keys(providerService)).not.toContain("phaseActor");
      const { createCheckout } = hostedStripe();
      const { invoice } = await issuedInvoice("audit-initiator");
      createCheckout.mockResolvedValue({ providerRef: "cs_audit", paymentRef: "pi_audit", url: "https://checkout.example.test/pay" });
      await beginPaymentCheckout.call(
        { invoiceId: invoice.id, provider: "stripe", successUrl: back(), cancelUrl: back(), idempotencyKey: "audit-initiator-1" },
        { kind: "agent", keyName: "checkout-only", scopes: ["invoicing.beginPaymentCheckout"] },
      );
      const rows = await db().select().from(auditLog).where(eq(auditLog.action, "invoicing.claimPaymentCheckout"));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actor).toBe("system");
      expect((rows[0]?.diff as Record<string, unknown>).initiatedBy).toBe("agent:checkout-only");
    });

    it("revokes a saved method with the provider outside a transaction", async () => {
      const { revokeSavedMethod } = hostedStripe();
      const { contact } = await issuedInvoice("revoke-method");
      const [method] = await db().insert(paymentMethods).values({
        contactId: contact.id, provider: "stripe", providerMethodRef: "pm_revoke", kind: "card", label: "card ending 4242",
        last4: "4242", status: "active", consentSource: "provider_checkout", consentedAt: new Date(), providerStatusAt: new Date(),
      }).returning();
      const seen: { open?: number } = {};
      revokeSavedMethod.mockImplementation(async () => {
        seen.open = await openTransactions();
      });
      const revoked = await revokeSavedPaymentMethod.call({ id: method!.id, idempotencyKey: "revoke-1" }, OWNER);
      expect(seen.open).toBe(0);
      expect(revoked.status).toBe("revoked");
      expect(revokeSavedMethod).toHaveBeenCalledWith({ providerRef: "pm_revoke", idempotencyKey: "revoke-1" });
    });
  });

  afterAll(closeDb);
});
