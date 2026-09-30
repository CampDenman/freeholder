// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The C2.25 gap-7 proof: the canvas image picker uploads, and crop and focal
// point are set where the picture renders.
//
// Open the home page in the editor, raise the hero image's anchored picker on
// the canvas, upload a new file through it (the media library's own
// resumable pipeline — a reservation, then the transfer, then an Asset), see
// it land on the block at once, open the crop & focus tool on the same
// canvas, mark the subject, choose a square frame and crop around it, let
// the structural save persist it, publish, and read the published page:
// the new file, cropped exactly as the tool showed.
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { API_BASE } from "@/core/api/dispatch";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { users, totpFactors } from "@/core/auth/schema";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { closeDb, db } from "@/core/db";
import { assets, mediaUploads } from "@/core/media/schema";
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

interface HeroProps {
  assetId?: string;
  aspect?: string;
  focalX?: number;
  focalY?: number;
  crop?: { x: number; y: number; w: number; h: number };
}

async function storedHero(pageId: string): Promise<HeroProps | undefined> {
  const [row] = await db().select({ blocks: pages.blocks }).from(pages).where(eq(pages.id, pageId));
  const find = (nodes: unknown): HeroProps | undefined => {
    for (const node of (nodes as Array<{ id: string; props: HeroProps; children?: unknown }>) ?? []) {
      if (node.id === "home-hero") return node.props;
      const nested = find(node.children);
      if (nested) return nested;
    }
    return undefined;
  };
  return find(row?.blocks);
}

test.describe("canvas image upload, crop and focal point", () => {
  let sessionToken = "";
  let homePageId = "";

  test.beforeAll(async () => {
    await resetBrowserDatabase();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner-media-tools@example.test",
      role: "owner",
    });
    await db().insert(totpFactors).values({
      userId: OWNER.userId,
      encryptedSecret: "c225-media-fixture",
    });
    const session = await db().transaction((tx) =>
      createSession(tx, OWNER.userId, { twoFactorVerified: true }),
    );
    sessionToken = session.token;
    await callService(sessionToken, "demo.install", { publish: true });

    const [home] = await db()
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.slug, ""))
      .limit(1);
    if (!home) throw new Error("The demo fixture did not create its home page.");
    homePageId = home.id;
    await callService(sessionToken, "cms.publishPage", { id: homePageId, published: false });
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("upload on the canvas → crop & focus → saved → the published page renders it", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    // Sign-in issues the double-submit CSRF cookie the upload API checks;
    // a fixture session has to carry one the same way.
    await context.addCookies([
      { name: SESSION_COOKIE, value: sessionToken, url: BASE_URL },
      { name: CSRF_COOKIE, value: issueCsrfToken(), url: BASE_URL },
    ]);

    const saved = page.locator('p[role="status"]');
    const canvas = page.frameLocator("iframe[title='Preview']");
    const hero = canvas.locator("[data-block-id='home-hero']");

    await test.step("open the editor", async () => {
      await page.goto(`/admin/pages/${homePageId}`);
      await expect(hero.locator("img")).toBeVisible();
    });

    let uploadedId = "";
    await test.step("upload a new picture from the canvas picker", async () => {
      const originalSrc = (await hero.locator("img").getAttribute("src")) ?? "";
      await hero.getByRole("button", { name: "Replace image" }).click();
      const picker = page.getByRole("dialog", { name: "Replace image" });
      await expect(picker).toBeVisible();

      const png = await sharp({
        create: { width: 1600, height: 900, channels: 3, background: { r: 30, g: 110, b: 160 } },
      })
        .png()
        .toBuffer();
      await picker
        .locator('input[type="file"]')
        .setInputFiles({ name: "harbour-at-dawn.png", mimeType: "image/png", buffer: png });

      // Upload is the pick: the picker closes and the canvas shows the new
      // file before any save round-trip.
      await expect(picker).toBeHidden({ timeout: 30_000 });
      await expect
        .poll(async () => hero.locator("img").getAttribute("src"), { timeout: 15_000 })
        .not.toBe(originalSrc);
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });

      // It went through the pipeline: a reservation completed into an Asset.
      const [asset] = await db()
        .select({ id: assets.id, width: assets.width, status: assets.status })
        .from(assets)
        .where(eq(assets.filename, "harbour-at-dawn.png"));
      expect(asset).toMatchObject({ width: 1600, status: "ready" });
      uploadedId = asset!.id;
      const [upload] = await db()
        .select({ state: mediaUploads.state, assetId: mediaUploads.assetId })
        .from(mediaUploads)
        .where(eq(mediaUploads.assetId, uploadedId));
      expect(upload).toMatchObject({ state: "complete" });
      await expect.poll(async () => (await storedHero(homePageId))?.assetId).toBe(uploadedId);
    });

    await test.step("mark the subject and crop to a square on the canvas", async () => {
      await hero.getByRole("button", { name: "Crop & focus" }).click();
      const tool = page.getByRole("dialog", { name: "Crop and focal point" });
      await expect(tool).toBeVisible();

      // Click the picture a quarter of the way across: the subject.
      const stage = tool.locator("[data-crop-stage]");
      const box = (await stage.boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
      const marker = tool.locator("[data-focal-marker]");
      await expect(marker).toHaveAttribute("aria-label", /Focal point, 2[45]% across, (49|50|51)% down/);

      // The keyboard path works on the same control.
      await marker.focus();
      await page.keyboard.press("ArrowDown");

      await tool.getByLabel("Frame shape").selectOption("square");
      await tool.getByLabel("Crop the picture").check();
      await expect(tool.getByRole("button", { name: "Crop window" })).toBeVisible();
      await expect(tool.locator("[data-crop-preview='crop']")).toBeVisible();
      await tool.getByRole("button", { name: "Apply" }).click();
      await expect(tool).toBeHidden();

      // Structural: saved at once, and the invisible reload shows the
      // server's own rendering of the crop on the canvas.
      await expect
        .poll(async () => (await storedHero(homePageId))?.crop, { timeout: 15_000 })
        .toBeTruthy();
      await expect(hero.locator("img[data-framing='crop']")).toBeVisible({ timeout: 30_000 });
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });
    });

    await test.step("publish and read the public page", async () => {
      const stored = (await storedHero(homePageId))!;
      expect(stored.assetId).toBe(uploadedId);
      expect(stored.aspect).toBe("square");
      expect(stored.focalX).toBeGreaterThan(2000);
      expect(stored.focalX).toBeLessThan(3000);
      // A square window of a 16:9 picture: full height, 9/16 of the width,
      // pulled to the left-hand subject and stopped at the edge.
      expect(stored.crop).toEqual({ x: 0, y: 0, w: 5625, h: 10_000 });

      await page.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible({
        timeout: 15_000,
      });

      await page.goto("/");
      const img = page.locator("img[data-framing='crop']").first();
      await expect(img).toBeVisible();
      // The public page draws the same window the tool showed: a square
      // frame, the picture scaled to 16/9 of it and anchored at the left.
      const frame = (await img.locator("xpath=ancestor::div[contains(@class,'fh-frame')][1]").boundingBox())!;
      expect(Math.abs(frame.width - frame.height)).toBeLessThan(2);
      const style = (await img.getAttribute("style")) ?? "";
      expect(style).toContain("left:0%");
      expect(style).toMatch(/width:177\.7\d*%/);
      // The published picture is the uploaded file.
      const src = (await img.getAttribute("src")) ?? "";
      const [asset] = await db()
        .select({ storageKey: assets.storageKey })
        .from(assets)
        .where(eq(assets.id, uploadedId));
      expect(src).toContain(asset!.storageKey.split("/").pop()!);
    });
  });
});
