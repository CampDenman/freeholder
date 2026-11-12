// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: fixture-only carrier evidence, real owner UI and shared-service audit.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { auditLog } from "@/core/events/schema";
import { carrierResource } from "@/core/mail/carrier-operations";
import { mailProviderGrants } from "@/core/mail/schema";
import { mailReceipts } from "@/core/mail/receipts";
import { consentRecords } from "@/core/privacy/schema";
import { businessProfile } from "@/core/settings/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ar from "../../locales/ar.json";
import { C11_BASE_URL, C11_OWNER, seedC11Owner, useOwnerSession } from "./owner-session";
const messages = { en, es, fr, ar };
test.describe("original carrier withdrawal owner review (C3.31)", () => {
  test.setTimeout(180_000); test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) test(`${locale}: confirms original final withdrawal with keyboard at 320px`, async ({ browser }) => {
    const owner = await seedC11Owner("Fictional original carrier"), text = messages[locale];
    await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
    const grant = await db().transaction(async tx => {
      const resource = await carrierResource(tx, { baseUrl: "https://fictional-original-carrier.example.test", apiKey: "fictional-original-private-site-key" }), receipts = await mailReceipts(tx);
      const email = `${"fictional-original".repeat(4)}@example.test`;
      const [contact] = await tx.insert(contacts).values({ name: "Fictional original reader", email }).returning();
      const [consent] = await tx.insert(consentRecords).values({ contactId: contact!.id, purpose: "marketing", channel: "email", state: "granted", method: "double_opt_in", actor: `user:${C11_OWNER.userId}` }).returning();
      const [row] = await tx.insert(mailProviderGrants).values({ provider: "paradise", email, consentRecordId: consent!.id, ...resource, withdrawalError: "Fictional original withdrawal reply was lost.", carrierOperations: [{ id: "00000000-0000-4000-8000-000000000076", kind: "withdraw", key: "withdraw", resourceDigest: resource.resourceDigest, payloadDigest: receipts.digest("dispatch-payload", JSON.stringify({ email })), state: "unknown" }] }).returning();
      return row!;
    });
    const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
    await useOwnerSession(context, owner); const page = await context.newPage();
    try {
      await page.goto("/admin/retention/mail/carriers");
      await expect(page.getByRole("heading", { name: text["mail.carrier.title"], exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: grant.email, exact: true })).toBeVisible();
      await expect(page.getByText(text["mail.carrier.state.unknown"], { exact: false })).toBeVisible();
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await page.locator("input:not([type=hidden]),textarea,button").evaluateAll(elements => elements.every(element => { const bounds = element.getBoundingClientRect(); return bounds.width === 0 || (bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1); }))).toBe(true);
        expect(await page.content()).not.toContain(grant.resourceDigest); expect(await page.content()).not.toContain(grant.carrierOperations[0]!.payloadDigest); expect(await page.content()).not.toContain("fictional-original-private-site-key");
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-carrier-review.png`), fullPage: true });
      }
      const evidence = "Fictional independently verified original provider final withdrawal and stopped-caller evidence.";
      await page.getByLabel(text["mail.recovery.operation"], { exact: true }).fill("fictional-original-provider-final-reference");
      for (const key of ["originalRouteEvidence", "finalProviderEvidence", "stoppedCallerEvidence"] as const) await page.getByLabel(text[`mail.recovery.${key}`], { exact: true }).fill(evidence);
      await page.getByLabel(text["mail.carrier.confirm"], { exact: true }).focus(); await page.keyboard.press("Space"); await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: text["mail.carrier.record"], exact: true })).toBeFocused(); await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toHaveText(text["mail.recovery.saved"]);
      const [reviewed] = await db().select().from(mailProviderGrants).where(eq(mailProviderGrants.id, grant.id));
      expect(reviewed?.withdrawnAt).toBeInstanceOf(Date); expect(reviewed?.reviewedBy).toBe(C11_OWNER.userId); expect(reviewed?.carrierOperations).toEqual(grant.carrierOperations);
      const [audit] = await db().select().from(auditLog).where(eq(auditLog.action, "mail.confirmCarrierWithdrawal"));
      expect(audit?.actor).toBe(`user:${C11_OWNER.userId}`); expect(audit?.diff).toEqual({ id: grant.id }); expect(JSON.stringify(audit)).not.toContain(evidence); expect(JSON.stringify(audit)).not.toContain(grant.email);
    } finally { await context.close(); }
  });
});
