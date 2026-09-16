// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: search actual records and open their exact destinations.
import { createHash, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { roles, roleGrants, users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { contacts } from "@/core/contacts/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { db, closeDb } from "@/core/db";
import { products, productVariants, orders, orderItems, suppliers } from "@/modules/catalog/schema";
import { contractDocuments } from "@/modules/contracts/schema";
import { plans, subscriptions } from "@/modules/subscriptions/schema";
import { giftRegistries } from "../../plugins/gift-registry/schema";
import { resetBrowserDatabase } from "./database";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

test("global search opens order, membership and gift records", async ({ page, context }) => {
  const token = await seedC11Owner("Search Studio");
  try {
    const [contact] = await db().insert(contacts).values({ name: "Search customer", email: "search-browser@example.test" }).returning();
    const [product] = await db().insert(products).values({ name: "Search fixture", slug: "search-browser", kind: "service" }).returning();
    const [variant] = await db().insert(productVariants).values({ productId: product!.id, combinationKey: "default", sku: "search-browser", isDefault: true }).returning();
    const [order] = await db().insert(orders).values({ contactId: contact!.id, currency: "CAD" }).returning();
    await db().insert(orderItems).values({ orderId: order!.id, variantId: variant!.id, quantity: 1, unitAmountMinor: 100, lineTotalMinor: 100, snapshot: { productName: "Browserfind print" } });
    const [plan] = await db().insert(plans).values({ productId: product!.id, name: "Browserfind membership", interval: "month" }).returning();
    const [subscription] = await db().insert(subscriptions).values({ contactId: contact!.id, planId: plan!.id, productVariantId: variant!.id,
      currency: "CAD", billingMode: "manual", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) }).returning();
    const [gift] = await db().insert(giftRegistries).values({ contactId: contact!.id, title: "Browserfind gifts", slug: "browserfind-gifts" }).returning();
    await useOwnerSession(context, token);
    await page.goto("/admin/search?q=Browserfind");
    await expect(page.locator(`a[href="/admin/orders/${order!.id}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/admin/gifts?registry=${gift!.id}"]`)).toBeVisible();
    await page.locator(`a[href="/admin/orders/${order!.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${order!.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(order!.id.slice(0, 8));
    await page.goto("/admin/search?q=Browserfind");
    await page.getByRole("link", { name: "Browserfind membership" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/subscriptions/${subscription!.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Browserfind membership" })).toBeVisible();
    await expect(page.getByText("Search customer", { exact: true })).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
      await page.reload();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    }
    await page.goto("/admin/search?q=Browserfind");
    await page.locator(`a[href="/admin/gifts?registry=${gift!.id}"]`).click();
    await expect(page.getByRole("heading", { name: "Browserfind gifts" })).toBeVisible();
    await db().insert(roles).values({ key: "search-reader", name: "Search reader" });
    await db().insert(roleGrants).values(["admin", "search", "subscriptions"].map(module => ({ roleKey: "search-reader", module, access: "view" as const })));
    const [reader] = await db().insert(users).values({ email: "search-reader@example.test", role: "search-reader" }).returning();
    await db().insert(totpFactors).values({ userId: reader!.id, encryptedSecret: "search-browser-fixture" });
    const readerSession = await db().transaction(tx => createSession(tx, reader!.id, { twoFactorVerified: true }));
    await useOwnerSession(context, readerSession.token);
    await page.goto("/admin/search?q=Browserfind");
    await expect(page.locator(`a[href="/admin/orders/${order!.id}"]`)).toHaveCount(0);
    await page.getByRole("link", { name: "Browserfind membership" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Browserfind membership" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Manage memberships" })).toHaveCount(0);
    await expect(page.getByText("Search customer", { exact: true })).toHaveCount(0);
    await expect(page.getByText(contact!.id, { exact: true })).toBeVisible();
  } finally {
    await resetBrowserDatabase();
    await closeDb();
  }
});

test("supplier and agreement search opens readable records without exposing signing credentials", async ({ page, context }) => {
  await seedC11Owner("Supplier Search Studio");
  try {
    const [contact] = await db().insert(contacts).values({ name: "Private signer", email: "supplier-search@example.test" }).returning();
    const [supplier] = await db().insert(suppliers).values({ name: "Supplierfind studio", currency: "CAD", contactId: contact!.id }).returning();
    const signingToken = randomUUID();
    const body = "Browser agreement terms.";
    const [agreement] = await db().insert(contractDocuments).values({
      contactId: contact!.id, subjectType: "contact", title: "Supplierfind agreement",
      bodySnapshot: body, bodyHash: createHash("sha256").update(body).digest("hex"), signToken: signingToken,
    }).returning();
    await db().insert(roles).values({ key: "supplier-search-reader", name: "Supplier and agreement reader" });
    await db().insert(roleGrants).values(["admin", "search", "catalog", "contracts"].map(module => ({ roleKey: "supplier-search-reader", module, access: "view" as const })));
    const [reader] = await db().insert(users).values({ email: "supplier-reader@example.test", role: "supplier-search-reader" }).returning();
    await db().insert(totpFactors).values({ userId: reader!.id, encryptedSecret: "supplier-browser-fixture" });
    const session = await db().transaction(tx => createSession(tx, reader!.id, { twoFactorVerified: true }));
    await useOwnerSession(context, session.token);
    await page.goto("/admin/search?q=Supplierfind");
    expect(await page.content()).not.toContain(signingToken);
    expect(await page.content()).not.toContain(body);
    await page.getByRole("link", { name: "Supplierfind studio" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/procurement#supplier-${supplier!.id}$`));
    await expect(page.locator(`#supplier-${supplier!.id}`)).toContainText("Supplierfind studio");
    await page.goto("/admin/search?q=Supplierfind");
    await page.getByRole("link", { name: "Supplierfind agreement" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/agreements/${agreement!.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Supplierfind agreement");
    expect(await page.content()).not.toContain(signingToken);
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
      await page.reload();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    }
  } finally {
    await resetBrowserDatabase();
    await closeDb();
  }
});
