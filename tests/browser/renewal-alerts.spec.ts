// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.40: an actual owner opt-in and a member's renewal register.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { closeDb, db } from "@/core/db";
import { THEME_COOKIE } from "@/core/design/theme";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

async function signInCustomer(context: BrowserContext, email: string) {
  const [user] = await db().insert(users).values({ email, role: "customer" }).returning();
  await db().insert(contacts).values({ email, name: "Renewal test member", userId: user!.id });
  const session = await db().transaction((tx) => createSession(tx, user!.id));
  await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: C11_BASE_URL }]);
}

async function checkThemes(page: Page) {
  for (const theme of ["light", "dark"]) {
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(report.violations).toEqual([]);
  }
}

test.describe("renewal register", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.setTimeout(180_000);
  test.afterAll(closeDb);

  test("starts off and lets a member add, correct and stop an owned charge after opt-in", async ({ browser, context, page }) => {
    const owner = await seedC11Owner("Renewal test studio");
    await signInCustomer(context, "renewal-member@example.test");
    await page.goto("/portal/renewals");
    await expect(page.getByRole("heading", { name: "Renewals", exact: true })).toHaveCount(0);
    await page.goto("/portal/renewals/new");
    await expect(page.getByLabel("What is it?", { exact: true })).toHaveCount(0);

    const admin = await browser.newContext({ baseURL: C11_BASE_URL });
    try {
      await useOwnerSession(admin, owner);
      const settings = await admin.newPage();
      await settings.goto("/admin/settings");
      const module = settings.getByRole("listitem").filter({ has: settings.getByText("renewal-alerts", { exact: true }) });
      await module.getByRole("button", { name: "On", exact: true }).click();
      await expect(module.getByRole("button", { name: "Off", exact: true })).toBeVisible();
    } finally {
      await admin.close();
    }

    await page.goto("/portal/renewals");
    await expect(page.getByRole("heading", { name: "Renewals", exact: true })).toBeVisible();
    await checkThemes(page);
    await page.getByRole("link", { name: "Track a subscription", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Track a subscription", exact: true })).toBeVisible();
    await checkThemes(page);
    await page.getByLabel("What is it?", { exact: true }).fill("Fixture cloud storage");
    await page.getByLabel("Amount charged", { exact: true }).fill("12.30");
    await page.getByLabel("First charge", { exact: true }).fill("2031-08-03");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/portal\/renewals\?saved=1$/);
    await page.getByRole("link", { name: "Fixture cloud storage", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Fixture cloud storage", exact: true })).toBeVisible();
    const recordPath = new URL(page.url()).pathname;
    const otherMember = await browser.newContext({ baseURL: C11_BASE_URL });
    try {
      await signInCustomer(otherMember, "renewal-other@example.test");
      const unrelatedPage = await otherMember.newPage();
      await unrelatedPage.goto(recordPath);
      await expect(unrelatedPage.getByRole("heading", { name: "Fixture cloud storage", exact: true })).toHaveCount(0);
      await expect(unrelatedPage.getByRole("link", { name: "Edit this charge", exact: true })).toHaveCount(0);
    } finally {
      await otherMember.close();
    }
    await page.getByRole("link", { name: "Edit this charge", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit a tracked subscription", exact: true })).toBeVisible();
    await checkThemes(page);
    await expect(page.getByLabel("Amount charged", { exact: true })).toHaveValue("12.30");
    await page.getByLabel("Amount charged", { exact: true }).fill("15.00");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("link", { name: "Fixture cloud storage", exact: true }).click();
    await page.getByRole("checkbox", { name: "Stop warning me about this charge.", exact: true }).check();
    await page.getByRole("button", { name: "Stop renewal warnings", exact: true }).click();
    await expect(page).toHaveURL(/\/portal\/renewals$/);
    await expect(page.getByRole("link", { name: "Fixture cloud storage", exact: true })).toHaveCount(0);
  });
});
