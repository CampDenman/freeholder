// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: real owner recovery, original-resource refusal and private audit.
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { boundStorage } from "@/adapters/storage";
import { createLocalStorage } from "@/adapters/storage/local";
import { putWithReceipt } from "@/core/media/write-ledger";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { mediaMultipartOperations, mediaMultipartResources } from "@/core/media/multipart-schema";
import { mediaObjects } from "@/core/media/schema";
import { sessions } from "@/core/auth/schema";
import { db, closeDb } from "@/core/db";
import { auditLog } from "@/core/events/schema";
import { businessProfile } from "@/core/settings/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ar from "../../locales/ar.json";
import { OWNER } from "../helpers/spine";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

const messages = { en, es, fr, ar };
const privateEvidence = "PRIVATE-MEDIA-EVIDENCE-only-the-digest-may-be-retained";
type Locale = keyof typeof messages;

async function fixture(locale: Locale) {
  const token = await seedC11Owner("Storage recovery fixture");
  await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
  const captured = await boundStorage();
  const key = `fixture/${locale}/${randomUUID()}/${"original-".repeat(18)}.png`;
  const failing = { ...captured, store: { ...captured.store, put: async (...args: Parameters<typeof captured.store.put>) => { await captured.store.put(...args); throw new Error("Synthetic lost original PUT acknowledgement"); } } };
  const requestDirectory = join(process.env.LOCAL_STORAGE_ROOT!, ".freeholder-original-requests"), requestName = createHash("sha256").update(`freeholder:local-request-key:v1\0${key}`).digest("hex");
  mkdirSync(requestDirectory, { recursive: true });
  writeFileSync(join(requestDirectory, `${requestName}.json`), "Synthetic occupied original request sidecar", { flag: "wx" });
  const failed = await putWithReceipt({ key, body: new Uint8Array([97, 98, 99]), contentType: "image/png", role: "original" }, OWNER, failing).then(() => false, () => true);
  if (!failed) throw new Error("The genuine failed original provider call is required.");
  await createLocalStorage({ root: process.env.LOCAL_STORAGE_ROOT!, publicPath: "/media" }).delete(key);
  const [receipt] = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key, key));
  if (!receipt || receipt.state !== "unknown" || !receipt.originalReservationId) throw new Error("The admitted original unknown receipt is missing.");
  const output = `/tmp/freeholder-browser-multipart-${randomUUID()}.json`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/fixtures/media-browser-multipart-debt.config.ts"], { env: { ...process.env, TEST_DATABASE_URL: process.env.DATABASE_URL!, FREEHOLDER_MEDIA_BROWSER_MULTIPART_OUTPUT: output }, stdio: ["ignore", "pipe", "pipe"] });
    let diagnostics = "";
    child.stdout.on("data", chunk => { diagnostics += String(chunk); }); child.stderr.on("data", chunk => { diagnostics += String(chunk); });
    child.on("error", reject); child.on("close", code => { if (code === 0) resolve(); else reject(new Error(`The genuine multipart producer failed (${code}): ${diagnostics}`)); });
  });
  const selected = z.object({ resourceId: z.uuid(), operationId: z.uuid(), originalEndpoint: z.string().url() }).strict().parse(JSON.parse(await readFile(output, "utf8")) as unknown);
  const [resource] = await db().select().from(mediaMultipartResources).where(eq(mediaMultipartResources.id, selected.resourceId));
  if (!resource || resource.state !== "unknown" || !resource.originalReservationId) throw new Error("The produced original multipart resource is missing.");
  const [operation] = await db().select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id, selected.operationId));
  if (!operation || operation.resourceId !== resource.id || operation.state !== "unknown") throw new Error("The produced original CREATE operation is missing.");
  return { token, receipt, resource, operation, originalEndpoint: selected.originalEndpoint };
}

async function submitProof(page: Page, form: Locator, m: typeof en, multipart = false) {
  await form.getByLabel(m["media.recovery.outcome"], { exact: true }).selectOption("not_applied");
  await form.getByLabel(m["media.recovery.reference"], { exact: true }).fill("fixture-final-provider-reference");
  await form.getByLabel(m["media.recovery.evidence"], { exact: true }).fill(privateEvidence);
  await form.getByLabel(m["media.recovery.stopped"], { exact: true }).fill("All fixture callers have stopped; no request can still allocate bytes.");
  const confirmation = form.getByRole("checkbox", { name: m[multipart ? "media.recovery.multipartConfirm" : "media.recovery.confirm"], exact: true });
  await confirmation.focus(); await page.keyboard.press("Space"); await expect(confirmation).toBeChecked();
  const submitted = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/admin/media/recovery"));
  await form.getByRole("button", { name: m["media.recovery.submit"], exact: true }).focus();
  await page.keyboard.press("Enter");
  expect((await submitted).status()).toBe(200);
}

test.describe("original storage recovery owner journey (C1.12/C11.08)", () => {
  test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) {
    test(`${locale}: fresh owner records real absence and refuses a replacement multipart resource`, async ({ browser }) => {
      const seeded = await fixture(locale), m = messages[locale];
      const context = await browser.newContext({ baseURL: C11_BASE_URL, locale, viewport: { width: 320, height: 900 } });
      const page = await context.newPage();
      try {
        await useOwnerSession(context, seeded.token);
        await db().update(sessions).set({ stepUpAt: new Date(Date.now() - 3_600_000) }).where(eq(sessions.userId, OWNER.userId));
        await page.goto("/admin/media/recovery");
        await expect(page.getByRole("link", { name: m["media.recovery.verify"], exact: true })).toBeVisible();
        await expect(page.locator("form input[name=originalNamespace]")).toHaveCount(0);
        await db().update(sessions).set({ stepUpAt: new Date() }).where(eq(sessions.userId, OWNER.userId));
        for (const theme of ["light", "dark"]) {
          await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
          await page.goto("/admin/media/recovery");
          await expect(page.getByRole("heading", { name: m["media.recovery.title"], exact: true })).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
          expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
          const html = await page.content();
          expect(html).not.toContain(seeded.originalEndpoint);
          await page.screenshot({ path: test.info().outputPath(`${locale}-${theme}-storage-recovery.png`), fullPage: true });
        }
        const multipart = page.locator(`form:has(input[name="resourceId"][value="${seeded.resource.id}"])`);
        await submitProof(page, multipart, m, true);
        await expect(multipart.getByText(m["media.recovery.failed"], { exact: true })).toBeVisible();
        expect((await db().select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.id, seeded.operation.id)))[0]?.state).toBe("unknown");
        const ordinary = page.locator(`form:has(input[name="id"][value="${seeded.receipt.id}"])`);
        await submitProof(page, ordinary, m);
        await expect.poll(async () => (await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, seeded.receipt.id)))[0]?.state).toBe("confirmed_absent");
        expect(await db().select().from(mediaObjects).where(eq(mediaObjects.key, seeded.receipt.key))).toHaveLength(0);
        const entries = await db().select().from(auditLog);
        expect(entries.some(row => row.action === "media.applyOriginalPutRecovery" && row.actor === `user:${OWNER.userId}` && row.subjectId === seeded.receipt.id)).toBe(true);
        expect(JSON.stringify(entries)).not.toContain(privateEvidence);
        const privatePhase = await context.request.post("/api/v1/media.claimStorageRecovery", { headers: { Origin: C11_BASE_URL }, data: {} });
        expect(privatePhase.status()).toBe(404);
      } finally { await context.close(); }
    });
  }
});
