// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.01: a signed-in person joins under the site's rules, edits their own
// profile, and the site admin approves and suspends — in a real browser, in
// both themes, with axe.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { THEME_COOKIE } from "@/core/design/theme";
import { memberProfiles, memberSettings } from "@/modules/members/schema";
import { seedC11Owner, useOwnerSession, C11_BASE_URL } from "./owner-session";

const MEMBER_ID = "00000000-0000-4000-8000-0000000000d1";

async function axeInBothThemes(page: Page) {
  for (const theme of ["light", "dark"]) {
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations).toEqual([]);
  }
}

test.describe("members (C12.01)", () => {
  test.setTimeout(180_000);
  test.afterAll(async () => { const { closeDb } = await import("@/core/db"); await closeDb(); });

  test("a person joins, edits their profile, and the admin approves and suspends", async ({ browser }) => {
    const ownerToken = await seedC11Owner("Members proof");
    await db().insert(memberSettings).values({ id: 1, joinPolicy: "approval", minimumAge: 16 });
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    const memberSession = await db().transaction((tx) => createSession(tx, MEMBER_ID));

    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    const anon = await visitor.newPage();
    await anon.goto("/join");
    await expect(anon.getByRole("heading", { level: 1, name: "Join" })).toBeVisible();
    await expect(anon.getByRole("link", { name: "Sign in with your email to join" })).toBeVisible();
    await visitor.close();

    const person = await browser.newContext({ baseURL: C11_BASE_URL });
    await person.addCookies([{ name: SESSION_COOKIE, value: memberSession.token, url: C11_BASE_URL }]);
    const page = await person.newPage();
    await page.goto("/join");
    await axeInBothThemes(page);
    await page.getByLabel("Handle").fill("rae_lane");
    await page.getByLabel("Display name").fill("Rae Lane");
    await page.getByLabel("I am 16 or older.").check();
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page).toHaveURL(/\/portal\/member\?joined=1$/);
    await expect(page.getByText("Your membership is waiting for the site to approve it.")).toBeVisible();
    await page.getByLabel("Bio", { exact: true }).fill("Coastal photographer.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Your profile is saved.")).toBeVisible();
    await axeInBothThemes(page);

    const admin = await browser.newContext({ baseURL: C11_BASE_URL });
    await useOwnerSession(admin, ownerToken);
    const console = await admin.newPage();
    await console.goto("/admin/members?status=pending");
    await expect(console.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
    await expect(console.getByText("@rae_lane")).toBeVisible();
    await axeInBothThemes(console);
    await console.getByRole("button", { name: "Approve" }).click();
    await expect(console.getByText("Saved.")).toBeVisible();
    await console.goto("/admin/members?status=active");
    await console.getByLabel("Reason (required to suspend)").fill("Spam");
    await console.getByRole("button", { name: "Suspend" }).click();
    await expect(console.getByText("Saved.")).toBeVisible();
    await console.goto("/admin/members?status=suspended");
    await expect(console.getByText("Reason: Spam")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Your membership is suspended.", { exact: false })).toBeVisible();
    await person.close();
    await admin.close();
  });

  test("profiles, follow requests, friendship and blocking at /@handle (C12.02–C12.03)", async ({ browser }) => {
    await seedC11Owner("Graph proof");
    const SAM_ID = "00000000-0000-4000-8000-0000000000d2";
    await db().insert(users).values([
      { id: MEMBER_ID, email: "rae@example.test", role: "customer" },
      { id: SAM_ID, email: "sam@example.test", role: "customer" },
    ]);
    const now = new Date();
    await db().insert(memberProfiles).values([
      { userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", bio: "Coastal photographer.", ageAttestedAt: now, isAdult: true },
      { userId: SAM_ID, handle: "sam", displayName: "Sam Ito", ageAttestedAt: now, isAdult: true },
    ]);
    const [rae, sam] = await Promise.all([
      db().transaction((tx) => createSession(tx, MEMBER_ID)),
      db().transaction((tx) => createSession(tx, SAM_ID)),
    ]);
    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    const anon = await visitor.newPage();
    await anon.goto("/@rae");
    await expect(anon.getByRole("heading", { level: 1, name: "Rae Lane" })).toBeVisible();
    await expect(anon.getByText("Coastal photographer.")).toHaveCount(0);
    await axeInBothThemes(anon);
    await visitor.close();

    const samContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await samContext.addCookies([{ name: SESSION_COOKIE, value: sam.token, url: C11_BASE_URL }]);
    const samPage = await samContext.newPage();
    await samPage.goto("/@rae");
    await samPage.getByRole("button", { name: "Ask to follow" }).click();
    await expect(samPage.getByRole("button", { name: "Cancel follow request" })).toBeVisible();
    await samPage.getByRole("button", { name: "Add friend" }).click();
    await expect(samPage.getByRole("button", { name: "Cancel friend request" })).toBeVisible();

    const raeContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await raeContext.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const raePage = await raeContext.newPage();
    await raePage.goto("/portal/notifications");
    await expect(raePage.getByRole("link", { name: "Sam Ito asked to follow you" })).toBeVisible();
    await expect(raePage.getByRole("link", { name: "Sam Ito sent you a friend request" })).toBeVisible();
    await axeInBothThemes(raePage);
    await raePage.getByLabel("By email").first().selectOption("off");
    await raePage.getByRole("button", { name: "Save settings" }).click();
    await expect(raePage.getByText("Your notification settings are saved.")).toBeVisible();
    await raePage.goto("/portal/connections");
    await expect(raePage.getByRole("heading", { level: 1, name: "Connections" })).toBeVisible();
    await axeInBothThemes(raePage);
    await raePage.getByRole("button", { name: "Approve" }).click();
    await raePage.getByRole("button", { name: "Accept friend request" }).click();
    await expect(raePage.getByText("Friends (1)")).toBeVisible();

    await samPage.goto("/@rae");
    await expect(samPage.getByText("Coastal photographer.")).toBeVisible();
    await expect(samPage.getByText("Friends", { exact: true })).toBeVisible();

    await raePage.goto("/@sam");
    await raePage.getByRole("button", { name: "Block" }).click();
    await expect(raePage.getByText("You blocked this member.", { exact: false })).toBeVisible();
    const gone = await samPage.goto("/@rae");
    expect(gone?.status()).toBe(404);
    await samContext.close();
    await raeContext.close();
  });

  test("posting, the home feed, comments and reactions (C12.04)", async ({ browser }) => {
    await seedC11Owner("Posts proof");
    const SAM_ID = "00000000-0000-4000-8000-0000000000d2";
    await db().insert(users).values([
      { id: MEMBER_ID, email: "rae@example.test", role: "customer" },
      { id: SAM_ID, email: "sam@example.test", role: "customer" },
    ]);
    const now = new Date();
    await db().insert(memberProfiles).values([
      { userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: now, isPrivate: false },
      { userId: SAM_ID, handle: "sam", displayName: "Sam Ito", ageAttestedAt: now, isPrivate: false },
    ]);
    const [rae, sam] = await Promise.all([
      db().transaction((tx) => createSession(tx, MEMBER_ID)),
      db().transaction((tx) => createSession(tx, SAM_ID)),
    ]);
    const raeContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await raeContext.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const raePage = await raeContext.newPage();
    await raePage.goto("/feed");
    await expect(raePage.getByRole("heading", { level: 1, name: "Feed" })).toBeVisible();
    await raePage.getByLabel("What’s new?").fill("Morning light at #comox with @sam");
    await raePage.getByLabel("Who can see this").selectOption("public");
    await raePage.getByRole("button", { name: "Post", exact: true }).click();
    await expect(raePage.getByText("Morning light at")).toBeVisible();
    await axeInBothThemes(raePage);

    const samContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await samContext.addCookies([{ name: SESSION_COOKIE, value: sam.token, url: C11_BASE_URL }]);
    const samPage = await samContext.newPage();
    await samPage.goto("/feed");
    await expect(samPage.getByText("Morning light at")).toHaveCount(0);
    await samPage.goto("/@rae");
    await samPage.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(samPage.getByRole("button", { name: "Unfollow" })).toBeVisible();
    await samPage.goto("/feed");
    await expect(samPage.getByText("Morning light at")).toBeVisible();
    await samPage.getByRole("button", { name: "Love" }).click();
    await expect(samPage.getByRole("button", { name: "Love" })).toHaveAttribute("aria-pressed", "true");
    await samPage.getByRole("link", { name: "Comments" }).click();
    await samPage.getByLabel("Add a comment").fill("Gorgeous.");
    await samPage.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(samPage.getByText("Gorgeous.")).toBeVisible();
    await axeInBothThemes(samPage);

    await samPage.goto("/tags/comox");
    await expect(samPage.getByRole("heading", { level: 1, name: "#comox" })).toBeVisible();
    await expect(samPage.getByText("Morning light at")).toBeVisible();
    await samContext.close();
    await raeContext.close();
  });

  test("message requests, conversations and unsending (C12.06)", async ({ browser }) => {
    await seedC11Owner("Messages proof");
    const SAM_ID = "00000000-0000-4000-8000-0000000000d2";
    await db().insert(users).values([
      { id: MEMBER_ID, email: "rae@example.test", role: "customer" },
      { id: SAM_ID, email: "sam@example.test", role: "customer" },
    ]);
    const now = new Date();
    await db().insert(memberProfiles).values([
      { userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: now },
      { userId: SAM_ID, handle: "sam", displayName: "Sam Ito", ageAttestedAt: now },
    ]);
    const [rae, sam] = await Promise.all([
      db().transaction((tx) => createSession(tx, MEMBER_ID)),
      db().transaction((tx) => createSession(tx, SAM_ID)),
    ]);
    const samContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await samContext.addCookies([{ name: SESSION_COOKIE, value: sam.token, url: C11_BASE_URL }]);
    const samPage = await samContext.newPage();
    await samPage.goto("/@rae");
    await samPage.getByRole("link", { name: "Message", exact: true }).click();
    await expect(samPage.getByLabel("To", { exact: true })).toHaveValue("rae");
    await samPage.getByLabel("Message", { exact: true }).fill("Hi Rae, are you free Saturday?");
    await samPage.getByRole("button", { name: "Send" }).click();
    await expect(samPage.getByText("Hi Rae, are you free Saturday?")).toBeVisible();
    await axeInBothThemes(samPage);

    const raeContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await raeContext.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const raePage = await raeContext.newPage();
    await raePage.goto("/messages");
    await expect(raePage.getByText("No conversations yet.")).toBeVisible();
    await raePage.getByRole("link", { name: "Requests (1)" }).click();
    await axeInBothThemes(raePage);
    await raePage.getByRole("link", { name: "Sam Ito" }).click();
    await raePage.getByRole("button", { name: "Accept" }).click();
    await raePage.getByLabel("Message", { exact: true }).fill("Yes! 7am at the pier.");
    await raePage.getByRole("button", { name: "Send" }).click();
    await expect(raePage.getByText("Yes! 7am at the pier.")).toBeVisible();

    await samPage.reload();
    await expect(samPage.getByText("Yes! 7am at the pier.")).toBeVisible();
    await samPage.getByRole("button", { name: "Remove for everyone" }).first().click();
    await raePage.reload();
    await expect(raePage.getByText("This message was removed.")).toBeVisible();
    await samContext.close();
    await raeContext.close();
  });
});
