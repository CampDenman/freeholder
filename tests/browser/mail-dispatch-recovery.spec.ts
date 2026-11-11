// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: real fresh-human review and explicit retry; never a security sign-off.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { mailDeliveries, mailDispatches, mailDispatchRequests, mailOutbox } from "@/core/mail/schema";
import { mailReceipts } from "@/core/mail/receipts";
import { encryptMailOutbox } from "@/core/mail/outbox-crypto";
import { auditLog } from "@/core/events/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ar from "../../locales/ar.json";
import { C11_BASE_URL, C11_OWNER, seedC11Owner, useOwnerSession } from "./owner-session";

const messages = { en, es, fr, ar };
async function seedRecoveryRequest(recipient: string, observedReply = false) {
  return db().transaction(async tx => {
    const receipts = await mailReceipts(tx);
    const [delivery] = await tx.insert(mailDeliveries).values({ purpose: "transactional", provider: "smtp", recipient, recipientDigest: receipts.digest("address", recipient), subject: "Fictional original private receipt", status: "unknown", attempts: 1, requestedBy: `user:${C11_OWNER.userId}` }).returning();
    const original = { provider: "smtp", purpose: "transactional", from: "sender@example.test", senderId: null, connectionId: null, providerAccountId: null, host: "original-smtp.example.test", port: 587, tlsMode: "required_starttls", user: "fictional-original-account", providerIdentity: null, authorizationDigest: receipts.digest("dispatch-authorization", "fictional-original-authorization") };
    const payload = JSON.stringify({ to: recipient, subject: delivery!.subject, text: "Fictional original private body" });
    const routeDigest = receipts.digest("dispatch-route", JSON.stringify(original)), payloadDigest = receipts.digest("dispatch-payload", payload);
    await tx.insert(mailDispatchRequests).values({ deliveryId: delivery!.id, routeDigest, payloadDigest, encryptedRoute: encryptMailOutbox(JSON.stringify(original), delivery!.id) });
    await tx.insert(mailOutbox).values({ deliveryId: delivery!.id, encryptedMessage: encryptMailOutbox(payload, delivery!.id) });
    const [dispatch] = await tx.insert(mailDispatches).values({ deliveryId: delivery!.id, routeDigest, payloadDigest, attempt: 1, state: "unknown", ...(observedReply ? { replyProviderRef: "fictional-original-positive-server-reference", replyEvidenceDigest: receipts.digest("dispatch-resolution", "fictional-original-positive-reply") } : {}) }).returning();
    return { delivery: delivery!, dispatch: dispatch!, routeDigest, payloadDigest };
  });
}
test.describe("human original-mail outcome recovery (C3.31)", () => {
  test.setTimeout(180_000); test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) test(`${locale}: reviews the original outcome and separately authorizes one retry`, async ({ browser }) => {
    const owner = await seedC11Owner("Fictional mail recovery"), text = messages[locale];
    await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
    const fixture = await seedRecoveryRequest(`${"fictional".repeat(7)}@example.test`);
    const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
    await useOwnerSession(context, owner); const page = await context.newPage();
    try {
      await page.goto("/admin/retention/mail/recovery");
      await expect(page.getByRole("heading", { name: text["mail.recovery.title"], exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: fixture.delivery.recipient, exact: true })).toBeVisible();
      await expect(page.getByText("original-smtp.example.test", { exact: false })).toBeVisible();
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        expect(await page.locator("input:not([type=hidden]),select,textarea,button").evaluateAll(elements => elements.every(element => { const bounds = element.getBoundingClientRect(); return bounds.width === 0 || (bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1); }))).toBe(true);
        expect(await page.content()).not.toContain(fixture.routeDigest); expect(await page.content()).not.toContain(fixture.payloadDigest);
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-original-mail-recovery.png`), fullPage: true });
      }
      await page.getByLabel(text["mail.recovery.outcome"], { exact: true }).selectOption("not_submitted");
      await page.getByLabel(text["mail.recovery.operation"], { exact: true }).fill("fictional-original-server-final-log");
      const evidence = "Fictional independent original-server records and stopped-caller evidence establish this exact final outcome.";
      for (const key of ["originalRouteEvidence", "finalProviderEvidence", "stoppedCallerEvidence"] as const) await page.getByLabel(text[`mail.recovery.${key}`], { exact: true }).fill(evidence);
      const confirmation = page.getByLabel(text["mail.recovery.confirm"], { exact: true });
      await confirmation.focus(); await page.keyboard.press("Space"); await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: text["mail.recovery.record"], exact: true })).toBeFocused(); await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toHaveText(text["mail.recovery.saved"]);
      const [reviewed] = await db().select().from(mailDispatches).where(eq(mailDispatches.id, fixture.dispatch.id));
      expect(reviewed?.state).toBe("not_submitted"); expect(reviewed?.resolutionSource).toBe("human_provider_confirmation"); expect(reviewed?.resolvedBy).toBe(C11_OWNER.userId);
      const [reviewAudit] = await db().select().from(auditLog).where(eq(auditLog.action, "mail.reconcileDispatch"));
      expect(reviewAudit?.diff).toEqual({ deliveryId: fixture.delivery.id, dispatchId: fixture.dispatch.id, outcome: "not_submitted" }); expect(reviewAudit?.actor).toBe(`user:${C11_OWNER.userId}`); expect(JSON.stringify(reviewAudit)).not.toContain(evidence);
      expect((await db().select().from(mailDispatchRequests))[0]?.admittedAttempt).toBe(1);
      const retry = page.getByLabel(text["mail.recovery.retryConfirm"], { exact: true });
      await retry.focus(); await page.keyboard.press("Space"); await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: text["mail.recovery.retry"], exact: true })).toBeFocused(); await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toHaveText(text["mail.recovery.retrySaved"]);
      expect((await db().select().from(mailDispatchRequests))[0]?.admittedAttempt).toBe(2);
      expect((await db().select().from(mailDeliveries))[0]?.status).toBe("queued");
      expect(await db().select().from(mailDispatches)).toHaveLength(1);
      await expect(page.getByRole("button", { name: text["mail.recovery.retry"], exact: true })).toHaveCount(0);

      // A retained positive reply has a distinct owner explanation and cannot
      // be manually relabeled as never submitted. This remains synthetic
      // owner-workflow evidence; SMTP wire acceptance is a separate test.
      const positive = await seedRecoveryRequest("fictional-positive@example.test", true);
      await page.goto("/admin/retention/mail/recovery");
      await expect(page.getByText(text["mail.recovery.observedReply"], { exact: true })).toBeVisible();
      await expect(page.getByLabel(text["mail.recovery.outcome"], { exact: true }).locator('option[value="not_submitted"]')).toBeDisabled();
      for (const theme of ["light", "dark"]) {
        await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]); await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.locator("input:not([type=hidden]),select,textarea,button").evaluateAll(elements => elements.every(element => { const bounds = element.getBoundingClientRect(); return bounds.width === 0 || (bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1); }))).toBe(true);
        expect(await page.content()).not.toContain(positive.dispatch.replyEvidenceDigest);
        await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-observed-mail-reply.png`), fullPage: true });
      }
      await page.getByLabel(text["mail.recovery.outcome"], { exact: true }).selectOption("submitted");
      await page.getByLabel(text["mail.recovery.operation"], { exact: true }).fill("fictional-original-positive-server-reference");
      for (const key of ["originalRouteEvidence", "finalProviderEvidence", "stoppedCallerEvidence"] as const) await page.getByLabel(text[`mail.recovery.${key}`], { exact: true }).fill(evidence);
      await page.getByLabel(text["mail.recovery.confirm"], { exact: true }).focus(); await page.keyboard.press("Space"); await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: text["mail.recovery.record"], exact: true })).toBeFocused(); await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toHaveText(text["mail.recovery.saved"]);
      const [accepted] = await db().select().from(mailDispatches).where(eq(mailDispatches.id, positive.dispatch.id));
      expect(accepted?.state).toBe("submitted"); expect(accepted?.resolutionSource).toBe("human_provider_confirmation"); expect(accepted?.replyProviderRef).toBe("fictional-original-positive-server-reference");
      expect(await db().select().from(mailOutbox).where(eq(mailOutbox.deliveryId, positive.delivery.id))).toHaveLength(0);
    } finally { await context.close(); }
  });
});
