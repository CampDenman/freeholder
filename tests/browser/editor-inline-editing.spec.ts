// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The flagship C2.25 slice A proof: the page is the canvas.
//
// Open a page in the editor, click the headline and the intro paragraph on
// the rendered canvas and type, replace the hero image through the block's
// own on-canvas affordance, let the existing debounced autosave persist the
// working draft, publish once, and read the result on the real public page.
// A reload of the editor then proves the canvas edits stuck in stored state.
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { API_BASE } from "@/core/api/dispatch";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { users, totpFactors } from "@/core/auth/schema";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { closeDb, db } from "@/core/db";
import { pages } from "@/modules/cms/schema";
import { businessProfile } from "@/core/settings/schema";
import { OWNER } from "../helpers/spine";
import { resetBrowserDatabase } from "./database";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3100";
const HEADLINE = "Coastal light, edited where it renders";
const INTRO = "Canvas-written intro copy.";

async function callService(
  sessionToken: string,
  service: string,
  input: Record<string, unknown>,
): Promise<void> {
  const csrf = issueCsrfToken();
  const response = await fetch(`${BASE_URL}${API_BASE}/${service}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; ${CSRF_COOKIE}=${encodeURIComponent(csrf)}`,
      [CSRF_HEADER]: csrf,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`${service} refused (${response.status}): ${await response.text()}`);
  }
}

test.describe("inline canvas editing", () => {
  let sessionToken = "";
  let homePageId = "";

  test.beforeAll(async () => {
    await resetBrowserDatabase();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner-canvas@example.test",
      role: "owner",
    });
    await db().insert(totpFactors).values({
      userId: OWNER.userId,
      encryptedSecret: "c224-canvas-fixture",
    });
    await db()
      .insert(businessProfile)
      .values({
        name: "Canvas Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        defaultLocale: "en",
        enabledLocales: ["en"],
        setupCompletedAt: new Date(),
      });
    const session = await db().transaction((tx) =>
      createSession(tx, OWNER.userId, { twoFactorVerified: true }),
    );
    sessionToken = session.token;

    // demo.install is an orchestrator, so it must run through the booted app
    // rather than service.call from this process.
    await callService(sessionToken, "demo.install", { publish: true });

    const [home] = await db()
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.slug, ""))
      .limit(1);
    if (!home) throw new Error("The demo fixture did not create its home page.");
    homePageId = home.id;

    // Work the draft → publish path the journey ends in: the page starts
    // unpublished so "Publish" is the single, atomic last step — no
    // unpublish-first toggle dance (audit finding 9, fixed separately).
    await callService(sessionToken, "cms.publishPage", { id: homePageId, published: false });
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("click the canvas, type, save, publish — the public page shows it", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await context.addCookies([
      { name: SESSION_COOKIE, value: sessionToken, url: BASE_URL },
    ]);

    const saved = page.locator('p[role="status"]');
    const canvas = page.frameLocator("iframe[title='Preview']");

    await test.step("open the editor", async () => {
      await page.goto(`/admin/pages/${homePageId}`);
      await expect(canvas.locator(".fh-canvas h1")).toHaveText(
        "Coastal light, honestly made",
      );
    });

    await test.step("click the headline on the canvas and type", async () => {
      const headline = canvas.locator(".fh-canvas h1");
      await headline.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(HEADLINE);
      // Enter commits a single-line edit instead of growing the heading.
      await page.keyboard.press("Enter");
      await expect(canvas.locator(".fh-canvas h1")).toHaveText(HEADLINE);
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });
    });

    await test.step("click the intro paragraph and type", async () => {
      const intro = canvas.locator("[data-editable-rich] p").first();
      await intro.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(INTRO);
      await page.keyboard.press("Escape");
      await expect(canvas.locator("[data-editable-rich] p").first()).toHaveText(INTRO);
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });
    });

    let originalSrc = "";
    await test.step("replace the hero image from the canvas", async () => {
      const hero = canvas.locator("[data-block-id='home-hero']");
      originalSrc = (await hero.locator("img").getAttribute("src")) ?? "";
      await hero.getByRole("button", { name: "Replace image" }).click();

      const picker = page.getByRole("dialog", { name: "Replace image" });
      await expect(picker).toBeVisible();
      await picker.getByRole("button", { name: "aurora-coast-studio.jpg" }).click();

      // The canvas swaps the picture before any save round-trip.
      await expect
        .poll(async () => hero.locator("img").getAttribute("src"))
        .not.toBe(originalSrc);
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });
    });

    await test.step("publish and read the public page", async () => {
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible({
        timeout: 15_000,
      });

      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1, name: HEADLINE }),
      ).toBeVisible();
      await expect(page.getByText(INTRO)).toBeVisible();
      const publicSrc = await page
        .locator("picture img")
        .first()
        .getAttribute("src");
      expect(publicSrc).not.toBe(originalSrc);
    });

    await test.step("reopen the editor: the canvas edits persisted", async () => {
      await page.goto(`/admin/pages/${homePageId}`);
      await expect(page.frameLocator("iframe[title='Preview']").locator(".fh-canvas h1")).toHaveText(
        HEADLINE,
      );
      // The form panel holds the same tree — the advanced surface agrees.
      await expect(page.locator("#home-h1-text")).toHaveValue(HEADLINE);
    });
  });
});
