// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.24 cash collection, receipts and in-person reconciliation.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as posAdapters from "@/adapters/point-of-sale";
import { AdapterError } from "@/adapters/types";
import { createContact } from "@/core/contacts/service";
import { db } from "@/core/db";
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
import { payments, refunds } from "@/modules/invoicing/schema";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("in-person payments", { timeout: 30_000 }, () => {
  beforeEach(async () => { vi.restoreAllMocks(); await truncateSpine(); });
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
  describe("Terminal I/O outside service transactions (C11.10)", () => {
    /** Sessions holding a transaction open while waiting; test files run serially. */
    async function openTransactions(): Promise<number> {
      const rows = await db().execute<{ open: number }>(sql`
        select count(*)::int as open from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid() and state like 'idle in transaction%'
      `);
      return Number(rows[0]?.open ?? 0);
    }

    function terminal() {
      const collect = vi.fn<posAdapters.PointOfSaleAdapter["collect"]>();
      const refund = vi.fn<posAdapters.PointOfSaleAdapter["refund"]>();
      const fake: posAdapters.PointOfSaleAdapter = {
        id: "stripe",
        status: { family: "point_of_sale", id: "stripe", available: true, message: "Test Terminal." },
        capabilities: () => ({ countertop: true, tapToPay: true, cashRecording: false, refunds: true }),
        collect,
        refund,
        verifyWebhook: async () => [],
      };
      const manual = posAdapters.createManualPointOfSale();
      vi.spyOn(posAdapters, "pointOfSaleAdapter").mockImplementation((id) => (id === "stripe" ? fake : manual));
      return { collect, refund };
    }

    async function cardInvoice(key: string) {
      const person = await createContact.call({ name: "Card buyer", email: `${key}@example.test` }, OWNER);
      const studio = await createLocationService.call({ name: "Studio", slug: `pos-${key}`, city: "Courtenay", country: "CA" }, OWNER);
      const draft = await createDraftInvoice.call({
        contactId: person.id,
        currency: "CAD",
        idempotencyKey: `pos-inv-${key}`,
        lines: [{ description: "Card", quantityMicros: 1_000_000, unitAmountMinor: 1_000 }],
        tax: { mode: "not_applicable", reason: "No collection obligation applies to this test transaction." },
      }, OWNER);
      const issued = await issueInvoice.call({ id: draft.invoice.id }, OWNER);
      return { invoiceId: issued.invoice.id, locationId: studio.id };
    }

    it("commits the Terminal attempt and refund reservation before the reader is contacted", async () => {
      const { collect, refund } = terminal();
      const { invoiceId, locationId } = await cardInvoice("terminal-ok");
      const seen: { open?: number; rows?: unknown } = {};
      collect.mockImplementation(async (request) => {
        seen.open = await openTransactions();
        seen.rows = await db().select().from(payments);
        return { providerRef: `pi_${request.idempotencyKey}`, status: "succeeded" };
      });
      const taken = await beginInPersonPayment.call({ invoiceId, locationId, method: "card_present", amountMinor: 1_000, idempotencyKey: "terminal-ok-1" }, OWNER);
      expect(seen.open).toBe(0);
      expect(seen.rows).toMatchObject([{ status: "created", provider: "stripe", method: "card_present" }]);
      expect(taken.payment.status).toBe("succeeded");
      expect(taken.receipt?.receiptNumber).toContain("PAY-");

      const refundSeen: { open?: number; rows?: unknown } = {};
      refund.mockImplementation(async () => {
        refundSeen.open = await openTransactions();
        refundSeen.rows = await db().select().from(refunds);
        return { providerRef: "re_terminal", status: "succeeded" };
      });
      const refunded = await refundInPersonPayment.call({ paymentId: taken.payment.id, amountMinor: 1_000, reason: "Customer changed their mind.", idempotencyKey: "terminal-refund-1" }, OWNER);
      expect(refundSeen.open).toBe(0);
      expect(refundSeen.rows).toMatchObject([{ status: "created", amountMinor: 1_000 }]);
      expect(refunded).toMatchObject({ status: "succeeded", providerRef: "re_terminal" });
    });

    it("keeps a reconcilable Terminal attempt when the reader times out, and a same-key retry converges", async () => {
      const { collect } = terminal();
      const { invoiceId, locationId } = await cardInvoice("terminal-timeout");
      const input = { invoiceId, locationId, method: "card_present" as const, amountMinor: 1_000, idempotencyKey: "terminal-timeout-1" };
      collect.mockRejectedValueOnce(new Error("reader connection lost after the charge was accepted"));
      await expect(beginInPersonPayment.call(input, OWNER)).rejects.toThrow();
      const books = await reconcileInPersonPayments.call({}, OWNER);
      expect(books.balanced).toBe(false);
      expect(books.unsettled).toMatchObject([{ status: "created", idempotencyKey: "terminal-timeout-1" }]);

      collect.mockResolvedValueOnce({ providerRef: "pi_timeout", status: "succeeded" });
      const retried = await beginInPersonPayment.call(input, OWNER);
      expect(retried.payment).toMatchObject({ status: "succeeded", providerRef: "pi_timeout" });
      expect(await db().select().from(payments)).toHaveLength(1);
      expect(collect.mock.calls.map(([request]) => request.idempotencyKey)).toEqual(["terminal-timeout-1", "terminal-timeout-1"]);
      expect((await reconcileInPersonPayments.call({}, OWNER)).balanced).toBe(true);
    });

    const ago = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

    it("keeps the Terminal attempt open when the reader is busy after the intent exists, and a retry converges", async () => {
      const { collect } = terminal();
      const { invoiceId, locationId } = await cardInvoice("terminal-busy");
      const input = { invoiceId, locationId, method: "card_present" as const, amountMinor: 1_000, readerRef: "tmr_1", idempotencyKey: "terminal-busy-1" };
      collect.mockRejectedValueOnce(new AdapterError("payments", "stripe", "invalid_request", "The payment provider refused the request (terminal_reader_busy).", false, "terminal_reader_busy"));
      await expect(beginInPersonPayment.call(input, OWNER)).rejects.toThrow();
      expect(await db().select().from(payments)).toMatchObject([{ status: "created" }]);
      collect.mockResolvedValueOnce({ providerRef: "pi_busy", status: "succeeded" });
      expect((await beginInPersonPayment.call(input, OWNER)).payment).toMatchObject({ status: "succeeded", providerRef: "pi_busy" });
    });

    it("never resubmits a failed or expired Terminal attempt to the reader under its key", async () => {
      const { collect } = terminal();
      const failed = await cardInvoice("terminal-failed");
      const failedInput = { ...failed, method: "card_present" as const, amountMinor: 1_000, idempotencyKey: "terminal-failed-1" };
      collect.mockResolvedValueOnce({ providerRef: "pi_failed", status: "failed" });
      expect((await beginInPersonPayment.call(failedInput, OWNER)).payment.status).toBe("failed");
      collect.mockResolvedValue({ providerRef: "pi_failed", status: "succeeded" });
      expect(await failure(beginInPersonPayment.call(failedInput, OWNER))).toMatchObject({ code: "conflict" });
      expect(collect).toHaveBeenCalledTimes(1);

      const old = await cardInvoice("terminal-old");
      const oldInput = { ...old, method: "card_present" as const, amountMinor: 1_000, idempotencyKey: "terminal-old-1" };
      collect.mockRejectedValueOnce(new Error("reader timeout"));
      await expect(beginInPersonPayment.call(oldInput, OWNER)).rejects.toThrow();
      await db().update(payments).set({ createdAt: ago(24) }).where(eq(payments.invoiceId, old.invoiceId));
      expect(await failure(beginInPersonPayment.call(oldInput, OWNER))).toMatchObject({ code: "conflict" });
      expect(collect).toHaveBeenCalledTimes(2);
    });

    it("lists a pending Terminal refund for reconciliation instead of holding it out of sight", async () => {
      const { collect, refund } = terminal();
      const { invoiceId, locationId } = await cardInvoice("terminal-pending-refund");
      collect.mockResolvedValue({ providerRef: "pi_pending_refund", status: "succeeded" });
      const taken = await beginInPersonPayment.call({ invoiceId, locationId, method: "card_present", amountMinor: 1_000, idempotencyKey: "terminal-pending-1" }, OWNER);
      refund.mockResolvedValue({ providerRef: "re_pending", status: "pending" });
      const pending = await refundInPersonPayment.call({ paymentId: taken.payment.id, amountMinor: 1_000, reason: "Card refund still settling.", idempotencyKey: "terminal-pending-refund-1" }, OWNER);
      expect(pending).toMatchObject({ status: "processing", providerRef: "re_pending" });
      const books = await reconcileInPersonPayments.call({}, OWNER);
      expect(books.balanced).toBe(false);
      expect(books.refundsNeedingReview).toMatchObject([{ id: pending.id, status: "processing" }]);
    });
  });
});
