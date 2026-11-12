// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.34: fixture-only original lead evidence, real owner UI and shared-service audit.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { auditLog } from "@/core/events/schema";
import { businessProfile } from "@/core/settings/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { claimLeadCopy, finishLeadCopy, stageLeadCopy } from "@/modules/forms/lead-copy-state";
import { leadCredentialFingerprint } from "@/modules/forms/lead-notice";
import { forms, formLeadCopies, formSubmissions } from "@/modules/forms/schema";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ar from "../../locales/ar.json";
import { C11_BASE_URL, C11_OWNER, seedC11Owner, useOwnerSession } from "./owner-session";
const messages = { en, es, fr, ar };
test.describe("original form lead owner review (C3.34)", () => {
  test.setTimeout(180_000); test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) test(`${locale}: verifies original outcome with keyboard at 320 px`, async ({ browser }) => {
    const owner = await seedC11Owner("Fictional original lead"), text = messages[locale];
    await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
    const site = { baseUrl: "https://fictional-original-lead.example.test", apiKey: "fictional-original-private-site-key" };
    const id = await db().transaction(async tx => {
      const [contact] = await tx.insert(contacts).values({ name: "Fictional original sender", email: "fictional-original@example.test" }).returning();
      const fields = [{ key: "email", label: "Email", kind: "email" as const, required: true }];
      const [form] = await tx.insert(forms).values({ slug: "fictional-lead", name: "Fictional lead", fields }).returning();
      const data = { email: contact!.email };
      const [submission] = await tx.insert(formSubmissions).values({ formId: form!.id, contactId: contact!.id, data }).returning();
      return stageLeadCopy(tx, { submissionId: submission!.id, form: { slug: form!.slug, fields }, data, sourceUrl: "/contact", notice: { version: 1, slug: form!.slug, origin: C11_BASE_URL, provider: "paradise", baseUrl: site.baseUrl, credentialFingerprint: leadCredentialFingerprint(site.baseUrl, site.apiKey), words: "Fictional notice identifies the original lead provider and the copied answers.", issued: Date.now() } });
    });
    const claim = await claimLeadCopy(id, site); expect(claim).toBeTruthy();
    await finishLeadCopy(id, claim!.operationId, { observed: "unknown" });
    const [original] = await db().select().from(formLeadCopies).where(eq(formLeadCopies.id, id));
    const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
    await useOwnerSession(context, owner); const page = await context.newPage();
    try {
      await page.goto("/admin/forms/lead-copies");
      await expect(page.getByRole("heading", { name: text["forms.leads.title"], exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: site.baseUrl, exact: true })).toBeVisible();
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await page.locator("input:not([type=hidden]),select,textarea,button").evaluateAll(elements => elements.every(element => { const bounds = element.getBoundingClientRect(); return bounds.width === 0 || (bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1); }))).toBe(true);
        for (const privateValue of [original!.resourceDigest, original!.requestDigest, original!.encryptedRequest, site.apiKey, "fictional-original@example.test"]) expect(await page.content()).not.toContain(privateValue);
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-lead-review.png`), fullPage: true });
      }
      const evidence = "Fictional independently verified original provider final not-copied outcome and stopped callers.";
      await page.getByLabel(text["forms.leads.outcome"], { exact: true }).selectOption("not_copied");
      await page.getByLabel(text["forms.leads.reference"], { exact: true }).fill("fictional-original-final-reference");
      for (const key of ["originalResourceEvidence", "finalProviderEvidence", "stoppedCallerEvidence"] as const) await page.getByLabel(text[`forms.leads.${key}`], { exact: true }).fill(evidence);
      await page.getByLabel(text["forms.leads.confirm"], { exact: true }).focus(); await page.keyboard.press("Space"); await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: text["forms.leads.record"], exact: true })).toBeFocused(); await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toHaveText(text["forms.leads.saved"]);
      const [reviewed] = await db().select().from(formLeadCopies).where(eq(formLeadCopies.id, id));
      expect(reviewed?.state).toBe("not_copied"); expect(reviewed?.attempts[0]).toMatchObject({ observed: "unknown", humanOutcome: "not_copied" }); expect(reviewed?.attempts).toHaveLength(1);
      const [audit] = await db().select().from(auditLog).where(eq(auditLog.action, "forms.reconcileLeadCopy"));
      expect(audit?.actor).toBe(`user:${C11_OWNER.userId}`); expect(audit?.diff).toEqual({ id, outcome: "not_copied" }); expect(JSON.stringify(audit)).not.toContain(evidence);
    } finally { await context.close(); }
  });
});
