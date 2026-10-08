// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19/C8.17/C9.38: customer prices and records never carry another audience's data.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { products, productVariants, priceLists, priceListEntries } from "@/modules/catalog/schema";
import { quoteServicePayment, setPriceRule, upsertServiceOffering } from "@/modules/catalog/offerings";
import { listSubscriptions, savePlan, subscribe } from "@/modules/subscriptions/service";
import { publicMembershipPlans, joinMembership } from "@/modules/subscriptions/public-signup";
import { subscriptions } from "@/modules/subscriptions/schema";
import { invoices } from "@/modules/invoicing/schema";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

let contactId: string;
const OTHER = { ...CUSTOMER, userId: "00000000-0000-4000-8000-000000000004" };
async function offer(kind: "service" | "digital") {
  const [product] = await db().insert(products).values({ name: "Private price offer", slug: randomUUID(), kind, status: "active", publishedAt: new Date() }).returning();
  const [variant] = await db().insert(productVariants).values({ productId: product!.id, combinationKey: "default", sku: randomUUID(), isDefault: true }).returning();
  const [retail] = await db().insert(priceLists).values({ name: "Retail", currency: "CAD", active: true }).returning();
  const [contract] = await db().insert(priceLists).values({ name: "Customer contract", kind: "contract", currency: "CAD", contactId, active: true, priority: 100 }).returning();
  await db().insert(priceListEntries).values([{ priceListId: retail!.id, variantId: variant!.id, amountMinor: 10000 }, { priceListId: contract!.id, variantId: variant!.id, amountMinor: 7000 }]);
  return product!;
}

describe.runIf(hasDatabase)("adversarial customer prices and membership records", () => {
  beforeAll(ready, 60000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([{ id: OWNER.userId, email: "owner@example.test", role: "owner" }, { id: CUSTOMER.userId, email: "customer@example.test", role: "customer" }, { id: OTHER.userId, email: "other@example.test", role: "customer" }]);
    await updateBusiness.call({ name: "Customer privacy proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    const { contact } = await resolveContact.call({ email: "customer@example.test" }, OWNER);
    contactId = contact.id;
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contactId));
    const { contact: other } = await resolveContact.call({ email: "other@example.test" }, OWNER);
    await db().update(contacts).set({ userId: OTHER.userId }).where(eq(contacts.id, other.id));
  });
  afterAll(closeDb);

  it("does not quote somebody's contract price to an anonymous or unrelated caller", async () => {
    const product = await offer("service");
    await upsertServiceOffering.call({ productId: product.id, durationMin: 60, locationType: "in_person" }, OWNER);
    await setPriceRule.call({ productId: product.id, mode: "full" }, OWNER);
    const input = { productId: product.id, currency: "CAD", contactId };
    const own = await quoteServicePayment.call(input, CUSTOMER);
    expect(own.available && own.priceMinor).toBe(7000);
    expect((await failure(quoteServicePayment.call(input, ANONYMOUS))).code).toBe("permission");
    expect((await failure(quoteServicePayment.call(input, OTHER))).code).toBe("permission");
    const owner = await quoteServicePayment.call(input, OWNER);
    expect(owner.available && owner.priceMinor).toBe(7000);
  });

  it("uses the signed-in customer's actual price in membership terms and invoice", async () => {
    const product = await offer("digital");
    const plan = await savePlan.call({ productId: product.id, name: "Contract membership", status: "active" }, OWNER);
    const anonymous = (await publicMembershipPlans.call({}, ANONYMOUS))[0]!;
    const offered = (await publicMembershipPlans.call({}, CUSTOMER))[0]!;
    expect(anonymous.amountMinor).toBe(10000);
    expect(offered.amountMinor).toBe(7000);
    expect(offered.termsHash).not.toBe(anonymous.termsHash);
    const joined = await joinMembership.call({ planId: plan.id, termsHash: offered.termsHash, acceptedTerms: true, requestKey: randomUUID() }, CUSTOMER);
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, joined.invoiceId!));
    expect(invoice?.subtotalMinor).toBe(offered.amountMinor);
  });

  it("projects customer membership records without provider, retry or private grant fields", async () => {
    const product = await offer("digital");
    const plan = await savePlan.call({ productId: product.id, name: "Private membership", status: "active" }, OWNER);
    const started = await subscribe.call({ contactId, planId: plan.id }, OWNER);
    const requestKey = randomUUID();
    await db().update(subscriptions).set({ provider: "stripe", providerRef: "sub_owner_private", publicRequestKey: requestKey, publicTermsHash: "b".repeat(64), grants: { ownerNote: "staff-only membership detail" } }).where(eq(subscriptions.id, started.subscription.id));
    const owner = (await listSubscriptions.call({ contactId }, OWNER))[0]!;
    expect(owner.providerRef).toBe("sub_owner_private");
    const customer = (await listSubscriptions.call({ contactId }, CUSTOMER))[0]!;
    expect(customer.id).toBe(started.subscription.id);
    expect(customer.providerRef).toBeNull();
    expect(customer.paymentMethodId).toBeNull();
    expect(JSON.stringify(customer)).not.toContain(requestKey);
    expect(JSON.stringify(customer)).not.toContain("staff-only membership detail");
    expect(customer).not.toHaveProperty("publicTermsHash");
  });
});
