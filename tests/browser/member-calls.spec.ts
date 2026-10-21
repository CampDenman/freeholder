// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.07: two members in two real browser contexts ring, answer, connect
// peer to peer over WebRTC with fake camera and microphone, and hang up.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { memberFriendships, memberProfiles } from "@/modules/members/schema";
import { seedC11Owner, C11_BASE_URL } from "./owner-session";

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

const RAE = "00000000-0000-4000-8000-0000000000e1";
const SAM = "00000000-0000-4000-8000-0000000000e2";

test.describe("member calls (C12.07)", () => {
  test.setTimeout(120_000);
  test.afterAll(async () => { const { closeDb } = await import("@/core/db"); await closeDb(); });

  test("a friend rings, the other answers, both connect, and hanging up ends it for both", async ({ browser }) => {
    await seedC11Owner("Calls proof");
    await db().insert(users).values([
      { id: RAE, email: "rae@example.test", role: "customer" },
      { id: SAM, email: "sam@example.test", role: "customer" },
    ]);
    const now = new Date();
    await db().insert(memberProfiles).values([
      { userId: RAE, handle: "rae", displayName: "Rae Lane", ageAttestedAt: now },
      { userId: SAM, handle: "sam", displayName: "Sam Ito", ageAttestedAt: now },
    ]);
    const [low, high] = [RAE, SAM].sort();
    await db().insert(memberFriendships).values({ lowId: low!, highId: high!, requestedBy: SAM, status: "accepted", acceptedAt: now });
    const [rae, sam] = await Promise.all([
      db().transaction((tx) => createSession(tx, RAE)),
      db().transaction((tx) => createSession(tx, SAM)),
    ]);
    const context = async (token: string) => {
      const c = await browser.newContext({ baseURL: C11_BASE_URL, permissions: ["camera", "microphone"] });
      await c.addCookies([{ name: SESSION_COOKIE, value: token, url: C11_BASE_URL }]);
      return c;
    };
    const samContext = await context(sam.token);
    const raeContext = await context(rae.token);
    const raePage = await raeContext.newPage();
    await raePage.goto("/feed");

    const samPage = await samContext.newPage();
    await samPage.goto("/@rae");
    await samPage.getByRole("button", { name: "Video call" }).click();
    await expect(samPage).toHaveURL(/\/call\/[0-9a-f-]{36}$/);
    await expect(samPage.getByRole("status")).toHaveText("Ringing…");

    const incoming = raePage.getByRole("alertdialog", { name: "Sam Ito is calling (video)" });
    await expect(incoming).toBeVisible({ timeout: 15_000 });
    const scan = await new AxeBuilder({ page: raePage }).include("[role=alertdialog]").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations).toEqual([]);
    await incoming.getByRole("link", { name: "Answer" }).click();
    await expect(raePage).toHaveURL(/\/call\/[0-9a-f-]{36}$/);

    await expect(raePage.getByRole("status")).toHaveText("Connected", { timeout: 30_000 });
    await expect(samPage.getByRole("status")).toHaveText("Connected", { timeout: 30_000 });
    await samPage.getByRole("button", { name: "Mute" }).click();
    await expect(samPage.getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");

    await samPage.getByRole("button", { name: "Hang up" }).click();
    await expect(samPage.getByRole("status")).toHaveText("Call ended");
    await expect(raePage.getByRole("status")).toHaveText("Call ended", { timeout: 15_000 });
    await samContext.close();
    await raeContext.close();
  });
});
