// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.26 and C6.18 in a real browser.
//
// Two things are being watched for here. A figure never appears without the
// assumptions that produced it, and the moment the published rate behind it
// stops standing the page stops answering — it does not fall back to the last
// number it saw, which is the failure a visitor could never detect.
//
// The coverage block is the same argument about geography: "we have not listed
// postcodes, so we cannot say from here" is a real answer, and a better one
// than a guess in the business's voice.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { db } from "@/core/db";
import { THEME_COOKIE } from "@/core/design/theme";
import { businessLocations, serviceAreas } from "@/core/locations/schema";
import { pages } from "@/modules/cms/schema";
import { attestations } from "@/core/attestations/schema";
import { calculators } from "@/modules/calculators/schema";
import { eq } from "drizzle-orm";
import { closeDb } from "../helpers/spine";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const RATE_KEY = "rate.30-year-fixed";

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

test("a figure arrives with its assumptions, and stops when its rate does", async ({
  page,
  context,
}) => {
  const token = await seedC11Owner("Fieldnote Home Loans");
  await useOwnerSession(context, token);

  // Seeded with inserts, not service calls: `owner-session.ts` says why —
  // `service.call` boots the job graph in a way Playwright's test process
  // cannot wire, and every other browser spec seeds the same way.
  const [fact] = await db()
    .insert(attestations)
    .values({
      key: RATE_KEY,
      value: 6,
      source: "Lender rate sheet, 12 September",
      asOf: new Date("2026-09-12T09:00:00.000Z"),
      publishedAt: new Date("2026-09-12T09:00:00.000Z"),
    })
    .returning();

  const [made] = await db()
    .insert(calculators)
    .values({
      slug: "monthly-interest",
      name: "Monthly interest",
      intro: "A rough monthly interest figure.",
      inputs: [
        { key: "amount", label: "How much are you borrowing?", min: 1000, max: 2000000 },
      ],
      steps: [
        {
          key: "yearly",
          label: "Interest for a year",
          op: "percentOf",
          first: { kind: "input", key: "amount" },
          second: { kind: "fact", factKey: RATE_KEY },
        },
        {
          key: "monthly",
          label: "Interest for a month",
          op: "divide",
          first: { kind: "step", key: "yearly" },
          second: { kind: "literal", value: 12 },
        },
      ],
      resultLabel: "Interest each month",
      resultUnit: "$",
      assumptions:
        "Interest only, before fees and insurance. Not a quote and not an offer of credit.",
      status: "active",
    })
    .returning();
  if (!made || !fact) throw new Error("The calculator fixtures were not created.");

  // A location that has listed its postcodes, so coverage is checkable.
  const [shop] = await db()
    .insert(businessLocations)
    .values({ name: "Courtenay", slug: "courtenay", country: "CA" })
    .returning();
  await db().insert(serviceAreas).values({
    locationId: shop!.id,
    kind: "postal_codes",
    postalCodes: ["V9N3A1"],
  });

  await db().insert(pages).values({
    slug: "tools",
    title: "Tools",
    status: "published",
    publishedAt: new Date(),
    blocks: [
      { id: "calc", type: "calculator", props: { calculatorSlug: "monthly-interest" } },
      { id: "cov", type: "coverageCheck", props: {} },
    ],
  });

  const visitor = await page.context().browser()!.newContext();
  const visitorPage = await visitor.newPage();
  try {
    for (const theme of ["light", "dark"] as const) {
      await visitor.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
      await visitorPage.goto("/tools", { waitUntil: "domcontentloaded" });
      await assertAxe(visitorPage, "calculator and coverage blocks", theme);
    }

    // Work it out.
    await visitorPage.goto("/tools", { waitUntil: "domcontentloaded" });
    await visitorPage.getByLabel(/How much are you borrowing/).fill("400000");
    await visitorPage.getByRole("button", { name: /Work it out/i }).click();

    await expect(visitorPage.getByText("Interest each month")).toBeVisible();
    await expect(visitorPage.getByText("$2,000")).toBeVisible();
    // The caveats arrive with the figure, never after it.
    await expect(visitorPage.getByText(/Not a quote and not an offer of credit/)).toBeVisible();
    await expect(visitorPage.getByText(/2026-09-12/)).toBeVisible();
    await assertAxe(visitorPage, "calculator result", "dark");

    // Coverage: a listed postcode, and one that is not.
    await visitorPage.getByLabel("Postcode").fill("V9N 3A1");
    await visitorPage.getByRole("button", { name: /^Check$/ }).click();
    await expect(visitorPage.getByText(/Courtenay covers V9N3A1/)).toBeVisible();

    await visitorPage.getByLabel("Postcode").fill("V8W 1A1");
    await visitorPage.getByRole("button", { name: /^Check$/ }).click();
    await expect(visitorPage.getByText(/outside the areas we have listed/)).toBeVisible();

    // Now take the rate away. The page must stop answering rather than carry
    // on with the number it used a moment ago.
    await db()
      .update(attestations)
      .set({ withdrawnAt: new Date() })
      .where(eq(attestations.id, fact.id));

    await visitorPage.goto(
      "/tools?calc=monthly-interest&c_amount=400000",
      { waitUntil: "domcontentloaded" },
    );
    await expect(visitorPage.getByText("$2,000")).toHaveCount(0);
    await expect(visitorPage.getByText(new RegExp(RATE_KEY))).toBeVisible();
  } finally {
    await visitor.close();
  }

  // The admin surfaces, in both themes.
  for (const theme of ["light", "dark"] as const) {
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
    await page.goto("/admin/calculators", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await assertAxe(page, "calculators list", theme);

    await page.goto(`/admin/calculators/${made.id}`, { waitUntil: "domcontentloaded" });
    await assertAxe(page, "calculator builder", theme);
  }
});
