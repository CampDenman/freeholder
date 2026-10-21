// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.16 in a real browser: permission given, taken back, and still on the
// record afterwards.
//
// The last assertion is the whole change. Before this, revoking set three
// columns back to NULL and the screen simply forgot that anybody had ever
// agreed. Here the grant is still listed, with the method it was given under,
// on the same page that now refuses to publish.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { db } from "@/core/db";
import { THEME_COOKIE } from "@/core/design/theme";
import { contacts } from "@/core/contacts/schema";
import { projects } from "@/modules/projects/schema";
import { closeDb } from "../helpers/spine";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function assertAxe(page: Page, surface: string, theme: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations,
    `${surface} (${theme}) has WCAG A/AA violations:\n${results.violations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join("\n")}`,
  ).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

test("publication permission is given, taken back, and still on the record", async ({
  page,
  context,
}) => {
  const token = await seedC11Owner("Northwater Studio");
  await useOwnerSession(context, token);

  const [client] = await db()
    .insert(contacts)
    .values({ name: "Alex Rivera", email: "alex@example.test" })
    .returning();
  const [work] = await db()
    .insert(projects)
    .values({
      title: "Kitchen refit",
      slug: "kitchen-refit",
      contactId: client!.id,
      status: "complete",
      // `projects_complete_has_time`: finished work has to say when.
      completedAt: new Date("2026-06-01T10:00:00.000Z"),
    })
    .returning();
  if (!work) throw new Error("The project fixture was not created.");

  const path = `/admin/projects/${work.id}`;

  for (const theme of ["light", "dark"] as const) {
    await context.addCookies([
      { name: THEME_COOKIE, value: theme, url: C11_BASE_URL },
    ]);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await assertAxe(page, "project consent", theme);
  }

  // Give it, for a period. Consent with an end date is normal in this domain
  // and was unrepresentable before C8.16.
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/Good until/).fill("2030-01-01");
  await page.getByRole("button", { name: /Record permission|Record consent/i }).click();
  await expect(page.getByText(/Permission recorded|Consent recorded/i)).toBeVisible();

  // Take it back.
  await page.getByRole("button", { name: /Revoke|Withdraw/i }).first().click();

  // The screen now refuses, and says which of the three reasons this is.
  await expect(page.getByText(/was taken back/i)).toBeVisible();

  // And the grant is still there, with the method it was given under — the
  // record a clinic needs to show it published lawfully while it did.
  await page.getByText(/decision/).click();
  const ledger = page.getByRole("listitem").filter({ hasText: /Given|Taken back/ });
  await expect(ledger.filter({ hasText: "Given" }).first()).toBeVisible();
  await expect(ledger.filter({ hasText: "Taken back" }).first()).toBeVisible();

  await assertAxe(page, "project consent after withdrawal", "dark");
});
