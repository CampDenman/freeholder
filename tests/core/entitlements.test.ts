// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Access computed from grants (MASTER.md §4.15, C9.14).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { ready } from "@/core/runtime";
import {
  grantAccess,
  hasAccess,
  issuePass,
  issueUnlock,
  listGrants,
  revokeGrant,
  saveEntitlement,
  spendPass,
} from "@/core/entitlements/service";
import { resourceMatches } from "@/core/entitlements/access";
import { entitlementGrants } from "@/core/entitlements/schema";
import {
  priceListEntries,
  priceLists,
  productVariants,
  products,
} from "@/modules/catalog/schema";
import { resolveVisibleProduct } from "@/modules/catalog/service";
import { savePlan, subscribe, pauseSubscription, cancelSubscription } from "@/modules/subscriptions/service";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

let sequence = 0;

async function person(name: string) {
  const { contact } = await resolveContact.call(
    { email: `${name}-${sequence}@example.test`, name, country: "CA" },
    OWNER,
  );
  return contact;
}

async function priced(name: string, amountMinor: number, kind: "digital" | "pass" = "digital") {
  sequence += 1;
  const [product] = await db()
    .insert(products)
    .values({
      name,
      slug: `entitlement-product-${sequence}`,
      kind,
      status: "active",
      visibility: "public",
      publishedAt: new Date(),
    })
    .returning();
  const [variant] = await db()
    .insert(productVariants)
    .values({
      productId: product!.id,
      combinationKey: `default-${sequence}`,
      sku: `ent-${sequence}`,
      isDefault: true,
    })
    .returning();
  const [list] = await db()
    .insert(priceLists)
    .values({ name: `List ${sequence}`, currency: "CAD", active: true })
    .returning();
  await db().insert(priceListEntries).values({
    priceListId: list!.id,
    variantId: variant!.id,
    amountMinor,
  });
  return { product: product!, variant: variant! };
}

describe("resource matching", () => {
  it("lets a site-wide grant cover any asked resource", () => {
    expect(resourceMatches({ kind: "site" }, { kind: "catalog", selector: "abc" })).toBe(true);
    expect(resourceMatches({ kind: "catalog" }, { kind: "catalog", selector: "abc" })).toBe(true);
    expect(resourceMatches({ kind: "catalog", selector: "abc" }, { kind: "catalog", selector: "abc" })).toBe(
      true,
    );
    expect(resourceMatches({ kind: "catalog", selector: "abc" }, { kind: "catalog", selector: "xyz" })).toBe(
      false,
    );
    expect(resourceMatches({ kind: "gallery" }, { kind: "catalog" })).toBe(false);
  });
});

describe.runIf(hasDatabase)("entitlements", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("turns a subscription into site access for the period, and takes it away on pause", async () => {
    const member = await person("member");
    const { product } = await priced("Club", 2_500);
    const plan = await savePlan.call(
      { productId: product.id, name: "Monthly club", interval: "month", status: "active" },
      OWNER,
    );
    await subscribe.call({ contactId: member.id, planId: plan.id }, OWNER);

    const allowed = await hasAccess.call(
      { resource: { kind: "catalog", selector: "anything" }, contactId: member.id },
      OWNER,
    );
    expect(allowed.allowed).toBe(true);

    const started = (await listGrants.call({ contactId: member.id }, OWNER))[0];
    await pauseSubscription.call({ id: started!.sourceSubscriptionId! }, OWNER);
    expect(
      (await hasAccess.call({ resource: { kind: "site" }, contactId: member.id }, OWNER)).allowed,
    ).toBe(false);
  });

  it("ends access immediately when the plan says cancel now", async () => {
    const member = await person("cut");
    const { product } = await priced("Cut", 1_000);
    const plan = await savePlan.call(
      {
        productId: product.id,
        name: "Immediate",
        interval: "month",
        status: "active",
        cancelBehaviour: "immediate",
      },
      OWNER,
    );
    const started = await subscribe.call({ contactId: member.id, planId: plan.id }, OWNER);
    await cancelSubscription.call({ id: started.subscription.id }, OWNER);
    expect(
      (await hasAccess.call({ resource: { kind: "site" }, contactId: member.id }, OWNER)).allowed,
    ).toBe(false);
  });

  it("hides a member-only product from strangers and shows it to a member", async () => {
    const member = await person("vip");
    const { product: planProduct } = await priced("VIP plan", 5_000);
    const plan = await savePlan.call(
      { productId: planProduct.id, name: "VIP", interval: "month", status: "active" },
      OWNER,
    );
    await subscribe.call({ contactId: member.id, planId: plan.id }, OWNER);

    sequence += 1;
    const [gated] = await db()
      .insert(products)
      .values({
        name: "Members print",
        slug: `gated-${sequence}`,
        kind: "physical",
        status: "active",
        visibility: "member_only",
        publishedAt: new Date(),
      })
      .returning();

    expect(await resolveVisibleProduct.call({ slug: gated!.slug }, { kind: "anonymous" })).toBeNull();

    await db().insert(users).values({ id: CUSTOMER.userId, email: "vip@example.test", role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, member.id));
    const seen = await resolveVisibleProduct.call({ slug: gated!.slug }, CUSTOMER);
    expect(seen?.id).toBe(gated!.id);
  });

  it("issues a pass once per order and spends punches", async () => {
    const member = await person("punches");
    const { product } = await priced("Ten class", 8_000, "pass");
    const issued = await issuePass.call(
      {
        contactId: member.id,
        productId: product.id,
        productName: product.name,
        quantity: 2,
        sourceOrderId: "00000000-0000-4000-8000-000000000099",
      },
      { kind: "system" },
    );
    const again = await issuePass.call(
      {
        contactId: member.id,
        productId: product.id,
        productName: product.name,
        quantity: 2,
        sourceOrderId: "00000000-0000-4000-8000-000000000099",
      },
      { kind: "system" },
    );
    expect(again.passBalanceId).toBe(issued.passBalanceId);

    const first = await spendPass.call(
      { passBalanceId: issued.passBalanceId, contactId: member.id },
      OWNER,
    );
    expect(first.remaining).toBe(1);
    const last = await spendPass.call(
      { passBalanceId: issued.passBalanceId, contactId: member.id },
      OWNER,
    );
    expect(last.remaining).toBe(0);
    const error = await failure(
      spendPass.call({ passBalanceId: issued.passBalanceId, contactId: member.id }, OWNER),
    );
    expect(error.code).toBe("conflict");
  });

  it("unlocks from a paid invoice and keeps a second settlement quiet", async () => {
    const member = await person("unlock");
    const first = await issueUnlock.call(
      {
        contactId: member.id,
        invoiceId: "00000000-0000-4000-8000-000000000088",
        name: "Gallery unlock",
        resource: { kind: "gallery", selector: "wedding" },
      },
      { kind: "system" },
    );
    const second = await issueUnlock.call(
      {
        contactId: member.id,
        invoiceId: "00000000-0000-4000-8000-000000000088",
        name: "Gallery unlock",
        resource: { kind: "gallery", selector: "wedding" },
      },
      { kind: "system" },
    );
    expect(second.unlockId).toBe(first.unlockId);
    expect(
      (
        await hasAccess.call(
          { resource: { kind: "gallery", selector: "wedding" }, contactId: member.id },
          OWNER,
        )
      ).allowed,
    ).toBe(true);
    expect(
      (
        await hasAccess.call(
          { resource: { kind: "gallery", selector: "other" }, contactId: member.id },
          OWNER,
        )
      ).allowed,
    ).toBe(false);
  });

  it("lets an owner grant and revoke by hand", async () => {
    const member = await person("manual");
    const entitlement = await saveEntitlement.call(
      {
        grantorType: "manual",
        grantorId: member.id,
        name: "Studio after hours",
        resource: { kind: "page", selector: "after-hours" },
      },
      OWNER,
    );
    await grantAccess.call({ contactId: member.id, entitlementId: entitlement.id }, OWNER);
    expect(
      (
        await hasAccess.call(
          { resource: { kind: "page", selector: "after-hours" }, contactId: member.id },
          OWNER,
        )
      ).allowed,
    ).toBe(true);
    const [grant] = await listGrants.call({ contactId: member.id }, OWNER);
    await revokeGrant.call({ id: grant!.id }, OWNER);
    expect(
      (
        await hasAccess.call(
          { resource: { kind: "page", selector: "after-hours" }, contactId: member.id },
          OWNER,
        )
      ).allowed,
    ).toBe(false);
    expect(await db().select().from(entitlementGrants)).toHaveLength(1);
  });

  it("refuses a customer asking about somebody else's access", async () => {
    const member = await person("rae");
    await db().insert(users).values({ id: CUSTOMER.userId, email: "rae@example.test", role: "customer" });
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, member.id));
    const other = await person("sam");
    const error = await failure(
      hasAccess.call({ resource: { kind: "site" }, contactId: other.id }, CUSTOMER),
    );
    expect(error.code).toBe("permission");
  });
});
