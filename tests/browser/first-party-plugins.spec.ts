// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Real-browser proof that first-party plugins have owner and visitor surfaces (C3.13).
import { randomUUID } from "node:crypto";
import { communitySpaces, communityRooms, communityMembers, communityPosts } from "../../plugins/community/schema";
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
    await expect(page.getByRole("link", { name: "Sitting gifts" })).toBeVisible();
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

  test("owner configures a Printify product and variant", async ({ page, context }) => {
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE_URL }]);
    await page.goto("/admin/print-on-demand");
    await expect(page.getByRole("heading", { name: "Printify connection" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Printify setup guide" })).toHaveAttribute("href", "https://developers.printify.com/#access-the-printify-api");
    await page.locator("#pod-map-sku").fill("browser-mug");
    await page.locator("#pod-map-product").fill("product-browser-123");
    await page.locator("#pod-map-variant").fill("17887");
    await page.locator("form").filter({ has: page.locator("#pod-map-sku") }).getByRole("button").click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByText("browser-mug → printify / product-browser-123 / 17887")).toBeVisible();
    await expect(page.getByRole("link", { name: "View orders", exact: true })).toBeVisible();
  });

  test("marketplace setup explains draft imports and refuses unconfigured access", async ({ page, context }) => {
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE_URL }]);
    await page.goto("/admin/marketplace");
    await expect(page.getByRole("heading", { name: "Shopify configuration" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Shopify setup guide" })).toBeVisible();
    await expect(page.getByText(/Paid, non-test Shopify orders become draft invoices/)).toBeVisible();
    await page.locator("#mkt-name").fill("Browser Shopify");
    await page.locator("form").filter({ has: page.locator("#mkt-name") }).getByRole("button").click();
    await expect(page.getByText("Browser Shopify", { exact: true })).toBeVisible();
    await expect(page.getByText(/No live marketplace provider is configured/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  });

  test("Daily setup refuses unconfigured rooms without reporting a live call", async ({ page, context }) => {
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE_URL }]);
    await page.goto("/admin/voice-video");
    await expect(page.getByRole("heading", { name: "Daily setup" })).toBeVisible();
    await expect(page.getByText(/Set DAILY_API_KEY and DAILY_DOMAIN/)).toBeVisible();
    await expect(page.locator("#vv-provider")).toHaveValue("daily");
    await page.locator("#vv-contact").selectOption(CONTACT_ID);
    await page.locator("#vv-title").fill("Browser consultation");
    await page.locator("form").filter({ has: page.locator("#vv-title") }).getByRole("button").click();
    await expect(page.getByText(/No live voice\/video provider is configured/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open as host" })).toHaveCount(0);
  });

  test("gated communities use the signed-in member, never a supplied email", async ({ page, context }) => {
    test.setTimeout(90_000);
    const memberUserId = randomUUID();
    const outsiderUserId = randomUUID();
    const memberContactId = randomUUID();
    const outsiderContactId = randomUUID();
    const spaceId = randomUUID();
    const roomId = randomUUID();
    await db().insert(users).values([
      { id: memberUserId, email: "verified-member@example.test", role: "customer" },
      { id: outsiderUserId, email: "outsider@example.test", role: "customer" },
    ]);
    await db().insert(contacts).values([
      { id: memberContactId, userId: memberUserId, name: "Verified Member", email: "verified-member@example.test" },
      { id: outsiderContactId, userId: outsiderUserId, name: "Outsider", email: "outsider@example.test" },
    ]);
    await db().insert(communitySpaces).values({ id: spaceId, slug: "private-browser", title: "Private browser circle", access: "gated" });
    await db().insert(communityRooms).values({ id: roomId, spaceId, slug: "general", title: "General" });
    await db().insert(communityMembers).values({ spaceId, contactId: memberContactId });
    await db().insert(communityPosts).values({ roomId, contactId: memberContactId, body: "Confidential community discussion" });
    const forgedUrl = "/community/private-browser?email=verified-member%40example.test";
    await page.goto(forgedUrl);
    await expect(page.getByText("Confidential community discussion")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in to read or post as a community member." })).toBeVisible();

    const outsiderSession = await db().transaction((tx) => createSession(tx, outsiderUserId));
    await context.addCookies([{ name: SESSION_COOKIE, value: outsiderSession.token, url: BASE_URL }]);
    await page.goto(forgedUrl);
    await expect(page.getByText("Confidential community discussion")).toHaveCount(0);

    const memberSession = await db().transaction((tx) => createSession(tx, memberUserId));
    await context.addCookies([{ name: SESSION_COOKIE, value: memberSession.token, url: BASE_URL }]);
    await page.goto("/community/private-browser");
    await expect(page.getByText("Confidential community discussion")).toBeVisible();
    await page.locator("#community-post-body").fill("A verified member reply");
    await page.locator("form").filter({ has: page.locator("#community-post-body") }).getByRole("button", { name: "Post", exact: true }).click();
    await expect(page.getByText("A verified member reply", { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/email=/);
  });

});
