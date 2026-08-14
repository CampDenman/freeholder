// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Real-browser proof that one person can load, inspect, reload, reset and
// exactly purge a visibly isolated scenario without repository knowledge.
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { db, closeDb } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { pages } from "@/modules/cms/schema";
import { forms } from "@/modules/forms/schema";
import { resetBrowserDatabase } from "./database";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3100";
const OWNER_ID = "21000000-0000-4000-8000-000000000001";

test.describe("deterministic demo scenario journey", () => {
  let token: string;

  test.beforeAll(async () => {
    await resetBrowserDatabase();
    await db().insert(businessProfile).values({
      name: "Scenario Workshop",
      country: "CA",
      baseCurrency: "CAD",
      timezone: "America/Vancouver",
      setupCompletedAt: new Date(),
    });
    await db().insert(users).values({
      id: OWNER_ID,
      email: "scenario-owner@example.test",
      role: "owner",
    });
    await db().insert(totpFactors).values({
      userId: OWNER_ID,
      encryptedSecret: "scenario-browser-fixture",
    });
    const session = await db().transaction((tx) =>
      createSession(tx, OWNER_ID, { twoFactorVerified: true }),
    );
    token = session.token;
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("runs the complete localized lifecycle and preserves untracked records", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, url: BASE_URL },
    ]);
    await page.goto("/admin/demos");
    await expect(
      page.getByRole("heading", { level: 1, name: "Demo scenarios" }),
    ).toBeVisible();
    await expect(page.getByText("Current-module foundation")).toBeVisible();
    await expect(page.getByText(/tied to exact run provenance/i)).toBeVisible();

    await page.getByRole("button", { name: "Load scenario" }).click();
    await expect(page.getByText(/scenario is loaded/i)).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText(/generation 1/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /example page appears/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /enquiry form appears/i })).toBeVisible();

    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByText(/new verified generation/i)).toBeVisible();
    await expect(page.getByText(/generation 2/i)).toBeVisible();

    await page.getByLabel("Fixture language").selectOption("fr");
    await page.getByRole("button", { name: "Reset fresh" }).click();
    await expect(page.getByText(/fresh verified demo run/i)).toBeVisible();
    await expect(page.getByText(/Français, generation 1/i)).toBeVisible();
    await page.getByRole("link", { name: /example page appears/i }).click();
    await expect(page.getByText("[Demo] Un premier projet clair")).toBeVisible();

    await db().insert(pages).values({
      slug: "real-browser-page",
      title: "Untracked real page",
      blocks: [],
    });
    await db().insert(forms).values({
      slug: "real-browser-form",
      name: "Untracked real form",
      fields: [],
    });

    await page.goto("/admin/demos");
    await page.getByRole("button", { name: "Purge demo" }).click();
    await expect(page.getByText(/tracked demo records were purged/i)).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();

    expect(
      await db().select().from(pages).where(eq(pages.slug, "real-browser-page")),
    ).toHaveLength(1);
    expect(
      await db().select().from(forms).where(eq(forms.slug, "real-browser-form")),
    ).toHaveLength(1);
    expect(
      await db().select().from(pages).where(eq(pages.slug, "freeholder-demo-project")),
    ).toHaveLength(0);
    expect(
      await db().select().from(forms).where(eq(forms.slug, "freeholder-demo-enquiry")),
    ).toHaveLength(0);
  });
});
