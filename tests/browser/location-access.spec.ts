// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.10 / §4.10: hidden addresses stay private across HTTP and staff selectors.
import { expect, test } from "@playwright/test";
import { roles, roleGrants, users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { db, closeDb } from "@/core/db";
import { businessLocations } from "@/core/locations/schema";
import { seedC11Owner, useOwnerSession } from "./owner-session";
import { resetBrowserDatabase } from "./database";

test("hidden locations require location access while POS and social remain usable", async ({ page, context }) => {
  await seedC11Owner("Location access studio");
  try {
    const [hidden] = await db().insert(businessLocations).values({
      name: "Private studio", slug: "private-studio", country: "CA",
      street: "Hidden address fixture", status: "hidden",
    }).returning();
    for (const selector of [`id=${hidden!.id}`, "slug=private-studio"]) {
      const response = await context.request.get(`/api/v1/locations.get?${selector}`);
      expect(response.ok()).toBe(true);
      expect(await response.json()).toEqual({ ok: true });
    }
    const denied = await context.request.get("/api/v1/locations.list?includeHidden=true");
    expect(denied.status()).toBe(401);
    expect(await denied.text()).not.toContain(hidden!.street!);

    await db().insert(roles).values({ key: "location-unrelated", name: "POS and social staff" });
    await db().insert(roleGrants).values(["admin", "invoicing", "social"].map(module => ({ roleKey: "location-unrelated", module, access: "view" as const })));
    const [reader] = await db().insert(users).values({ email: "location-unrelated@example.test", role: "location-unrelated" }).returning();
    await db().insert(totpFactors).values({ userId: reader!.id, encryptedSecret: "location-browser-fixture" });
    const session = await db().transaction(tx => createSession(tx, reader!.id, { twoFactorVerified: true }));
    await useOwnerSession(context, session.token);
    for (const path of ["/admin/pos", "/admin/social"]) {
      const response = await page.goto(path);
      expect(response?.ok()).toBe(true);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.content()).not.toContain(hidden!.street!);
    }
  } finally {
    await resetBrowserDatabase();
    await closeDb();
  }
});
