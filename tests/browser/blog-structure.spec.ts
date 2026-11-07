// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.27–C2.29: real owner forms and moderated reader output, both themes.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { THEME_COOKIE } from "@/core/design/theme";
import { seedC11Owner, useOwnerSession, C11_BASE_URL } from "./owner-session";

test("an owner organizes a post, reviews a reader comment and keeps email private", async ({ page, context }) => {
  test.setTimeout(240000);
  await useOwnerSession(context, await seedC11Owner("Blog qualification"));
  await page.goto("/admin/blog/authors");
  await page.getByLabel("Name", { exact: true }).fill("A Guest Writer");
  await page.getByLabel("Email (private)", { exact: true }).fill("writer-private@example.test");
  await page.getByLabel("Biography", { exact: true }).fill("Writes from the studio.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto("/admin/blog/categories");
  await page.getByLabel("Name", { exact: true }).fill("Studio Journal");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto("/admin/blog");
  await page.getByLabel("Title", { exact: true }).fill("A moderated studio story");
  await page.getByLabel("Web address", { exact: true }).fill("moderated-studio-story");
  await page.getByRole("button", { name: "Create draft post", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/pages\/[a-f0-9-]+$/);
  await page.getByLabel("Author", { exact: true }).selectOption({ label: "A Guest Writer" });
  await page.getByLabel("Studio Journal", { exact: true }).check();
  await page.getByRole("region", { name: "Blog post settings", exact: true }).getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await page.goto("/blog/moderated-studio-story");
  await expect(page.getByRole("link", { name: "A Guest Writer", exact: true }).first()).toBeVisible();
  expect(await page.content()).not.toContain("writer-private@example.test");
  await page.getByLabel("Name", { exact: true }).fill("A Reader");
  await page.getByLabel("Email (private)", { exact: true }).fill("reader-private@example.test");
  await page.getByLabel("Comment", { exact: true }).fill("This reader comment waits for approval. <img src=x alt=unexpected>");
  await page.getByRole("button", { name: "Submit for approval", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Your comment is awaiting moderation.");
  expect(await page.content()).not.toContain("This reader comment waits for approval. <img src=x alt=unexpected>");
  await page.goto("/admin/blog/comments?status=pending");
  await expect(page.getByText("This reader comment waits for approval. <img src=x alt=unexpected>", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("approved");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.goto("/blog/moderated-studio-story");
  await expect(page.getByText("This reader comment waits for approval. <img src=x alt=unexpected>", { exact: true })).toBeVisible();
  expect(await page.content()).not.toContain("reader-private@example.test");
  await expect(page.locator("#comments img")).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
    await page.reload();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  }
  const response = await page.request.get("/blog/moderated-studio-story/", { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers().location).toBe(`${C11_BASE_URL}/blog/moderated-studio-story`);
});

test.afterAll(async () => { const { closeDb } = await import("@/core/db"); await closeDb(); });
