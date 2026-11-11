// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C3.22: a real owner cutover must explain pending original-file cleanup.
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { dataRequests, dataRequestArtifacts } from "@/core/privacy/schema";
import { importRuns } from "@/core/plugins/schema";
import { auditLog } from "@/core/events/schema";
import { businessProfile } from "@/core/settings/schema";
import { translator } from "@/core/i18n";
import { THEME_COOKIE } from "@/core/design/theme";
import { C11_BASE_URL, C11_OWNER, seedC11Owner, useOwnerSession } from "./owner-session";

test.describe("original import-file erasure feedback", () => {
  test.setTimeout(180_000);
  test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) {
    test(`${locale}: keyboard erasure stays pending for private source recovery at320px`, async ({ browser }) => {
      const token = await seedC11Owner("Source erasure qualification");
      await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
      const [contact] = await db().insert(contacts).values({ name: "Synthetic reader", email: "source-reader-browser@example.test" }).returning();
      const [run] = await db().insert(importRuns).values({ source: "https://source.example", origin: "https://source.example", kind: "wordpress-wxr", createdBy: `user:${C11_OWNER.userId}` }).returning();
      const uploadId = randomUUID();
      await db().update(importRuns).set({ checkpoint: { sourceUpload: { uploadId, filename: "source.xml", bytes: 1024, chunkBytes: 4 * 1024 * 1024, chunks: 1, received: [], digests: {}, keyPrefix: `imports/${run!.id}/${uploadId}`, createdBy: `user:${C11_OWNER.userId}`, expiresAt: new Date(Date.now() + 86_400_000).toISOString() } } }).where(eq(importRuns.id, run!.id));
      const [request] = await db().insert(dataRequests).values({ contactId: contact!.id, kind: "erasure", status: "verified", requestedBy: `user:${C11_OWNER.userId}`, details: { kind: "erasure" }, verifiedAt: new Date(), responseDueAt: new Date(Date.now() + 86_400_000) }).returning();
      const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
      try {
        await useOwnerSession(context, token);
        const page = await context.newPage(), t = translator(locale);
        await page.goto(`/admin/contacts/privacy/${request!.id}`);
        const confirmation = page.locator('input[name="confirmation"]');
        await confirmation.fill("ERASE");
        await confirmation.focus();
        await page.keyboard.press("Tab");
        await expect(page.getByRole("button", { name: t("privacy.fulfill.submit"), exact: true })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("heading", { name: t("privacy.erasure.pending.title") })).toBeVisible();
        await expect(page.getByText(t("privacy.erasure.pending.hint"), { exact: true })).toBeVisible();
        await expect(page.locator('input[name="confirmation"]')).toHaveCount(0);
        await expect(page.getByRole("link", { name: t("privacy.erasure.pending.jobs") })).toHaveAttribute("href", "/admin/jobs");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        for (const theme of ["light", "dark"]) {
          await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
          await page.reload();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
          expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
          await expect(page.locator("body")).not.toContainText("source-reader-browser@example.test");
          await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-source-erasure.png`), fullPage: true });
        }
        const [saved] = await db().select().from(dataRequests).where(eq(dataRequests.id, request!.id));
        expect(saved?.status).toBe("in_progress");
        const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request!.id));
        const receipt = artifact!.body as { outcomes: Array<{ scope: string; outcome: string; pendingJobs?: string[] }> };
        const source = receipt.outcomes.find(outcome => outcome.scope === "imports.readerSources");
        expect(source?.outcome).toBe("pending");
        expect(source?.pendingJobs).toHaveLength(1);
        const audit = await db().select().from(auditLog).where(eq(auditLog.subjectId, request!.id));
        expect(audit.some(row => row.action === "contacts.fulfillDataRequest" && row.actor === `user:${C11_OWNER.userId}`)).toBe(true);
      } finally { await context.close(); }
    });
  }
});
