// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: actual HTML upload, source review and public fragment navigation.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { importRuns } from "@/core/plugins/schema";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { THEME_COOKIE } from "@/core/design/theme";
import { translator } from "@/core/i18n";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

const BODY = `<!doctype html><html><head><title>Fictional source team</title><meta name="description" content="Actual source description"><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="/legacy/team.html"></head><body><main id="source-root"><h1>Fictional source team</h1><p><a href="#people">Meet the team</a></p>${Array.from({ length: 32 }, (_, index) => `<p>Fictional source paragraph ${index + 1}. This source content stays readable and editable after migration. The source has enough ordinary text to exercise real fragment scrolling.</p>`).join("")}<h2 id="people">Our people</h2><p>Our fictional team.</p><img src="https://outside.example/portrait.png" alt="Source image requiring review"></main></body></html>`;

test.describe("generic source owner and public journey (C3.22)", () => {
  test.setTimeout(180_000);
  test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) test(`${locale}: review source warnings, publish editable HTML and follow its real fragment`, async ({ browser }) => {
    const session = await seedC11Owner("Generic import qualification");
    await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
    const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
    await useOwnerSession(context, session);
    await context.addCookies([{ name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL }]);
    const page = await context.newPage(), t = translator(locale);
    await page.goto("/admin/imports");
    await page.locator("#origin").fill("https://generic-source-qualification.example/legacy/team.html?edition=one");
    await page.locator("#kind").selectOption("html");
    await page.locator("#origin").focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/imports\/[a-f0-9-]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.locator("#source-file").setInputFiles({ name: "fictional-generic-site.html", mimeType: "text/html", buffer: Buffer.from(BODY) });
    await page.getByRole("button", { name: t("imports.stage"), exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: t("imports.commit"), exact: true })).toBeVisible();
    await expect(page.getByText(t("imports.note.generic"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("imports.count.pagesStaged"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("imports.count.mediaFound"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("imports.count.redirectsProposed"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("imports.count.pages"), { exact: true })).toHaveCount(0);
    await expect(page.getByText(t("imports.sourceWarning.query-address"), { exact: true })).toBeVisible();
    await expect(page.getByText("https://outside.example/portrait.png", { exact: true })).toBeVisible();
    if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator("#source-file").evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-generic-owner.png`), fullPage: true });
    }
    await page.getByRole("button", { name: t("imports.commit"), exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: t("imports.reconcile"), exact: true })).toBeVisible();
    await expect(page.getByText(t("imports.count.pages"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("imports.count.media"), { exact: true })).toBeVisible();
    await page.getByRole("button", { name: t("imports.reconcile"), exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: t("imports.publish"), exact: true })).toBeVisible();
    await page.getByRole("button", { name: t("imports.publish"), exact: true }).focus(); await page.keyboard.press("Enter");
    await expect.poll(async () => (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.status).toBe("published");
    expect((await page.request.get("/legacy/team.html", { maxRedirects: 0 })).status()).toBe(301);
    await page.goto("/legacy/team");
    await expect(page.getByRole("heading", { name: "Fictional source team", level: 1 })).toBeVisible();
    await expect(page.locator("#source-root")).toHaveCount(1);
    await page.getByRole("link", { name: "Meet the team", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/legacy\/team\?edition=one#people$/);
    await expect(page.locator("#people")).toHaveCount(1);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(200);
    expect(await page.locator("#people").evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.top < innerHeight; })).toBe(true);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-generic-public.png`), fullPage: true });
    }
    await page.goto(`/admin/imports/${id}`);
    await page.getByRole("button", { name: t("imports.rollback"), exact: true }).focus(); await page.keyboard.press("Enter");
    await expect.poll(async () => (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.status).toBe("rolled_back");
    expect((await page.request.get("/legacy/team")).status()).toBe(404);
    await context.close();
  });
});
