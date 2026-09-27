// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: real-browser proof of the hardened public playground — a visitor
// edits and publishes a page, privileged APIs refuse that same visitor, and
// the hourly reset (truncate + reseed, the data-layer twin of
// deploy/docker-selfhost/playground/reset.sh's recreate) signs the visitor
// out, drops their page and leaves a reseeded playground the next visitor can
// edit. The full boot-phase reseed (fresh database + initializePlayground +
// seedDemoIfRequested) is proven service-side in
// tests/core/playground.test.ts; this suite proves the same
// contract through the running server's real surfaces, where container
// recreate is not available.
import { expect, test } from "@playwright/test";
import { closeDb, db } from "@/core/db";
import { pages } from "@/modules/cms/schema";
import { initializePlayground } from "@/core/demo/playground";
import { CSRF_COOKIE, CSRF_HEADER } from "@/core/http/csrf";
import { resetBrowserDatabase } from "./database";

/**
 * The reset the hourly systemd timer runs for the container deployment
 * recreates the disposable database and lets the ordinary boot phases re-run
 * (instrumentation.node.ts). This suite holds one long-lived server process
 * instead of containers, so the same truncate + reseed contract is exercised
 * at the data layer: drop every visitor-visible row, restore the playground
 * identity, and put the sample page back.
 */
async function resetPlaygroundData(): Promise<void> {
  await resetBrowserDatabase();
  await initializePlayground();
  await db().insert(pages).values({ slug: "sample", title: "Reseeded sample page" });
}

test.describe("hardened public playground (C1.38)", () => {
  test.beforeAll(async () => {
    await resetPlaygroundData();
  });
  test.afterAll(async () => {
    // Later browser suites share this database; never leak playground state.
    await resetBrowserDatabase();
    await closeDb();
  });

  test("a visitor edits content, privileged APIs refuse them, and the reset restores a clean playground", async ({ page }) => {
    test.setTimeout(180_000);

    await test.step("the entry page and every surface carry the reset and privacy notice", async () => {
      await page.goto("/playground");
      await expect(
        page.getByRole("heading", { name: "Explore Freeholder" }),
      ).toBeVisible();
      await expect(page.getByText(/resets every hour/i).first()).toBeVisible();
      await expect(
        page.getByText(/do not enter personal information/i),
      ).toBeVisible();

      await page.getByRole("button", { name: "Enter the playground" }).click();
      await expect(page).toHaveURL(/\/admin$/);
      // The banner is in the root layout, so it rides every admin surface too.
      await expect(page.getByText(/resets every hour/i).first()).toBeVisible();
      await page.goto("/admin/pages");
      await expect(page.getByText(/resets every hour/i).first()).toBeVisible();
      await expect(page.getByText("Reseeded sample page")).toBeVisible();
    });

    await test.step("a visitor edits and publishes a page through the real editor", async () => {
      await page.goto("/admin/pages/new");
      await page.getByLabel("Title").fill("Playground proof page");
      await page.getByLabel("Web address").fill("playground-proof");
      await page.getByRole("button", { name: "Create page" }).click();
      await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]+$/);

      await page.getByRole("button", { name: "Add a block" }).click();
      await page.getByRole("button", { name: "Heading", exact: true }).click();
      await page.getByLabel("Text").fill("Visitor written heading");
      await page.getByLabel("Size").selectOption("1");
      await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });

      await page.getByRole("button", { name: "Publish" }).click();
      await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();

      await page.goto("/playground-proof");
      await expect(
        page.getByRole("heading", { name: "Visitor written heading" }),
      ).toBeVisible();
    });

    await test.step("privileged APIs refuse the same visitor server-side", async () => {
      const csrf = (await page.context().cookies()).find(
        (cookie) => cookie.name === CSRF_COOKIE,
      )?.value;
      expect(csrf).toBeTruthy();
      const refused = [
        // Admin: inviting staff.
        ["invitations.create", { email: "intruder@example.test", roleKey: "staff" }],
        // External delivery: testing a mail sender.
        ["mail.testSend", {}],
        // Uploads: staging a file.
        [
          "media.beginUpload",
          { filename: "probe.png", contentType: "image/png", bytes: 1024, provenance: {}, metadata: {} },
        ],
      ] as const;
      for (const [service, data] of refused) {
        const response = await page.request.post(`/api/v1/${service}`, {
          data,
          headers: { [CSRF_HEADER]: csrf! },
        });
        expect(response.status(), service).toBe(403);
        const body = (await response.json()) as {
          error: { code: string; message: string };
        };
        expect(body.error.code, service).toBe("permission");
        expect(body.error.message, service).toContain(
          "unavailable in the public playground",
        );
      }
    });

    await test.step("the hourly reset signs the visitor out and restores a clean playground", async () => {
      await resetPlaygroundData();

      // The old session no longer authorizes: admin sends the visitor back to
      // the entry page, and the visitor's published page is gone.
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/playground$/);
      const gone = await page.goto("/playground-proof");
      expect(gone?.status()).toBe(404);

      // Recovery, not just emptiness: the reseeded sample is back and a new
      // visitor can enter and edit again.
      await page.goto("/playground");
      await page.getByRole("button", { name: "Enter the playground" }).click();
      await expect(page).toHaveURL(/\/admin$/);
      await page.goto("/admin/pages");
      await expect(page.getByText("Reseeded sample page")).toBeVisible();
      await expect(page.getByText("Playground proof page")).toHaveCount(0);

      const fresh = await page.goto("/admin/pages/new");
      expect(fresh?.status()).toBe(200);
    });
  });
});
