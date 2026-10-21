// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: workflow search destinations work for readers in both themes.
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { roles, roleGrants, users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { contacts } from "@/core/contacts/schema";
import { dataRequests } from "@/core/privacy/schema";
import { priceLists } from "@/modules/catalog/schema";
import { marketplaceChannels, marketplaceOrders } from "../../plugins/marketplace/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { db, closeDb } from "@/core/db";
import { resetBrowserDatabase } from "./database";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

test("readers open price lists, marketplace orders and privacy requests from search", async ({ page, context }) => {
  await seedC11Owner("Workflow search studio");
  try {
    const [contact] = await db().insert(contacts).values({ name: "Workflow customer" }).returning();
    const [price] = await db().insert(priceLists).values({ name: "Browserworkflow prices", currency: "CAD", kind: "contract", contactId: contact!.id }).returning();
    const [channel] = await db().insert(marketplaceChannels).values({ name: "Workflow channel", provider: "shopify", status: "connected" }).returning();
    const [order] = await db().insert(marketplaceOrders).values({ channelId: channel!.id, contactId: contact!.id, invoiceId: randomUUID(), externalRef: "Browserworkflow order", description: "Imported print", amountMinor: 100, currency: "CAD" }).returning();
    const [request] = await db().insert(dataRequests).values({ contactId: contact!.id, kind: "access", requestedBy: "owner", responseDueAt: new Date(Date.now() + 86_400_000) }).returning();
    await db().insert(roles).values({ key: "workflow-reader", name: "Workflow reader" });
    await db().insert(roleGrants).values(["admin", "search", "catalog", "marketplace", "contacts"].map(module => ({ roleKey: "workflow-reader", module, access: "view" as const })));
    const [reader] = await db().insert(users).values({ email: "workflow-reader@example.test", role: "workflow-reader" }).returning();
    await db().insert(totpFactors).values({ userId: reader!.id, encryptedSecret: "workflow-browser-fixture" });
    const session = await db().transaction(tx => createSession(tx, reader!.id, { twoFactorVerified: true }));
    await useOwnerSession(context, session.token);
    for (const destination of [
      { query: "Browserworkflow", href: `/admin/price-lists#price-list-${price!.id}`, target: `#price-list-${price!.id}` },
      { query: "Browserworkflow", href: `/admin/marketplace#order-${order!.id}`, target: `#order-${order!.id}` },
      { query: request!.id, href: `/admin/contacts/privacy/${request!.id}`, target: "h1" },
    ]) {
      await page.goto(`/admin/search?q=${destination.query}`);
      await page.locator(`a[href="${destination.href}"]`).click();
      await expect(page).toHaveURL(`${C11_BASE_URL}${destination.href}`);
      await expect(page.locator(destination.target)).toBeVisible();
      await expect(page.getByRole('main').locator('button[type="submit"]')).toHaveCount(0);
      await expect(page.locator(`a[href="/admin/invoices/${order!.invoiceId}"]`)).toHaveCount(0);
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
        await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      }
    }
  } finally {
    await resetBrowserDatabase();
    await closeDb();
  }
});
