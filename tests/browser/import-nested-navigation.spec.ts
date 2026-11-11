// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22/C2.11: real owner level editing, public nested lists and keyboard links.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { importRuns } from "@/core/plugins/schema";
import { auditLog } from "@/core/events/schema";
import { sections, pages } from "@/modules/cms/schema";
import { businessProfile } from "@/core/settings/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { translator } from "@/core/i18n";
import { C11_BASE_URL, C11_OWNER, seedC11Owner, useOwnerSession } from "./owner-session";

test.describe("nested imported navigation (C3.22)", () => {
  test.setTimeout(180_000);
  test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) {
    test(`${locale}: owner edits level, public parents, keyboard, 320px and both themes`, async ({ browser }) => {
      const token = await seedC11Owner("Nested navigation qualification");
      await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
      const links = [{ id: "source-about", label: "About", href: "/nested-about" }, { id: "source-team", label: "Team", href: "/nested-about/team", depth: 1 }, { id: "source-member", label: "Member", href: "/nested-about/team/member", depth: 2 }];
      const [section] = await db().insert(sections).values({ key: "nav", locale, name: "Nested site menu", kind: "chrome", blocks: [{ id: "nested-menu", type: "nav", props: { links } }] }).returning();
      for (const link of links) await db().insert(pages).values({ title: link.label, slug: link.href.slice(1), locale, status: "published", publishedAt: new Date(), blocks: [{ id: `heading-${link.id}`, type: "heading", props: { text: link.label, level: 1 } }] });
      const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
      await useOwnerSession(context, token);
      const page = await context.newPage();
      const t = translator(locale);
      await page.goto(`/admin/sections/nav?locale=${locale}`);
      const levels = page.getByLabel(t("cms.field.depth"), { exact: true });
      await expect(levels).toHaveCount(3);
      await expect(levels.nth(2)).toHaveValue("2");
      await levels.nth(2).focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect.poll(async () => {
        const [saved] = await db().select().from(sections).where(eq(sections.id, section!.id));
        return ((saved!.blocks as Array<{ props: { links: Array<{ depth?: number }> } }>)[0]!.props.links[2]?.depth);
      }).toBe(1);
      const [entry] = await db().select().from(auditLog).where(eq(auditLog.action, "cms.updateSection"));
      expect(entry).toMatchObject({ actor: `user:${C11_OWNER.userId}` });
      await page.goto("/nested-about");
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        const navigation = page.getByRole("navigation", { name: t("cms.nav.primary"), exact: true });
        const summary = navigation.locator("details > summary");
        await summary.focus(); await page.keyboard.press("Enter");
        await expect(navigation.getByRole("link", { name: "Member", exact: true })).toBeVisible();
        expect(await navigation.locator('li > a[href$="/nested-about"] + ul > li > a').allTextContents()).toEqual(["Team", "Member", "Team", "Member"]);
        expect(await navigation.locator("a").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width > 0).every(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth; }))).toBe(true);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-nested-nav.png`), fullPage: true });
      }
      await page.getByRole("link", { name: "Member", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/nested-about\/team\/member$/);
      await expect(page.getByRole("heading", { name: "Member", level: 1 })).toBeVisible();
      const [run] = await db().insert(importRuns).values({ source: "wordpress-wxr:https://source.example", origin: "https://source.example", kind: "wordpress-wxr", status: "published", createdBy: `user:${C11_OWNER.userId}`, counts: { menuWarnings: 1 }, checkpoint: { report: { menuIssues: [{ menu: "Source menu", label: "Private future label", reason: "private" }] } } }).returning();
      await page.goto(`/admin/imports/${run!.id}`);
      await expect(page.getByText("Private future label", { exact: true })).toBeVisible();
      await expect(page.getByText(t("imports.menuWarning.private"), { exact: true })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`${locale}-owner-warning.png`), fullPage: true });
      await context.close();
    });
  }
});
