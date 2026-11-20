// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C5.19/C12.38: cartless actual manual invoicing for financial undo proof.
// The checkout/RMA controls use their unchanged separate helper.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import * as adapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { resolveContact } from "@/core/contacts/service";
import { createDraftInvoice, createPayment, issueInvoice, settlePayment } from "@/modules/invoicing/invoice-service";
import { retainPaymentProviderEvidence, submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { OWNER } from "./spine";

/** The existing legacyRecoveryFixture manual-invoice sequence, with separate
 * actual identities and an exact-byte HMAC verifier for each original owner. */
export async function legacyFeedbackOwnerFixture() {
  const nonce = randomUUID().replaceAll("-", ""), paymentRef = `pi_FeedbackOwner${nonce}`, chargeRef = `ch_FeedbackOwner${nonce}`;
  const buyer = (await resolveContact.call({ email: `fictional-feedback-owner-${nonce}@example.test` }, OWNER)).contact;
  const draft = await createDraftInvoice.call({ contactId: buyer.id, currency: "CAD", idempotencyKey: `feedback-owner-invoice-${nonce}`,
    lines: [{ description: "Original manually invoiced service", quantityMicros: 1000000, unitAmountMinor: 2000 }],
    tax: { mode: "not_applicable", reason: "Synthetic cartless owner-fingerprint control" } }, OWNER);
  const invoice = (await issueInvoice.call({ id: draft.invoice.id }, OWNER)).invoice;
  const payment = await createPayment.call({ invoiceId: invoice.id, provider: "stripe", method: "hosted_checkout", amountMinor: 2000, idempotencyKey: `feedback-owner-payment-${nonce}` }, OWNER);
  await settlePayment.call({ id: payment.id, providerRef: paymentRef }, OWNER);
  const posts: string[] = [], paths: string[] = [];
  const resource = { id: `pyr_FeedbackOwner${nonce}`, amount: 1000, status: "succeeded" as string | null };
  const raw = () => ({ ...resource, payment_intent: paymentRef, charge: chargeRef, currency: "cad", failure_balance_transaction: null });
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); paths.push(`${init.method} ${url.pathname}`);
    expect(url.origin).toBe("https://api.stripe.com"); expect(new Headers(init.headers).get("stripe-account")).toBeNull();
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_LegacyRmaRead" });
    if (url.pathname === "/v1/refunds" && init.method === "POST") {
      const form = init.body instanceof URLSearchParams ? init.body : typeof init.body === "string" ? new URLSearchParams(init.body) : undefined;
      if (!form) throw Error("The real refund POST requires its actual form body.");
      expect(form.get("payment_intent")).toBe(paymentRef); expect(form.get("amount")).toBe("1000");
      const key = new Headers(init.headers).get("idempotency-key"); if (!key) throw Error("The actual original refund has no physical key.");
      posts.push(key); return Response.json(raw());
    }
    // This proof must reach the owned-feedback guard before its first bank GET.
    throw Error(`Unexpected financial HTTP before the feedback-only oracle: ${init.method} ${url.pathname}`);
  });
  const secret = "whsec_feedback_owner_fixture_only", factory = createStripePayments({ secretKey: "sk_feedback_owner_fixture_only", webhookSecrets: [secret], fetch: fetcher });
  vi.spyOn(adapters, "paymentAdapter").mockReturnValue(factory);
  const original = await submitProviderRefund.call({ paymentId: payment.id, amountMinor: 1000, reason: "Actual original manually invoiced legacy promise", idempotencyKey: `feedback-owner-refund-${nonce}` }, OWNER);
  expect(original).toMatchObject({ providerRef: resource.id, status: "succeeded", amountMinor: 1000 });
  async function signedStatus(ref: string, status: "requires_action", apply: false) {
    expect(ref).toBe(resource.id); expect(apply).toBe(false); resource.status = status;
    const now = Math.floor(Date.now() / 1000), body = Buffer.from(JSON.stringify({ id: `evt_feedback_owner_${randomUUID()}`, type: "refund.updated", api_version: "2026-02-25.clover", created: now, data: { object: raw() } }));
    const signature = createHmac("sha256", secret).update(`${now}.`).update(body).digest("hex"), receivedAt = new Date(now * 1000).toISOString(), bodySha256 = createHash("sha256").update(body).digest("hex");
    const verified = await factory.verifyWebhook({ body, headers: { "stripe-signature": `t=${now},v1=${signature}` }, receivedAt });
    const events = await retainPaymentProviderEvidence("stripe", verified, { rawBodySha256: bodySha256, receivedAt });
    return { events, receivedAt, bodySha256 };
  }
  return { buyer, payment, paymentRef, invoiceId: invoice.id, original, posts, paths, signedStatus };
}
