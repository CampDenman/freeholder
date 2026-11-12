// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: real owner requests pause, restore and finish a 501-entry source.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Route } from "@playwright/test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { importRuns, importSourceGraphs } from "@/core/plugins/schema";
import { businessProfile } from "@/core/settings/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { translator } from "@/core/i18n";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { originalStaticZip } from "../helpers/original-static-zip";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

const ORIGIN = "https://fictionalresumptionsourcewithalonghostname.example";
const source = () => Buffer.from(`<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Fictional saved source</title><link>${ORIGIN}</link>${Array.from({ length: 501 }, (_, index) => `<item><title>Fictional saved page ${index}</title><link>${ORIGIN}/resumed/page-${index}</link><wp:post_id>${index + 1}</wp:post_id><wp:post_type>page</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Fictional saved body ${index}.</p>${index === 0 ? `<p><a href="${ORIGIN}/resumed/page-500">Last saved page</a></p>` : ""}]]></content:encoded></item>`).join("")}</channel></rss>`);

const restSource = (origin = ORIGIN) => Buffer.from(JSON.stringify(Array.from({ length: 501 }, (_, index) => ({
  id: index + 1, type: "page", status: "publish", link: `${origin.replace(/\/$/, "")}/resumed/page-${index}`,
  title: { rendered: `Fictional saved page ${index}` },
  content: { rendered: `<p>Fictional saved body ${index} العربية.</p>${index === 0 ? `<p><a href="${origin.replace(/\/$/, "")}/resumed/page-500">Last saved page</a></p>` : ""}` },
}))));

const archiveSource = () => Buffer.from(originalStaticZip(Array.from({ length: 501 }, (_, index) => ({
  path: `resumed/page-${index}.html`,
  body: `<html><head><title>Fictional saved page ${index}</title></head><body><p>Fictional saved body ${index} العربية.</p>${index === 0 ? `<p><a href="${ORIGIN}/resumed/page-500.html">Last saved page</a></p>` : ""}</body></html>`,
}))));

test.describe("saved source owner journey (C3.47)", () => {
  test.setTimeout(180_000);
  test.afterAll(closeDb);
  for (const kind of ["wordpress-wxr", "wordpress-rest", "archive"] as const) for (const locale of ["en", "es", "fr", "ar"] as const) {
    test(`${kind} ${locale}: pause, return, restore identical bytes, publish and reverse 501 pages`, async ({ browser }) => {
      const session = await seedC11Owner("Saved source qualification");
      const selectedOrigin = kind === "wordpress-rest" && locale === "en" ? `${ORIGIN}/site-a/` : ORIGIN;
      await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
      const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
      await useOwnerSession(context, session);
      await context.addCookies([{ name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL }]);
      const page = await context.newPage(), t = translator(locale), file = kind === "archive" ? { name: "fictional-saved-original.zip", mimeType: "application/zip", buffer: archiveSource() } : kind === "wordpress-rest" ? { name: "fictional-saved-original.json", mimeType: "application/json", buffer: restSource(selectedOrigin) } : { name: "fictional-saved-original.xml", mimeType: "application/xml", buffer: source() };
      const press = async (name: string) => { await page.getByRole("button", { name, exact: true }).focus(); await page.keyboard.press("Enter"); };
      // A 500-page receipt takes longer than a DOM assertion. Await the real
      // bounded RPC outcome before inspecting the next control or resetting
      // this database; never leave an unfinished writer for the next locale.
      const outcome = (operation: string, status: string) => page.waitForResponse(async response => {
        if (!response.url().endsWith(`/api/v1/imports.${operation}`) || response.request().method() !== "POST") return false;
        return !response.ok() || (await response.json() as { status?: string }).status === status;
      }, { timeout: 120_000 });
      const complete = async (label: string, operation: string, status: string) => {
        const waiting = outcome(operation, status);
        await press(label);
        const response = await waiting;
        expect(response.ok(), await response.text()).toBe(true);
        expect(await response.json()).toMatchObject({ status });
      };
      await page.goto("/admin/imports");
      await page.locator("#origin").fill(selectedOrigin);
      await page.locator("#kind").selectOption(kind);
      await page.locator("#origin").focus(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/admin\/imports\/[a-f0-9-]+$/);
      const id = new URL(page.url()).pathname.split("/").at(-1)!;
      if (kind === "wordpress-rest" && locale === "en") expect((await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.origin).toBe(selectedOrigin);
      await page.locator("#source-file").setInputFiles(file);
      await press(t("imports.stage"));
      await expect(page.getByRole("button", { name: t("imports.resume.index"), exact: true })).toBeVisible();
      await complete(t("imports.resume.index"), "previewFromUpload", "previewed");
      await expect(page.getByRole("button", { name: t("imports.resume.commit"), exact: true })).toBeVisible();
      if (kind === "archive") await expect(page.locator("#source-file")).toHaveAttribute("accept", /\.zip/);
      await expect(page.getByRole("link", { name: t("imports.resume.next"), exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const selector of ["#source-file", "#graph-conflict-slug", "#graph-conflict-resolution", "#graph-conflict-renamed"]) expect(await page.locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${kind}-${locale}-${theme}-saved-source.png`) });
      }
      await page.locator("#graph-conflict-slug").fill("resumed/page-500");
      await page.locator("#graph-conflict-resolution").selectOption("rename");
      await page.locator("#graph-conflict-renamed").fill("resumed/renamed-final");
      await press(t("imports.review"));
      await expect.poll(async () => (await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, id)))[0]?.planRevision).toBe(2);
      await page.reload();
      let entered!: () => void, release!: () => void;
      const reached = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
      const route = async (request: Route) => { entered(); await held; await request.continue(); };
      await page.route("**/api/v1/imports.commit", route, { times: 1 });
      const firstReceipt = outcome("commit", "previewed");
      await press(t("imports.resume.commit"));
      try { await reached; await press(t("imports.resume.pause")); } finally { release(); }
      const firstResponse = await firstReceipt;
      expect(firstResponse.ok(), await firstResponse.text()).toBe(true);
      expect(await firstResponse.json()).toMatchObject({ status: "previewed", counts: { pages: 500 } });
      await expect(page.getByRole("button", { name: t("imports.resume.commit"), exact: true })).toBeEnabled();
      await expect.poll(async () => (await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, id)))[0]?.commitOrdinal).toBe(500);
      await page.reload();
      await page.route("**/api/v1/imports.commit", request => request.abort("failed"), { times: 1 });
      await press(t("imports.resume.commit"));
      await expect(page.getByRole("alert").filter({ hasText: t("imports.resume.failed") })).toHaveText(t("imports.resume.failed"));
      await page.reload();
      await page.locator("#source-file").setInputFiles(file);
      const restored = page.waitForResponse(response => response.url().endsWith("/api/v1/imports.previewFromUpload") && response.status() === 200);
      await press(t("imports.stage"));
      await restored;
      await expect(page.getByRole("button", { name: t("imports.stage"), exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: t("imports.resume.commit"), exact: true })).toBeEnabled();
      expect((await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, id)))[0]).toMatchObject({ commitOrdinal: 500, planRevision: 2 });
      await complete(t("imports.resume.commit"), "commit", "committed");
      await expect(page.getByRole("button", { name: t("imports.reconcile"), exact: true })).toBeVisible();
      await complete(t("imports.reconcile"), "reconcile", "reconciled");
      await expect(page.getByRole("button", { name: t("imports.publish"), exact: true })).toBeVisible();
      await complete(t("imports.publish"), "publish", "published");
      await expect.poll(async () => (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.status).toBe("published");
      await page.goto("/resumed/page-0");
      await expect(page.getByRole("heading", { name: "Fictional saved page 0", level: 1 })).toBeVisible();
      await page.getByRole("link", { name: "Last saved page", exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/resumed\/renamed-final$/);
      await expect(page.getByRole("heading", { name: "Fictional saved page 500", level: 1 })).toBeVisible();
      await page.goto(`/admin/imports/${id}`);
      await complete(t("imports.rollback"), "rollback", "rolled_back");
      await expect.poll(async () => (await db().select().from(importRuns).where(eq(importRuns.id, id)))[0]?.status).toBe("rolled_back");
      expect((await page.request.get("/resumed/page-0")).status()).toBe(404);
      expect((await page.request.get("/resumed/renamed-final")).status()).toBe(404);
      await context.close();
    });
  }
});
