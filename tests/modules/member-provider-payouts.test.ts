// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26–C12.27: the ledger paying sellers through a provider. A seller
// sets up through the provider, its webhook makes the account payable, a
// sale's payout is transferred exactly once, a refund reverses it, and a
// provider that keeps refusing hands the payout to the owner to review.
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { createListing } from "@/modules/members/listings";
import { myPayoutAccount, onOrderPaid, reversePayouts, sitePayouts } from "@/modules/members/payouts";
import { applyPayoutWebhook, applyProviderTransfer, payoutSetup, sendProviderPayouts, startPayoutSetup } from "@/modules/members/provider-payouts";
import { memberPayouts, memberPayoutTransfers } from "@/modules/members/schema";
import { setPayoutProviderForTests } from "@/adapters/payouts";
import { createStripeConnect } from "@/adapters/payouts/stripe-connect";
import { addCartItem, getOrCreateCart } from "@/modules/catalog/cart";
import { checkoutCart } from "@/modules/catalog/orders";
import { getProductVariants } from "@/modules/catalog/variants";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { invoices } from "@/modules/invoicing/schema";
import { POST as webhook } from "../../app/api/payouts/[provider]/webhook/route";
import { ANONYMOUS, closeDb, CUSTOMER, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SECRET = "whsec_test_connect";

type Call = { path: string; body: URLSearchParams; idempotencyKey?: string };
let calls: Call[] = [];
let refuseTransfers = false;
let timeoutTransfers = false;
let onTransfer: (() => Promise<void>) | undefined;
const fakeStripe = (async (input: string | URL, init: RequestInit = {}) => {
  const url = new URL(String(input));
  const headers = (init.headers ?? {}) as Record<string, string>;
  calls.push({ path: url.pathname, body: new URLSearchParams(init.body instanceof URLSearchParams ? init.body : typeof init.body === "string" ? init.body : ""), idempotencyKey: headers["idempotency-key"] });
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/v1/accounts") return reply({ id: "acct_rae" });
  if (url.pathname === "/v1/account_links") return reply({ url: "https://connect.stripe.test/onboarding/rae" });
  if (url.pathname === "/v1/transfers" && timeoutTransfers) throw new TypeError("fetch failed");
  if (url.pathname === "/v1/transfers") await onTransfer?.();
  if (url.pathname === "/v1/transfers") return refuseTransfers ? reply({ error: { code: "balance_insufficient" } }, 400) : reply({ id: `tr_${calls.length}` });
  if (url.pathname.endsWith("/reversals")) return reply({ id: "trr_1" });
  return reply({});
}) as typeof fetch;

async function sell(priceMajor: string) {
  const listing = await createListing.call({ acceptPolicy: true, title: `Print ${priceMajor} (download)`, kind: "digital", price: priceMajor }, RAE);
  const variantId = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!.id;
  const { contact: buyer } = await resolveContact.call({ email: "buyer@example.test", name: "Buyer" }, OWNER);
  const cart = await getOrCreateCart.call({ currency: "CAD", contactId: buyer.id }, OWNER);
  await addCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token ?? undefined, variantId }, ANONYMOUS);
  const order = await checkoutCart.call({ cartId: cart.cart.id, contactId: buyer.id, idempotencyKey: `market-${crypto.randomUUID()}`, acceptedTerms: true as const }, OWNER);
  const [invoice] = await db().select().from(invoices).where(eq(invoices.id, order.order.invoiceId!));
  const payment = await createPayment.call({ invoiceId: invoice!.id, provider: "manual", method: "bank_transfer", amountMinor: invoice!.totalMinor, idempotencyKey: `pay-${crypto.randomUUID()}` }, OWNER);
  await settlePayment.call({ id: payment.id, providerRef: "offline" }, OWNER);
  await onOrderPaid({ orderId: order.order.id });
  return invoice!;
}

function signed(event: unknown) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  return webhook(new Request("http://localhost/api/payouts/stripe_connect/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body }), { params: Promise.resolve({ provider: "stripe_connect" }) });
}

describe.runIf(hasDatabase)("payouts through a provider (C12.26–C12.27)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    calls = [];
    refuseTransfers = false;
    timeoutTransfers = false;
    onTransfer = undefined;
    setPayoutProviderForTests("stripe_connect", createStripeConnect({ secretKey: "sk_test_x", webhookSecrets: [SECRET], fetch: fakeStripe }));
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Provider payouts", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, siteFeeBps: 1000, payoutModel: "instant", payoutAdapter: "stripe_connect" }, OWNER);
  });
  afterEach(() => {
    setPayoutProviderForTests("stripe_connect", null);
    vi.restoreAllMocks();
  });

  async function readySeller() {
    await startPayoutSetup.call({}, RAE);
    await signed({ type: "account.updated", data: { object: { id: "acct_rae", payouts_enabled: true, capabilities: { transfers: "active" } } } });
  }
  const retryNow = () => db().update(memberPayoutTransfers).set({ nextAttemptAt: new Date(Date.now() - 1000) });
  const transferCalls = () => calls.filter((c) => c.path === "/v1/transfers");
  afterAll(closeDb);

  it("sets a seller up with Stripe, pays each due payout once, and reverses it on refund", { timeout: 60_000 }, async () => {
    expect(await payoutSetup.call({}, RAE)).toEqual({ provider: "stripe_connect", kind: "hosted", fields: [], configured: true });
    expect(await startPayoutSetup.call({}, RAE)).toEqual({ url: "https://connect.stripe.test/onboarding/rae", status: "pending" });
    expect((await myPayoutAccount.call({}, RAE)).status).toBe("pending");

    // Stripe's signed webhook makes the account payable; a forged one is refused.
    const updated = { type: "account.updated", data: { object: { id: "acct_rae", payouts_enabled: true, capabilities: { transfers: "active" } } } };
    const forged = await webhook(new Request("http://localhost/x", { method: "POST", headers: { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` }, body: JSON.stringify(updated) }), { params: Promise.resolve({ provider: "stripe_connect" }) });
    expect(forged.status).toBe(401);
    expect((await signed(updated)).status).toBe(200);
    expect((await myPayoutAccount.call({}, RAE)).status).toBe("ready");

    const invoice = await sell("40");
    expect(await sendProviderPayouts()).toEqual({ sent: 1, failed: 0 });
    expect(await sendProviderPayouts()).toEqual({ sent: 0, failed: 0 });
    const transfers = calls.filter((c) => c.path === "/v1/transfers");
    expect(transfers).toHaveLength(1);
    expect([transfers[0]!.body.get("amount"), transfers[0]!.body.get("destination"), transfers[0]!.idempotencyKey?.startsWith("freeholder-payout-")]).toEqual(["3600", "acct_rae", true]);
    const [paid] = (await sitePayouts.call({}, OWNER)).payouts;
    expect(paid).toMatchObject({ state: "paid", netMinor: 3600 });

    await reversePayouts.call({ invoiceId: invoice.id, amountMinor: invoice.totalMinor }, { kind: "system" });
    expect(await sendProviderPayouts()).toEqual({ sent: 1, failed: 0 });
    expect(calls.at(-1)!.path).toMatch(/^\/v1\/transfers\/tr_\d+\/reversals$/);
    expect((await sitePayouts.call({}, OWNER)).payouts.map((p) => p.state)).toEqual(["cancelled"]);
  });

  it("retries a refused transfer with backoff and then hands it to the owner", { timeout: 60_000 }, async () => {
    await startPayoutSetup.call({}, RAE);
    await signed({ type: "account.updated", data: { object: { id: "acct_rae", payouts_enabled: true, capabilities: { transfers: "active" } } } });
    await sell("25");
    refuseTransfers = true;
    for (let i = 0; i < 5; i++) {
      await db().update(memberPayoutTransfers).set({ nextAttemptAt: new Date(Date.now() - 1000) });
      expect((await sendProviderPayouts()).failed).toBe(1);
    }
    const [t] = await db().select().from(memberPayoutTransfers);
    expect(t).toMatchObject({ state: "failed", attempts: 5 });
    const [payout] = (await sitePayouts.call({ state: "review" }, OWNER)).payouts;
    expect(payout?.state).toBe("review");
    expect(calls.filter((c) => c.path === "/v1/transfers")).toHaveLength(5);
  });
  it("never sends a transfer for a payout refunded before it went out", { timeout: 60_000 }, async () => {
    await readySeller();
    const invoice = await sell("30");
    refuseTransfers = true;
    expect((await sendProviderPayouts()).failed).toBe(1);
    await reversePayouts.call({ invoiceId: invoice.id, amountMinor: invoice.totalMinor }, { kind: "system" });
    refuseTransfers = false;
    await retryNow();
    expect(await sendProviderPayouts()).toEqual({ sent: 0, failed: 0 });
    expect(transferCalls()).toHaveLength(1);
    const [t] = await db().select().from(memberPayoutTransfers);
    expect(t?.state).toBe("failed");
    expect(t?.lastError).toMatch(/^Not sent: the payout was cancelled/);
    expect((await sitePayouts.call({}, OWNER)).payouts.map((p) => p.state)).toEqual(["cancelled"]);
  });

  it("sends a refunded payout whose earlier attempt timed out to the owner instead of retrying", { timeout: 60_000 }, async () => {
    await readySeller();
    const invoice = await sell("30");
    timeoutTransfers = true;
    expect((await sendProviderPayouts()).failed).toBe(1);
    const [pending] = await db().select().from(memberPayoutTransfers);
    expect(pending).toMatchObject({ state: "pending", attempts: 1 });
    expect(pending?.lastError).toMatch(/^Outcome unknown: /);
    await reversePayouts.call({ invoiceId: invoice.id, amountMinor: invoice.totalMinor }, { kind: "system" });
    timeoutTransfers = false;
    await retryNow();
    expect(await sendProviderPayouts()).toEqual({ sent: 0, failed: 0 });
    expect(transferCalls()).toHaveLength(1);
    const [payout] = (await sitePayouts.call({}, OWNER)).payouts;
    expect(payout?.state).toBe("review");
    expect(payout?.note).toMatch(/unknown outcome/);
  });

  it("retries a timed-out transfer with the same idempotency key, and a refusal after a timeout stays uncertain to the owner", { timeout: 60_000 }, async () => {
    await readySeller();
    await sell("30");
    timeoutTransfers = true;
    for (let i = 0; i < 5; i++) {
      await retryNow();
      expect((await sendProviderPayouts()).failed).toBe(1);
    }
    const [payout] = (await sitePayouts.call({ state: "review" }, OWNER)).payouts;
    expect(payout?.note).toMatch(/never confirmed/);
  });

  it("records a transfer whose result could not be saved on the next run, without counting it as a provider failure", { timeout: 60_000 }, async () => {
    await readySeller();
    await sell("30");
    const real = applyProviderTransfer.call.bind(applyProviderTransfer);
    const spy = vi.spyOn(applyProviderTransfer, "call").mockImplementationOnce(async () => { throw new Error("database went away"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendProviderPayouts()).toEqual({ sent: 0, failed: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const [t] = await db().select().from(memberPayoutTransfers);
    expect(t).toMatchObject({ state: "pending", attempts: 1 });
    expect(t?.lastError).toMatch(/^Outcome unknown: /);
    spy.mockImplementation(real);
    await retryNow();
    expect(await sendProviderPayouts()).toEqual({ sent: 1, failed: 0 });
    const keys = transferCalls().map((c) => c.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect((await sitePayouts.call({}, OWNER)).payouts.map((p) => p.state)).toEqual(["paid"]);
  });

  it("reverses a transfer the provider confirms after the buyer was refunded", { timeout: 60_000 }, async () => {
    const stripe = createStripeConnect({ secretKey: "sk_test_x", webhookSecrets: [SECRET], fetch: fakeStripe });
    // A provider that confirms later by webhook, as PayPal does.
    setPayoutProviderForTests("stripe_connect", { ...stripe, transfer: async (r) => ({ ...(await stripe.transfer(r)), settled: false }) });
    await readySeller();
    const invoice = await sell("30");
    expect(await sendProviderPayouts()).toEqual({ sent: 1, failed: 0 });
    const [sent] = await db().select().from(memberPayoutTransfers);
    expect(sent?.state).toBe("sent");
    await reversePayouts.call({ invoiceId: invoice.id, amountMinor: invoice.totalMinor }, { kind: "system" });
    expect((await sitePayouts.call({}, OWNER)).payouts.map((p) => p.state)).toEqual(["cancelled"]);
    await applyPayoutWebhook.call({ provider: "stripe_connect", events: [{ kind: "transfer", reference: sent!.reference!, state: "settled" }] }, { kind: "system" });
    const [payout] = (await sitePayouts.call({}, OWNER)).payouts;
    expect(payout?.state).toBe("review");
    expect(payout?.note).toMatch(/after this payout was cancelled/);
    expect(await sendProviderPayouts()).toEqual({ sent: 1, failed: 0 });
    expect(calls.at(-1)!.path).toMatch(/\/reversals$/);
    expect((await sitePayouts.call({}, OWNER)).payouts.map((p) => p.state)).toEqual(["cancelled"]);
  });

  it("applies a confirmation that arrives before the transfer's reference is recorded, and asks again for one it cannot match", { timeout: 60_000 }, async () => {
    await readySeller();
    await sell("30");
    const [due] = await db().select().from(memberPayouts);
    onTransfer = async () => {
      onTransfer = undefined;
      const result = await applyPayoutWebhook.call({ provider: "stripe_connect", events: [{ kind: "transfer", reference: "tr_early", payoutId: due!.id, state: "settled" }] }, { kind: "system" });
      expect(result).toEqual({ applied: 1, unmatched: 0 });
    };
    expect(await sendProviderPayouts()).toEqual({ sent: 1, failed: 0 });
    const [t] = await db().select().from(memberPayoutTransfers);
    expect(t).toMatchObject({ state: "settled", reference: "tr_early" });
    expect((await sitePayouts.call({}, OWNER)).payouts.map((p) => p.state)).toEqual(["paid"]);
    const unknown = await applyPayoutWebhook.call({ provider: "stripe_connect", events: [{ kind: "transfer", reference: "tr_other", payoutId: crypto.randomUUID(), state: "settled" }] }, { kind: "system" });
    expect(unknown).toEqual({ applied: 0, unmatched: 1 });
  });
});
