// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: real owner creation/navigation, source validation, keyboard and themes.
// Network source crawling itself is qualified separately with recorded HTTP.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { importRuns } from "@/core/plugins/schema";
import { businessProfile } from "@/core/settings/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

test.describe("public source import owner form (C3.22)", () => {
  test.setTimeout(180_000);
  test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) {
    test(`${locale}: start navigation, safe source refusal, keyboard, 320px and both themes`, async ({ browser }) => {
      const token = await seedC11Owner("Source import qualification");
      await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
      const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
      await useOwnerSession(context, token);
      await context.addCookies([{ name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL }]);
      const page = await context.newPage();
      await page.goto("/admin/imports");
      await page.locator("#origin").fill("https://source.example");
      await page.locator("#kind").selectOption("wordpress-rest");
      await page.locator("#origin").focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/admin\/imports\/[a-f0-9-]+$/);
      const id = new URL(page.url()).pathname.split("/").at(-1)!;
      const input = page.locator("#import-source-url");
      await expect(input).toHaveValue("https://source.example");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await page.locator("#import-source-url, #source-file").evaluateAll(elements => elements.every(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth; }))).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-source.png`), fullPage: true });
      }
      const form = page.locator("form").filter({ has: input });
      await input.fill("http://127.0.0.1/private");
      await input.focus();
      await page.keyboard.press("Tab");
      await expect(form.getByRole("button")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(form.getByRole("alert")).toBeVisible();
      await expect(form.getByRole("alert")).toContainText("public HTTP or HTTPS source URL");
      const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, id));
      expect(saved).toMatchObject({ status: "discover", preview: {}, counts: {} });
      await context.close();
    });
  }
});
