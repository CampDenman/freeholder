// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN: real service writers and Stripe HTTP adapter; fictional bank only.
import { createHash, createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { entitlementGrants, entitlements } from "@/core/entitlements/schema";
import { getJob, stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { setModuleEnabled } from "@/core/settings/service";
import { cartItems, productVariants } from "@/modules/catalog/schema";
import { createListing } from "@/modules/members/listings";
import { getProductVariants } from "@/modules/catalog/variants";
import { invoices, payments } from "@/modules/invoicing/schema";
import { recordOfflinePayment, listSavedPaymentMethods, processPaymentProviderEvents } from "@/modules/invoicing/payment-provider-service";
import { merchantPaymentDispatches, merchantPaymentDispatchFinishes } from "@/modules/invoicing/merchant-payment-recovery-schema";
import { merchantPaymentObservations } from "@/modules/invoicing/merchant-collection-schema";
import { quoteNewAgreement } from "@/modules/subscriptions/merchant-terms-quote";
import { subscriptions } from "@/modules/subscriptions/schema";
import { savePlan, subscribe } from "@/modules/subscriptions/service";
import { quoteGrossProration } from "@/modules/subscriptions/proration-quote";
import { acceptGrossProration, applyGrossProrationTask } from "@/modules/subscriptions/proration-service";
import { collectProrationCard, collectProrationCardTask } from "@/modules/subscriptions/proration-card-service";
import { PRORATION_CARD_JOB } from "@/modules/subscriptions/proration-card-contract";
import { subscriptionProrations } from "@/modules/subscriptions/proration-schema";
import { subscriptionProrationCardJobs, subscriptionProrationCardReads, subscriptionProrationCardReadFinishes, subscriptionProrationPaymentProtocols } from "@/modules/subscriptions/proration-card-schema";
import { subscriptionProrationCardWitnesses, exportProrationCardHistory } from "@/modules/subscriptions/proration-card-witnesses";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
function edge(loseReply = false) {
  let intent: Record<string, unknown> | undefined, posts = 0, gets = 0, lost = false;
  const bodies: URLSearchParams[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), headers = new Headers(init.headers);
    expect(url.origin).toBe("https://stripe.example.test"); expect(headers.has("stripe-account")).toBe(false);
    if (url.pathname === "/v1/account") return Response.json({ id: "acct_fixturePlatform" });
    expect(headers.get("stripe-version")).toBe("2026-02-25.clover");
    if (url.pathname === "/v1/payment_intents" && init.method === "POST") {
      posts++; const form = new URLSearchParams(init.body as URLSearchParams); bodies.push(form);
      intent = { id: "pi_originalGrossCard", object: "payment_intent", status: "succeeded", customer: form.get("customer"), currency: form.get("currency"), amount: Number(form.get("amount")),
        amount_received: Number(form.get("amount")), amount_capturable: 0, created: Math.floor(Date.now()/1000), application_fee_amount: Number(form.get("application_fee_amount")),
        transfer_data: { destination: form.get("transfer_data[destination]") }, on_behalf_of: form.get("on_behalf_of"),
        metadata: Object.fromEntries([...form].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9,-1), value])) };
      if (loseReply && !lost) { lost = true; throw new Error("Synthetic original charge accepted but response lost"); }
      return Response.json(intent);
    }
    if (url.pathname === "/v1/payment_intents" && init.method === "GET") { gets++; return Response.json({ data: intent ? [intent] : [], has_more: false }); }
    if (url.pathname === "/v1/payment_intents/pi_originalGrossCard" && init.method === "GET" && intent) { gets++; return Response.json(intent); }
    throw new Error(`Unexpected fictional bank call: ${init.method} ${url.pathname}`);
  });
  return { provider: createStripePayments({ secretKey: "sk_original_gross_card_fixture", webhookSecrets: ["whsec_original_gross_card_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher }),
    posts: () => posts, gets: () => gets, bodies };
}
describe.runIf(hasDatabase)("actual accepted original gross stored-method collection", { timeout: 90000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { vi.useRealTimers(); fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function original(loseReply = false) {
    const effectiveAt = new Date(Date.now()+45000);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(effectiveAt.getTime()-43200000);
    fixture = await seedMerchantCheckout80("destination", 1);
    const remote = edge(loseReply); vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue(remote.provider);
    await setModuleEnabled.call({ module: "subscriptions", enabled: true }, OWNER);
    const receivedAt = new Date().toISOString(), timestamp = Math.floor(Date.parse(receivedAt)/1000);
    const body = Buffer.from(JSON.stringify({ id: "evt_originalGrossCardMethod", type: "payment_method.attached", created: timestamp, data: { object: {
      id: "pm_originalGrossCard", object: "payment_method", type: "card", customer: "cus_originalGrossCard", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
      metadata: { freeholder_contact_id: fixture.buyer.id, freeholder_platform_account_id: "acct_fixturePlatform" } } } }));
    const signature = createHmac("sha256", "whsec_original_gross_card_fixture").update(`${timestamp}.`).update(body).digest("hex");
    const events = await remote.provider.verifyWebhook({ body, receivedAt, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` } }); expect(events).toHaveLength(1);
    await processPaymentProviderEvents.call({ provider: "stripe", bodySha256: createHash("sha256").update(body).digest("hex"), receivedAt, events: [...events] }, { kind: "system" });
    const saved = await listSavedPaymentMethods.call({ contactId: fixture.buyer.id }, OWNER); expect(saved).toHaveLength(1);
    const [item] = await db().select({ variant: productVariants }).from(cartItems).innerJoin(productVariants, eq(productVariants.id, cartItems.variantId)).where(eq(cartItems.cartId, fixture.cart.id)).limit(1);
    if (!item || !saved[0]) throw new Error("Create the actual original listing and authenticated saved method first.");
    const plan = await savePlan.call({ productId: item.variant.productId, name: "Actual original paid card day", interval: "day", billingMode: "platform", proration: "create_prorations", status: "active" }, OWNER);
    const selection = { planId: plan.id, productVariantId: item.variant.id, contactId: fixture.buyer.id, paymentMethodId: saved[0].id, currency: "CAD", taxDestination: { country: "CA", region: "BC" } };
    const quote = await quoteNewAgreement.call(selection, OWNER); if (!quote) throw new Error("The actual original seller quote is required.");
    const joined = await subscribe.call({ ...selection, commercialTerms: { quoteDigest: quote.quoteDigest, locale: "en", source: "owner_subscription" } }, OWNER);
    if (!joined.invoiceId) throw new Error("The actual initial period invoice is required.");
    // Legitimate authorized external principal, never a synthetic Stripe cash row.
    await recordOfflinePayment.call({ invoiceId: joined.invoiceId, method: "bank_transfer", amountMinor: 4200, reference: "fictional-old-card-period",
      evidence: "Synthetic recorded original external principal; not independent bank verification", idempotencyKey: "original-card-period" }, OWNER);
    const seller = fixture.sellers[0];
    if (!seller) throw new Error("The actual original card fixture must provide its seller before creating a target.");
    const listing = await createListing.call({ title: "Actual card target", kind: "digital", price: "100", acceptPolicy: true }, seller);
    const variant = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!;
    const target = await savePlan.call({ productId: listing.productId, name: "Actual target paid card day", interval: "day", intervalCount: 2, billingMode: "platform", proration: "create_prorations", status: "active" }, OWNER);
    vi.useRealTimers();
    const input = { id: joined.subscription.id, planId: target.id, productVariantId: variant.id, effectiveAt: effectiveAt.toISOString(), taxDestination: selection.taxDestination, locale: "en" as const };
    const review = await quoteGrossProration.call(input, OWNER);
    expect(review).toMatchObject({ cashDueMinor: 3150, payment: { methodId: saved[0].id, last4: "4242" } });
    const accepted = await acceptGrossProration.call({ ...input, previousTermsId: review.previousTermsId, acceptedQuoteDigest: review.quoteDigest, confirm: true }, OWNER);
    const [job] = await db().select().from(subscriptionProrationCardJobs).where(eq(subscriptionProrationCardJobs.prorationId, accepted.prorationId));
    if (!job) throw new Error("The actual accepted transaction must retain its original worker body.");
    expect((await getJob(PRORATION_CARD_JOB, job.jobId))?.data).toEqual(job.originalTask);
    await collectProrationCardTask.call(job.originalTask, { kind: "system" });
    expect((await failure(collectProrationCardTask.call({ ...job.originalTask, originalJobId: joined.subscription.id }, { kind: "system" }))).code).toBe("permission");
    return { remote, joined, target, accepted, effectiveAt };
  }
  async function current(id: string) { return (await db().select().from(subscriptions).where(eq(subscriptions.id,id)))[0]!; }
  const access = (id: string) => db().select({ planId: entitlements.grantorId, startsAt: entitlementGrants.startsAt, endsAt: entitlementGrants.endsAt })
    .from(entitlementGrants).innerJoin(entitlements, eq(entitlements.id, entitlementGrants.entitlementId)).where(eq(entitlementGrants.sourceSubscriptionId, id));
  async function effect(prorationId: string) {
    const [row] = await db().select().from(subscriptionProrations).where(eq(subscriptionProrations.id,prorationId));
    if (!row?.originalTask) throw new Error("Retain the actual original effect worker body.");
    const wait = row.effectiveAt.getTime()-Date.now()+30;
    if (wait>45030) throw new Error("The real-clock effect exceeds this finite control.");
    if (wait>0) await new Promise(resolve => setTimeout(resolve,wait));
    return applyGrossProrationTask.call(row.originalTask,{kind:"system"});
  }
  it("collects the exact accepted method/amount/fee once and changes only fully paid access at the real boundary", async () => {
    const source = await original();
    expect((await current(source.joined.subscription.id)).planId).toBe(source.joined.subscription.planId);
    const beforeAccess = await access(source.joined.subscription.id);
    const result = await collectProrationCard.call({ prorationId: source.accepted.prorationId }, OWNER);
    expect(result.collectionState).toBe("paid"); expect(result.applied).toBe(false); expect(source.remote.posts()).toBe(1);
    expect(source.remote.bodies[0]!.get("amount")).toBe("3150"); expect(source.remote.bodies[0]!.get("application_fee_amount")).toBe("300");
    expect(source.remote.bodies[0]!.get("payment_method")).toBe("pm_originalGrossCard"); expect(source.remote.bodies[0]!.get("customer")).toBe("cus_originalGrossCard");
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id,result.invoiceId!));
    expect(invoice).toMatchObject({ totalMinor:5250, creditedMinor:2100, paidMinor:3150, status:"paid" });
    const dispatches = await db().select().from(merchantPaymentDispatches).where(eq(merchantPaymentDispatches.paymentId,result.paymentId!)); expect(dispatches).toHaveLength(1);
    expect(await db().select().from(merchantPaymentDispatchFinishes).where(eq(merchantPaymentDispatchFinishes.dispatchId,dispatches[0]!.id))).toHaveLength(1);
    expect(await db().select().from(subscriptionProrationPaymentProtocols).where(eq(subscriptionProrationPaymentProtocols.paymentId,result.paymentId!))).toMatchObject([{providerApiVersion:"2026-02-25.clover"}]);
    expect((await current(source.joined.subscription.id)).planId).toBe(source.joined.subscription.planId);
    expect(await access(source.joined.subscription.id)).toEqual(beforeAccess);
    expect((await effect(source.accepted.prorationId)).applied).toBe(true);
    expect((await access(source.joined.subscription.id)).every(row => row.planId !== source.target.id || row.startsAt >= source.effectiveAt)).toBe(true);
    expect(await current(source.joined.subscription.id)).toMatchObject({ planId:source.target.id, currentPeriodStart:source.joined.subscription.currentPeriodStart,currentPeriodEnd:source.joined.subscription.currentPeriodEnd });
  });
  it("recovers a real lost charge reply through its independent actual GET without a second POST or fictional finish", async () => {
    const source=await original(true);
    expect((await failure(collectProrationCard.call({prorationId:source.accepted.prorationId},OWNER))).code).toBe("conflict");
    expect(source.remote.posts()).toBe(1);
    const result=await collectProrationCard.call({prorationId:source.accepted.prorationId},OWNER);
    expect(result.collectionState).toBe("paid"); expect(source.remote.posts()).toBe(1); expect(source.remote.gets()).toBeGreaterThan(0);
    const reads=await db().select().from(subscriptionProrationCardReads).where(eq(subscriptionProrationCardReads.paymentId,result.paymentId!)); expect(reads).toHaveLength(1);
    const finishes=await db().select().from(subscriptionProrationCardReadFinishes).where(eq(subscriptionProrationCardReadFinishes.readId,reads[0]!.id));expect(finishes).toHaveLength(1);expect(finishes[0]!.actualResult.outcome).toBe("returned");
    expect(await db().select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId,result.paymentId!),eq(merchantPaymentObservations.status,"succeeded")))).not.toHaveLength(0);
    const witness=await db().transaction(tx => subscriptionProrationCardWitnesses(tx,[result.invoiceId!]));expect(witness.incomplete).toBe(false);expect(witness.reads).toHaveLength(1);
    const safe=JSON.stringify(exportProrationCardHistory(witness));expect(safe).not.toMatch(/pm_original|cus_original|nonce|completionDigest|publicKey|signature|hostingEvidence|pidNamespace/);
    expect((await current(source.joined.subscription.id)).planId).toBe(source.joined.subscription.planId);
  });
  it("makes an unstarted stale original card job inert when the subscription module is disabled",async()=>{
    const source=await original();await setModuleEnabled.call({module:"subscriptions",enabled:false},OWNER);
    const result=await collectProrationCard.call({prorationId:source.accepted.prorationId},OWNER);expect(result.collectionState).toBe("skipped");expect(source.remote.posts()).toBe(0);
    expect(await current(source.joined.subscription.id)).toMatchObject({planId:source.joined.subscription.planId,currentPeriodEnd:source.joined.subscription.currentPeriodEnd});
    expect(await db().select().from(payments).where(eq(payments.invoiceId,source.accepted.invoiceId!))).toHaveLength(0);
  });
});
