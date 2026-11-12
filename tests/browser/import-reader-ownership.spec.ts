// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.46: the real verified owner chooses an ambiguous original reader.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, closeDb } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { readerOwnershipReceipts } from "@/core/import/reader-ownership-schema";
import { stageImportSource } from "@/core/import/service";
import { importRuns } from "@/core/plugins/schema";
import { businessProfile } from "@/core/settings/schema";
import { blogReaderComments } from "@/modules/cms/blog-comments-schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { translator } from "@/core/i18n";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

const EMAIL = `${"historical".repeat(7)}@example.test`;
const SECOND = `<wp:comment><wp:comment_id>21</wp:comment_id><wp:comment_author>Second fictional original reader</wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content>Second fictional original reader evidence.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>`;
const SOURCE = `<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><link>https://fictional-reader.example/site-a/</link><item><title>Original fictional article</title><link>https://fictional-reader.example/site-a/original-article</link><wp:post_id>10</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Fictional article text.</p>]]></content:encoded><wp:comment><wp:comment_id>20</wp:comment_id><wp:comment_author>Original fictional reader</wp:comment_author><wp:comment_author_email>${EMAIL}</wp:comment_author_email><wp:comment_content>Original fictional reader evidence.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>${SECOND}</item></channel></rss>`;

test.describe("original reader ownership review (C2.29/C3.46)", () => {
  test.setTimeout(180_000); test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) test(`${locale}: assigns the original person with keyboard at 320px`, async ({ browser }) => {
    const owner = await seedC11Owner("Original reader qualification"), t = translator(locale);
    await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
    const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
    await useOwnerSession(context, owner);
    const csrf = issueCsrfToken(); await context.addCookies([{ name: CSRF_COOKIE, value: csrf, url: C11_BASE_URL }]);
    const page = await context.newPage();
    const post = async (operation: string, data: Record<string, unknown>): Promise<unknown> => {
      const response = await page.request.post(`/api/v1/${operation}`, { data, headers: { [CSRF_HEADER]: csrf } });
      expect(response.ok(), `${operation}: ${await response.text()}`).toBe(true);
      return response.json();
    };
    try {
      await post("cms.ensureDefaults", {});
      const original = z.object({ id: z.uuid() }).parse(await post("contacts.create", { name: "Original fictional person", email: EMAIL }));
      let legacy: { id: string } | undefined;
      if (locale === "en") {
        // Declared pre-receipt persistence fixture, with its original pointer
        // and executor. No current receipt/key is deleted to manufacture it.
        const staged = stageImportSource("wordpress-wxr", SOURCE, "https://fictional-reader.example");
        const cached = z.object({ pages: z.array(z.object({ readerComments: z.array(z.record(z.string(), z.unknown())) }).passthrough()) }).passthrough().parse(staged.preview);
        for (const reader of cached.pages[0]!.readerComments) reader.contactId = original.id;
        [legacy] = await db().insert(importRuns).values({ source: "wordpress-wxr:https://fictional-reader.example", kind: "wordpress-wxr", origin: "https://fictional-reader.example", status: "previewed", preview: cached, checkpoint: { origin: "https://fictional-reader.example", kind: "wordpress-wxr" }, counts: staged.counts, createdBy: "agent:legacy-browser-source" }).returning({ id: importRuns.id });
      }
      await post("contacts.update", { id: original.id, email: "changed-original@example.test" });
      const later = z.object({ id: z.uuid() }).parse(await post("contacts.create", { name: "Later email holder", email: EMAIL }));
      const run = legacy ?? z.object({ id: z.uuid() }).parse(await post("imports.start", { origin: "https://fictional-reader.example", kind: "wordpress-wxr" }));
      if (!legacy) await post("imports.previewFromSource", { id: run.id, payload: SOURCE });
      await page.goto(`/admin/imports/${run.id}`);
      await expect(page.getByRole("heading", { name: t("imports.readers.title"), exact: true })).toBeVisible();
      await expect(page.getByText(EMAIL, { exact: true })).toHaveCount(2);
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await page.locator("input:not([type=hidden]),select,textarea,button").evaluateAll(elements => elements.every(element => {
          const box = element.getBoundingClientRect(); return box.width === 0 || (box.left >= -1 && box.right <= document.documentElement.clientWidth + 1);
        }))).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-original-reader.png`), fullPage: true });
      }
      const person = page.getByLabel(t("imports.readers.person"), { exact: true });
      await expect(person).toHaveCount(2);
      for (const selected of await person.all()) { await expect(selected).toHaveValue(""); await selected.selectOption(original.id); }
      const confirmation = page.getByLabel(t("imports.readers.confirm"), { exact: true });
      await expect(confirmation).toHaveCount(2);
      for (const checked of await confirmation.all()) { await expect(checked).not.toBeChecked(); await checked.focus(); await page.keyboard.press("Space"); }
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: t("imports.readers.bulkSubmit"), exact: true })).toBeFocused();
      const reviewed = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/admin/imports/${run.id}`, { timeout: 120_000 });
      await page.keyboard.press("Enter");
      // The successful action redirects immediately; Chromium can discard
      // its body after navigation. Its status and durable receipt prove the
      // outcome without racing that intentionally disposable response body.
      const saved = await reviewed; expect(saved.status()).toBe(200);
      await expect(page.getByRole("heading", { name: t("imports.readers.title"), exact: true })).toHaveCount(0);
      const receipts = await db().select().from(readerOwnershipReceipts);
      expect(receipts).toHaveLength(2);
      for (const receipt of receipts) { expect(receipt).toMatchObject({ state: "bound", contactId: original.id }); expect(receipt.contactId).not.toBe(later.id); }
      if (legacy) expect((await db().select().from(importRuns).where(eq(importRuns.id, run.id)))[0]?.createdBy).toBe("agent:legacy-browser-source");
      await post("imports.commit", { id: run.id });
      expect((await db().select().from(blogReaderComments)).map(comment => comment.contactId)).toEqual([original.id, original.id]);
      const [audit] = await db().select().from(auditLog).where(eq(auditLog.action, "imports.resolveReaderOwnership"));
      expect(audit).toMatchObject({ actor: "user:00000000-0000-4000-8000-000000000001", subjectType: "contact", subjectId: original.id });
      const [batchAudit] = await db().select().from(auditLog).where(eq(auditLog.action, "imports.resolveReaderOwnershipBatch"));
      expect(batchAudit).toMatchObject({ actor: "user:00000000-0000-4000-8000-000000000001", subjectType: "import_run", subjectId: run.id });
      expect(JSON.stringify(batchAudit?.diff)).not.toContain(EMAIL);
      expect(JSON.stringify(audit?.diff)).not.toContain(EMAIL); expect(JSON.stringify(audit?.diff)).not.toContain("Original fictional reader evidence.");
    } finally { await context.close(); }
  });
});
