// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.14 in a real browser: the coverage refusal, the authored outcome, and
// WCAG A/AA on every surface this feature adds, in both themes.
//
// The unit suite proves the service refuses. This proves an owner is actually
// *told*, in the screen where they can fix it — which is the difference
// between a safe engine and a safe product. It also proves the thing the whole
// module exists for end to end: the words a visitor reads are the words the
// owner typed, having travelled through a redirect that carries only a key.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { THEME_COOKIE } from "@/core/design/theme";
import { pages } from "@/modules/cms/schema";
import {
  assessments,
  assessmentBands,
  assessmentEscalations,
} from "@/modules/assessments/schema";
import { closeDb } from "../helpers/spine";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const QUESTIONS = [
  {
    key: "symptom",
    label: "What is happening?",
    kind: "single",
    required: true,
    options: [
      { key: "no_heat", label: "No heat", score: 2 },
      { key: "noise", label: "An unusual noise", score: 1 },
      { key: "gas_smell", label: "I can smell gas", score: 5 },
    ],
  },
];

async function assertAxe(page: Page, surface: string, theme: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations,
    `${surface} (${theme}) has WCAG A/AA violations:\n${results.violations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join("\n")}`,
  ).toEqual([]);
}

/** Every surface this feature adds, audited in the viewer's own theme. */
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

test("an owner is refused a gap, fixes it, and a visitor reads the authored words", async ({
  page,
  context,
}) => {
  const token = await seedC11Owner("Clearseason Heating");
  await useOwnerSession(context, token);

  const [made] = await db()
    .insert(assessments)
    .values({
      slug: "boiler-check",
      name: "Boiler check",
      intro: "Five questions. We will tell you what we would do next.",
      questions: QUESTIONS,
      status: "draft",
    })
    .returning();
  if (!made) throw new Error("The assessment fixture was not created.");

  // Deliberately short: 0 to 3 leaves 4 and 5 with no authored outcome, which
  // is what publishing has to refuse.
  await db().insert(assessmentBands).values({
    assessmentId: made.id,
    key: "routine",
    label: "Routine",
    body: "Book a routine visit and we will look at it.",
    minScore: 0,
    maxScore: 3,
  });

  await auditBothThemes(page, "/admin/assessments", "assessments list");
  await auditBothThemes(page, `/admin/assessments/${made.id}`, "assessment detail");
  await auditBothThemes(page, `/admin/assessments/${made.id}/edit`, "assessment questions");

  // The gap is named where it can be fixed, before anybody tries to publish.
  await page.goto(`/admin/assessments/${made.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/No outcome covers 4 to 5/i)).toBeVisible();

  // And publishing is refused, in the same words, beside the button.
  await page.getByRole("button", { name: /open to visitors/i }).click();
  await expect(page.getByText(/scores no band covers/i)).toBeVisible();

  await db().insert(assessmentBands).values({
    assessmentId: made.id,
    key: "urgent",
    label: "Urgent",
    body: "Call us today and we will come out.",
    minScore: 4,
    maxScore: 5,
  });
  await db().insert(assessmentEscalations).values({
    assessmentId: made.id,
    questionKey: "symptom",
    optionKey: "gas_smell",
    instruction: "Leave the building and call the gas emergency line now.",
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Every score from 1 to 5 has an outcome/i)).toBeVisible();
  await page.getByRole("button", { name: /open to visitors/i }).click();
  await expect(page.getByText(/stop accepting answers/i)).toBeVisible();

  // The public half: a page carrying the block, answered by a stranger.
  await db().insert(pages).values({
    slug: "boiler",
    title: "Boiler check",
    status: "published",
    publishedAt: new Date(),
    blocks: [
      {
        id: "boiler-assessment",
        type: "assessment",
        props: { assessmentSlug: "boiler-check" },
      },
    ],
  });

  const visitor = await page.context().browser()!.newContext();
  const visitorPage = await visitor.newPage();
  try {
    for (const theme of ["light", "dark"] as const) {
      await visitor.addCookies([
        { name: THEME_COOKIE, value: theme, url: C11_BASE_URL },
      ]);
      await visitorPage.goto("/boiler", { waitUntil: "domcontentloaded" });
      await assertAxe(visitorPage, "assessment block", theme);
    }

    await visitorPage.goto("/boiler", { waitUntil: "domcontentloaded" });
    await visitorPage.getByLabel("An unusual noise").check();
    await visitorPage.getByRole("button", { name: /see my result/i }).click();

    // The owner's sentence, verbatim, having crossed a redirect that carried
    // only the band's key.
    await expect(
      visitorPage.getByText("Book a routine visit and we will look at it."),
    ).toBeVisible();
    await assertAxe(visitorPage, "assessment outcome", "light");

    // An escalating answer outranks a low score, and says what to do.
    await visitorPage.goto("/boiler", { waitUntil: "domcontentloaded" });
    await visitorPage.getByLabel("I can smell gas").check();
    await visitorPage.getByRole("button", { name: /see my result/i }).click();
    await expect(
      visitorPage.getByText("Leave the building and call the gas emergency line now."),
    ).toBeVisible();
  } finally {
    await visitor.close();
  }

  // The owner sees it, marked as the one to look at today.
  await page.goto(`/admin/assessments/${made.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Escalated/i).first()).toBeVisible();

  const [stored] = await db()
    .select()
    .from(assessments)
    .where(eq(assessments.id, made.id));
  expect(stored?.status).toBe("active");
});
