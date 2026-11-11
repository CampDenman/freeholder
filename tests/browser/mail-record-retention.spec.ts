// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: real authorized ownership review, not a human security sign-off.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { businessProfile } from "@/core/settings/schema";
import { mailDeliveries, mailRecordSubjects } from "@/core/mail/schema";
import { auditLog } from "@/core/events/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ar from "../../locales/ar.json";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";
import { historicalMailFixture } from "../helpers/mail-fixture";

const messages = { en, es, fr, ar };
test.describe("mail historical ownership review (C3.31)", () => {
  test.setTimeout(180_000); test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) test(`${locale}: reviews exact original ownership with keyboard at 320px`, async ({ browser }) => {
    const owner = await seedC11Owner("Mail privacy fixture"), text = messages[locale];
    await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
    const email = `${"historical".repeat(7)}@example.test`;
    const [contact] = await db().insert(contacts).values({ name: "Original fictional person", email }).returning();
    const [delivery] = await historicalMailFixture(async tx => tx.insert(mailDeliveries).values({ purpose: "transactional", provider: "console", recipient: email, subject: "Original fictional mail fact", status: "failed", requestedBy: "system", createdAt: new Date("2020-01-01T00:00:00Z") }).returning());
    const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
    await useOwnerSession(context, owner); const page = await context.newPage();
    try {
      await page.goto(`/admin/retention/mail?contactId=${contact!.id}`);
      await expect(page.getByRole("heading", { name: text["admin.retention.mail.title"], exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: email, exact: true })).toBeVisible();
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await page.locator("input:not([type=hidden]),select,textarea,button").evaluateAll(elements => elements.every(element => {
          const box = element.getBoundingClientRect(); return box.width === 0 || (box.left >= -1 && box.right <= document.documentElement.clientWidth + 1);
        }))).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-mail-ownership.png`), fullPage: true });
      }
      await expect(page.getByLabel(text["admin.retention.mail.contact"], { exact: true })).toHaveValue(contact!.id);
      const evidence = "Fictional original correspondence and the recorded date independently establish this person's ownership.";
      await page.getByLabel(text["admin.retention.mail.evidence"], { exact: true }).fill(evidence);
      const verified = page.getByLabel(text["admin.retention.mail.confirm"], { exact: true });
      await verified.focus(); await page.keyboard.press("Space"); await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: text["admin.retention.mail.review"], exact: true })).toBeFocused(); await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toHaveText(text["admin.retention.mail.saved"]);
      const [binding] = await db().select().from(mailRecordSubjects).where(eq(mailRecordSubjects.recordId, delivery!.id));
      expect(binding).toMatchObject({ contactId: contact!.id, basis: "owner_review" });
      expect(binding?.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
      const [audit] = await db().select().from(auditLog).where(eq(auditLog.action, "mail.reviewLegacyOwnership"));
      expect(JSON.stringify(audit)).not.toContain(evidence); expect(audit?.diff).toEqual({ kind: "delivery", id: delivery!.id });
    } finally { await context.close(); }
  });
});
