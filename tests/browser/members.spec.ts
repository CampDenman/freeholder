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
import { memberPayouts, memberPosts, memberProfiles, memberSaleFulfilments, memberSettings } from "@/modules/members/schema";
import { contacts } from "@/core/contacts/schema";
import { orderItems, orders, productVariants, products } from "@/modules/catalog/schema";
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
    await page.getByLabel("Price").fill("45");
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
    await page.getByLabel("Price").fill("45");
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
});
