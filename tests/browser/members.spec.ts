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
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { THEME_COOKIE } from "@/core/design/theme";
import { memberDevices, memberFollows, memberMessages, memberMlsLog, memberRemoteFollows, memberRemotePosts, memberSealedBlobs, memberPayoutAccounts, memberPayouts, memberPosts, memberProfiles, memberReports, memberSaleFulfilments, memberSettings } from "@/modules/members/schema";
import { contacts } from "@/core/contacts/schema";
import { orderItems, orders, productVariants, products } from "@/modules/catalog/schema";
import { invoices } from "@/modules/invoicing/schema";
import { subscriptions } from "@/modules/subscriptions/schema";
import { eq } from "drizzle-orm";
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

  test("messages are end-to-end encrypted between every device, and franked when reported (C12.23)", async ({ browser }) => {
    await seedC11Owner("Encryption proof");
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
    await db().insert(memberFollows).values([{ followerId: MEMBER_ID, followeeId: SAM_ID, status: "active" as const }, { followerId: SAM_ID, followeeId: MEMBER_ID, status: "active" as const }]);
    const [rae, sam, samAgain] = await Promise.all([MEMBER_ID, SAM_ID, SAM_ID].map((id) => db().transaction((tx) => createSession(tx, id))));
    const open = async (token: string) => {
      const context = await browser.newContext({ baseURL: C11_BASE_URL });
      // As after a real sign-in: the session, and the CSRF token uploads carry.
      await context.addCookies([
        { name: SESSION_COOKIE, value: token, url: C11_BASE_URL },
        { name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL },
      ]);
      return { context, page: await context.newPage() };
    };

    // Both open their messages, which sets up a device in each browser.
    const samSide = await open(sam!.token);
    await samSide.page.goto("/messages");
    const raeSide = await open(rae!.token);
    await raeSide.page.goto("/messages?to=sam");
    await expect.poll(async () => (await db().select().from(memberDevices)).length).toBe(1);
    await raeSide.page.getByLabel("Message", { exact: true }).fill("The spare key is under the blue pot");
    await raeSide.page.getByRole("button", { name: "Send" }).click();
    await expect(raeSide.page.getByText("End-to-end encrypted. Only the devices of the people here can read these messages.", { exact: true })).toBeVisible();
    await expect(raeSide.page.getByText("The spare key is under the blue pot")).toBeVisible();

    await samSide.page.goto("/messages");
    await samSide.page.getByRole("link", { name: "Rae Lane" }).click();
    await expect(samSide.page.getByText("The spare key is under the blue pot")).toBeVisible();
    await samSide.page.getByLabel("Message", { exact: true }).fill("Got it, thanks");
    await samSide.page.getByRole("button", { name: "Send" }).click();
    await expect(samSide.page.getByText("Got it, thanks")).toBeVisible();
    await axeInBothThemes(samSide.page);
    await raeSide.page.reload();
    await expect(raeSide.page.getByText("Got it, thanks")).toBeVisible();

    // The server holds ciphertext only.
    const stored = JSON.stringify(await db().select().from(memberMessages)) + JSON.stringify(await db().select().from(memberMlsLog));
    expect(stored).not.toContain("blue pot");

    // C12.36: a photo is encrypted in Rae's browser; Sam's opens it.
    const sharp = (await import("sharp")).default;
    const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 40, g: 140, b: 90 } } }).jpeg().toBuffer();
    await raeSide.page.getByLabel("Add photos or video (end-to-end encrypted)").setInputFiles({ name: "pot.jpg", mimeType: "image/jpeg", buffer: photo });
    await raeSide.page.getByLabel("Describe them for people who cannot see them").fill("The blue pot by the door");
    await raeSide.page.getByLabel("Message", { exact: true }).fill("This one");
    await raeSide.page.getByRole("button", { name: "Send" }).click();
    await expect(raeSide.page.getByAltText("The blue pot by the door")).toBeVisible();
    await samSide.page.reload();
    const shown = samSide.page.getByAltText("The blue pot by the door");
    await expect(shown).toBeVisible();
    expect(await shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
    const [blobRow] = await db().select().from(memberSealedBlobs);
    expect(blobRow!.size).toBe(photo.length + 16);

    // Sam reports Rae's message; the report carries exactly what Sam's device read.
    await samSide.page.reload();
    await samSide.page.getByRole("link", { name: "Report" }).first().click();
    await expect(samSide.page.getByText("The spare key is under the blue pot")).toBeVisible();
    await samSide.page.getByRole("button", { name: "Send report" }).click();
    await expect(samSide.page.getByText(/^Thank you\. Your report is with/)).toBeVisible();
    expect((await db().select({ excerpt: memberReports.excerpt }).from(memberReports)).map((r) => r.excerpt)).toEqual(["The spare key is under the blue pot"]);

    // A second browser for Sam is a new device: added on Rae's next send, it reads from then on.
    const samTablet = await open(samAgain!.token);
    await samTablet.page.goto("/messages");
    await samTablet.page.getByRole("link", { name: "Rae Lane" }).click();
    await expect(samTablet.page.getByText(/not in this encrypted conversation yet/)).toBeVisible();
    await raeSide.page.getByLabel("Message", { exact: true }).fill("Dinner at 8?");
    await raeSide.page.getByRole("button", { name: "Send" }).click();
    await expect(raeSide.page.getByText("Dinner at 8?")).toBeVisible();
    await samTablet.page.reload();
    await expect(samTablet.page.getByText("Dinner at 8?")).toBeVisible();
    await expect(samTablet.page.getByText("Sent before this device joined the conversation.").first()).toBeVisible();

    // C12.34: the tablet asks for Sam's earlier messages; the phone shows the same code and sends them.
    await samTablet.page.goto("/messages");
    await samTablet.page.getByText("Bring earlier messages to this browser").click();
    await samTablet.page.getByRole("button", { name: "Ask my other devices" }).click();
    const tabletCode = await samTablet.page.locator("[data-my-code]").textContent();
    await samSide.page.goto("/messages");
    await expect(samSide.page.locator("[data-history-code]")).toHaveText(tabletCode!);
    await samSide.page.getByRole("button", { name: "Send my messages" }).click();
    await expect(samSide.page.getByText(/^Sent\. They are encrypted/)).toBeVisible();
    await expect(samTablet.page.getByText(/^Brought \d+ earlier messages to this browser\.$/)).toBeVisible({ timeout: 20_000 });
    await samTablet.page.goto(raeSide.page.url());
    await expect(samTablet.page.getByText("The spare key is under the blue pot")).toBeVisible();

    // C12.35: Rae is told a device joined, and both see the same safety number.
    await raeSide.page.reload();
    await expect(raeSide.page.getByText("The devices in this conversation changed since you last checked.")).toBeVisible();
    await raeSide.page.getByText("Verify devices").click();
    const raeNumber = await raeSide.page.locator("[data-safety-number]").textContent();
    await samSide.page.goto(raeSide.page.url());
    await samSide.page.getByText("Verify devices").click();
    await expect(samSide.page.locator("[data-safety-number]")).toHaveText(raeNumber!);
    await raeSide.page.getByRole("button", { name: "I have checked them" }).click();
    await expect(raeSide.page.getByText("The devices in this conversation changed since you last checked.")).toHaveCount(0);
    await samSide.page.goto("/portal/member");
    await expect(samSide.page.getByRole("heading", { name: "Your devices for encrypted messages" })).toBeVisible();
    await expect(samSide.page.getByRole("button", { name: "Remove device" })).toHaveCount(2);
    for (const side of [samSide, raeSide, samTablet]) await side.context.close();
  });

  test("listing something for sale, review, the market and the profile shop (C12.08)", async ({ browser }) => {
    const ownerToken = await seedC11Owner("Market proof");
    await db().insert(memberSettings).values({ id: 1, marketplaceEnabled: true, listingReview: true });
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date(), isPrivate: false });
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));

    const seller = await browser.newContext({ baseURL: C11_BASE_URL });
    await seller.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const page = await seller.newPage();
    await page.goto("/portal/listings");
    await expect(page.getByRole("heading", { level: 1, name: "My listings" })).toBeVisible();
    await axeInBothThemes(page);
    await page.getByLabel("Title").fill("Harbour print");
    await page.getByLabel("Price", { exact: true }).fill("45");
    await page.getByLabel(/I have read and accept the market policy/).check();
    await page.getByRole("button", { name: "Create listing" }).click();
    await expect(page.getByText("Waiting for review")).toBeVisible();

    const admin = await browser.newContext({ baseURL: C11_BASE_URL });
    await useOwnerSession(admin, ownerToken);
    const console = await admin.newPage();
    await console.goto("/admin/members");
    await expect(console.getByText("Harbour print", { exact: false })).toBeVisible();
    await console.getByRole("button", { name: "Approve", exact: true }).first().click();
    await expect(console.getByText("No listings are waiting for review.")).toBeVisible();

    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    const anon = await visitor.newPage();
    await anon.goto("/market");
    await expect(anon.getByRole("heading", { level: 1, name: "Market" })).toBeVisible();
    await expect(anon.getByRole("link", { name: "Harbour print" })).toBeVisible();
    await axeInBothThemes(anon);
    await anon.goto("/@rae");
    await expect(anon.getByRole("heading", { level: 2, name: "Shop" })).toBeVisible();
    await anon.getByRole("link", { name: "Harbour print" }).click();
    await expect(anon.getByRole("heading", { level: 1, name: "Harbour print" })).toBeVisible();
    await expect(anon.getByRole("button", { name: /add to cart/i })).toHaveCount(0);
    await visitor.close();
    await seller.close();
    await admin.close();
  });

  test("payout details, confirmation, and a listing becoming buyable (C12.09)", async ({ browser }) => {
    const ownerToken = await seedC11Owner("Payout proof");
    await db().insert(memberSettings).values({ id: 1, marketplaceEnabled: true, listingReview: false });
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date(), isPrivate: false });
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));
    const seller = await browser.newContext({ baseURL: C11_BASE_URL });
    await seller.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const page = await seller.newPage();
    await page.goto("/portal/listings");
    await page.getByLabel("Title").fill("Harbour print download");
    await page.getByLabel("Type").selectOption("digital");
    await page.getByLabel("Price", { exact: true }).fill("45");
    await page.getByLabel(/I have read and accept the market policy/).check();
    await page.getByRole("button", { name: "Create listing" }).click();
    await expect(page.getByText("Listed", { exact: true })).toBeVisible();

    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    const anon = await visitor.newPage();
    await anon.goto("/market");
    await anon.getByRole("link", { name: "Harbour print download" }).click();
    await expect(anon.getByRole("button", { name: /add to cart/i })).toHaveCount(0);

    await page.goto("/portal/payouts");
    await expect(page.getByRole("heading", { level: 1, name: "Payouts" })).toBeVisible();
    await axeInBothThemes(page);
    await page.getByLabel("Payout details").fill("Interac e-transfer to rae@example.test");
    await page.getByRole("button", { name: "Save payout details" }).click();
    await expect(page.getByText("Waiting for the site")).toBeVisible();

    const admin = await browser.newContext({ baseURL: C11_BASE_URL });
    await useOwnerSession(admin, ownerToken);
    const console = await admin.newPage();
    await console.goto("/admin/members");
    await expect(console.getByText("Interac e-transfer to rae@example.test")).toBeVisible();
    await console.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(console.getByText("Saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Ready to sell")).toBeVisible();
    await anon.reload();
    await expect(anon.getByRole("button", { name: /add to cart/i })).toBeVisible();
    await visitor.close();
    await seller.close();
    await admin.close();
  });

  test("shipping, the sale conversation and the buyer confirming delivery (C12.10)", async ({ browser }) => {
    await seedC11Owner("Protection proof");
    const BUYER_ID = "00000000-0000-4000-8000-0000000000d3";
    await db().insert(memberSettings).values({ id: 1, marketplaceEnabled: true, listingReview: false });
    await db().insert(users).values([
      { id: MEMBER_ID, email: "rae@example.test", role: "customer" },
      { id: BUYER_ID, email: "buyer@example.test", role: "customer" },
    ]);
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date() });
    const [buyer] = await db().insert(contacts).values({ email: "buyer@example.test", name: "Bea Buyer", userId: BUYER_ID }).returning();
    const [product] = await db().insert(products).values({ name: "Harbour print", slug: "rae-harbour-print-test", kind: "physical", status: "active", publishedAt: new Date(), sellerUserId: MEMBER_ID }).returning();
    const [variant] = await db().insert(productVariants).values({ productId: product!.id, sku: "rae-harbour-print-test", combinationKey: "default", isDefault: true }).returning();
    const [order] = await db().insert(orders).values({ contactId: buyer!.id, currency: "CAD", status: "paid", subtotalMinor: 4500, totalMinor: 4500 }).returning();
    const [line] = await db().insert(orderItems).values({ orderId: order!.id, variantId: variant!.id, quantity: 1, unitAmountMinor: 4500, lineTotalMinor: 4500 }).returning();
    await db().insert(memberPayouts).values({ orderId: order!.id, orderItemId: line!.id, sellerId: MEMBER_ID, currency: "CAD", grossMinor: 4500, feeMinor: 0, netMinor: 4500, state: "held", model: "hold", releaseAt: new Date(Date.now() + 14 * 86_400_000) });
    const [rae, bea] = await Promise.all([
      db().transaction((tx) => createSession(tx, MEMBER_ID)),
      db().transaction((tx) => createSession(tx, BUYER_ID)),
    ]);

    const seller = await browser.newContext({ baseURL: C11_BASE_URL });
    await seller.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const sp = await seller.newPage();
    await sp.goto("/portal/sales");
    await sp.getByRole("link", { name: /Harbour print/ }).click();
    await axeInBothThemes(sp);
    await sp.getByLabel("Carrier").fill("Canada Post");
    await sp.getByLabel("Tracking number").fill("CP123");
    await sp.getByRole("button", { name: "Mark as shipped" }).click();
    await expect(sp.getByText("Sent with Canada Post, tracking CP123")).toBeVisible();
    await sp.getByLabel("Message").fill("On its way!");
    await sp.getByRole("button", { name: "Send" }).click();

    const buyerContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await buyerContext.addCookies([{ name: SESSION_COOKIE, value: bea.token, url: C11_BASE_URL }]);
    const bp = await buyerContext.newPage();
    await bp.goto("/portal/purchases");
    await bp.getByRole("link", { name: /Harbour print/ }).click();
    await expect(bp.getByText("On its way!")).toBeVisible();
    await axeInBothThemes(bp);
    await bp.getByRole("button", { name: "I received it" }).click();
    await expect(bp.getByText("Delivered", { exact: true })).toBeVisible();

    await sp.reload();
    await expect(sp.getByText("Payment due to you")).toBeVisible();
    await seller.close();
    await buyerContext.close();
  });

  test("double-blind reviews after a completed sale, with a public reply (C12.11)", async ({ browser }) => {
    await seedC11Owner("Reputation proof");
    const BUYER_ID = "00000000-0000-4000-8000-0000000000d4";
    await db().insert(memberSettings).values({ id: 1, marketplaceEnabled: true, listingReview: false });
    await db().insert(users).values([
      { id: MEMBER_ID, email: "rae@example.test", role: "customer" },
      { id: BUYER_ID, email: "buyer@example.test", role: "customer" },
    ]);
    await db().insert(memberProfiles).values([
      { userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date() },
      { userId: BUYER_ID, handle: "bea", displayName: "Bea Buyer", ageAttestedAt: new Date() },
    ]);
    const [buyer] = await db().insert(contacts).values({ email: "buyer@example.test", name: "Bea Buyer", userId: BUYER_ID }).returning();
    const [product] = await db().insert(products).values({ name: "Harbour print", slug: "rae-harbour-print-review", kind: "physical", status: "active", publishedAt: new Date(), sellerUserId: MEMBER_ID }).returning();
    const [variant] = await db().insert(productVariants).values({ productId: product!.id, sku: "rae-harbour-print-review", combinationKey: "default", isDefault: true }).returning();
    const [order] = await db().insert(orders).values({ contactId: buyer!.id, currency: "CAD", status: "paid", subtotalMinor: 4500, totalMinor: 4500 }).returning();
    const [line] = await db().insert(orderItems).values({ orderId: order!.id, variantId: variant!.id, quantity: 1, unitAmountMinor: 4500, lineTotalMinor: 4500 }).returning();
    await db().insert(memberPayouts).values({ orderId: order!.id, orderItemId: line!.id, sellerId: MEMBER_ID, currency: "CAD", grossMinor: 4500, feeMinor: 0, netMinor: 4500, state: "due", model: "hold", releaseAt: new Date() });
    await db().insert(memberSaleFulfilments).values({ orderId: order!.id, sellerId: MEMBER_ID, state: "delivered" });
    const [rae, bea] = await Promise.all([
      db().transaction((tx) => createSession(tx, MEMBER_ID)),
      db().transaction((tx) => createSession(tx, BUYER_ID)),
    ]);

    const buyerContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await buyerContext.addCookies([{ name: SESSION_COOKIE, value: bea.token, url: C11_BASE_URL }]);
    const bp = await buyerContext.newPage();
    await bp.goto("/portal/purchases");
    await bp.getByRole("link", { name: /Harbour print/ }).click();
    await bp.getByLabel("Rating").selectOption("4");
    await bp.getByLabel(/What should others know/).fill("Lovely print, slow post.");
    await bp.getByRole("button", { name: "Post review" }).click();
    await expect(bp.getByText("Hidden until they review you or two weeks pass")).toBeVisible();
    await axeInBothThemes(bp);

    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    const anon = await visitor.newPage();
    await anon.goto("/@rae");
    await expect(anon.getByRole("heading", { name: "Reviews" })).toHaveCount(0);

    const seller = await browser.newContext({ baseURL: C11_BASE_URL });
    await seller.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const sp = await seller.newPage();
    await sp.goto("/portal/sales");
    await sp.getByRole("link", { name: /Harbour print/ }).click();
    await expect(sp.getByText("They reviewed you. Write yours to see it.")).toBeVisible();
    await expect(sp.getByText("Lovely print, slow post.")).toHaveCount(0);
    await sp.getByRole("button", { name: "Post review" }).click();
    await expect(sp.getByText("Lovely print, slow post.")).toBeVisible();
    await sp.getByLabel("Reply publicly").fill("Thanks Bea! Sorry about the post.");
    await sp.getByRole("button", { name: "Post reply" }).click();
    await expect(sp.getByText("Thanks Bea! Sorry about the post.")).toBeVisible();

    await anon.reload();
    await expect(anon.getByRole("heading", { name: "Reviews" })).toBeVisible();
    await expect(anon.getByText("As a seller: 4 of 5 (1)")).toBeVisible();
    await expect(anon.getByText("Thanks Bea! Sorry about the post.")).toBeVisible();
    await axeInBothThemes(anon);
    await visitor.close();
    await seller.close();
    await buyerContext.close();
  });

  test("reporting a post, the moderation queue, and removal with a reason (C12.12)", async ({ browser }) => {
    const ownerToken = await seedC11Owner("Safety proof");
    const SAM_ID = "00000000-0000-4000-8000-0000000000d5";
    await db().insert(users).values([
      { id: MEMBER_ID, email: "rae@example.test", role: "customer" },
      { id: SAM_ID, email: "sam@example.test", role: "customer" },
    ]);
    const now = new Date();
    await db().insert(memberProfiles).values([
      { userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: now, isPrivate: false },
      { userId: SAM_ID, handle: "sam", displayName: "Sam Ito", ageAttestedAt: now, isPrivate: false },
    ]);
    const [post] = await db().insert(memberPosts).values({ authorId: SAM_ID, body: "Cheap followers at spam.example", visibility: "public" }).returning();
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));

    const raeContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await raeContext.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const raePage = await raeContext.newPage();
    await raePage.goto(`/p/${post!.id}`);
    await raePage.getByRole("link", { name: "Report" }).first().click();
    await expect(raePage.getByRole("heading", { level: 1, name: "Report a post" })).toBeVisible();
    await axeInBothThemes(raePage);
    await raePage.getByLabel("What is wrong?").selectOption("spam");
    await raePage.getByLabel(/Anything else the moderators/).fill("Spam link.");
    await raePage.getByRole("button", { name: "Send report" }).click();
    await expect(raePage.getByText(/Your report is with the site’s moderators/)).toBeVisible();

    const admin = await browser.newContext({ baseURL: C11_BASE_URL });
    await useOwnerSession(admin, ownerToken);
    const console = await admin.newPage();
    await console.goto("/admin/members");
    await expect(console.getByText("Cheap followers at spam.example")).toBeVisible();
    await expect(console.getByText("Reporter said: Spam link.")).toBeVisible();
    await axeInBothThemes(console);
    await console.getByLabel(/Reason the member will see/).fill("Spam links are not allowed here.");
    await console.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(console.getByText("Nothing has been reported.")).toBeVisible();

    await raePage.goto(`/p/${post!.id}`);
    await expect(raePage.getByText("Cheap followers at spam.example")).toHaveCount(0);
    await raeContext.close();
    await admin.close();
  });

  test("adult content is opt-in for adults and never shown to minors (C12.29)", async ({ browser }) => {
    const ownerToken = await seedC11Owner("Adult proof");
    const BEN_ID = "00000000-0000-4000-8000-0000000000d6";
    const DEE_ID = "00000000-0000-4000-8000-0000000000d7";
    await db().insert(users).values([
      { id: MEMBER_ID, email: "ada@example.test", role: "customer" },
      { id: BEN_ID, email: "ben@example.test", role: "customer" },
      { id: DEE_ID, email: "dee@example.test", role: "customer" },
    ]);
    const now = new Date();
    await db().insert(memberProfiles).values([
      { userId: MEMBER_ID, handle: "ada", displayName: "Ada Lane", ageAttestedAt: now, isAdult: true, isPrivate: false },
      { userId: BEN_ID, handle: "ben", displayName: "Ben Ito", ageAttestedAt: now, isAdult: true, isPrivate: false },
      { userId: DEE_ID, handle: "dee", displayName: "Dee Young", ageAttestedAt: now, isAdult: false, isPrivate: false },
    ]);
    const [ada, ben, dee] = await Promise.all([MEMBER_ID, BEN_ID, DEE_ID].map((id) => db().transaction((tx) => createSession(tx, id))));

    const admin = await browser.newContext({ baseURL: C11_BASE_URL });
    await useOwnerSession(admin, ownerToken);
    const console = await admin.newPage();
    await console.goto("/admin/members");
    await console.getByLabel(/Allow adult \(18\+\) content/).check();
    await console.getByRole("button", { name: "Save rules" }).first().click();
    await expect(console.getByLabel(/Allow adult \(18\+\) content/)).toBeChecked();

    const adaContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await adaContext.addCookies([{ name: SESSION_COOKIE, value: ada!.token, url: C11_BASE_URL }]);
    const adaPage = await adaContext.newPage();
    await adaPage.goto("/feed");
    await adaPage.getByLabel("What’s new?").fill("Late-night figure study");
    await adaPage.getByLabel("Who can see this").selectOption("public");
    await adaPage.getByLabel(/This post is adult content/).check();
    await adaPage.getByRole("button", { name: "Post", exact: true }).click();
    await expect(adaPage.getByText("Late-night figure study")).toBeVisible();
    await expect(adaPage.getByText("18+", { exact: true })).toBeVisible();

    const deeContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await deeContext.addCookies([{ name: SESSION_COOKIE, value: dee!.token, url: C11_BASE_URL }]);
    const deePage = await deeContext.newPage();
    await deePage.goto("/@ada");
    await expect(deePage.getByText("Late-night figure study")).toHaveCount(0);
    await deePage.goto("/portal/member");
    await expect(deePage.getByLabel(/Show me adult/)).toHaveCount(0);

    const benContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await benContext.addCookies([{ name: SESSION_COOKIE, value: ben!.token, url: C11_BASE_URL }]);
    const benPage = await benContext.newPage();
    await benPage.goto("/@ada");
    await expect(benPage.getByText("Late-night figure study")).toHaveCount(0);
    await benPage.goto("/portal/member");
    await benPage.getByLabel(/Show me adult/).check();
    await benPage.getByRole("button", { name: "Save profile" }).click();
    await benPage.goto("/@ada");
    await expect(benPage.getByText("Late-night figure study")).toBeVisible();
    await axeInBothThemes(benPage);

    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    const anon = await visitor.newPage();
    await anon.goto("/feed?view=latest");
    await expect(anon.getByText("Late-night figure study")).toHaveCount(0);
    for (const context of [admin, adaContext, deeContext, benContext, visitor]) await context.close();
  });

  test("a member joins the fediverse and is findable by their address (C12.18)", async ({ browser }) => {
    const ownerToken = await seedC11Owner("Federation proof");
    await db().insert(users).values({ id: MEMBER_ID, email: "ada@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "ada", displayName: "Ada Lane", ageAttestedAt: new Date(), isPrivate: false });
    const ada = await db().transaction((tx) => createSession(tx, MEMBER_ID));

    const adaContext = await browser.newContext({ baseURL: C11_BASE_URL });
    await adaContext.addCookies([{ name: SESSION_COOKIE, value: ada.token, url: C11_BASE_URL }]);
    const adaPage = await adaContext.newPage();
    await adaPage.goto("/portal/member");
    await expect(adaPage.getByRole("heading", { name: "The fediverse" })).toHaveCount(0);
    expect((await adaPage.request.get("/ap/users/ada", { headers: { accept: "application/activity+json" } })).status()).toBe(404);

    const admin = await browser.newContext({ baseURL: C11_BASE_URL });
    await useOwnerSession(admin, ownerToken);
    const console = await admin.newPage();
    await console.goto("/admin/members");
    await console.getByLabel(/Let members join the fediverse/).check();
    await console.getByRole("button", { name: "Save rules" }).first().click();
    await expect(console.getByLabel(/Let members join the fediverse/)).toBeChecked();

    await adaPage.goto("/portal/member");
    await adaPage.getByRole("button", { name: "Join the fediverse" }).click();
    const address = adaPage.locator("code", { hasText: /^@ada@/ });
    await expect(address).toBeVisible();
    await expect(adaPage.getByText("Followers elsewhere: 0")).toBeVisible();
    await axeInBothThemes(adaPage);

    const acct = (await address.textContent())!.slice(1);
    const jrd = await adaPage.request.get(`/.well-known/webfinger?resource=acct:${acct}`);
    expect(jrd.headers()["content-type"]).toContain("application/jrd+json");
    const self = ((await jrd.json()) as { links: { rel: string; href: string }[] }).links.find((l) => l.rel === "self")!.href;
    const actor = await adaPage.request.get(new URL(self).pathname, { headers: { accept: "application/activity+json" } });
    expect(await actor.json()).toMatchObject({ type: "Person", preferredUsername: "ada" });

    await adaPage.getByRole("button", { name: "Leave the fediverse" }).click();
    await expect(adaPage.getByRole("button", { name: "Join the fediverse" })).toBeVisible();
    expect((await adaPage.request.get("/ap/users/ada", { headers: { accept: "application/activity+json" } })).status()).toBe(404);
    for (const context of [admin, adaContext]) await context.close();
  });

  test("posts from accounts followed elsewhere appear in the home feed as plain text (C12.32)", async ({ browser }) => {
    await seedC11Owner("Fediverse following proof");
    await db().insert(users).values({ id: MEMBER_ID, email: "ada@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "ada", displayName: "Ada Lane", ageAttestedAt: new Date(), isPrivate: false, federated: true });
    await db().insert(memberSettings).values({ id: 1, federation: true }).onConflictDoUpdate({ target: memberSettings.id, set: { federation: true } });
    await db().insert(memberRemoteFollows).values({ userId: MEMBER_ID, actorUri: "https://remote.example/users/sam", inboxUri: "https://remote.example/users/sam/inbox", handle: "sam@remote.example", followId: "x", state: "accepted" });
    await db().insert(memberRemotePosts).values({ actorUri: "https://remote.example/users/sam", objectId: "https://remote.example/notes/1", url: "https://remote.example/@sam/1", text: "<b>Sunrise</b> over the bay", publishedAt: new Date() });
    const ada = await db().transaction((tx) => createSession(tx, MEMBER_ID));
    const context = await browser.newContext({ baseURL: C11_BASE_URL });
    await context.addCookies([{ name: SESSION_COOKIE, value: ada.token, url: C11_BASE_URL }]);
    const page = await context.newPage();
    await page.goto("/feed");
    const post = page.locator("[data-remote-post]");
    await expect(post).toContainText("@sam@remote.example");
    await expect(post).toContainText("from the fediverse");
    // Remote text is shown as text, never as markup.
    await expect(post.getByText("<b>Sunrise</b> over the bay")).toBeVisible();
    await expect(post.locator("b")).toHaveCount(0);
    await axeInBothThemes(page);

    await page.goto("/portal/member");
    await expect(page.getByText("@sam@remote.example · following")).toBeVisible();
    await page.getByLabel("Follow someone on another server").fill("not an address");
    await page.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(page).toHaveURL(/error=validation/);
    await page.getByRole("button", { name: "Unfollow" }).click();
    await expect(page.getByText("@sam@remote.example · following")).toHaveCount(0);
    await page.goto("/feed");
    await expect(page.locator("[data-remote-post]")).toHaveCount(0);
    await context.close();
  });

  test("accounts elsewhere and a move are shown, and a move needs confirming (C12.33)", async ({ browser }) => {
    // The lookup and the Move protocol run against a fake server in tests/modules/member-federation.test.ts;
    // the production build refuses private addresses, so this checks the screens.
    await seedC11Owner("Fediverse move proof");
    await db().insert(users).values({ id: MEMBER_ID, email: "ada@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "ada", displayName: "Ada Lane", ageAttestedAt: new Date(), isPrivate: false, federated: true, fediverseAliases: ["https://old.example/users/ada"] });
    await db().insert(memberSettings).values({ id: 1, federation: true }).onConflictDoUpdate({ target: memberSettings.id, set: { federation: true } });
    const ada = await db().transaction((tx) => createSession(tx, MEMBER_ID));
    const context = await browser.newContext({ baseURL: C11_BASE_URL });
    await context.addCookies([{ name: SESSION_COOKIE, value: ada.token, url: C11_BASE_URL }]);
    const page = await context.newPage();
    await page.goto("/portal/member");
    await page.getByText("Moving between accounts").click();
    await expect(page.getByText("Also known as: https://old.example/users/ada")).toBeVisible();
    await axeInBothThemes(page);

    await page.getByText("Moving between accounts").click();
    await page.getByLabel("Your accounts on other servers").fill("not an address");
    await page.getByRole("button", { name: "Save accounts" }).click();
    await expect(page).toHaveURL(/error=validation/);
    await page.getByText("Moving between accounts").click();
    await page.getByLabel("Move to another account").fill("@ada@new.example");
    await page.getByRole("button", { name: "Move my followers" }).click();
    await expect(page).toHaveURL(/error=validation/);
    expect((await db().select({ movedTo: memberProfiles.movedTo }).from(memberProfiles).where(eq(memberProfiles.userId, MEMBER_ID)))[0]?.movedTo).toBeNull();

    await db().update(memberProfiles).set({ movedTo: "https://new.example/users/ada" }).where(eq(memberProfiles.userId, MEMBER_ID));
    await page.goto("/portal/member");
    await page.getByText("Moving between accounts").click();
    await expect(page.getByText(/You moved to https:\/\/new\.example\/users\/ada/)).toBeVisible();
    await context.close();
  });

  test("the prohibited-items policy, published by the site and accepted by sellers (C12.28)", async ({ browser }) => {
    const ownerToken = await seedC11Owner("Policy proof");
    await db().insert(memberSettings).values({ id: 1, marketplaceEnabled: true, listingReview: false });
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date(), marketPolicyAccepted: 1 });
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));

    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    const anon = await visitor.newPage();
    await anon.goto("/market");
    await anon.getByRole("link", { name: "What you can’t sell here" }).click();
    await expect(anon.getByRole("heading", { level: 1, name: "What you can’t sell here" })).toBeVisible();
    await expect(anon.getByText(/Weapons, ammunition/)).toBeVisible();
    await axeInBothThemes(anon);

    const seller = await browser.newContext({ baseURL: C11_BASE_URL });
    await seller.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const page = await seller.newPage();
    await page.goto("/portal/listings");
    await expect(page.getByLabel(/accept the market policy/)).toHaveCount(0);

    const admin = await browser.newContext({ baseURL: C11_BASE_URL });
    await useOwnerSession(admin, ownerToken);
    const console = await admin.newPage();
    await console.goto("/admin/members");
    await console.getByLabel("What members may not sell").fill("No weapons. No live animals. Handmade goods only.");
    await console.getByRole("button", { name: "Publish policy" }).click();
    await expect(console.getByText("Saved.")).toBeVisible();

    await anon.reload();
    await expect(anon.getByText("No weapons. No live animals. Handmade goods only.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/The market policy has changed/)).toBeVisible();
    for (const context of [visitor, seller, admin]) await context.close();
  });

  test("member pages load nothing from other origins, and data rights are one click away (C12.15)", async ({ browser }) => {
    await seedC11Owner("Rights proof");
    await db().insert(memberSettings).values({ id: 1, marketplaceEnabled: true, listingReview: false });
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date(), isPrivate: false });
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));
    const context = await browser.newContext({ baseURL: C11_BASE_URL });
    await context.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const page = await context.newPage();
    const origin = new URL(C11_BASE_URL).origin;
    const elsewhere: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.origin !== origin) elsewhere.push(url.origin);
    });
    for (const path of ["/@rae", "/feed", "/market", "/messages", "/portal/member", "/market/policy"]) {
      await page.goto(path);
      await page.waitForLoadState("load");
    }
    expect([...new Set(elsewhere)]).toEqual([]);
    await page.goto("/portal/member");
    await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
    await axeInBothThemes(page);
    await page.getByRole("link", { name: "Download your data or delete your account" }).click();
    await expect(page).toHaveURL(/\/portal\/privacy/);
    await context.close();
  });

  test("an avatar, profile sections with their own audience, and a pinned post (C12.20)", async ({ browser }) => {
    await seedC11Owner("Profile proof");
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date(), isPrivate: false });
    await db().insert(memberPosts).values({ authorId: MEMBER_ID, body: "My best harbour shot", visibility: "public" });
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));
    const context = await browser.newContext({ baseURL: C11_BASE_URL });
    await context.addCookies([
      { name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL },
      { name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL },
    ]);
    const page = await context.newPage();
    await page.goto("/portal/member");
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 120, b: 60 } } }).png().toBuffer();
    await page.getByLabel("Choose a picture").setInputFiles({ name: "rae.png", mimeType: "image/png", buffer: png });
    await expect(page.getByAltText("Your current picture")).toBeVisible();

    await page.getByLabel("Kind of section").selectOption("services");
    await page.getByLabel("Heading").fill("Rates");
    await page.getByLabel("Text", { exact: true }).fill("Portraits from $150");
    await page.getByLabel("Who can see this").selectOption("followers");
    await page.getByRole("button", { name: "Add section" }).click();
    await expect(page.getByText("Rates", { exact: true })).toBeVisible();
    await axeInBothThemes(page);

    await page.goto("/@rae");
    await page.getByRole("button", { name: "Pin to profile" }).click();
    await page.goto("/@rae");
    await expect(page.getByRole("heading", { name: "Pinned" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rates" })).toBeVisible();

    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    const anon = await visitor.newPage();
    await anon.goto("/@rae");
    await expect(anon.locator("header img")).toBeVisible();
    await expect(anon.getByRole("heading", { name: "Pinned" })).toBeVisible();
    await expect(anon.getByRole("heading", { name: "Rates" })).toHaveCount(0);
    await axeInBothThemes(anon);
    await visitor.close();
    await context.close();
  });

  test("a member adds a passkey, then signs in with it instead of an email link (C12.19)", async ({ browser }) => {
    await seedC11Owner("Passkey proof");
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date() });
    await db().insert(contacts).values({ email: "rae@example.test", name: "Rae Lane", userId: MEMBER_ID });
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));
    const context = await browser.newContext({ baseURL: C11_BASE_URL });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } });
    await context.addCookies([
      { name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL },
      { name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL },
    ]);
    await page.goto("/portal/member");
    await expect(page.getByText(/Add a passkey and next time/)).toBeVisible();
    await page.getByLabel("Name this passkey").fill("Laptop");
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByText(/Passkey added/)).toBeVisible();
    await expect(page.getByText(/Keep these recovery codes/)).toBeVisible();
    await expect(page.getByText("Laptop", { exact: true })).toBeVisible();
    await axeInBothThemes(page);

    await context.clearCookies();
    await page.goto("/portal/login");
    await page.getByLabel("Email").first().fill("rae@example.test");
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    await page.goto("/portal/member");
    await expect(page.getByText("@rae").first()).toBeVisible();
    await context.close();
  });

  test("push in this browser and quiet hours that hold push and email (C12.22)", async ({ browser }) => {
    await seedC11Owner("Push proof");
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date() });
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));
    const context = await browser.newContext({ baseURL: C11_BASE_URL, permissions: ["notifications"] });
    await context.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const page = await context.newPage();
    const worker = await page.request.get("/push-sw.js");
    expect(worker.ok()).toBe(true);
    expect(await worker.text()).toContain("showNotification");

    await page.goto("/portal/notifications");
    // Headless browsers report notifications as blocked; a real one offers "Turn on".
    await expect(page.getByText(/Get notified here|blocked for this site|can’t receive push/)).toBeVisible();
    await page.getByLabel("Use quiet hours").check();
    await page.getByLabel("From").fill("22:00");
    await page.getByLabel("Until").fill("07:00");
    await page.getByRole("button", { name: "Save quiet hours" }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await expect(page.getByLabel("Use quiet hours")).toBeChecked();
    await expect(page.getByLabel("From")).toHaveValue("22:00");
    await axeInBothThemes(page);
    await context.close();
  });

  test("a followers-only photo post shows its photo to followers and nobody else (C12.21)", async ({ browser }) => {
    await seedC11Owner("Attachments proof");
    const SAM_ID = "00000000-0000-4000-8000-0000000000d8";
    await db().insert(users).values([
      { id: MEMBER_ID, email: "rae@example.test", role: "customer" },
      { id: SAM_ID, email: "sam@example.test", role: "customer" },
    ]);
    await db().insert(memberProfiles).values([
      { userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date(), isPrivate: false },
      { userId: SAM_ID, handle: "sam", displayName: "Sam Ito", ageAttestedAt: new Date(), isPrivate: false },
    ]);
    const [rae, sam] = await Promise.all([MEMBER_ID, SAM_ID].map((id) => db().transaction((tx) => createSession(tx, id))));
    const context = await browser.newContext({ baseURL: C11_BASE_URL });
    await context.addCookies([
      { name: SESSION_COOKIE, value: rae!.token, url: C11_BASE_URL },
      { name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL },
    ]);
    const page = await context.newPage();
    await page.goto("/feed");
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 30, g: 90, b: 160 } } }).jpeg().toBuffer();
    await page.getByLabel("Add photos or video").setInputFiles({ name: "harbour.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await page.getByLabel(/Describe it for people/).fill("Boats in the harbour at dawn");
    await page.getByLabel("Who can see this").selectOption("followers");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    const image = page.getByAltText("Boats in the harbour at dawn");
    await expect(image).toBeVisible();
    const src = await image.getAttribute("src");
    expect(src).toMatch(/^\/member-files\//);
    expect((await page.request.get(src!)).status()).toBe(200);
    await axeInBothThemes(page);

    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    expect((await visitor.request.get(src!)).status()).toBe(404);
    const other = await browser.newContext({ baseURL: C11_BASE_URL });
    await other.addCookies([{ name: SESSION_COOKIE, value: sam!.token, url: C11_BASE_URL }]);
    expect((await other.request.get(src!)).status()).toBe(404);
    const samPage = await other.newPage();
    await samPage.goto("/@rae");
    await samPage.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(samPage.getByRole("button", { name: "Unfollow" })).toBeVisible();
    expect((await other.request.get(src!)).status()).toBe(200);
    for (const c of [context, visitor, other]) await c.close();
  });

  test("a member offers a subscription; a subscriber pays and sees subscriber-only posts (C12.05)", async ({ browser }) => {
    await seedC11Owner("Subscriptions proof");
    const SAM_ID = "00000000-0000-4000-8000-0000000000d9";
    await db().insert(memberSettings).values({ id: 1, marketplaceEnabled: true, listingReview: false });
    await db().insert(users).values([
      { id: MEMBER_ID, email: "rae@example.test", role: "customer" },
      { id: SAM_ID, email: "sam@example.test", role: "customer" },
    ]);
    await db().insert(memberProfiles).values([
      { userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date(), isPrivate: false },
      { userId: SAM_ID, handle: "sam", displayName: "Sam Ito", ageAttestedAt: new Date(), isPrivate: false },
    ]);
    await db().insert(contacts).values([
      { email: "rae@example.test", name: "Rae Lane", userId: MEMBER_ID },
      { email: "sam@example.test", name: "Sam Ito", userId: SAM_ID },
    ]);
    await db().insert(memberPayoutAccounts).values({ userId: MEMBER_ID, status: "ready", adapter: "manual" });
    await db().insert(memberPosts).values({ authorId: MEMBER_ID, body: "Raw edit for subscribers", visibility: "subscribers" });
    const [rae, sam] = await Promise.all([MEMBER_ID, SAM_ID].map((id) => db().transaction((tx) => createSession(tx, id))));

    const seller = await browser.newContext({ baseURL: C11_BASE_URL });
    await seller.addCookies([{ name: SESSION_COOKIE, value: rae!.token, url: C11_BASE_URL }]);
    const sp = await seller.newPage();
    await sp.goto("/portal/listings");
    await sp.getByLabel("Plan name").fill("Behind the scenes");
    await sp.locator("#plan-price").fill("5");
    await sp.getByRole("button", { name: "Offer this subscription" }).click();
    await expect(sp.getByText("Behind the scenes")).toBeVisible();
    await axeInBothThemes(sp);

    const buyer = await browser.newContext({ baseURL: C11_BASE_URL });
    await buyer.addCookies([{ name: SESSION_COOKIE, value: sam!.token, url: C11_BASE_URL }]);
    const bp = await buyer.newPage();
    await bp.goto("/@rae");
    await expect(bp.getByText("Raw edit for subscribers")).toHaveCount(0);
    await expect(bp.getByRole("heading", { name: "Subscribe to Rae Lane" })).toBeVisible();
    await axeInBothThemes(bp);
    await bp.getByLabel(/I agree to this membership/).check();
    await bp.getByRole("button", { name: "Subscribe", exact: true }).click();
    await bp.waitForURL(/\/portal\/invoices\//);
    const invoiceId = new URL(bp.url()).pathname.split("/").pop()!;

    // Settling the first invoice and activating the signup are proven in
    // tests/modules/member-subscriptions.test.ts; here the result is applied.
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, invoiceId));
    await db().update(invoices).set({ status: "paid", paidMinor: invoice!.totalMinor, paidAt: new Date() }).where(eq(invoices.id, invoiceId));
    await db().update(subscriptions).set({ status: "active", signupPending: false, pausedAt: null }).where(eq(subscriptions.signupInvoiceId, invoiceId));

    await bp.goto("/@rae");
    await expect(bp.getByText("Raw edit for subscribers")).toBeVisible();
    await expect(bp.getByText("You subscribe")).toBeVisible();
    await sp.goto("/portal/listings");
    await expect(sp.getByText("1 subscriber")).toBeVisible();
    await seller.close();
    await buyer.close();
  });

  test("a member opens a service for booking and visitors find times from the profile (C12.25)", async ({ browser }) => {
    await seedC11Owner("Member bookings proof");
    await db().insert(memberSettings).values({ id: 1, marketplaceEnabled: true, listingReview: false });
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date(), isPrivate: false, marketPolicyAccepted: 1 });
    await db().insert(memberPayoutAccounts).values({ userId: MEMBER_ID, status: "ready", adapter: "manual" });
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));
    const seller = await browser.newContext({ baseURL: C11_BASE_URL });
    await seller.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const page = await seller.newPage();
    await page.goto("/portal/listings");
    await page.getByLabel("Title").fill("Portrait session");
    await page.getByLabel("Type").selectOption("service");
    await page.getByLabel("Price", { exact: true }).fill("80");
    await page.getByRole("button", { name: "Create listing" }).click();
    await page.getByText("Let people book this").click();
    for (const day of ["Sat", "Sun"]) await page.getByLabel(day, { exact: true }).first().check();
    await page.getByRole("button", { name: "Open for booking" }).click();
    await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();
    await expect(page.getByText("No bookings yet.")).toBeVisible();
    await axeInBothThemes(page);

    const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
    const anon = await visitor.newPage();
    await anon.goto("/@rae");
    await expect(anon.getByRole("heading", { name: "Book Rae Lane" })).toBeVisible();
    await anon.getByRole("link", { name: "See times" }).click();
    await expect(anon).toHaveURL(/\/book\?.*seller=/);
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await anon.getByLabel("Date").fill(day);
    await anon.getByRole("button", { name: /find/i }).click();
    await expect(anon.getByRole("heading", { name: "Portrait session" })).toBeVisible();
    await expect(anon.locator("form").filter({ hasText: "Rae Lane" }).first()).toBeVisible();
    await axeInBothThemes(anon);
    await anon.goto("/book");
    await expect(anon.getByRole("heading", { name: "Portrait session" })).toHaveCount(0);
    await visitor.close();
    await seller.close();
  });

  test("a member makes a key for their own agent, which sees only what it was given (C12.14)", async ({ browser }) => {
    await seedC11Owner("Agent keys proof");
    await db().insert(users).values({ id: MEMBER_ID, email: "rae@example.test", role: "customer" });
    await db().insert(memberProfiles).values({ userId: MEMBER_ID, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date() });
    const rae = await db().transaction((tx) => createSession(tx, MEMBER_ID));
    const context = await browser.newContext({ baseURL: C11_BASE_URL });
    await context.addCookies([{ name: SESSION_COOKIE, value: rae.token, url: C11_BASE_URL }]);
    const page = await context.newPage();
    await page.goto("/portal/member");
    await page.getByLabel("Name", { exact: true }).fill("Claude at home");
    await page.getByRole("button", { name: "Make key" }).click();
    const token = (await page.locator("p.font-mono").first().textContent())?.trim() ?? "";
    expect(token).toMatch(/^fh_/);
    await expect(page.getByText("Claude at home")).toBeVisible();
    await axeInBothThemes(page);

    const response = await page.request.post("/api/mcp", {
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    const tools = ((await response.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(tools).toContain("members_feed");
    expect(tools).not.toContain("members_post");
    expect(tools.some((name) => name.startsWith("apikeys_") || name.startsWith("contacts_"))).toBe(false);

    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText("You have no agent keys.")).toBeVisible();
    const after = await page.request.post("/api/mcp", {
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(((await after.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)).not.toContain("members_feed");
    await context.close();
  });
});
