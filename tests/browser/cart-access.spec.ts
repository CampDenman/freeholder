// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.20/C11.10: the HTTP boundary and read-only cart screen share authorization.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { roles, roleGrants, users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { db, closeDb } from "@/core/db";
import { carts } from "@/modules/catalog/schema";
import { seedC11Owner, useOwnerSession } from "./owner-session";
import { resetBrowserDatabase } from "./database";

test("cart IDs grant no anonymous access and read-only screens disclose no write token", async ({ page, context }) => {
  await seedC11Owner("Cart access studio");
  try {
    const token = randomUUID();
    const [cart] = await db().insert(carts).values({ token, currency: "CAD" }).returning();
    const denied = await context.request.get(`/api/v1/catalog.getCart?cartId=${cart!.id}`);
    expect(denied.status()).toBe(401);
    expect(await denied.text()).not.toContain(token);
    const guest = await context.request.get(`/api/v1/catalog.getCart?token=${token}`);
    expect(guest.ok()).toBe(true);
    expect(await guest.json()).toMatchObject({ cart: { id: cart!.id, token } });

    await db().insert(roles).values({ key: "cart-reader", name: "Cart reader" });
    await db().insert(roleGrants).values(["admin", "catalog"].map(module => ({ roleKey: "cart-reader", module, access: "view" as const })));
    const [reader] = await db().insert(users).values({ email: "cart-reader@example.test", role: "cart-reader" }).returning();
    await db().insert(totpFactors).values({ userId: reader!.id, encryptedSecret: "cart-browser-fixture" });
    const session = await db().transaction(tx => createSession(tx, reader!.id, { twoFactorVerified: true }));
    await useOwnerSession(context, session.token);
    const readable = await context.request.get(`/api/v1/catalog.getCart?cartId=${cart!.id}`);
    expect(readable.ok()).toBe(true);
    expect(await readable.json()).toMatchObject({ cart: { id: cart!.id, token: null } });
    await page.goto("/admin/carts");
    await page.getByRole("link", { name: cart!.id.slice(0, 8), exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(cart!.id.slice(0, 8));
    expect(await page.content()).not.toContain(token);
  } finally {
    await resetBrowserDatabase();
    await closeDb();
  }
});
