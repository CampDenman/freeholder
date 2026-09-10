// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.25: customer authorization, durable provider boundaries and money truth.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as adapters from "@/adapters/payments";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createContact } from "@/core/contacts/service";
import { mailOutbox } from "@/core/mail/schema";
import { decryptMailOutbox } from "@/core/mail/outbox-crypto";
import { myRecords } from "@/core/portal/service";
import { getExternalService } from "@/core/service";
import { beginCustomerCheckout, confirmCustomerPayment, customerPaymentReceipt, getCustomerInvoice, sendInvoice, viewCustomerInvoice } from "@/modules/invoicing/customer-service";
import { invoiceAccessToken, paymentReturnToken, validInvoiceToken, validPaymentReturnToken } from "@/modules/invoicing/customer-tokens";
import { createDraftInvoice, getInvoice, issueInvoice, markInvoiceOverdue, voidInvoice } from "@/modules/invoicing/invoice-service";
import { recordOfflinePayment } from "@/modules/invoicing/payment-provider-service";
import { invoices, payments } from "@/modules/invoicing/schema";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ANON = { kind: "anonymous" } as const;

describe("invoice capabilities (C5.25)", () => {
  it("binds an invoice token to its issue and contact and separates payment returns", () => {
    const invoice = { id: "invoice-a", contactId: "contact-a", issuedAt: new Date() };
    const token = invoiceAccessToken(invoice);
    expect(validInvoiceToken(invoice, token)).toBe(true);
    expect(validInvoiceToken({ ...invoice, id: "invoice-b" }, token)).toBe(false);
    expect(validInvoiceToken({ ...invoice, contactId: "contact-b" }, token)).toBe(false);
    expect(validInvoiceToken(invoice, "x".repeat(64))).toBe(false);
    const payment = { id: "payment-a", createdAt: new Date() };
    expect(validPaymentReturnToken(payment, paymentReturnToken(payment))).toBe(true);
    expect(validPaymentReturnToken(payment, token)).toBe(false);
    const old = { ...payment, createdAt: new Date(Date.now() - 8 * 86_400_000) };
    expect(validPaymentReturnToken(old, paymentReturnToken(old))).toBe(false);
  });
});

describe.runIf(hasDatabase)("customer invoices", () => {
  beforeEach(async () => { vi.restoreAllMocks(); await truncateSpine(); });
  afterAll(async () => { vi.restoreAllMocks(); await closeDb(); });

  async function fixture(key = "customer-invoice") {
    const contact = await createContact.call({ name: "Rae Buyer", email: `${key}@example.test` }, OWNER);
    await db().insert(users).values({ id: CUSTOMER.userId, email: contact.email!, role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
    const draft = await createDraftInvoice.call({ contactId: contact.id, currency: "CAD", idempotencyKey: key,
      lines: [{ description: "Photography", quantityMicros: 1_000_000, unitAmountMinor: 10_000 }],
      tax: { mode: "not_applicable", reason: "No tax on this test transaction." },
    }, OWNER);
    const { invoice } = await issueInvoice.call({ id: draft.invoice.id }, OWNER);
    return { invoice, token: invoiceAccessToken(invoice), contact };
  }

  function hosted() {
    const createCheckout = vi.fn<adapters.PaymentAdapter["createCheckout"]>().mockResolvedValue({ providerRef: "checkout-1", paymentRef: "payment-1", url: "https://checkout.example.test/pay" });
    const captureCheckout = vi.fn<adapters.PaymentAdapter["captureCheckout"]>().mockResolvedValue({ providerRef: "payment-1", status: "succeeded", amountMinor: 10_000, currency: "CAD" });
    vi.spyOn(adapters, "paymentAdapter").mockReturnValue({ ...adapters.createManualPayments(), id: "stripe", createCheckout, captureCheckout });
    return { createCheckout, captureCheckout };
  }

  it("serves only the linked contact or exact token and exposes a safe customer projection", async () => {
    const { invoice, token } = await fixture();
    expect(await getCustomerInvoice.call({ id: invoice.id }, CUSTOMER)).toMatchObject({ number: invoice.number, totalMinor: 10_000 });
    const publicInvoice = await getCustomerInvoice.call({ id: invoice.id, token }, ANON);
    expect(publicInvoice).not.toHaveProperty("contactId");
    expect(publicInvoice).not.toHaveProperty("requestHash");
    expect(publicInvoice).not.toHaveProperty("payments");
    for (const actor of [ANON, OWNER]) expect(await failure(getCustomerInvoice.call({ id: invoice.id }, actor))).toMatchObject({ code: "not_found" });
    const otherId = randomUUID();
    await db().insert(users).values({ id: otherId, email: "other-invoice@example.test", role: "customer" });
    const other = await createContact.call({ name: "Another buyer", email: "other-invoice@example.test" }, OWNER);
    await db().update(contacts).set({ userId: otherId }).where(eq(contacts.id, other.id));
    expect(await failure(getCustomerInvoice.call({ id: invoice.id }, { ...CUSTOMER, userId: otherId }))).toMatchObject({ code: "not_found" });
    expect(await failure(getCustomerInvoice.call({ id: invoice.id, token: "0".repeat(64) }, ANON))).toMatchObject({ code: "not_found" });
    const rooms = await myRecords.call({ section: "invoices" }, CUSTOMER);
    expect(rooms[0]?.records[0]?.href).toBe(`/portal/invoices/${invoice.id}`);
    expect(JSON.stringify(rooms)).not.toContain(token);
  });

  it("records a first view once and preserves an overdue invoice's state", async () => {
    const { invoice, token } = await fixture();
    const access = { id: invoice.id, token };
    await viewCustomerInvoice.call(access, ANON);
    const first = (await getInvoice.call({ id: invoice.id }, OWNER)).invoice;
    expect(first.status).toBe("viewed");
    await viewCustomerInvoice.call(access, ANON);
    expect((await getInvoice.call({ id: invoice.id }, OWNER)).invoice.viewedAt).toEqual(first.viewedAt);
    // A reminder may reach somebody who never opened the original email.
    await db().update(invoices).set({ viewedAt: null, dueAt: new Date(0) }).where(eq(invoices.id, invoice.id));
    await markInvoiceOverdue.call({ id: invoice.id }, OWNER);
    await viewCustomerInvoice.call(access, ANON);
    const overdue = (await getInvoice.call({ id: invoice.id }, OWNER)).invoice;
    expect(overdue.status).toBe("overdue");
    expect(overdue.viewedAt).toBeInstanceOf(Date);
  });

  it("retires paid and void invoice links while preserving a customer's historic read", async () => {
    const { invoice, token } = await fixture();
    await recordOfflinePayment.call({ invoiceId: invoice.id, method: "cash", amountMinor: 10_000, evidence: "Cash received and counted.", idempotencyKey: "paid" }, OWNER);
    expect(await failure(getCustomerInvoice.call({ id: invoice.id, token }, ANON))).toMatchObject({ code: "not_found" });
    expect(await getCustomerInvoice.call({ id: invoice.id }, CUSTOMER)).toMatchObject({ status: "paid", canPay: false });
    expect(await failure(beginCustomerCheckout.call({ id: invoice.id, token }, ANON))).toMatchObject({ code: "not_found" });
  });

  it("queues the private link once in the encrypted mail outbox", async () => {
    const { invoice, token } = await fixture();
    const input = { id: invoice.id, idempotencyKey: "email-1" };
    const sent = await sendInvoice.call(input, OWNER);
    expect((await sendInvoice.call(input, OWNER)).deliveryId).toBe(sent.deliveryId);
    const [outbox] = await db().select().from(mailOutbox);
    expect(outbox).toBeDefined();
    const body = decryptMailOutbox(outbox!.encryptedMessage, sent.deliveryId);
    expect(body).toContain(`/portal/invoices/${invoice.id}?token=${token}`);
    expect(await failure(sendInvoice.call(input, CUSTOMER))).toMatchObject({ code: "permission" });
  });

  it("shows offline instructions without pretending money was received", async () => {
    vi.spyOn(adapters, "paymentAdapter").mockReturnValue(adapters.createManualPayments());
    const { invoice, token } = await fixture();
    const result = await beginCustomerCheckout.call({ id: invoice.id, token }, ANON);
    expect(new URL(result.url).searchParams.get("checkout")).toBe("offline");
    expect(await db().select().from(payments)).toHaveLength(0);
    expect((await getInvoice.call({ id: invoice.id }, OWNER)).invoice.paidMinor).toBe(0);
  });

  it("retries the same hosted charge outside a transaction with fixed same-instance return URLs", async () => {
    const { createCheckout } = hosted();
    const { invoice, token } = await fixture();
    createCheckout.mockImplementation(async () => {
      const unlocked = await db().transaction(async (tx) => tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${`invoice:${invoice.id}`})) as unlocked`));
      expect(unlocked[0]?.unlocked).toBe(true);
      expect(await db().select().from(payments)).toHaveLength(1);
      return { providerRef: "checkout-1", paymentRef: "payment-1", url: "https://checkout.example.test/pay" };
    });
    await beginCustomerCheckout.call({ id: invoice.id, token }, ANON);
    await beginCustomerCheckout.call({ id: invoice.id }, CUSTOMER);
    expect(await db().select().from(payments)).toHaveLength(1);
    expect(createCheckout).toHaveBeenCalledTimes(1);
    const request = createCheckout.mock.calls[0]![0];
    expect(new URL(request.successUrl).origin).toBe(new URL(request.cancelUrl).origin);
    expect(request.amountMinor).toBe(10_000);
    expect(await failure(beginCustomerCheckout.call({ id: invoice.id, token, amountMinor: 1 }, ANON))).toMatchObject({ code: "validation" });
  });

  it("retains the retry identity when checkout creation times out", async () => {
    const { createCheckout } = hosted();
    const { invoice, token } = await fixture();
    createCheckout.mockRejectedValueOnce(new Error("provider secret must not escape"));
    expect(await failure(beginCustomerCheckout.call({ id: invoice.id, token }, ANON))).toMatchObject({ code: "conflict", message: "Payment could not be opened. Please try again." });
    await beginCustomerCheckout.call({ id: invoice.id, token }, ANON);
    expect(await db().select().from(payments)).toHaveLength(1);
    expect(createCheckout.mock.calls[0]![0].idempotencyKey).toBe(createCheckout.mock.calls[1]![0].idempotencyKey);
  });

  it("checks an expired checkout before allowing a fresh attempt after a verified failure", async () => {
    const { createCheckout, captureCheckout } = hosted();
    const { invoice, token } = await fixture();
    createCheckout.mockResolvedValueOnce({ providerRef: "checkout-1", paymentRef: "payment-1", url: "https://checkout.example.test/pay", expiresAt: new Date(0).toISOString() });
    await beginCustomerCheckout.call({ id: invoice.id, token }, ANON);
    const expired = await beginCustomerCheckout.call({ id: invoice.id, token }, ANON);
    expect(new URL(expired.url).pathname).toContain("/portal/invoices/confirmation/");
    expect(createCheckout).toHaveBeenCalledTimes(1);
    captureCheckout.mockResolvedValueOnce({ providerRef: "payment-1", status: "failed" });
    await confirmCustomerPayment.call({ token: new URL(expired.url).pathname.split("/").at(-1)! }, ANON);
    createCheckout.mockResolvedValueOnce({ providerRef: "checkout-2", paymentRef: "payment-2", url: "https://checkout.example.test/new" });
    expect((await beginCustomerCheckout.call({ id: invoice.id, token }, ANON)).url).toBe("https://checkout.example.test/new");
    expect(await db().select().from(payments)).toHaveLength(2);
  });

  it("requires reconciliation for an old unanswered provider request", async () => {
    const { createCheckout } = hosted();
    const { invoice, token } = await fixture();
    createCheckout.mockRejectedValue(new Error("timeout"));
    await failure(beginCustomerCheckout.call({ id: invoice.id, token }, ANON));
    await db().update(payments).set({ createdAt: new Date(0) }).where(eq(payments.invoiceId, invoice.id));
    expect(await failure(beginCustomerCheckout.call({ id: invoice.id, token }, ANON))).toMatchObject({ code: "conflict", message: "This payment attempt needs the business to check it before you try again." });
    expect(createCheckout).toHaveBeenCalledTimes(1);
  });

  it("does not create another checkout after an outstanding attempt's balance changes", async () => {
    const { createCheckout } = hosted();
    const { invoice, token } = await fixture();
    await beginCustomerCheckout.call({ id: invoice.id, token }, ANON);
    await recordOfflinePayment.call({ invoiceId: invoice.id, method: "cash", amountMinor: 1_000,
      evidence: "Partial cash payment received.", idempotencyKey: "partial-cash" }, OWNER);
    expect(await failure(beginCustomerCheckout.call({ id: invoice.id, token }, ANON))).toMatchObject({
      code: "conflict", message: "A previous payment attempt needs the business to check it before you try again.",
    });
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect((await getInvoice.call({ id: invoice.id }, OWNER)).invoice.paidMinor).toBe(1_000);
  });

  it("refuses to attach a checkout when the invoice was voided during provider work", async () => {
    const { createCheckout } = hosted();
    const { invoice, token } = await fixture();
    createCheckout.mockImplementation(async () => {
      await voidInvoice.call({ id: invoice.id, reason: "Cancelled during provider work." }, OWNER);
      return { providerRef: "checkout-1", url: "https://checkout.example.test/pay" };
    });
    expect(await failure(beginCustomerCheckout.call({ id: invoice.id, token }, ANON))).toMatchObject({ code: "not_found" });
    expect((await db().select().from(payments))[0]?.providerCheckoutRef).toBeNull();
  });

  it("does not infer settlement from a return link, validates provider amounts, and settles once", async () => {
    const { captureCheckout } = hosted();
    const { invoice, token } = await fixture();
    await beginCustomerCheckout.call({ id: invoice.id, token }, ANON);
    const [payment] = await db().select().from(payments);
    const receipt = { token: paymentReturnToken(payment!) };
    expect(await customerPaymentReceipt.call(receipt, ANON)).toEqual({ status: "processing", amountMinor: 10_000, currency: "CAD" });
    captureCheckout.mockResolvedValueOnce({ providerRef: "payment-1", status: "succeeded", amountMinor: 1, currency: "CAD" });
    expect(await failure(confirmCustomerPayment.call(receipt, ANON))).toMatchObject({ code: "conflict" });
    await confirmCustomerPayment.call(receipt, ANON);
    await confirmCustomerPayment.call(receipt, ANON);
    expect(captureCheckout).toHaveBeenCalledTimes(2);
    expect((await getInvoice.call({ id: invoice.id }, OWNER)).invoice).toMatchObject({ status: "paid", paidMinor: 10_000 });
    expect(await customerPaymentReceipt.call(receipt, ANON)).toEqual({ status: "succeeded", amountMinor: 10_000, currency: "CAD" });
    expect(await failure(getCustomerInvoice.call({ id: invoice.id, token }, ANON))).toMatchObject({ code: "not_found" });
    for (const name of ["invoicing.applyCustomerCheckout", "invoicing.applyCustomerPayment", "invoicing.customerPaymentSource", "invoicing.claimCustomerCheckout"]) {
      expect(() => getExternalService(name)).toThrow();
    }
  });
});
