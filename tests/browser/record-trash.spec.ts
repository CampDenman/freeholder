// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: original records survive keyboard-operated trash and restore.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { notes } from "@/core/notes/schema";
import { tasks } from "@/core/tasks/schema";
import { popups } from "@/modules/popups/schema";
import { roles, roleGrants, users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { businessProfile } from "@/core/settings/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { C11_BASE_URL, C11_OWNER, seedC11Owner, useOwnerSession } from "./owner-session";
import { resetBrowserDatabase } from "./database";

test("owners restore the same notes and tasks and explicitly purge trash", async ({ page, context }) => {
  test.setTimeout(120_000);
  const token = await seedC11Owner("Recovery studio");
  try {
    const [contact] = await db().insert(contacts).values({ name: "Browser recovery customer" }).returning();
    const [note] = await db().insert(notes).values({ subjectType: "contact", subjectId: contact!.id, contactId: contact!.id,
      authorUserId: C11_OWNER.userId, body: "Recover browser note" }).returning();
    const [task] = await db().insert(tasks).values({ title: "Recover browser task" }).returning();
    await useOwnerSession(context, token);
    await page.goto(`/admin/contacts/${contact!.id}`);
    const noteRow = page.locator("li").filter({ has: page.locator(`#note-body-${note!.id}`) });
    await noteRow.getByRole("button", { name: "Move to trash", exact: true }).press("Enter");
    await expect(page.locator(`#note-body-${note!.id}`)).toHaveCount(0);
    await page.locator('a[href="/admin/trash?kind=notes"]').click();
    await expect(page.getByText("Recover browser note", { exact: true })).toBeVisible();
    for (const locale of ["en", "fr", "es"]) {
      await db().update(businessProfile).set({ defaultLocale: locale });
      for (const [width, height] of [[1280, 900], [320, 800]]) {
        await page.setViewportSize({ width: width!, height: height! });
        for (const theme of ["light", "dark"]) {
          await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
          await page.reload();
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }
      }
    }
    await db().update(businessProfile).set({ defaultLocale: "en" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.getByRole("button", { name: "Restore", exact: true }).press("Enter");
    await page.goto(`/admin/contacts/${contact!.id}`);
    await expect(page.locator(`#note-body-${note!.id}`)).toHaveValue("Recover browser note");
    await page.goto("/admin/tasks");
    await page.getByRole("listitem").filter({ hasText: "Recover browser task" }).getByRole("button", { name: "Move to trash", exact: true }).press("Enter");
    await expect(page.getByText("Recover browser task", { exact: true })).toHaveCount(0);
    await page.locator('a[href="/admin/trash?kind=tasks"]').click();
    await page.getByRole("button", { name: "Restore", exact: true }).press("Enter");
    await page.goto("/admin/tasks");
    await expect(page.getByText("Recover browser task", { exact: true })).toBeVisible();
    expect((await db().select().from(tasks).where(eq(tasks.id, task!.id)))[0]?.trashedAt).toBeNull();
    await page.goto(`/admin/contacts/${contact!.id}`);
    await noteRow.getByRole("button", { name: "Move to trash", exact: true }).press("Enter");
    await page.locator('a[href="/admin/trash?kind=notes"]').click();
    await page.getByLabel("Type PURGE to permanently delete").fill("PURGE");
    await page.getByRole("button", { name: "Delete permanently", exact: true }).press("Enter");
    await expect(page.getByRole("status")).toContainText("Permanently deleted.");
    expect(await db().select().from(notes).where(eq(notes.id, note!.id))).toHaveLength(0);
  } finally { await resetBrowserDatabase(); await closeDb(); }
});

test("owners trash and restore a popup from its admin surface and the trash screen", async ({ page, context }) => {
  test.setTimeout(120_000);
  const token = await seedC11Owner("Popup recovery studio");
  try {
    // Service calls boot the job graph, which this process cannot wire —
    // fixtures are inserts, like the rest of the browser suite.
    const [popup] = await db().insert(popups).values({
      slug: "browser-recovery-popup",
      name: "Browser recovery popup",
      title: "Browser recovery popup",
    }).returning();
    await useOwnerSession(context, token);
    await page.goto("/admin/popups");
    const row = page.locator("li").filter({ hasText: "Browser recovery popup" });
    await row.getByRole("button", { name: "Move to trash", exact: true }).press("Enter");
    await expect(page.locator("li").filter({ hasText: "Browser recovery popup" })).toHaveCount(0);
    expect((await db().select().from(popups).where(eq(popups.id, popup!.id)))[0]?.trashedAt).not.toBeNull();

    await page.goto("/admin/trash?kind=popups");
    await expect(page.getByText("Browser recovery popup", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).press("Enter");
    await expect(page.getByRole("status")).toContainText("Restored.");
    expect((await db().select().from(popups).where(eq(popups.id, popup!.id)))[0]?.trashedAt).toBeNull();
    await page.goto("/admin/popups");
    await expect(page.locator("li").filter({ hasText: "Browser recovery popup" })).toBeVisible();
  } finally { await resetBrowserDatabase(); await closeDb(); }
});

test("view-only staff can read permitted trash without management controls or private notes", async ({ page, context }) => {
  await seedC11Owner("Recovery access studio");
  try {
    const [contact] = await db().insert(contacts).values({ name: "Trash access customer" }).returning();
    await db().insert(notes).values([
      { subjectType: "contact", subjectId: contact!.id, contactId: contact!.id, authorUserId: C11_OWNER.userId, body: "Team trash note", trashedAt: new Date() },
      { subjectType: "contact", subjectId: contact!.id, contactId: contact!.id, authorUserId: C11_OWNER.userId, body: "Private trash note", visibility: "private", trashedAt: new Date() },
    ]);
    await db().insert(tasks).values({ title: "Visible trash task", trashedAt: new Date() });
    await db().insert(roles).values({ key: "trash-reader", name: "Trash reader" });
    await db().insert(roleGrants).values(["admin", "notes", "tasks"].map(module => ({ roleKey: "trash-reader", module, access: "view" as const })));
    const [reader] = await db().insert(users).values({ email: "trash-reader@example.test", role: "trash-reader" }).returning();
    await db().insert(totpFactors).values({ userId: reader!.id, encryptedSecret: "trash-browser-fixture" });
    const session = await db().transaction(tx => createSession(tx, reader!.id, { twoFactorVerified: true }));
    await useOwnerSession(context, session.token);
    await page.goto("/admin/trash?kind=notes");
    await expect(page.getByText("Team trash note", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain("Private trash note");
    await expect(page.getByRole("main").locator("form")).toHaveCount(0);
    await page.goto("/admin/trash?kind=tasks");
    await expect(page.getByText("Visible trash task", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").locator("form")).toHaveCount(0);
    await page.locator('a[href="/admin/tasks"]').press("Enter");
    await expect(page).toHaveURL(/\/admin\/tasks$/);
    await expect(page.getByRole("button", { name: "Add it", exact: true })).toHaveCount(0);
  } finally { await resetBrowserDatabase(); await closeDb(); }
});
