// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C3.13: pending provider work cannot appear as completed erasure.
import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { roles, roleGrants, users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { contacts } from "@/core/contacts/schema";
import { dataRequests, dataRequestArtifacts } from "@/core/privacy/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { db, closeDb } from "@/core/db";
import { resetBrowserDatabase } from "./database";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

test("pending erasure explains recovery and respects staff job access", async ({ page, context }) => {
  const token = await seedC11Owner("Privacy studio");
  try {
    const [contact] = await db().insert(contacts).values({ name: "Erased contact" }).returning();
    const [request] = await db().insert(dataRequests).values({ contactId: contact!.id, kind: "erasure", status: "in_progress",
      requestedBy: "owner", verifiedAt: new Date(), responseDueAt: new Date(Date.now() + 86_400_000) }).returning();
    const body = { format: "freeholder.erasure-receipt", outcomes: [{ scope: "plugins.voice-video.rooms", outcome: "pending" }] };
    await db().insert(dataRequestArtifacts).values({ dataRequestId: request!.id, filename: "erasure.json", body,
      sha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) });
    await useOwnerSession(context, token);
    await page.goto(`/admin/contacts/privacy/${request!.id}`);
    await expect(page.getByRole("heading", { name: "Provider erasure pending" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inspect background jobs" })).toHaveAttribute("href", "/admin/jobs");
    await expect(page.locator('input[name="confirmation"]')).toHaveCount(0);
    await expect(page.locator('textarea[name="resolution"]')).toHaveCount(0);
    await expect(page.locator('select[name="scope"]')).toHaveCount(0);
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
      await page.reload();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    }
    await db().insert(roles).values({ key: "privacy-reader", name: "Privacy reader" });
    await db().insert(roleGrants).values(["admin", "contacts"].map(module => ({ roleKey: "privacy-reader", module, access: "view" as const })));
    const [reader] = await db().insert(users).values({ email: "privacy-reader@example.test", role: "privacy-reader" }).returning();
    await db().insert(totpFactors).values({ userId: reader!.id, encryptedSecret: "privacy-browser-fixture" });
    const session = await db().transaction(tx => createSession(tx, reader!.id, { twoFactorVerified: true }));
    await useOwnerSession(context, session.token);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Provider erasure pending" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inspect background jobs" })).toHaveCount(0);
  } finally {
    await resetBrowserDatabase();
    await closeDb();
  }
});
