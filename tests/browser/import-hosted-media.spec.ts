// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: real owner consent and review; provider/media execution has native proof.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { importRuns } from "@/core/plugins/schema";
import { assets } from "@/core/media/schema";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { THEME_COOKIE } from "@/core/design/theme";
import { translator } from "@/core/i18n";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

test.describe("hosted source media approval (C3.22)", () => {
  test.setTimeout(120_000);
  test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) test(`${locale}: approve a file origin, review staged media and cancel`, async ({ browser }) => {
    const session = await seedC11Owner("Hosted source qualification");
    await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
    const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
    await useOwnerSession(context, session);
    await context.addCookies([{ name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL }]);
    const page = await context.newPage(), t = translator(locale);
    await page.goto("/admin/imports");
    await page.locator("#kind").selectOption("wordpress-wxr");
    await expect(page.locator("#approvedMediaOrigins")).toHaveCount(0);
    await page.locator("#kind").selectOption("html");
    await page.locator("#origin").fill("https://hosted-source.example/team.html");
    await page.getByLabel(t("imports.mediaOrigins"), { exact: true }).fill("https://images.hosted-cdn.example");
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-hosted-origins.png`), fullPage: true });
    }
    await page.locator("#origin").fill("https://hosted-source.example/team.html");
    await page.locator("#approvedMediaOrigins").fill("https://images.hosted-cdn.example");
    await page.locator("#origin").focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/imports\/[a-f0-9-]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.locator("#source-file").setInputFiles({ name: "fictional-hosted-export.html", mimeType: "text/html", buffer: Buffer.from('<!doctype html><html><title>Hosted source</title><main><h1>Hosted source</h1><img src="https://images.hosted-cdn.example/image?id=one" alt="Fictional source image"></main></html>') });
    await page.getByRole("button", { name: t("imports.stage"), exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: t("imports.commit"), exact: true })).toBeVisible();
    const [run] = await db().select().from(importRuns).where(eq(importRuns.id, id));
    expect(run?.checkpoint).toMatchObject({ approvedMediaOrigins: ["https://images.hosted-cdn.example"] });
    expect(run?.counts).toMatchObject({ media: 1, mediaWarnings: 0 });
    await expect(page.getByText(t("imports.count.mediaFound"), { exact: true })).toBeVisible();
    expect(await db().select().from(assets)).toHaveLength(0);
    await page.getByRole("button", { name: t("imports.rollback"), exact: true }).focus(); await page.keyboard.press("Enter");
    await expect.poll(async () => (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.status).toBe("rolled_back");
    await expect(page.getByText(t("imports.count.mediaFound"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("imports.count.media"), { exact: true })).toHaveCount(0);
    await context.close();
  });
});
