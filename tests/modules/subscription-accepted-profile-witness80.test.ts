// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: real accepted manual terms and exact business-child witnesses.
// These shared-service journeys do not qualify provider creation or real tax
// certificates; all contacts, declarations and certificate references are fictional.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import { getJob, stopJobs, type JobExecutionContext } from "@/core/jobs";
import { dataRequestArtifacts } from "@/core/privacy/schema";
import { createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { cartItems, productVariants } from "@/modules/catalog/schema";
import { BUYER_MONEY_ERASURE_JOB, finishBuyerMoneyErasure } from "@/modules/invoicing/buyer-money-erasure";
import { requestMerchantTaxExemption, reviewMemberMerchantTaxExemption } from "@/modules/invoicing/merchant-tax-exemptions";
import { merchantTaxProfiles, merchantTaxProfileVersions } from "@/modules/invoicing/merchant-tax-schema";
import { taxExemptions } from "@/modules/invoicing/schema";
import { memberListings } from "@/modules/members/schema";
import { quoteNewAgreement } from "@/modules/subscriptions/merchant-terms-quote";
import { subscriptionCommercialSnapshot } from "@/modules/subscriptions/merchant-terms-contract";
import { subscriptionCommercialTerms } from "@/modules/subscriptions/schema";
import { getSubscription, savePlan, subscribe } from "@/modules/subscriptions/service";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

function jobContext(id: string): JobExecutionContext { return { id, name: BUYER_MONEY_ERASURE_JOB, attempt: 1, signal: new AbortController().signal,
  leaseSeconds: 120, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} }; }
describe.runIf(hasDatabase)("accepted merchant terms and exact profile merge witnesses", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  async function acceptManualTrial(index: 0 | 1, buyerId: string) {
    const [owned] = await db().select({ variant: productVariants }).from(cartItems)
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .innerJoin(memberListings, and(eq(memberListings.productId, productVariants.productId), eq(memberListings.sellerId, fixture!.sellers[index]!.userId)))
      .where(eq(cartItems.cartId, fixture!.cart.id)).limit(1);
    const selected = owned?.variant;
    if (!selected) throw new Error("The real two-seller fixture has no original plan variant.");
    const plan = await savePlan.call({ productId: selected.productId, name: `Accepted original manual offer ${index}`, interval: "month", trialDays: 7,
      trialRequiresCard: false, setupFeeMinor: 500, billingMode: "manual", cancelBehaviour: "period_end", proration: "none", status: "active" }, OWNER);
    const quote = await quoteNewAgreement.call({ planId: plan.id, productVariantId: selected.id, contactId: buyerId, currency: "CAD",
      taxDestination: { country: "CA", region: "BC" }, locale: "en" }, OWNER);
    if (!quote) throw new Error("The actual declared seller agreement unexpectedly selected legacy collection.");
    const accepted = await subscribe.call({ planId: plan.id, productVariantId: selected.id, contactId: buyerId, currency: "CAD",
      taxDestination: { country: "CA", region: "BC" }, commercialTerms: { quoteDigest: quote.quoteDigest, locale: "en", source: "owner_subscription" } }, OWNER);
    expect(accepted.invoiceId).toBeNull(); expect(accepted.subscription.status).toBe("trialing");
    const [terms] = await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.subscriptionId, accepted.subscription.id));
    if (!terms) throw new Error("The shared acceptance service did not persist its actual original terms.");
    expect(terms.profileId).toBe(fixture!.profiles[index]!.profileId);
    expect(terms.acceptedQuoteDigest).toBe(quote.quoteDigest);
    expect(terms.noticeDigest).toBe(quote.noticeDigest);
    const snapshot = subscriptionCommercialSnapshot.parse(terms.snapshot);
    expect(snapshot).toMatchObject({ billingMode: "manual", periodAmountMinor: index === 0 ? 4000 : 1000, setupFeeMinor: 500, trialDays: 7, interval: "month", currency: "CAD" });
    expect(quote.initialTaxQuote.totalMinor).toBe(0);
    expect(quote.firstPeriodTaxQuote.totalMinor).toBe(index === 0 ? 4725 : 1575);
    return { plan, quote, accepted, terms, snapshot };
  }
  async function eraseTerms(contactId: string) {
    const request = await createDataRequest.call({ contactId, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic original accepted-terms buyer verification" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
    const body = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({ scope: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough().parse(artifact?.body);
    for (const id of body.outcomes.find(item => item.scope === "commerce.money")?.pendingJobs ?? []) {
      const job = await getJob(BUYER_MONEY_ERASURE_JOB, id);
      if (!job) throw new Error("The actual money privacy source named a different or missing finisher.");
      await finishBuyerMoneyErasure.handler(job.data, jobContext(job.id));
    }
  }

  it("keeps accepted manual promises after plan edits and binds only the owning profile's accepted-term child changes", async () => {
    fixture = await seedMerchantCheckout80("destination", 2);
    const ownBuyer = await createContact.call({ name: "Accepted own buyer", email: "accepted-own-buyer@example.test" }, OWNER);
    const foreignBuyer = await createContact.call({ name: "Accepted foreign buyer", email: "accepted-foreign-buyer@example.test" }, OWNER);
    const own = await acceptManualTrial(0, ownBuyer.id), foreign = await acceptManualTrial(1, foreignBuyer.id);
    expect(own.terms.profileId).not.toBe(foreign.terms.profileId);
    await savePlan.call({ id: own.plan.id, productId: own.plan.productId, name: "Later changed offer", interval: "year", trialDays: 0,
      setupFeeMinor: 900, billingMode: "manual", cancelBehaviour: "immediate", proration: "create_prorations", status: "active" }, OWNER);
    const viewed = await getSubscription.call({ id: own.accepted.subscription.id }, OWNER);
    expect(viewed.plan).toMatchObject({ name: own.snapshot.name, interval: "month", trialDays: 7, setupFeeMinor: 500, cancelBehaviour: "period_end", proration: "none" });
    expect((await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, own.terms.id)))[0]).toEqual(own.terms);
    const [profile] = await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, own.terms.profileId));
    if (!profile?.contactId) throw new Error("The accepted original merchant lost its contact ownership before merge.");
    const originalContactId = profile.contactId, alias = await createContact.call({ name: "Accepted seller alias", email: "accepted-seller-alias@example.test" }, OWNER);
    const first = await mergeContacts.call({ survivingId: alias.id, duplicateId: originalContactId }, OWNER);
    await eraseTerms(foreignBuyer.id);
    expect((await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, foreign.terms.id)))[0]).toMatchObject({ taxDestination: null });
    expect((await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, own.terms.id)))[0]).toEqual(own.terms);
    await undoContactMerge.call({ operationId: first.mergeOperationId }, OWNER);
    expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profile.id)))[0]?.contactId).toBe(originalContactId);
    const second = await mergeContacts.call({ survivingId: alias.id, duplicateId: originalContactId }, OWNER);
    await eraseTerms(ownBuyer.id);
    const [minimized] = await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, own.terms.id));
    expect(minimized).toMatchObject({ taxDestination: null });
    expect(minimized?.snapshot).toEqual(own.terms.snapshot);
    const blocked = await failure(undoContactMerge.call({ operationId: second.mergeOperationId }, OWNER));
    expect(blocked.code).toBe("conflict"); expect(blocked.message).toMatch(/Original tax business declarations changed/);
    expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profile.id)))[0]?.contactId).toBe(alias.id);
  });

  it("correlates actual exemption children to the owning profile while ignoring a foreign business's decision", async () => {
    fixture = await seedMerchantCheckout80("destination", 2);
    // Only authentication identity is seeded here, matching the fixture's
    // existing user setup; all exemption and merge operations use real services.
    const actor = { ...CUSTOMER, userId: randomUUID() };
    await db().insert(users).values({ id: actor.userId, email: fixture.buyer.email!, role: "customer" });
    await db().update(contacts).set({ userId: actor.userId }).where(eq(contacts.id, fixture.buyer.id));
    const requested: Array<{ id: string }> = [];
    for (const seller of fixture.sellers) requested.push(await requestMerchantTaxExemption.call({ cartId: fixture.cart.id, cartToken: fixture.cart.token,
      sellerUserId: seller.userId, destination: { country: "CA", region: "BC" }, kind: "reseller", certificateRef: `synthetic-certificate-${seller.userId}` }, actor));
    const [profile] = await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, fixture.profiles[0]!.profileId));
    if (!profile?.contactId) throw new Error("The actual original business declaration has no owner.");
    const originalContactId = profile.contactId, alias = await createContact.call({ name: "Correlated seller alias", email: "correlated-seller-alias@example.test" }, OWNER);
    const first = await mergeContacts.call({ survivingId: alias.id, duplicateId: originalContactId }, OWNER);
    await reviewMemberMerchantTaxExemption.call({ id: requested[1]!.id, expectedStatus: "pending", decision: "valid", confirmEvidence: true }, fixture.sellers[1]!);
    await undoContactMerge.call({ operationId: first.mergeOperationId }, OWNER);
    const second = await mergeContacts.call({ survivingId: alias.id, duplicateId: originalContactId }, OWNER);
    const [before] = await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profile.id));
    const versions = await db().select().from(merchantTaxProfileVersions).where(eq(merchantTaxProfileVersions.profileId, profile.id)).orderBy(merchantTaxProfileVersions.version);
    await reviewMemberMerchantTaxExemption.call({ id: requested[0]!.id, expectedStatus: "pending", decision: "valid", confirmEvidence: true }, fixture.sellers[0]!);
    expect((await db().select().from(taxExemptions).where(eq(taxExemptions.id, requested[0]!.id)))[0]).toMatchObject({ merchantProfileId: profile.id, status: "valid" });
    expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profile.id)))[0]).toEqual(before);
    expect(await db().select().from(merchantTaxProfileVersions).where(eq(merchantTaxProfileVersions.profileId, profile.id)).orderBy(merchantTaxProfileVersions.version)).toEqual(versions);
    const blocked = await failure(undoContactMerge.call({ operationId: second.mergeOperationId }, OWNER));
    expect(blocked.code).toBe("conflict"); expect(blocked.message).toMatch(/Original tax business declarations changed/);
    expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profile.id)))[0]?.contactId).toBe(alias.id);
  });
});
