// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: real shared checkout, original money, contact merge and old-writer refusal.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts, contactMergeOperations } from "@/core/contacts/schema";
import { mergeContacts, resolveContact, undoContactMerge } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { createLocationService } from "@/core/locations/service";
import { updateBusiness } from "@/core/settings/service";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { createListing } from "@/modules/members/listings";
import { savePayoutInstructions, setPayoutAccountStatus } from "@/modules/members/payouts";
import { activateProduct, addCartItem, applyCouponToCart, applyVariantMatrix, checkoutCart, createCoupon, createPriceList, createProduct, createShippingMethod, createShippingZone, getOrCreateCart, getProductVariants, setPriceListEntry } from "@/modules/catalog/service";
import { createDraftInvoice, getInvoice, issueInvoice } from "@/modules/invoicing/invoice-service";
import { addTaxRate, createTaxCategory, createTaxZone, setTaxRegistration } from "@/modules/invoicing/tax-service";
import { captureInvoiceMerchantAllocations } from "@/modules/invoicing/merchant-allocations";
import { invoiceLines, invoiceMarketPolicies, invoiceMerchantAllocations, invoiceMerchantAllocationLines, invoices } from "@/modules/invoicing/schema";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SECOND = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
describe.runIf(hasDatabase)("one invoice's original merchant portions (C12.38)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([{ id: OWNER.userId, email: "owner@example.test", role: "owner" }, { id: CUSTOMER.userId, email: "first@example.test", role: "customer" }, { id: SECOND.userId, email: "second@example.test", role: "customer" }]);
    await updateBusiness.call({ name: "Original portion proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, siteFeeBps: 1000, holdDays: 7 }, OWNER);
    for (const [actor, handle] of [[CUSTOMER, "original_first"], [SECOND, "original_second"]] as const) {
      await joinSite.call({ handle, displayName: handle, meetsMinimumAge: true, isAdult: true }, actor);
      await savePayoutInstructions.call({ instructions: "Synthetic recorded bank account" }, actor);
      await setPayoutAccountStatus.call({ userId: actor.userId, status: "ready" }, OWNER);
    }
  });
  afterAll(closeDb);

  async function place(physical = false) {
    const { contact } = await resolveContact.call({ email: "portion-buyer@example.test", name: "Buyer" }, OWNER);
    const cart = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    for (const [actor, price] of [[CUSTOMER, "40"], [SECOND, "10"]] as const) {
      const listing = await createListing.call({ acceptPolicy: true, title: `Original ${price} item`, kind: physical ? "physical" : "digital", price }, actor);
      const variant = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!;
      await addCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token ?? undefined, variantId: variant.id }, ANONYMOUS);
    }
    const siteCategory = await createTaxCategory.call({ code: "site_digital", name: "Site digital products" }, OWNER);
    const siteProduct = await createProduct.call({ name: "Site download", slug: "site-download", kind: "digital", taxCategoryId: siteCategory.id }, OWNER);
    const matrix = await applyVariantMatrix.call({ productId: siteProduct.id, expectedVersion: siteProduct.version }, OWNER);
    const siteVariant = (await getProductVariants.call({ productId: siteProduct.id }, OWNER)).variants[0]!;
    const list = await createPriceList.call({ name: "Site CAD retail", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: siteVariant.id, amount: "30" }, OWNER);
    await activateProduct.call({ id: siteProduct.id, expectedVersion: matrix.version }, OWNER);
    await addCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token ?? undefined, variantId: siteVariant.id }, ANONYMOUS);
    await createCoupon.call({ code: "HALFPORTIONS", kind: "percent", percentOffPpm: 500000 }, OWNER);
    await applyCouponToCart.call({ cartId: cart.cart.id, code: "HALFPORTIONS" }, OWNER);
    const input = { cartId: cart.cart.id, contactId: contact.id, idempotencyKey: "original-portions-order", acceptedTerms: true as const,
      ...(physical ? { shippingAddress: { country: "CA", region: "BC", postalCode: "V8W1P6", city: "Victoria" } } : {}),
    };
    const order = await checkoutCart.call(input, OWNER);
    return { order, input, invoiceId: order.order.invoiceId! };
  }

  it("freezes two sellers and site revenue on exactly one discounted invoice, with repeat checkout creating no second portion", async () => {
    const { order, input, invoiceId } = await place();
    const portions = await db().select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId, invoiceId));
    expect(portions.map(part => [part.sellerUserId, part.revenueMinor, part.feeMinor]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([[CUSTOMER.userId, 2000, 200], [SECOND.userId, 500, 50], [null, 1500, 0]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(portions.reduce((sum, part) => sum + part.totalMinor, 0)).toBe(4000);
    expect(await db().select().from(invoices)).toHaveLength(1);
    expect(await db().select().from(invoiceMerchantAllocationLines)).toHaveLength(3);
    expect((await checkoutCart.call(input, OWNER)).order.id).toBe(order.order.id);
    expect(await db().select().from(invoiceMerchantAllocations)).toEqual(portions);
    expect(JSON.stringify(await getInvoice.call({ id: invoiceId }, OWNER))).not.toContain("sellerKey");
  });

  it("refuses edits to original portion money, policy version, routing terms and invoice line ownership", async () => {
    const { invoiceId } = await place();
    const [part] = await db().select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId, invoiceId));
    const [line] = await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    await expect(db().update(invoiceMerchantAllocations).set({ feeMinor: 1 }).where(eq(invoiceMerchantAllocations.id, part!.id))).rejects.toThrow();
    await expect(db().update(invoiceMarketPolicies).set({ allocationVersion: 0 }).where(eq(invoiceMarketPolicies.invoiceId, invoiceId))).rejects.toThrow();
    await expect(db().update(invoiceMarketPolicies).set({ adapter: "replacement" }).where(eq(invoiceMarketPolicies.invoiceId, invoiceId))).rejects.toThrow();
    await expect(db().update(invoiceLines).set({ sourceId: crypto.randomUUID() }).where(eq(invoiceLines.id, line!.id))).rejects.toThrow();
    await expect(db().update(invoices).set({ currency: "USD" }).where(eq(invoices.id, invoiceId))).rejects.toThrow();
    await expect(db().delete(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.id, part!.id))).rejects.toThrow();
  });

  it("repoints the original unified seller contact during merge and restores its financial portion on undo", async () => {
    const { invoiceId } = await place();
    const [original] = await db().select().from(contacts).where(eq(contacts.userId, CUSTOMER.userId));
    expect(original).toBeDefined();
    const { contact: duplicate } = await resolveContact.call({ email: "duplicate-original-seller@example.test", name: "Duplicate" }, OWNER);
    const merged = await mergeContacts.call({ duplicateId: original!.id, survivingId: duplicate.id }, OWNER);
    const portion = async () => (await db().select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId, invoiceId))).find(row => row.sellerUserId === CUSTOMER.userId)!;
    expect((await portion()).merchantContactId).toBe(duplicate.id);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect((await portion()).merchantContactId).toBe(original!.id);
  });

  it("denies human/agent capture and refuses a prior writer issuing a new unallocated order policy", async () => {
    const { invoiceId } = await place();
    expect(await failure(captureInvoiceMerchantAllocations.call({ invoiceId }, OWNER))).toMatchObject({ code: "permission" });
    expect(await failure(captureInvoiceMerchantAllocations.call({ invoiceId }, { kind: "agent", keyName: "portion-agent", scopes: ["invoicing.*"] }))).toMatchObject({ code: "permission" });
    const [issued] = await db().select().from(invoices).where(eq(invoices.id, invoiceId));
    const draft = await createDraftInvoice.call({ contactId: issued!.contactId, currency: "CAD", sourceType: "order", sourceId: crypto.randomUUID(), idempotencyKey: "old-writer-unallocated", lines: [{ description: "Original writer line", quantityMicros: 1000000, unitAmountMinor: 100 }], tax: { mode: "not_applicable", reason: "Synthetic original writer" } }, OWNER);
    await db().insert(invoiceMarketPolicies).values({ invoiceId: draft.invoice.id, model: "hold", adapter: "manual", siteFeeBps: 1000, holdDays: 7, feeMinor: 10, sellerUserId: CUSTOMER.userId });
    await expect(issueInvoice.call({ id: draft.invoice.id }, OWNER)).rejects.toThrow();
    expect((await getInvoice.call({ id: draft.invoice.id }, OWNER)).invoice.status).toBe("draft");
  });

  it("refuses undo of a pre77 contact merge after new original merchant ownership is recorded", async () => {
    const [original] = await db().select().from(contacts).where(eq(contacts.userId, CUSTOMER.userId));
    const { contact: survivor } = await resolveContact.call({ email: "prior-merge-survivor@example.test", name: "Original survivor" }, OWNER);
    const merged = await mergeContacts.call({ duplicateId: original!.id, survivingId: survivor.id }, OWNER);
    // Declared historical fixture: pre77 merge receipts had no allocation
    // entry, because that table did not exist. Do not invent before hashes.
    await db().update(contactMergeOperations).set({ referenceState: sql`(select coalesce(jsonb_agg(entry), '[]'::jsonb) from jsonb_array_elements(${contactMergeOperations.referenceState}) entry where entry->>'table'<>'invoice_merchant_allocations')` }).where(eq(contactMergeOperations.id, merged.mergeOperationId));
    const { invoiceId } = await place();
    expect(await failure(undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER))).toMatchObject({ code: "conflict" });
    await expect(db().update(contactMergeOperations).set({ undoneAt: new Date() }).where(eq(contactMergeOperations.id, merged.mergeOperationId))).rejects.toThrow();
    const portions = await db().select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId, invoiceId));
    expect(portions.find(part => part.sellerUserId === CUSTOMER.userId)?.merchantContactId).toBe(survivor.id);
    expect(await db().select().from(contacts).where(eq(contacts.id, original!.id))).toHaveLength(0);
  });

  it("conserves actual item tax and an indivisible shipping-tax cent on a mixed physical seller/site invoice", async () => {
    await createLocationService.call({ name: "Fixture origin", slug: "portion-origin", country: "CA", city: "Victoria" }, OWNER);
    const zone = await createTaxZone.call({ name: "Fixture five-percent zone", country: "CA", basis: "destination", pricesIncludeTax: false, roundingScope: "line", roundingMode: "half_up" }, OWNER);
    await setTaxRegistration.call({ zoneId: zone.id, number: "SYNTHETIC-ONLY-REGISTRATION", status: "active" }, OWNER);
    await addTaxRate.call({ zoneId: zone.id, name: "Fixture five percent", jurisdiction: "Synthetic test jurisdiction", ratePpm: 50000, appliesToShipping: true }, OWNER);
    const destinations = await createShippingZone.call({ name: "Fixture delivery", countries: ["CA"] }, OWNER);
    await createShippingMethod.call({ zoneId: destinations.id, name: "Fixture parcel", kind: "flat", currency: "CAD", amount: "3.71" }, OWNER);
    const { invoiceId } = await place(true);
    const invoice = await getInvoice.call({ id: invoiceId }, OWNER);
    expect(invoice.invoice).toMatchObject({ subtotalMinor: 8000, discountMinor: 4000, shippingMinor: 371, taxMinor: 219, totalMinor: 4590 });
    expect(invoice.taxLines.filter(line => line.kind === "shipping").reduce((sum, line) => sum + line.amountMinor, 0)).toBe(19);
    const portions = await db().select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId, invoiceId));
    expect(portions.find(part => part.sellerUserId === CUSTOMER.userId)).toMatchObject({ revenueMinor: 2000, shippingMinor: 297, taxMinor: 115, totalMinor: 2412, feeMinor: 200 });
    expect(portions.find(part => part.sellerUserId === SECOND.userId)).toMatchObject({ revenueMinor: 500, shippingMinor: 74, taxMinor: 29, totalMinor: 603, feeMinor: 50 });
    expect(portions.find(part => part.sellerUserId === null)).toMatchObject({ revenueMinor: 1500, shippingMinor: 0, taxMinor: 75, totalMinor: 1575, feeMinor: 0 });
  });
});
