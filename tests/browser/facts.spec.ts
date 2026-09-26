// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.15 in a real browser: a figure published with its provenance, corrected
// without erasing, and withdrawn without a trace left on the page.
//
// The last assertion is the one worth having. After a withdrawal the block
// renders *nothing* — not a placeholder, not the previous value, not an em
// dash. A page with nothing to say about a number says nothing about it, and
// that is only believable if somebody has watched it happen.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { db } from "@/core/db";
import { THEME_COOKIE } from "@/core/design/theme";
import { pages } from "@/modules/cms/schema";
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

async function auditBothThemes(page: Page, path: string, surface: string) {
  for (const theme of ["light", "dark"] as const) {
    await page
      .context()
      .addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await assertAxe(page, surface, theme);
  }
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

test("a figure is published with its source, corrected without erasing, then withdrawn", async ({
  page,
  context,
}) => {
  const token = await seedC11Owner("Fieldnote Home Loans");
  await useOwnerSession(context, token);

  await db().insert(pages).values({
    slug: "rates",
    title: "Today's rates",
    status: "published",
    publishedAt: new Date(),
    blocks: [
      {
        id: "rate-block",
        type: "fact",
        props: {
          factKey: "rate.30-year-fixed",
          label: "30-year fixed",
          showHistory: true,
        },
      },
    ],
  });

  // Nothing stated yet, so the page says nothing about the number.
  const visitor = await page.context().browser()!.newContext();
  const visitorPage = await visitor.newPage();
  try {
    await visitorPage.goto("/rates", { waitUntil: "domcontentloaded" });
    await expect(visitorPage.getByText("30-year fixed")).toHaveCount(0);

    await auditBothThemes(page, "/admin/facts", "facts list");

    // Publish it through the form an owner actually uses.
    await page.goto("/admin/facts", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Key").fill("rate.30-year-fixed");
    await page.getByLabel("Value", { exact: true }).fill("6.5%");
    await page.getByLabel("Source", { exact: true }).fill("Lender rate sheet, 12 September");
    await page.getByLabel("True as of").fill("2026-09-12T09:00");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Published.")).toBeVisible();

    // The public page now carries the figure *and* its provenance together.
    await visitorPage.goto("/rates", { waitUntil: "domcontentloaded" });
    await expect(visitorPage.getByText("6.5%")).toBeVisible();
    await expect(visitorPage.getByText(/As of/)).toBeVisible();
    await expect(
      visitorPage.getByText(/Lender rate sheet, 12 September/),
    ).toBeVisible();
    await assertAxe(visitorPage, "fact block", "light");

    await auditBothThemes(
      page,
      "/admin/facts/rate.30-year-fixed",
      "fact ledger",
    );

    // Correct it. The old value must survive.
    await page.goto("/admin/facts/rate.30-year-fixed", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Value", { exact: true }).fill("6.9%");
    await page.getByLabel("Source", { exact: true }).fill("Lender rate sheet, 19 September");
    await page.getByLabel("True as of").fill("2026-09-19T09:00");
    await page.getByLabel("What changed").fill("Weekly rate update.");
    await page.getByRole("button", { name: "Publish the correction" }).click();
    await expect(page.getByText("Published.")).toBeVisible();

    // Both values are on the ledger, and the superseded one is struck through
    // rather than gone.
    await page.goto("/admin/facts/rate.30-year-fixed", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("6.9%").first()).toBeVisible();
    await expect(page.getByText("6.5%").first()).toBeVisible();
    await expect(page.getByText("Weekly rate update.")).toBeVisible();

    // The public page shows the new figure, and the old one under corrections.
    await visitorPage.goto("/rates", { waitUntil: "domcontentloaded" });
    await expect(visitorPage.getByText("6.9%")).toBeVisible();
    await visitorPage.getByRole("group").getByText(/earlier value/).click();
    await expect(visitorPage.getByText("6.5%")).toBeVisible();

    // Withdraw it, and the page goes quiet about the number entirely.
    await page.goto("/admin/facts/rate.30-year-fixed", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByText(/Nothing is currently published/)).toBeVisible();

    await visitorPage.goto("/rates", { waitUntil: "domcontentloaded" });
    await expect(visitorPage.getByText("6.9%")).toHaveCount(0);
    await expect(visitorPage.getByText("30-year fixed")).toHaveCount(0);
    // And nothing took its place.
    await expect(visitorPage.getByText("6.5%")).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});
