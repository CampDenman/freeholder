// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual checkout, original return allocation/credit and real Stripe factory.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as adapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { createLocationService } from "@/core/locations/service";
import { addCartItem, applyVariantMatrix, checkoutCart, createPriceList, createProduct, createShippingMethod, createShippingZone, decideReturn, enableInventory, getOrCreateCart, getProductVariants, payOrder, prepareReturnRefund, receiveReturn, recordStockMovement, requestReturn, setPriceListEntry, submitReturnProviderRefund } from "@/modules/catalog/service";
import { recoverReturnBankRefunds, replaceReturnBankRefunds, RETURN_BANK_REPLACEMENT_CONFIRMATION } from "@/modules/catalog/legacy-return-bank-recovery";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { retainPaymentProviderEvidence, processPaymentProviderEvents, submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { creditNoteLines, creditNotes, payments, refunds } from "@/modules/invoicing/schema";
import { returnRefundAllocations } from "@/modules/catalog/schema";
import { CUSTOMER, OWNER } from "./spine";
export type RmaBankStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | null;
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
export async function legacyRmaFixture(options: { pauseOriginal?: boolean } = {}) {
  const nonce = randomUUID().replaceAll("-", ""), paymentRef = `pi_Rma${nonce}`, chargeRef = `ch_Rma${nonce}`;
  const buyer = (await resolveContact.call({ email: `fictional-rma-${nonce}@example.test` }, OWNER)).contact;
  const customer = { ...CUSTOMER, userId: randomUUID() };
  await db().insert(users).values({ id: customer.userId, email: buyer.email!, role: "customer" });
  await db().update(contacts).set({ userId: customer.userId }).where(eq(contacts.id, buyer.id));
  const location = await createLocationService.call({ name: "Original RMA studio", slug: `rma-${nonce}`, country: "CA" }, OWNER);
  const product = await createProduct.call({ name: "Original RMA print", slug: `rma-${nonce}`, kind: "physical" }, OWNER);
  await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
  const variant = (await getProductVariants.call({ productId: product.id }, OWNER)).variants[0]!;
  const list = await createPriceList.call({ name: `Original RMA CAD ${nonce}`, currency: "CAD", kind: "retail" }, OWNER);
  await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "10.00" }, OWNER);
  const inventory = await enableInventory.call({ variantId: variant.id, locationId: location.id }, OWNER);
  await recordStockMovement.call({ itemId: inventory.id, delta: 2, reason: "receipt" }, OWNER);
  const zone = await createShippingZone.call({ name: `Original RMA zone ${nonce}`, countries: [], regions: [], postalPatterns: [] }, OWNER);
  await createShippingMethod.call({ zoneId: zone.id, name: "Original collection", kind: "flat", currency: "CAD", amount: "0.00" }, OWNER);
  const cart = await getOrCreateCart.call({ contactId: buyer.id, currency: "CAD" }, OWNER);
  await addCartItem.call({ cartId: cart.cart.id, variantId: variant.id, quantity: 2, locationId: location.id }, OWNER);
  const placed = await checkoutCart.call({ cartId: cart.cart.id, contactId: buyer.id, idempotencyKey: `rma-checkout-${nonce}`, acceptedTerms: true, shippingAddress: { country: "CA", city: "Courtenay" } }, OWNER);
  expect(placed.order.totalMinor).toBe(2000);
  const payment = await createPayment.call({ invoiceId: placed.order.invoiceId!, provider: "stripe", method: "hosted_checkout", amountMinor: 2000, idempotencyKey: `rma-payment-${nonce}` }, OWNER);
  await settlePayment.call({ id: payment.id, providerRef: paymentRef }, OWNER);
  const paid = await payOrder.call({ id: placed.order.id }, OWNER);
  const requested = await requestReturn.call({ orderId: paid.order.id, reason: "One original print arrived damaged", restock: false, items: [{ orderItemId: paid.lines[0]!.id, quantity: 1 }] }, OWNER);
  await decideReturn.call({ id: requested.return.id, decision: "approved" }, OWNER);
  await receiveReturn.call({ id: requested.return.id }, OWNER);
  await prepareReturnRefund.call({ id: requested.return.id, idempotencyKey: `rma-prepare-${nonce}` }, OWNER);
  const [part] = await db().select().from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId, requested.return.id));
  if (!part) throw Error("The actual prepared original allocation was not created.");
  expect(part.amountMinor).toBe(1000);
  const entered = signal(), release = signal(), resources = new Map<string, { id: string; amount: number; status: RmaBankStatus }>();
  const keys = new Map<string, string>(), posts: string[] = [], paths: string[] = [];
  const raw = (row: { id: string; amount: number; status: RmaBankStatus }) => ({ ...row, payment_intent: paymentRef, charge: chargeRef, currency: "cad", failure_balance_transaction: row.status === "failed" ? `txn_Returned${row.id}` : null });
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); paths.push(`${init.method} ${url.pathname}`);
    expect(url.origin).toBe("https://api.stripe.com"); expect(new Headers(init.headers).get("stripe-account")).toBeNull();
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_LegacyRmaRead" });
    if (url.pathname === "/v1/refunds" && init.method === "POST") {
      if (!(init.body instanceof URLSearchParams) && typeof init.body !== "string") throw Error("The actual Stripe form body is not URLSearchParams or a string.");
      const form = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(init.body);
      expect(form.get("payment_intent")).toBe(paymentRef);
      const key = new Headers(init.headers).get("idempotency-key"); if (!key) throw Error("The actual original physical key is missing.");
      posts.push(key); let ref = keys.get(key);
      if (!ref) { ref = `pyr_Rma${nonce}_${resources.size + 1}`; keys.set(key, ref); resources.set(ref, { id: ref, amount: Number(form.get("amount")), status: "succeeded" }); }
      const actual = raw(resources.get(ref)!); entered.resolve(); if (options.pauseOriginal && posts.length === 1) await release.promise;
      return Response.json(actual);
    }
    expect(init.method).toBe("GET");
    if (url.pathname.startsWith("/v1/refunds/")) { const row = resources.get(decodeURIComponent(url.pathname.slice("/v1/refunds/".length))); if (!row) throw Error("No actual original RMA bank resource."); return Response.json(raw(row)); }
    if (url.pathname === `/v1/payment_intents/${paymentRef}`) return Response.json({ id: paymentRef, status: "succeeded", amount_received: 2000, currency: "cad", latest_charge: chargeRef, amount_capturable: 0 });
    if (url.pathname === `/v1/charges/${chargeRef}`) return Response.json({ id: chargeRef, payment_intent: paymentRef, amount_captured: 2000, amount_refunded: [...resources.values()].filter(row => row.status === "succeeded").reduce((sum, row) => sum + row.amount, 0), currency: "cad", paid: true, captured: true, refunded: false, application_fee: null, transfer: null });
    if (url.pathname === "/v1/refunds") return Response.json({ data: [...resources.values()].map(raw), has_more: false });
    if (url.pathname === "/v1/disputes") return Response.json({ data: [], has_more: false });
    throw Error(`Unexpected original RMA request ${init.method} ${url.pathname}`);
  });
  const secret = "whsec_legacy_rma_fixture_only", factory = createStripePayments({ secretKey: "sk_legacy_rma_fixture_only", webhookSecrets: [secret], fetch: fetcher });
  vi.spyOn(adapters, "paymentAdapter").mockReturnValue(factory);
  const pending = submitReturnProviderRefund.call({ id: requested.return.id, idempotencyKey: `rma-submit-${nonce}` }, OWNER).then(value => ({ value }), (error: unknown) => ({ error }));
  if (options.pauseOriginal) expect(await Promise.race([entered.promise.then(() => "entered"), pending.then(() => "ended")])).toBe("entered");
  else { const done = await pending; if (!("value" in done)) throw done.error; expect(done.value.return.status).toBe("refunded"); }
  const [original] = await db().select().from(refunds).where(eq(refunds.paymentId, payment.id));
  if (!original) throw Error("No actual original return refund admission.");
  const check = () => recoverReturnBankRefunds.call({ id: requested.return.id }, OWNER);
  const replace = () => replaceReturnBankRefunds.call({ id: requested.return.id, confirmation: RETURN_BANK_REPLACEMENT_CONFIRMATION }, OWNER);
  const setStatus = (ref: string, status: RmaBankStatus) => { const actual = resources.get(ref); if (!actual) throw Error("No actual original RMA resource."); actual.status = status; };
  async function signedStatus(ref: string, status: RmaBankStatus, apply = true) {
    setStatus(ref, status); const now = Math.floor(Date.now() / 1000), actual = resources.get(ref)!;
    const body = Buffer.from(JSON.stringify({ id: `evt_rma_${randomUUID()}`, type: "refund.updated", api_version: "2026-02-25.clover", created: now, data: { object: raw(actual) } }));
    const signature = createHmac("sha256", secret).update(`${now}.`).update(body).digest("hex"), receivedAt = new Date(now * 1000).toISOString(), bodySha256 = createHash("sha256").update(body).digest("hex");
    const verified = await factory.verifyWebhook({ body, headers: { "stripe-signature": `t=${now},v1=${signature}` }, receivedAt });
    const events = await retainPaymentProviderEvidence("stripe", verified, { rawBodySha256: bodySha256, receivedAt });
    if (apply) await processPaymentProviderEvents.call({ provider: "stripe", events, receivedAt, bodySha256 }, { kind: "system" });
    return { events, receivedAt, bodySha256 };
  }
  async function originalCredit() {
    const [credit] = await db().select().from(creditNotes).where(eq(creditNotes.idempotencyKey, `return:${requested.return.id}:credit`));
    if (!credit) throw Error("The actual original return credit is unavailable.");
    const lines = await db().select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, credit.id));
    return { credit, lines: lines.sort((a, b) => a.id.localeCompare(b.id)) };
  }
  async function balances(returnedMinor: number) {
    expect((await db().select().from(payments).where(eq(payments.id, payment.id)))[0]).toMatchObject({ status: "succeeded", amountMinor: 2000, refundedMinor: returnedMinor });
  }
  const unrelated = () => submitProviderRefund.call({ paymentId: payment.id, amountMinor: 1000, reason: "An equal unrelated actual legacy promise", idempotencyKey: `unrelated-rma-${nonce}` }, OWNER);
  return { original, part, buyer, customer, payment, paymentRef, invoiceId: placed.order.invoiceId!, returnId: requested.return.id, check, replace, setStatus, signedStatus, originalCredit, balances, unrelated, posts, paths, resources, pending, release };
}
