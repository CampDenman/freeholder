// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.06 database proof for offline money and authenticated provider convergence.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact } from "@/core/contacts/service";
import {
  createDraftInvoice,
  createPayment,
  getInvoice,
  issueInvoice,
  startPayment,
} from "@/modules/invoicing/invoice-service";
import {
  listPaymentDisputes,
  listSavedPaymentMethods,
  processPaymentProviderEvents,
  recordOfflinePayment,
  recordOfflineRefund,
} from "@/modules/invoicing/payment-provider-service";
import {
  paymentDisputes,
  paymentMethods,
  paymentProviderEvents,
  payments,
  providerPayouts,
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

describe.runIf(hasDatabase)("payment provider services", () => {
  beforeEach(truncateSpine);

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

  afterAll(closeDb);
});
