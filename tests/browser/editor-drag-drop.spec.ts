// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The flagship C2.25 slice B proof: drag a block from the top of the canvas
// to the bottom, and the published page agrees.
//
// The demo's home page starts as heading / text / image / button / divider /
// columns. The journey drags the heading below the intro paragraph on the
// rendered canvas, watches the same order appear in the form panel, lets the
// debounced autosave persist it, pushes it live with the one-step "Publish
// changes" action (audit gap 8 — no unpublish-first dance), and reads the new
// order back from the real public page. A second journey reorders from the
// keyboard through the canvas grip, the path a screen-reader or keyboard
// owner actually uses.
//
// Headless Chromium cannot carry a real HTML5 drag across the preview
// iframe's boundary, so the drag runs through the frame's own shipped drag
// listeners with real DragEvents (same caveat as the 2026-09-29 editor UX
// audit); every handler under test is the exact script the frame ships.
import { eq } from "drizzle-orm";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { API_BASE } from "@/core/api/dispatch";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { users, totpFactors } from "@/core/auth/schema";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { closeDb, db } from "@/core/db";
import { pages } from "@/modules/cms/schema";
import { OWNER } from "../helpers/spine";
import { resetBrowserDatabase } from "./database";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3100";

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

/** The block ids in document order inside the preview frame. */
async function canvasOrder(canvas: FrameLocator): Promise<string[]> {
  return canvas
    .locator("[data-block-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id") ?? ""));
}

function pageFrame(page: Page): FrameLocator {
  return page.frameLocator("iframe[title='Preview']");
}

test.describe("canvas drag-and-drop reordering", () => {
  let sessionToken = "";
  let homePageId = "";

  test.beforeAll(async () => {
    await resetBrowserDatabase();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner-c225-drag@example.test",
      role: "owner",
    });
    await db().insert(totpFactors).values({
      userId: OWNER.userId,
      encryptedSecret: "c225-drag-fixture",
    });
    const session = await db().transaction((tx) =>
      createSession(tx, OWNER.userId, { twoFactorVerified: true }),
    );
    sessionToken = session.token;

    // demo.install publishes its pages, so the home page starts live: the
    // journey exercises "Publish changes" against a page that is already
    // public, exactly the flow the audit's finding 9 lacked.
    await callService(sessionToken, "demo.install", { publish: true });

    const [home] = await db()
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.slug, ""))
      .limit(1);
    if (!home) throw new Error("The demo fixture did not create its home page.");
    homePageId = home.id;
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("drag the heading below the intro on the canvas → Saved → the public page shows it", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await context.addCookies([
      { name: SESSION_COOKIE, value: sessionToken, url: BASE_URL },
    ]);

    const saved = page.locator('p[role="status"]');
    const canvas = pageFrame(page);
    const canvasBlocks = canvas.locator(".fh-canvas > [data-block-id]");

    await test.step("open the editor on the live home page", async () => {
      await page.goto(`/admin/pages/${homePageId}`);
      await expect(canvas.locator(".fh-canvas h1")).toHaveText(
        "Coastal light, honestly made",
      );
      await expect(canvasBlocks).toHaveCount(6);
      // The gap-8 chrome: the page is live, and pushing edits live is one action.
      await expect(page.getByText("Live", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Publish changes" }),
      ).toBeVisible();
    });

    await test.step("drag the heading below the intro paragraph", async () => {
      // A real DragEvent with a real DataTransfer, dispatched in the frame —
      // the same sequence a pointer drag produces.
      await canvas.locator("[data-block-id='home-h1']").evaluate((block) => {
        const grip = block.querySelector(":scope > .fh-grip");
        grip?.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: new DataTransfer(),
          }),
        );
      });
      // The drop indicator follows the pointer: below the intro's midpoint
      // it offers "after".
      await canvas.locator("[data-block-id='home-intro']").evaluate((block) => {
        const box = block.getBoundingClientRect();
        block.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: box.left + box.width / 2,
            clientY: box.bottom + 20,
          }),
        );
      });
      await expect(canvas.locator("[data-drop='after']")).toBeVisible();
      await canvas.locator("[data-block-id='home-intro']").evaluate((block) => {
        block.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true }));
      });
      await canvas
        .locator("[data-block-id='home-h1'] > .fh-grip")
        .dispatchEvent("dragend");

      // The canvas re-sorts from the draft broadcast, no save round-trip.
      await expect
        .poll(async () => (await canvasOrder(canvas)).slice(0, 3))
        .toEqual(["home-intro", "home-h1", "home-hero"]);
    });

    await test.step("the form panel lists the same order", async () => {
      const introField = page.locator("#home-intro-body");
      const headingField = page.locator("#home-h1-text");
      await expect(introField).toBeVisible();
      await expect(headingField).toBeVisible();
      const [introBox, headingBox] = await Promise.all([
        introField.boundingBox(),
        headingField.boundingBox(),
      ]);
      expect(introBox!.y).toBeLessThan(headingBox!.y);
    });

    await test.step("autosave persists the reorder", async () => {
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });
    });

    await test.step("publish changes and read the public page", async () => {
      const publish = page.getByRole("button", { name: "Publish changes" });
      await publish.click();
      // The action saves then publishes; the button is disabled while it
      // runs, so it returning to idle is the signal both round-trips
      // resolved — navigating any earlier would abort the action.
      await expect(publish).toBeEnabled({ timeout: 15_000 });
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });

      await page.goto("/");
      const intro = page.locator("p", {
        hasText: "Weddings and portraits on the east coast",
      });
      const headline = page.getByRole("heading", {
        level: 1,
        name: "Coastal light, honestly made",
      });
      await expect(intro).toBeVisible();
      await expect(headline).toBeVisible();
      const [introBox, headlineBox] = await Promise.all([
        intro.boundingBox(),
        headline.boundingBox(),
      ]);
      // The intro paragraph now renders above the heading it used to follow.
      expect(introBox!.y).toBeLessThan(headlineBox!.y);
    });
  });

  test("reorder from the keyboard through the canvas grip", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await context.addCookies([
      { name: SESSION_COOKIE, value: sessionToken, url: BASE_URL },
    ]);

    const saved = page.locator('p[role="status"]');
    const canvas = pageFrame(page);

    await test.step("open the editor on the reordered live page", async () => {
      await page.goto(`/admin/pages/${homePageId}`);
      // The previous journey's order persisted: intro, heading, image…
      await expect
        .poll(async () => (await canvasOrder(canvas)).slice(0, 2))
        .toEqual(["home-intro", "home-h1"]);
    });

    await test.step("focus the intro's grip and move it down", async () => {
      const grip = canvas.locator("[data-block-id='home-intro'] > .fh-grip");
      await grip.focus();
      await page.keyboard.press("ArrowDown");

      // The frame re-sorts from the draft broadcast and announces the move
      // where focus already is.
      await expect
        .poll(async () => (await canvasOrder(canvas)).slice(0, 3))
        .toEqual(["home-h1", "home-intro", "home-hero"]);
      await expect(canvas.locator(".fh-sr-only")).toHaveText("Block moved down");
      // The editor's form panel agrees.
      const [headingBox, introBox] = await Promise.all([
        page.locator("#home-h1-text").boundingBox(),
        page.locator("#home-intro-body").boundingBox(),
      ]);
      expect(headingBox!.y).toBeLessThan(introBox!.y);
    });

    await test.step("the keyboard reorder persists too", async () => {
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });
      await page.reload();
      await expect
        .poll(async () => (await canvasOrder(pageFrame(page))).slice(0, 2))
        .toEqual(["home-h1", "home-intro"]);
    });
  });
});
