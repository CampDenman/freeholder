// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Real-browser permission matrix for role-derived onboarding. The important
// assertion is absence: a role never sees a guide or navigation control it
// cannot use.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { contacts } from "@/core/contacts/schema";
import { db, closeDb } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { resetBrowserDatabase } from "./database";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3100";
const IDS = {
  owner: "20000000-0000-4000-8000-000000000001",
  administrator: "20000000-0000-4000-8000-000000000002",
  editor: "20000000-0000-4000-8000-000000000003",
  bookkeeper: "20000000-0000-4000-8000-000000000004",
  provider: "20000000-0000-4000-8000-000000000005",
  customer: "20000000-0000-4000-8000-000000000006",
} as const;

type RoleKey = "administrator" | "editor" | "bookkeeper" | "service-provider";

async function installRoleFixtures(): Promise<Record<RoleKey | "customer", string>> {
  await db().insert(businessProfile).values({
    name: "Guidance Matrix",
    country: "CA",
    baseCurrency: "CAD",
    timezone: "America/Vancouver",
    setupCompletedAt: new Date(),
  });
  const people = [
    { id: IDS.owner, email: "owner-matrix@example.test", role: "owner" },
    { id: IDS.administrator, email: "administrator-matrix@example.test", role: "administrator" },
    { id: IDS.editor, email: "editor-matrix@example.test", role: "editor" },
    { id: IDS.bookkeeper, email: "bookkeeper-matrix@example.test", role: "bookkeeper" },
    { id: IDS.provider, email: "provider-matrix@example.test", role: "service-provider" },
    { id: IDS.customer, email: "customer-matrix@example.test", role: "customer" },
  ];
  await db().insert(users).values(people);
  await db().insert(totpFactors).values(
    people
      .filter((person) => person.role !== "customer")
      .map((person) => ({
        userId: person.id,
        encryptedSecret: `guidance-fixture-${person.role}`,
      })),
  );
  await db().insert(contacts).values({
    userId: IDS.customer,
    name: "Customer Matrix",
    email: "customer-matrix@example.test",
  });

  const tokens = {} as Record<RoleKey | "customer", string>;
  for (const role of [
    "administrator",
    "editor",
    "bookkeeper",
    "service-provider",
    "customer",
  ] as const) {
    const person = people.find((candidate) => candidate.role === role)!;
    const session = await db().transaction((tx) =>
      createSession(tx, person.id, { twoFactorVerified: role !== "customer" }),
    );
    tokens[role] = session.token;
  }
  return tokens;
}

async function useSession(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE_URL }]);
}

function expectNoTargets(page: Page, hrefs: string[]) {
  return Promise.all(
    hrefs.map((href) => expect(page.locator(`a[href="${href}"]`)).toHaveCount(0)),
  );
}

test.describe("role guidance browser matrix", () => {
  let tokens: Awaited<ReturnType<typeof installRoleFixtures>>;

  test.beforeAll(async () => {
    await resetBrowserDatabase();
    tokens = await installRoleFixtures();
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("shows each staff role a usable preferred flow and removes forbidden controls", async ({ page, context }) => {
    await useSession(context, tokens.editor);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    const editor = page.locator('[data-guidance-flow="core.editor-first-win"]');
    await expect(editor).toBeVisible();
    await expect(editor.getByText("Publish a page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What changed" })).toHaveCount(0);
    await expectNoTargets(page, ["/admin/contacts", "/admin/invitations"]);

    await useSession(context, tokens.bookkeeper);
    await page.goto("/admin");
    const bookkeeper = page.locator('[data-guidance-flow="core.bookkeeper-first-win"]');
    await expect(bookkeeper).toBeVisible();
    await expect(bookkeeper.getByText("Choose your alerts")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
    await expectNoTargets(page, ["/admin/pages", "/admin/forms", "/admin/media", "/admin/invitations"]);

    await useSession(context, tokens["service-provider"]);
    await page.goto("/admin");
    const provider = page.locator('[data-guidance-flow="core.service-provider-first-win"]');
    await expect(provider).toBeVisible();
    await expect(provider.getByText("Add a customer")).toBeVisible();
    await expect(provider.locator('a[href="/admin/contacts/new"]')).toHaveCount(0);
    // Links stay hidden until the guide starts, then only permitted contact
    // controls appear.
    await provider.getByRole("button", { name: "Start guide" }).click();
    await expect(provider.locator('a[href="/admin/contacts/new"]')).toBeVisible();
    await expectNoTargets(page, ["/admin/pages", "/admin/invitations"]);

    await useSession(context, tokens.administrator);
    await page.goto("/admin");
    const administrator = page.locator('[data-guidance-flow="core.administrator-first-win"]');
    await expect(administrator).toBeVisible();
    await expect(administrator.getByText("Invite a collaborator")).toBeVisible();
    await expect(page.locator('a[href="/admin/invitations"]')).toBeVisible();
    await expect(page.locator('a[href="/admin/builder"]')).toHaveCount(0);
  });

  test("keeps customer onboarding in the portal and out of admin", async ({ page, context }) => {
    await useSession(context, tokens.customer);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/portal/privacy");
    const customer = page.locator('[data-guidance-flow="core.customer-first-win"]');
    await expect(customer).toBeVisible();
    await expect(customer.getByText("Open your private account")).toBeVisible();
    await expectNoTargets(page, ["/admin", "/admin/pages", "/admin/contacts"]);
  });
});
