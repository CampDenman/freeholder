// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.37 in a real browser.
//
// The send itself — consent at the moment of sending, batches, webhooks — is
// proved in tests/modules/broadcasts.test.ts. What only a browser can show is
// the owner's path: the audience count before they choose, a test copy, the
// skip count when they start, and the archive a visitor reads. Jobs are off
// in this suite, so a started campaign stays on "still to go" until the
// worker runs; that row is the outcome the screen can show here.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { THEME_COOKIE } from "@/core/design/theme";
import { contacts } from "@/core/contacts/schema";
import { consentRecords } from "@/core/privacy/schema";
import { mailDeliveries, mailSenders, mailSuppressions } from "@/core/mail/schema";
import { pages } from "@/modules/cms/schema";
import { segmentMembers, segments } from "@/core/segments/schema";
import { emailTemplates } from "@/modules/newsletters/template-schema";
import { newsletterIssues, newsletters } from "@/modules/newsletters/schema";
import { closeDb } from "../helpers/spine";
import { C11_BASE_URL, C11_OWNER, seedC11Owner, useOwnerSession } from "./owner-session";

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

async function bothThemes(page: Page, surface: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await assertAxe(page, surface, theme);
  }
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

test("an owner sees who can be mailed, sends a test, and starts with the skip count", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const token = await seedC11Owner("Aurora Coast Studio");
  await useOwnerSession(context, token);

  const people = await db()
    .insert(contacts)
    .values([
      { name: "Granted Reader", email: "granted@example.test" },
      { name: "Silent Reader", email: "silent@example.test" },
      { name: "Blocked Reader", email: "blocked@example.test" },
    ])
    .returning();
  const granted = people.find((person) => person.email === "granted@example.test");
  const blocked = people.find((person) => person.email === "blocked@example.test");
  if (!granted || !blocked) throw new Error("the audience fixture was not created");
  await db().insert(consentRecords).values([
    {
      contactId: granted.id,
      purpose: "marketing",
      channel: "email",
      state: "granted",
      method: "double_opt_in",
      actor: "browser-fixture",
    },
    {
      contactId: blocked.id,
      purpose: "marketing",
      channel: "email",
      state: "granted",
      method: "double_opt_in",
      actor: "browser-fixture",
    },
  ]);
  await db().insert(mailSuppressions).values({
    email: "blocked@example.test",
    reason: "manual",
    provider: "manual",
    active: true,
  });
  const [segment] = await db()
    .insert(segments)
    .values({
      name: "Studio readers",
      slug: "studio-readers",
      kind: "static",
      definition: { match: "all", rules: [{ field: "contact.email", op: "isSet" }] },
      capturedAt: new Date(),
      createdBy: C11_OWNER.userId,
    })
    .returning();
  await db().insert(segmentMembers).values(
    people.map((person) => ({ segmentId: segment!.id, contactId: person.id })),
  );
  const [template] = await db()
    .insert(emailTemplates)
    .values({
      kind: "campaign",
      name: "October note",
      subject: "October note",
      blocks: [{ type: "text", props: { body: "Hello from the studio." } }],
      variables: [],
      status: "active",
      createdByUserId: C11_OWNER.userId,
    })
    .returning();
  await db().insert(mailSenders).values({
    purpose: "bulk",
    provider: "resend",
    email: "news@example.test",
    verificationStatus: "verified",
    status: "active",
    isDefault: true,
    verificationDetail: { domain: "example.test", dkim: true },
    createdBy: C11_OWNER.userId,
  });

  await page.goto("/admin/newsletters/broadcasts");
  await expect(page.getByText("1 of 3 can receive this now")).toBeVisible();
  await expect(page.getByText("2 will be skipped")).toBeVisible();
  await bothThemes(page, "broadcast compose");

  await page.getByLabel("Name", { exact: true }).fill("October letter");
  await page.getByLabel("Audience", { exact: true }).selectOption({ label: "Studio readers" });
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/newsletters\/broadcasts\/[0-9a-f-]+/);
  await expect(page.getByText("Campaign mail is ready.")).toBeVisible();
  await expect(page.getByRole("link", { name: "What sender verification checks" })).toHaveAttribute(
    "href",
    "/admin/settings#mail-verification",
  );

  await page.getByLabel("Send one copy to", { exact: true }).fill("owner@example.test");
  await page.getByRole("button", { name: "Send test", exact: true }).click();
  await expect(page.getByText("Test sent.", { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const rows = await db()
        .select({ recipient: mailDeliveries.recipient })
        .from(mailDeliveries)
        .where(eq(mailDeliveries.recipient, "owner@example.test"));
      return rows.length;
    })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("1 of 3 can be mailed now")).toBeVisible();
  await expect(page.getByText("2 will be skipped when each copy goes out")).toBeVisible();
  await expect(page.getByText("granted@example.test")).toBeVisible();
  await expect(page.getByText("Still to go").first()).toBeVisible();
  await bothThemes(page, "broadcast detail");

  await page.goto(`/admin/newsletters/templates?template=${template!.id}`);
  await expect(page.getByText("Sends one copy of this wording")).toBeVisible();
  await page.getByLabel("Send one copy to", { exact: true }).fill("editor@example.test");
  await page.getByRole("button", { name: "Send test", exact: true }).click();
  await expect(page.getByText("Test sent.", { exact: true })).toBeVisible();
  await bothThemes(page, "template editor");

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "What to do when a sender is not verified" })).toBeVisible();
  await expect(page.getByText("DKIM: Verified")).toBeVisible();
  await bothThemes(page, "mail settings");
});

test("the public archive shows a published issue", async ({ page }) => {
  test.setTimeout(120_000);
  await seedC11Owner("Aurora Coast Studio");
  const [newsletter] = await db()
    .insert(newsletters)
    .values({
      name: "The Aurora Coast Letter",
      slug: "aurora-coast-letter",
      description: "Notes from the studio.",
      status: "active",
    })
    .returning();
  const [issue] = await db()
    .insert(newsletterIssues)
    .values({
      newsletterId: newsletter!.id,
      slug: "first-light",
      title: "First light on the coast",
      excerpt: "What the morning looked like from the strait.",
      body: "The strait was silver before the ferry.",
      status: "published",
      publishedAt: new Date(),
    })
    .returning();
  await db().insert(pages).values({
    slug: "newsletters",
    title: "Studio newsletters",
    status: "published",
    publishedAt: new Date(),
    blocks: [
      { id: "newsletters-h1", type: "heading", props: { text: "Studio newsletters", level: 1 } },
      { id: "newsletters-archive", type: "newsletterArchive", props: {} },
      {
        id: "newsletters-subscribe",
        type: "newsletterSubscribe",
        props: {
          newsletterId: newsletter!.id,
          consentStatement: "Send me the Aurora Coast Letter. I can unsubscribe from any issue.",
        },
      },
    ],
  });

  await page.goto("/newsletters");
  await expect(page.getByRole("link", { name: "First light on the coast" })).toHaveAttribute(
    "href",
    "/newsletters/first-light",
  );
  await expect(page.getByText(issue!.excerpt!)).toBeVisible();
  // Transactional mail is not a delivering route in this suite, so the form
  // stays hidden rather than promising an email that cannot be sent.
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await bothThemes(page, "newsletter archive");
});
