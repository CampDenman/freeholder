// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.04 app-free capture path (C10.18 equivalent): /capture/[token] ingest
// becomes a normal Asset. Gallery/social/referral composition is the paired
// vitest chain in tests/core/c11-04-gallery-social-journey.test.ts.
import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { mediaCaptureSessions } from "@/core/media/schema";
import { assets } from "@/core/media/schema";
import { resetBrowserDatabase } from "./database";
import { seedC11Owner, useOwnerSession } from "./owner-session";

test.describe("C11.04 app-free capture", () => {
  let token: string;

  test.beforeAll(async () => {
    token = await seedC11Owner("C11 Capture");
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("phone ingest link uploads, lists the file and confirms an Asset", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await useOwnerSession(context, token);
    await page.goto("/admin/media/record");
    await page.getByRole("button", { name: "Phone upload link" }).click();
    const captureUrl = page.locator("p.font-mono");
    await expect(captureUrl).toBeVisible();
    const href = await captureUrl.textContent();
    expect(href).toMatch(/\/capture\/[A-Za-z0-9_-]+/);

    const pngPath = join(tmpdir(), "c11-harbour.png");
    writeFileSync(
      pngPath,
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#336699" },
      })
        .png()
        .toBuffer(),
    );

    const visitor = await context.browser()!.newContext({
      baseURL: new URL(page.url()).origin,
    });
    try {
      const phone = await visitor.newPage();
      await phone.goto(new URL(href!).pathname);
      await expect(phone.getByRole("heading", { name: "Send a file to the library" })).toBeVisible();
      await phone.getByLabel("Photo or video").setInputFiles(pngPath);
      await phone.getByRole("button", { name: "Upload" }).click();
      await expect(phone.getByRole("button", { name: "Confirm into library" })).toBeVisible({
        timeout: 30_000,
      });
      await phone.getByRole("button", { name: "Confirm into library" }).click();
      await expect(phone.getByText("This file is in the library.")).toBeVisible();
    } finally {
      await visitor.close();
    }

    const pathToken = new URL(href!).pathname.split("/").at(-1)!;
    const [session] = await db()
      .select()
      .from(mediaCaptureSessions)
      .where(eq(mediaCaptureSessions.token, pathToken));
    expect(session?.status).toBe("confirmed");
    expect(session?.assetId).toBeTruthy();
    expect(await db().select().from(assets).where(eq(assets.id, session!.assetId!))).toHaveLength(1);
  });
});
