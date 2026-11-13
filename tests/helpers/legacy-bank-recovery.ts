// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual old-HMAC admissions and real Stripe factory HTTP for recovery80.
import { randomUUID } from "node:crypto";
import { vi, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as adapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { resolveContact } from "@/core/contacts/service";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { getCustomerInvoice } from "@/modules/invoicing/customer-service";
import { db } from "@/core/db";
import { createDraftInvoice, createPayment, issueInvoice, settlePayment } from "@/modules/invoicing/invoice-service";
import { submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { invoices, payments } from "@/modules/invoicing/schema";
import { recoverLegacyBankRefund, replaceLegacyReturnedBankRefund } from "@/modules/invoicing/legacy-bank-replacement-service";
import { LEGACY_REPLACEMENT_CONFIRMATION } from "@/modules/invoicing/legacy-bank-replacement-proof";
import { CUSTOMER, OWNER } from "./spine";
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
type Status = "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | null;
export async function legacyRecoveryFixture() {
  const buyer = (await resolveContact.call({ email: "fictional-legacy-recovery@example.test" }, OWNER)).contact;
  const customer = { ...CUSTOMER, userId: randomUUID() };
  await db().insert(users).values({ id: customer.userId, email: buyer.email!, role: "customer" });
  await db().update(contacts).set({ userId: customer.userId }).where(eq(contacts.id, buyer.id));
  const draft = await createDraftInvoice.call({ contactId: buyer.id, currency: "CAD", idempotencyKey: "legacy-recovery-invoice",
    lines: [{ description: "Original legacy service", quantityMicros: 1000000, unitAmountMinor: 1000 }], tax: { mode: "not_applicable", reason: "Synthetic legacy recovery control" } }, OWNER);
  const invoice = (await issueInvoice.call({ id: draft.invoice.id }, OWNER)).invoice;
  const payment = await createPayment.call({ invoiceId: invoice.id, provider: "stripe", method: "hosted_checkout", amountMinor: 1000, idempotencyKey: "legacy-recovery-payment" }, OWNER);
  const paymentRef = "pi_LegacyRecovery";
  await settlePayment.call({ id: payment.id, providerRef: paymentRef }, OWNER);
  let nextPause: { entered: ReturnType<typeof signal>; release: ReturnType<typeof signal> } | undefined;
  const resources = new Map<string, { id: string; amount: number; status: Status }>(), keys = new Map<string, string>(), posts: string[] = [], paths: string[] = [];
  const raw = (row: { id: string; amount: number; status: Status }) => ({ ...row, payment_intent: paymentRef, charge: "ch_LegacyRecovery", currency: "cad",
    failure_balance_transaction: row.status === "failed" ? `txn_Returned_${row.id}` : null });
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); paths.push(`${init.method} ${url.pathname}`);
    expect(url.origin).toBe("https://api.stripe.com"); expect(new Headers(init.headers).get("stripe-account")).toBeNull();
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_LegacyRecoveryRead" });
    if (url.pathname === "/v1/refunds" && init.method === "POST") {
      const form = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init.body));
      expect(form.get("payment_intent")).toBe(paymentRef); const key = new Headers(init.headers).get("idempotency-key"); if (!key) throw Error("The actual legacy POST has no original key.");
      posts.push(key); let id = keys.get(key);
      if (!id) { id = `pyr_LegacyRecovery_${resources.size + 1}`; keys.set(key, id); resources.set(id, { id, amount: Number(form.get("amount")), status: "succeeded" }); }
      const paused = nextPause; nextPause = undefined; const accepted = raw(resources.get(id)!);
      if (paused) { paused.entered.resolve(); await paused.release.promise; }
      return Response.json(accepted);
    }
    expect(init.method).toBe("GET");
    if (url.pathname.startsWith("/v1/refunds/")) { const row = resources.get(decodeURIComponent(url.pathname.slice("/v1/refunds/".length))); if (!row) throw Error("No synthetic original refund resource."); return Response.json(raw(row)); }
    if (url.pathname === `/v1/payment_intents/${paymentRef}`) return Response.json({ id: paymentRef, status: "succeeded", amount_received: 1000, currency: "cad", latest_charge: "ch_LegacyRecovery", amount_capturable: 0 });
    if (url.pathname === "/v1/charges/ch_LegacyRecovery") return Response.json({ id: "ch_LegacyRecovery", payment_intent: paymentRef, amount_captured: 1000,
      amount_refunded: [...resources.values()].filter(row => row.status === "succeeded").reduce((sum, row) => sum + row.amount, 0), currency: "cad", paid: true, captured: true, refunded: false, application_fee: null, transfer: null });
    if (url.pathname === "/v1/refunds") return Response.json({ data: [...resources.values()].map(raw), has_more: false });
    if (url.pathname === "/v1/disputes") return Response.json({ data: [], has_more: false });
    throw Error(`Unexpected synthetic legacy recovery request ${init.method} ${url.pathname}`);
  });
  vi.spyOn(adapters, "paymentAdapter").mockReturnValue(createStripePayments({ secretKey: "sk_legacy_recovery_fixture_only", webhookSecrets: ["whsec_legacy_recovery_fixture_only"], fetch: fetcher }));
  const submit = (key: string) => submitProviderRefund.call({ paymentId: payment.id, amountMinor: 400, reason: "Actual independent original legacy promise", idempotencyKey: key }, OWNER);
  const original = await submit("legacy-recovery-original");
  const recover = (refundId = original.id) => recoverLegacyBankRefund.call({ refundId }, OWNER);
  const replace = () => replaceLegacyReturnedBankRefund.call({ refundId: original.id, confirmation: LEGACY_REPLACEMENT_CONFIRMATION }, OWNER);
  const status = (providerRef: string, value: Status) => { const actual = resources.get(providerRef); if (!actual) throw Error("No actual synthetic original bank resource."); actual.status = value; };
  async function balances(returned: number) {
    expect((await db().select().from(payments).where(eq(payments.id, payment.id)))[0]).toMatchObject({ amountMinor: 1000, refundedMinor: returned });
    expect((await db().select().from(invoices).where(eq(invoices.id, invoice.id)))[0]).toMatchObject({ paidMinor: 1000, refundedMinor: returned });
  }
  const customerInvoice = () => getCustomerInvoice.call({ id: invoice.id }, customer);
  const pauseNextSubmission = () => { const pause = { entered: signal(), release: signal() }; nextPause = pause; return pause; };
  return { pauseNextSubmission, customerInvoice, invoice, payment, paymentRef, original, resources, posts, paths, submit, recover, replace, status, balances };
}
