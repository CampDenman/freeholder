// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.24: a group video call through a real LiveKit SFU. Two members see and
// hear each other with media marked end-to-end encrypted; a third member whose
// device holds the wrong key receives the same forwarded frames and can decode
// none of them — which is what the SFU itself holds.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { memberDevices, memberFollows, memberGroupCalls, memberProfiles } from "@/modules/members/schema";
import { seedC11Owner, C11_BASE_URL } from "./owner-session";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const RAE = "00000000-0000-4000-8000-0000000000e1";
const SAM = "00000000-0000-4000-8000-0000000000e2";
const KIM = "00000000-0000-4000-8000-0000000000e3";

async function signedIn(browser: Browser, userId: string): Promise<{ context: BrowserContext; page: Page }> {
  const session = await db().transaction((tx) => createSession(tx, userId));
  const context = await browser.newContext({ baseURL: C11_BASE_URL, permissions: ["camera", "microphone"] });
  await context.addCookies([
    { name: SESSION_COOKIE, value: session.token, url: C11_BASE_URL },
    { name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL },
  ]);
  return { context, page: await context.newPage() };
}

/** Width of the decoded video in the tile of the participant whose identity starts with `userId`. */
const decodedWidth = (page: Page, userId: string) =>
  page.locator(`[data-participant^="${userId}:"] video`).evaluate((v: HTMLVideoElement) => v.videoWidth).catch(() => 0);

test.describe("group calls (C12.24)", () => {
  test.setTimeout(180_000);
  test.skip(!process.env.LIVEKIT_URL && !process.env.CI, "needs a LiveKit server (LIVEKIT_URL)");
  test.afterAll(async () => { const { closeDb } = await import("@/core/db"); await closeDb(); });

  test("an encrypted group video call through the SFU", async ({ browser }) => {
    expect(process.env.LIVEKIT_URL, "CI must run the SFU for this test").toBeTruthy();
    await seedC11Owner("Group call proof");
    await db().insert(users).values([
      { id: RAE, email: "rae@example.test", role: "customer" },
      { id: SAM, email: "sam@example.test", role: "customer" },
      { id: KIM, email: "kim@example.test", role: "customer" },
    ]);
    const now = new Date();
    await db().insert(memberProfiles).values([
      { userId: RAE, handle: "rae", displayName: "Rae Lane", ageAttestedAt: now, isPrivate: false },
      { userId: SAM, handle: "sam", displayName: "Sam Ito", ageAttestedAt: now, isPrivate: false },
      { userId: KIM, handle: "kim", displayName: "Kim Roy", ageAttestedAt: now, isPrivate: false },
    ]);
    await db().insert(memberFollows).values([SAM, KIM].map((followerId) => ({ followerId, followeeId: RAE, status: "active" as const })));

    const [rae, sam, kim] = await Promise.all([signedIn(browser, RAE), signedIn(browser, SAM), signedIn(browser, KIM)]);
    for (const side of [sam, kim]) await side.page.goto("/messages");
    await expect.poll(async () => (await db().select().from(memberDevices)).length).toBe(2);
    await rae.page.goto("/messages?to=sam,kim");
    await rae.page.getByLabel("Group name").fill("Crag crew");
    await rae.page.getByLabel("Message", { exact: true }).fill("Video call tonight?");
    await rae.page.getByRole("button", { name: "Send" }).click();
    await expect(rae.page.getByText("Video call tonight?")).toBeVisible();

    await rae.page.getByRole("button", { name: "Start video call" }).click();
    await expect(rae.page).toHaveURL(/\/call\/group\//);
    await expect(rae.page.getByText("Waiting for others to join.")).toBeVisible({ timeout: 30_000 });
    const [call] = await db().select().from(memberGroupCalls);

    await sam.page.goto("/messages");
    await sam.page.getByRole("link", { name: "Crag crew" }).click();
    await sam.page.getByRole("link", { name: "Join the call going on" }).click();
    // Each sees the other, decoded, and marked end-to-end encrypted.
    await expect(sam.page.locator(`[data-participant^="${RAE}:"]`)).toHaveAttribute("data-encrypted", "yes", { timeout: 30_000 });
    await expect(rae.page.locator(`[data-participant^="${SAM}:"]`)).toHaveAttribute("data-encrypted", "yes", { timeout: 30_000 });
    await expect.poll(() => decodedWidth(sam.page, RAE), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => decodedWidth(rae.page, SAM), { timeout: 30_000 }).toBeGreaterThan(0);

    // Kim's device is given a wrong key: the SFU forwards the same frames, and none decode.
    await kim.page.goto("/messages");
    await kim.page.getByRole("link", { name: "Crag crew" }).click();
    await expect(kim.page.getByText("Video call tonight?")).toBeVisible();
    await kim.page.evaluate(async (callId) => {
      const open = indexedDB.open("freeholder-e2ee");
      const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(new Error("idb")); });
      const tx = db.transaction("callKeys", "readwrite");
      tx.objectStore("callKeys").put(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))), callId);
      await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
    }, call!.id);
    await kim.page.goto(`/call/group/${call!.id}`);
    await expect(kim.page.locator(`[data-participant^="${RAE}:"]`)).toBeVisible({ timeout: 30_000 });
    await kim.page.waitForTimeout(5_000);
    expect(await decodedWidth(kim.page, RAE)).toBe(0);
    expect(await decodedWidth(sam.page, RAE)).toBeGreaterThan(0);

    // Leaving ends the call once everyone has gone.
    for (const side of [kim, sam, rae]) await side.page.getByRole("button", { name: "Leave call" }).click();
    await expect.poll(async () => (await db().select({ state: memberGroupCalls.state }).from(memberGroupCalls).where(eq(memberGroupCalls.id, call!.id)))[0]?.state).toBe("ended");
    for (const side of [rae, sam, kim]) await side.context.close();
  });
});
