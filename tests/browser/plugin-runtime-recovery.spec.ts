// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.40: a corrupt plugin widget cannot take down its page, and recovery
// requires a reviewed owner action after the underlying content is repaired.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { pages } from "@/modules/cms/schema";
import { businessProfile } from "@/core/settings/schema";
import { pluginPermissionConsents } from "@/core/plugins/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";
import { resetBrowserDatabase } from "./database";

test("a failing plugin stays inside its widget and resumes only after owner review", async ({ page, context }) => {
  await useOwnerSession(context, await seedC11Owner("Plugin recovery qualification"));
  const blocks = [
    { id: "healthy-heading", type: "heading", props: { text: "The rest of the site still works", level: 1 } },
    { id: "proof-fixture", type: "notice", props: { body: { invalid: "PRIVATE_WIDGET_MARKER" }, tone: "info" } },
  ];
  // Deliberate fixture corruption bypasses the editor's schema validation;
  // production has no special failing renderer or public disable endpoint.
  await db().insert(pages).values({ slug: "plugin-recovery", title: "Plugin recovery", status: "published", publishedAt: new Date(), blocks });
  const response = await page.goto("/plugin-recovery");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "The rest of the site still works", exact: true })).toBeVisible();
  await expect(page.locator("[data-plugin-unavailable]")).toContainText("This content is temporarily unavailable.");
  expect(await page.content()).not.toContain("PRIVATE_WIDGET_MARKER");
  const [disabled] = await db().select().from(pluginPermissionConsents).where(eq(pluginPermissionConsents.name, "proof"));
  expect(disabled!.runtimeDisabledAt).not.toBeNull(); expect(disabled!.disabledReason).not.toContain("PRIVATE_WIDGET_MARKER");

  await db().update(pages).set({ blocks: [blocks[0]!, { id: "proof-fixture", type: "notice", props: { body: "Recovered notice", tone: "info" } }] }).where(eq(pages.slug, "plugin-recovery"));
  await page.reload();
  await expect(page.locator("[data-plugin-unavailable]")).toBeVisible();
  await page.goto("/admin/plugins");
  const proof = page.locator('li[data-plugin-permissions="proof"]');
  await expect(proof.getByText("Disabled", { exact: true })).toBeVisible();
  await proof.getByLabel("I approve exactly the permissions listed above.", { exact: true }).check();
  await proof.getByRole("button", { name: "Approve permissions", exact: true }).click();
  await expect(proof.getByText("Disabled", { exact: true })).toHaveCount(0);
  await page.goto("/plugin-recovery");
  await expect(page.getByText("Recovered notice", { exact: true })).toBeVisible();
  await expect(page.locator("[data-plugin-unavailable]")).toHaveCount(0);

  // The actual owner review remains usable in RTL and in both cookie themes.
  await db().update(businessProfile).set({ defaultLocale: "ar", enabledLocales: ["en", "ar"] });
  for (const theme of ["light", "dark"]) {
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
    await page.goto("/admin/plugins");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { name: "أذونات الإضافات", exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  const reflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(reflow.scroll).toBeLessThanOrEqual(reflow.width + 1);
});

test.afterAll(async () => { await resetBrowserDatabase(); await closeDb(); });
