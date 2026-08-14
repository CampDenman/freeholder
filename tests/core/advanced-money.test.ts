// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.08 deposits, plans, flexible pricing, balances, fees, and payout proof.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import {
  adjustCustomerBalance,
  applyCustomerBalance,
  assessLateFee,
  createDepositAndBalanceInvoices,
  createFlexiblePaymentInvoice,
  createPaymentPlan,
  getCustomerBalance,
  getPaymentPlan,
  reconcileAdvancedMoney,
  reconcileProviderPayout,
  recordProviderBalanceTransaction,
  recordProviderPayoutObservation,
  refundCustomerBalancePayment,
} from "@/modules/invoicing/advanced-money-service";
import {
  createDraftInvoice,
  createPayment,
  issueInvoice,
  settlePayment,
} from "@/modules/invoicing/invoice-service";
import {
  customerBalanceAccounts,
  invoices,
  paymentAllocations,
} from "@/modules/invoicing/schema";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const noTax = { mode: "not_applicable" as const, reason: "No tax applies to this test transaction." };
const line = (amountMinor: number, description = "Professional service") => ({
  description,
  quantityMicros: 1_000_000,
  unitAmountMinor: amountMinor,
  discountMinor: 0,
  taxCategoryCode: "standard",
  requiresShipping: false,
  snapshot: { source: "advanced-money-test" },
});

async function contact(name = "Advanced Buyer", email = "advanced@example.test") {
  return createContact.call({ name, email }, OWNER);
}

async function openInvoice(contactId: string, key: string, amountMinor = 10_000, dueAt?: Date) {
  const draft = await createDraftInvoice.call({
    contactId,
    currency: "CAD",
    idempotencyKey: key,
    lines: [line(amountMinor)],
    shippingMinor: 0,
    dueAt,
    tax: noTax,
  }, OWNER);
  return issueInvoice.call({ id: draft.invoice.id, dueAt }, OWNER);
}

describe.runIf(hasDatabase)("advanced invoice terms", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);

  it("creates immutable linked deposit and balance invoices", async () => {
    const buyer = await contact();
    const pair = await createDepositAndBalanceInvoices.call({
      contactId: buyer.id,
      currency: "CAD",
      sourceType: "quote",
      sourceId: "quote-42",
      deposit: { lines: [line(2_500, "Project deposit")] },
      balance: { lines: [line(7_500, "Project balance")] },
      tax: noTax,
      issueNow: true,
      idempotencyKey: "deposit-pair-1",
    }, OWNER);
    expect(pair.deposit).toMatchObject({ sourceType: "deposit", totalMinor: 2_500, status: "sent" });
    expect(pair.balance).toMatchObject({ sourceType: "balance", totalMinor: 7_500, status: "sent", depositOfInvoiceId: pair.deposit.id });
    const replay = await createDepositAndBalanceInvoices.call({
      contactId: buyer.id,
      currency: "CAD",
      sourceType: "quote",
      sourceId: "quote-42",
      deposit: { lines: [line(2_500, "Project deposit")] },
      balance: { lines: [line(7_500, "Project balance")] },
      tax: noTax,
      issueNow: true,
      idempotencyKey: "deposit-pair-1",
    }, OWNER);
    expect(replay).toMatchObject({ deposit: { id: pair.deposit.id }, balance: { id: pair.balance.id } });
  });

  it("allocates any number of partial payments FIFO across exact installments", async () => {
    const buyer = await contact();
    const invoice = await openInvoice(buyer.id, "plan-invoice");
    const plan = await createPaymentPlan.call({
      invoiceId: invoice.invoice.id,
      installments: [
        { dueAt: new Date("2026-09-01T12:00:00Z"), amountMinor: 3_000 },
        { dueAt: new Date("2026-10-01T12:00:00Z"), amountMinor: 3_000 },
        { dueAt: new Date("2026-11-01T12:00:00Z"), amountMinor: 4_000 },
      ],
      idempotencyKey: "plan-1",
    }, OWNER);
    for (const [index, amountMinor] of [2_000, 2_500, 5_500].entries()) {
      const payment = await createPayment.call({ invoiceId: invoice.invoice.id, provider: "manual", method: "bank_transfer", amountMinor, idempotencyKey: `plan-payment-${index}` }, OWNER);
      await settlePayment.call({ id: payment.id, providerRef: `manual:plan:${index}`, processedAt: new Date("2026-08-20T12:00:00Z") }, OWNER);
    }
    const result = await getPaymentPlan.call({ invoiceId: invoice.invoice.id }, OWNER);
    expect(result.plan).toMatchObject({ id: plan.plan.id, status: "completed", paidMinor: 10_000 });
    expect(result.installments.map((row) => [row.amountMinor, row.paidMinor, row.status])).toEqual([
      [3_000, 3_000, "paid"],
      [3_000, 3_000, "paid"],
      [4_000, 4_000, "paid"],
    ]);
    expect((await db().select().from(paymentAllocations)).map((row) => row.amountMinor).sort((a, b) => a - b)).toEqual([1_000, 1_500, 1_500, 2_000, 4_000]);
  });

  it("bounds voluntary amounts and creates normal issued tip invoices", async () => {
    const buyer = await contact();
    const attached = await openInvoice(buyer.id, "tip-base", 5_000);
    const invalid = await failure(createFlexiblePaymentInvoice.call({
      kind: "tip",
      contactId: buyer.id,
      currency: "CAD",
      chosenMinor: 400,
      minimumMinor: 500,
      maximumMinor: 2_000,
      context: "invoice",
      attachedInvoiceId: attached.invoice.id,
      description: "Thank-you tip",
      tax: noTax,
      idempotencyKey: "tip-too-low",
    }, OWNER));
    expect(invalid.code).toBe("validation");
    const tip = await createFlexiblePaymentInvoice.call({
      kind: "tip",
      contactId: buyer.id,
      currency: "CAD",
      chosenMinor: 1_250,
      minimumMinor: 500,
      maximumMinor: 2_000,
      context: "invoice",
      attachedInvoiceId: attached.invoice.id,
      description: "Thank-you tip",
      message: "Wonderful work",
      tax: noTax,
      idempotencyKey: "tip-valid",
    }, OWNER);
    expect(tip).toMatchObject({ flexiblePayment: { kind: "tip", chosenMinor: 1_250, attachedInvoiceId: attached.invoice.id }, invoice: { sourceType: "tip", totalMinor: 1_250, status: "sent" } });
  });

  it("waits through grace, calculates against outstanding principal, and caps a separate late-fee invoice", async () => {
    const buyer = await contact();
    const dueAt = new Date("2026-08-01T12:00:00Z");
    const invoice = await openInvoice(buyer.id, "late-source", 10_000, dueAt);
    const early = await failure(assessLateFee.call({
      invoiceId: invoice.invoice.id,
      terms: { basis: "percentage", ratePpm: 100_000, capMinor: 750 },
      graceDays: 10,
      asOf: new Date("2026-08-10T12:00:00Z"),
      reason: "Contractual late-payment term",
      tax: noTax,
      idempotencyKey: "late-early",
    }, OWNER));
    expect(early.code).toBe("conflict");
    const fee = await assessLateFee.call({
      invoiceId: invoice.invoice.id,
      terms: { basis: "percentage", ratePpm: 100_000, capMinor: 750 },
      graceDays: 10,
      asOf: new Date("2026-08-12T12:00:00Z"),
      reason: "Contractual late-payment term",
      tax: noTax,
      idempotencyKey: "late-valid",
    }, OWNER);
    expect(fee).toMatchObject({ assessment: { sourceInvoiceId: invoice.invoice.id, outstandingMinor: 10_000, assessedMinor: 750 }, invoice: { sourceType: "late_fee", totalMinor: 750, status: "sent" } });
    expect((await db().select().from(invoices).where(eq(invoices.id, invoice.invoice.id)))[0]?.totalMinor).toBe(10_000);
  });
});

describe.runIf(hasDatabase)("customer balances and provider payouts", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);

  it("spends balance once under a race and restores credit through the refund ledger", async () => {
    const buyer = await contact();
    await adjustCustomerBalance.call({ contactId: buyer.id, currency: "CAD", direction: "credit", amountMinor: 10_000, reason: "Gift certificate purchase", idempotencyKey: "balance-credit" }, OWNER);
    const invoice = await openInvoice(buyer.id, "balance-invoice");
    const raced = await Promise.allSettled([
      applyCustomerBalance.call({ invoiceId: invoice.invoice.id, amountMinor: 7_000, idempotencyKey: "balance-spend-a" }, OWNER),
      applyCustomerBalance.call({ invoiceId: invoice.invoice.id, amountMinor: 7_000, idempotencyKey: "balance-spend-b" }, OWNER),
    ]);
    expect(raced.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    const succeeded = raced.find((row): row is PromiseFulfilledResult<Awaited<ReturnType<typeof applyCustomerBalance.call>>> => row.status === "fulfilled")!;
    expect((await getCustomerBalance.call({ contactId: buyer.id }, OWNER)).accounts[0]?.balanceMinor).toBe(3_000);
    await refundCustomerBalancePayment.call({ paymentId: succeeded.value.payment.id, amountMinor: 2_000, reason: "Partial return to store credit", idempotencyKey: "balance-refund" }, OWNER);
    const balance = await getCustomerBalance.call({ contactId: buyer.id }, OWNER);
    expect(balance.accounts[0]?.balanceMinor).toBe(5_000);
    expect(balance.entries.map((row) => row.deltaMinor).sort((a, b) => a - b)).toEqual([-7_000, 2_000, 10_000]);
  });

  it("reconciles provider fees and negative adjustments exactly to a payout", async () => {
    const charge = await recordProviderBalanceTransaction.call({ provider: "stripe", providerRef: "txn-charge", kind: "charge", currency: "CAD", grossMinor: 10_000, feeMinor: 300, occurredAt: new Date("2026-08-14T12:00:00Z") }, OWNER);
    const refund = await recordProviderBalanceTransaction.call({ provider: "stripe", providerRef: "txn-refund", kind: "refund", currency: "CAD", grossMinor: -500, feeMinor: 0, occurredAt: new Date("2026-08-14T12:01:00Z") }, OWNER);
    const observed = await recordProviderPayoutObservation.call({ provider: "stripe", providerRef: "po_1", status: "paid", currency: "CAD", amountMinor: 9_200, occurredAt: new Date("2026-08-15T12:00:00Z"), statementRef: "FREEHOLDER PAYOUT" }, OWNER);
    const wrong = await failure(reconcileProviderPayout.call({ payoutId: observed.payout.id, balanceTransactionIds: [charge.id] }, OWNER));
    expect(wrong.code).toBe("conflict");
    const reconciled = await reconcileProviderPayout.call({ payoutId: observed.payout.id, balanceTransactionIds: [charge.id, refund.id] }, OWNER);
    expect(reconciled.netMinor).toBe(9_200);
    expect(reconciled.payout.reconciledAt).toBeInstanceOf(Date);
    await expect(reconcileAdvancedMoney.call({}, OWNER)).resolves.toMatchObject({ balanced: true, discrepancies: [], checked: { providerPayouts: 1 } });
    const failed = await recordProviderPayoutObservation.call({ provider: "stripe", providerRef: "po_1", status: "failed", currency: "CAD", amountMinor: 9_200, occurredAt: new Date("2026-08-16T12:00:00Z"), failureReason: "Destination bank returned the payout" }, OWNER);
    expect(failed.payout).toMatchObject({ status: "failed", reconciledAt: null });
  });

  it("combines same-currency credit on contact merge and restores both ledgers on undo", async () => {
    const survivor = await contact("Survivor", "survivor-balance@example.test");
    const duplicate = await contact("Duplicate", "duplicate-balance@example.test");
    await adjustCustomerBalance.call({ contactId: survivor.id, currency: "CAD", direction: "credit", amountMinor: 2_000, reason: "Survivor credit", idempotencyKey: "survivor-credit" }, OWNER);
    await adjustCustomerBalance.call({ contactId: duplicate.id, currency: "CAD", direction: "credit", amountMinor: 3_000, reason: "Duplicate credit", idempotencyKey: "duplicate-credit" }, OWNER);
    const merged = await mergeContacts.call({ survivingId: survivor.id, duplicateId: duplicate.id }, OWNER);
    expect((await getCustomerBalance.call({ contactId: survivor.id }, OWNER)).accounts).toMatchObject([{ balanceMinor: 5_000 }]);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    const restored = await db().select().from(customerBalanceAccounts).orderBy(customerBalanceAccounts.balanceMinor);
    expect(restored.map((row) => [row.contactId, row.balanceMinor])).toEqual([[survivor.id, 2_000], [duplicate.id, 3_000]]);
  });
});

afterAll(closeDb);
