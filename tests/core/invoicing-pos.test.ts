// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.24 cash collection, receipts and in-person reconciliation.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/core/contacts/service";
import { createLocationService } from "@/core/locations/service";
import {
  createDraftInvoice,
  getPaymentReceipt,
  issueInvoice,
} from "@/modules/invoicing/invoice-service";
import {
  beginInPersonPayment,
  listPointOfSale,
  reconcileInPersonPayments,
  refundInPersonPayment,
} from "@/modules/invoicing/pos-service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("in-person payments", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("collects cash at a location, issues a receipt, and refunds through the same ledger", async () => {
    const adapters = await listPointOfSale.call({}, OWNER);
    expect(adapters.find((row) => row.id === "manual")?.capabilities.cashRecording).toBe(true);

    const person = await createContact.call({ name: "Walk-in", email: "walkin@example.test" }, OWNER);
    const studio = await createLocationService.call(
      { name: "Studio", slug: "pos-studio", city: "Courtenay", country: "CA" },
      OWNER,
    );
    const draft = await createDraftInvoice.call(
      {
        contactId: person.id,
        currency: "CAD",
        idempotencyKey: "pos-inv-1",
        lines: [
          {
            description: "Print",
            quantityMicros: 1_000_000,
            unitAmountMinor: 2_500,
          },
        ],
        tax: { mode: "not_applicable", reason: "No collection obligation applies to this test transaction." },
      },
      OWNER,
    );
    const issued = await issueInvoice.call({ id: draft.invoice.id }, OWNER);
    const taken = await beginInPersonPayment.call(
      {
        invoiceId: issued.invoice.id,
        locationId: studio.id,
        method: "cash",
        amountMinor: 2_500,
        idempotencyKey: "pos-cash-1",
      },
      OWNER,
    );
    expect(taken.payment.status).toBe("succeeded");
    expect(taken.receipt?.receiptNumber).toContain("PAY-");
    const receipt = await getPaymentReceipt.call({ paymentId: taken.payment.id }, OWNER);
    expect(receipt.payment.amountMinor).toBe(2_500);
    expect(receipt.payment.method).toBe("cash");

    const refunded = await refundInPersonPayment.call(
      {
        paymentId: taken.payment.id,
        amountMinor: 2_500,
        reason: "Customer changed their mind.",
        idempotencyKey: "pos-cash-refund-1",
      },
      OWNER,
    );
    expect(refunded.status).toBe("succeeded");
    const books = await reconcileInPersonPayments.call({}, OWNER);
    expect(books.succeeded).toBe(1);
    expect(books.balanced).toBe(true);

    const other = await createDraftInvoice.call(
      {
        contactId: person.id,
        currency: "CAD",
        idempotencyKey: "pos-inv-2",
        lines: [{ description: "Card", quantityMicros: 1_000_000, unitAmountMinor: 1_000 }],
        tax: { mode: "not_applicable", reason: "No collection obligation applies to this test transaction." },
      },
      OWNER,
    );
    const cardInvoice = await issueInvoice.call({ id: other.invoice.id }, OWNER);
    expect(
      (await failure(
        beginInPersonPayment.call(
          {
            invoiceId: cardInvoice.invoice.id,
            locationId: studio.id,
            method: "card_present",
            amountMinor: 1_000,
            idempotencyKey: "pos-stripe-missing",
          },
          OWNER,
        ),
      )).message,
    ).toMatch(/STRIPE_SECRET_KEY/);
  });
});
