// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: actual owner ZIP transport, root conflict, drafts and public rollback.
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { importRuns } from "@/core/plugins/schema";
import { businessProfile } from "@/core/settings/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { translator } from "@/core/i18n";
import { cleanupOrphanedMedia } from "@/core/media/service";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

test.describe("static archive owner journey (C3.22)", () => {
  test.setTimeout(180_000);
  test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) {
    test(`${locale}: upload ZIP, resolve home, publish local media and reverse`, async ({ browser }) => {
      const session = await seedC11Owner("Static archive qualification");
      await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
      const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
      await useOwnerSession(context, session);
      const page = await context.newPage(), t = translator(locale);
      await page.goto("/admin/imports");
      await page.locator("#origin").fill("https://archive.example/legacy/");
      await page.locator("#kind").selectOption("archive");
      await page.locator("#origin").focus(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/admin\/imports\/[a-f0-9-]+$/);
      const id = new URL(page.url()).pathname.split("/").at(-1)!;
      await expect(page.locator("#import-source-url")).toHaveCount(0);
      await expect(page.locator("#source-file")).toHaveAttribute("accept", /\.zip/);
      await page.locator("#source-file").setInputFiles(resolve("tests/fixtures/static-archive/site.zip"));
      await page.getByRole("button", { name: t("imports.stage"), exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: t("imports.commit"), exact: true })).toBeVisible();
      await expect(page.getByText("site/css/site.css", { exact: true })).toBeVisible();
      await expect(page.getByText(t("imports.note.archive"), { exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.locator("#source-file").evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-archive-owner.png`), fullPage: true });
      }
      // The empty CMS slug names the home page; HTML required validation must
      // not make the service's legitimate root-conflict decision unreachable.
      await expect(page.locator("#conflict-slug")).not.toHaveAttribute("required");
      await page.locator("#conflict-slug").fill("");
      await page.locator("#conflict-resolution").selectOption("replace");
      await page.getByRole("button", { name: t("imports.review"), exact: true }).focus(); await page.keyboard.press("Enter");
      await expect.poll(async () => (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.conflicts).toEqual([{ slug: "", resolution: "replace" }]);
      await page.getByRole("button", { name: t("imports.commit"), exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: t("imports.reconcile"), exact: true })).toBeVisible();
      await page.getByRole("button", { name: t("imports.reconcile"), exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: t("imports.publish"), exact: true })).toBeVisible();
      await page.getByRole("button", { name: t("imports.publish"), exact: true }).focus(); await page.keyboard.press("Enter");
      await expect.poll(async () => (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.status).toBe("published");
      const redirected = await page.request.get("/legacy/about/team.html", { maxRedirects: 0 });
      expect(redirected.status()).toBe(301);
      expect(redirected.headers().location).toMatch(/\/about\/team$/);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Northstar", level: 1 })).toBeVisible();
      await page.getByRole("link", { name: "Our team", exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/about\/team#people$/);
      await expect(page.getByRole("heading", { name: "Our people", level: 1 })).toBeVisible();
      const image = page.getByRole("img", { name: "Synthetic blue square", exact: true });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-archive-public.png`), fullPage: true });
      }
      await page.goto(`/admin/imports/${id}`);
      await page.getByRole("button", { name: t("imports.rollback"), exact: true }).focus(); await page.keyboard.press("Enter");
      await expect.poll(async () => (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.status).toBe("rolled_back");
      expect((await page.request.get("/about/team")).status()).toBe(404);
      await cleanupOrphanedMedia(new Date(Date.now() + 25 * 60 * 60 * 1000));
      await context.close();
    });
  }
});
