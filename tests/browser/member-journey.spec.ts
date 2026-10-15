// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.17: the whole member journey, end to end, through the real screens.
// Two people join, follow and befriend, message, and call each other — one
// in Chromium, one in Firefox. One sells a service to the other, the site
// records the payment and pays the seller, both review, and a report reaches
// moderation, where staff act on it.
import { expect, test, firefox, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { memberPayoutAccounts, memberSettings } from "@/modules/members/schema";
import { seedC11Owner, useOwnerSession, C11_BASE_URL } from "./owner-session";

// The test network has no STUN or TURN server, so both browsers must offer
// plain host addresses: Chromium hides them behind mDNS names by default,
// which a headless Firefox cannot resolve. Real sites use STUN/TURN.
test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns"] },
});

const RAE = "00000000-0000-4000-8000-0000000000f1";
const SAM = "00000000-0000-4000-8000-0000000000f2";

/** Records each peer connection's states and candidates, for a failure report. */
const PROBE = () => {
  const Native = window.RTCPeerConnection;
  const seen: string[] = [];
  (window as unknown as { __rtc: string[] }).__rtc = seen;
  window.RTCPeerConnection = class extends Native {
    constructor(config?: RTCConfiguration) {
      super(config);
      const log = (what: string) => seen.push(`${what} c=${this.connectionState} i=${this.iceConnectionState} s=${this.signalingState}`);
      this.addEventListener("connectionstatechange", () => log("conn"));
      this.addEventListener("iceconnectionstatechange", () => log("ice"));
      this.addEventListener("icecandidate", (e) => seen.push(`cand ${e.candidate?.candidate ?? "end"}`));
    }
  };
};

async function signedIn(browser: Browser, userId: string, media = false): Promise<BrowserContext> {
  const session = await db().transaction((tx) => createSession(tx, userId));
  const context = await browser.newContext({ baseURL: C11_BASE_URL, ...(media ? { permissions: ["camera", "microphone"] } : {}) });
  await context.addCookies([
    { name: SESSION_COOKIE, value: session.token, url: C11_BASE_URL },
    { name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL },
  ]);
  return context;
}

async function join(page: Page, handle: string, name: string) {
  await page.goto("/join");
  await page.getByLabel("Handle").fill(handle);
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel(/or older\.$/).first().check();
  await page.getByLabel(/I am an adult/).check();
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await page.waitForURL(/\/portal\/member/);
}

test.describe("the whole member journey (C12.17)", () => {
  test.setTimeout(300_000);
  test.afterAll(async () => { const { closeDb } = await import("@/core/db"); await closeDb(); });

  test("join, connect, message, call across browsers, sell, pay out, review and moderate", async ({ browser }) => {
    const ownerToken = await seedC11Owner("Member journey proof");
    await db().insert(memberSettings).values({ id: 1, marketplaceEnabled: true, listingReview: false, holdDays: 7 });
    await db().insert(users).values([
      { id: RAE, email: "rae@example.test", role: "customer" },
      { id: SAM, email: "sam@example.test", role: "customer" },
    ]);
    await db().insert(contacts).values([
      { email: "rae@example.test", name: "Rae Lane", userId: RAE },
      { email: "sam@example.test", name: "Sam Ito", userId: SAM },
    ]);

    // 1. Two people join.
    const raeContext = await signedIn(browser, RAE, true);
    const rae = await raeContext.newPage();
    await join(rae, "rae", "Rae Lane");
    const samContext = await signedIn(browser, SAM);
    const sam = await samContext.newPage();
    await join(sam, "sam", "Sam Ito");
    await rae.getByLabel(/Who sees my profile/i).first().waitFor({ state: "attached" }).catch(() => undefined);

    // 2. Follow and befriend.
    await sam.goto("/@rae");
    await sam.getByRole("button", { name: /^(Follow|Ask to follow)$/ }).click();
    await sam.getByRole("button", { name: "Add friend" }).click();
    await rae.goto("/@sam");
    await rae.getByRole("button", { name: "Accept friend request" }).click();
    await expect(rae.getByText("Friends", { exact: true })).toBeVisible();

    // 3. Message.
    await sam.goto("/messages?to=rae");
    await sam.locator("#message-body").fill("Hi Rae, could you do a portrait session?");
    await sam.getByRole("button", { name: "Send" }).click();
    await rae.goto("/messages");
    await rae.getByRole("link", { name: /Sam Ito/ }).first().click();
    await expect(rae.getByText("Hi Rae, could you do a portrait session?")).toBeVisible();

    // 4. Call each other: Rae in Chromium, Sam in Firefox.
    const gecko = await firefox.launch({
      firefoxUserPrefs: {
        "media.navigator.streams.fake": true,
        "media.navigator.permission.disabled": true,
        "media.peerconnection.ice.obfuscate_host_addresses": false,
        // CI runners may only share loopback or link-local addresses.
        "media.peerconnection.ice.loopback": true,
        "media.peerconnection.ice.link_local": true,
        "media.peerconnection.ice.default_address_only": false,
      },
    });
    try {
      const samSession = await db().transaction((tx) => createSession(tx, SAM));
      const samFirefox = await gecko.newContext({ baseURL: C11_BASE_URL });
      await samFirefox.addCookies([{ name: SESSION_COOKIE, value: samSession.token, url: C11_BASE_URL }]);
      await samFirefox.addInitScript(PROBE);
      const samGecko = await samFirefox.newPage();
      await samGecko.goto("/feed");
      await rae.addInitScript(PROBE);
      await rae.goto("/@sam");
      await rae.getByRole("button", { name: "Video call" }).click();
      const incoming = samGecko.getByRole("alertdialog", { name: "Rae Lane is calling (video)" });
      await expect(incoming).toBeVisible({ timeout: 20_000 });
      await incoming.getByRole("link", { name: "Answer" }).click();
      try {
        await expect(samGecko.getByRole("status")).toHaveText("Connected", { timeout: 45_000 });
        await expect(rae.getByRole("status")).toHaveText("Connected", { timeout: 45_000 });
      } catch (error) {
        const read = (page: Page) => page.evaluate(() => (window as unknown as { __rtc?: string[] }).__rtc ?? []).catch(() => ["(page gone)"]);
        const report = JSON.stringify({ chromium: await read(rae), firefox: await read(samGecko) }, null, 1);
        // CI keeps the log, not the report folder.
        process.stdout.write(`WEBRTC ${report}\n`);
        await test.info().attach("webrtc", { body: report, contentType: "application/json" });
        throw error;
      }
      await rae.getByRole("button", { name: "Hang up" }).click();
      await expect(samGecko.getByRole("status")).toHaveText("Call ended", { timeout: 15_000 });
      await samFirefox.close();
    } finally {
      await gecko.close();
    }

    // 5. Rae sells a service; Sam buys it.
    await db().insert(memberPayoutAccounts).values({ userId: RAE, status: "ready", adapter: "manual" });
    await rae.goto("/portal/listings");
    await rae.getByLabel("Title").fill("Portrait session");
    await rae.getByLabel("Type").selectOption("service");
    await rae.getByLabel("Price", { exact: true }).fill("120");
    await rae.getByLabel(/I have read and accept the market policy/).check();
    await rae.getByRole("button", { name: "Create listing" }).click();
    await expect(rae.getByRole("link", { name: "Portrait session" })).toBeVisible();

    await sam.goto("/@rae");
    await sam.getByRole("link", { name: "Portrait session" }).click();
    await sam.getByRole("button", { name: /add to cart/i }).click();
    await sam.waitForURL(/[?&](added|cartError)=/);
    expect(sam.url()).toContain("added=");
    await sam.goto("/checkout");
    await expect(sam.getByRole("heading", { name: "Checkout" })).toBeVisible();
    const name = sam.getByLabel("Full name");
    if (await name.isVisible()) await name.fill("Sam Ito");
    await sam.getByLabel("I agree to the terms of sale.").check();
    await sam.getByRole("button", { name: "Place order" }).click();
    await expect(sam.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();

    // 6. The site records the payment; the seller ships; the buyer confirms;
    //    the site pays the seller.
    const admin = await browser.newContext({ baseURL: C11_BASE_URL });
    await useOwnerSession(admin, ownerToken);
    const staff = await admin.newPage();
    await staff.goto("/admin/payments");
    const invoice = staff.getByLabel("Invoice and outstanding balance", { exact: true }).first();
    const option = (await invoice.locator("option").allTextContents()).find((text) => /120/.test(text));
    await invoice.selectOption({ label: option! });
    await staff.getByLabel("Amount", { exact: true }).first().fill((option!.match(/[\d,]+\.\d{2}/)?.[0] ?? "120.00").replace(/,/g, ""));
    await staff.getByLabel("How this payment was verified").fill("C12.17 e-transfer received.");
    await staff.getByLabel("I confirm this money was received and the evidence is accurate.").check();
    await staff.getByRole("button", { name: "Record payment" }).click();
    await expect(staff.getByText("The payment ledger was updated.")).toBeVisible();

    // The payout is recorded by the events that follow the payment.
    await expect(async () => {
      await rae.goto("/portal/sales");
      await expect(rae.getByRole("link", { name: /Portrait session/ })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await rae.getByRole("link", { name: /Portrait session/ }).click();
    await expect(rae.getByText("Payment held")).toBeVisible({ timeout: 15_000 });
    await rae.getByRole("button", { name: "Mark as sent" }).click();
    await expect(rae.getByText("Saved.")).toBeVisible();
    await sam.goto("/portal/purchases");
    await sam.getByRole("link", { name: /Portrait session/ }).click();
    await sam.getByRole("button", { name: "I received it" }).click();
    await expect(sam.getByText("Delivered", { exact: true })).toBeVisible();
    await staff.goto("/admin/members");
    await staff.getByLabel(/@rae ·/).check();
    await staff.getByLabel(/Payment reference/).fill("ETR-1217");
    await staff.getByRole("button", { name: "Mark paid" }).click();
    await expect(staff.getByText("Saved.")).toBeVisible();
    await expect(async () => {
      await rae.goto("/portal/payouts");
      await expect(rae.getByText("Paid", { exact: true }).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // 7. Both review each other; both reviews appear.
    await sam.reload();
    await sam.getByLabel("Rating").selectOption("5");
    await sam.getByLabel(/What should others know/).fill("Lovely portraits, very relaxed.");
    await sam.getByRole("button", { name: "Post review" }).click();
    await rae.goto("/portal/sales");
    await rae.getByRole("link", { name: /Portrait session/ }).click();
    await rae.getByLabel(/What should others know/).fill("Paid quickly, great to work with.");
    await rae.getByRole("button", { name: "Post review" }).click();
    await expect(rae.getByText("Lovely portraits, very relaxed.")).toBeVisible();
    await sam.goto("/@rae");
    await expect(sam.getByText("As a seller: 5 of 5 (1)")).toBeVisible();

    // 8. A report reaches moderation, and staff act on it.
    await rae.goto("/feed");
    await rae.getByLabel("What’s new?").fill("Discount codes at spam.example");
    await rae.getByLabel("Who can see this").selectOption("public");
    await rae.getByRole("button", { name: "Post", exact: true }).click();
    await sam.goto("/feed?view=latest");
    await sam.getByRole("article").filter({ hasText: "Discount codes at spam.example" }).getByRole("link", { name: "Report" }).click();
    await sam.getByLabel("What is wrong?").selectOption("spam");
    await sam.getByRole("button", { name: "Send report" }).click();
    await expect(sam.getByText(/Your report is with the site’s moderators/)).toBeVisible();
    await staff.goto("/admin/members");
    await expect(staff.getByText("Discount codes at spam.example")).toBeVisible();
    await staff.getByLabel(/Reason the member will see/).fill("No advertising links, please.");
    await staff.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(staff.getByText("Nothing has been reported.")).toBeVisible();
    await sam.goto("/feed?view=latest");
    await expect(sam.getByText("Discount codes at spam.example")).toHaveCount(0);

    await admin.close();
    await samContext.close();
    await raeContext.close();
  });
});
