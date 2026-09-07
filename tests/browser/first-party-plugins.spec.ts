// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Real-browser proof that first-party plugins have owner and visitor surfaces (C3.13).
import { expect, test } from "@playwright/test";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { contacts } from "@/core/contacts/schema";
import { db, closeDb } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { resetBrowserDatabase } from "./database";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3100";
const OWNER_ID = "21000000-0000-4000-8000-000000000021";
const CONTACT_ID = "21000000-0000-4000-8000-000000000022";

test.describe("first-party plugin journeys", () => {
  let token: string;

  test.beforeAll(async () => {
    await resetBrowserDatabase();
    await db().insert(businessProfile).values({
      name: "Plugin Workshop",
      country: "CA",
      baseCurrency: "CAD",
      timezone: "America/Vancouver",
      setupCompletedAt: new Date(),
    });
    await db().insert(users).values({
      id: OWNER_ID,
      email: "plugin-owner@example.test",
      role: "owner",
    });
    await db().insert(totpFactors).values({
      userId: OWNER_ID,
      encryptedSecret: "plugin-browser-fixture",
    });
    await db().insert(contacts).values({
      id: CONTACT_ID,
      name: "Jordan Hale",
      email: "jordan.plugins@example.test",
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

  test("owner creates a registry, visitor sees the public list", async ({ page, context }) => {
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE_URL }]);
    await page.goto("/admin/gifts");
    await expect(page.getByRole("heading", { level: 1, name: "Gift registries" })).toBeVisible();
    await expect(page.getByText("No gift registries yet.")).toBeVisible();

    await page.getByLabel("Contact").selectOption(CONTACT_ID);
    await page.getByLabel("Title").fill("Sitting gifts");
    await page.getByLabel("Slug").fill("sitting-gifts");
    await page.getByRole("button", { name: "Create registry" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByText("Sitting gifts")).toBeVisible();
    await expect(page.getByText("No items on this registry yet.")).toBeVisible();

    await page.getByLabel("Item").fill("Harbour print");
    await page.getByLabel("Amount (minor units)").fill("2500");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Harbour print")).toBeVisible();

    await page.goto("/gifts/sitting-gifts");
    await expect(page.getByRole("heading", { level: 1, name: "Sitting gifts" })).toBeVisible();
    await expect(page.getByText("Harbour print")).toBeVisible();
    await expect(page.getByRole("button", { name: "I will take this" })).toBeVisible();
  });
});
