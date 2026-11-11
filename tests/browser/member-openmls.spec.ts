// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.39: actual browser upgrades of synthetic pre-OpenMLS devices. Private
// fixture keys remain in this disposable test browser and never enter delivery.
import { THEME_COOKIE } from "@/core/design/theme";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { businessProfile } from "@/core/settings/schema";
import { memberFollows, memberMessages, memberMlsGroups, memberProfiles } from "@/modules/members/schema";
import type { E2eeStore, E2eeTransport } from "@/modules/members/e2ee/engine";
import { LegacyE2eeDevice } from "../helpers/legacy-e2ee";
import { memoryStore } from "../helpers/e2ee-store";
import { seedC11Owner, C11_BASE_URL } from "./owner-session";

const RAE = "00000000-0000-4000-8000-0000000000e1";
const SAM = "00000000-0000-4000-8000-0000000000e2";
async function signedIn(browser: Browser, userId: string) {
  const session = await db().transaction((tx) => createSession(tx, userId));
  const context = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 820 } });
  const csrf = issueCsrfToken();
  await context.addCookies([{ name: SESSION_COOKIE, value: session.token, url: C11_BASE_URL }, { name: CSRF_COOKIE, value: csrf, url: C11_BASE_URL }]);
  const call = async (name: string, input: unknown) => {
    const response = await context.request.post(`/api/v1/members.${name}`, { data: input, headers: { [CSRF_HEADER]: csrf } });
    const body: unknown = await response.json();
    const error = (body as { error?: { message?: string; code?: string } }).error;
    if (!response.ok()) throw Object.assign(new Error(error?.message ?? "Synthetic fixture API failed"), { code: error?.code });
    return body;
  };
  const names = { register: "registerDevice", publish: "publishKeyPackages", sync: "e2eeSync", claim: "claimKeyPackages", commit: "e2eeCommit", send: "sendEncrypted", sendCallKey: "sendCallKey", requestHistory: "requestHistory", historyRequests: "historyRequests", sendHistory: "sendHistory", closeHistory: "closeHistoryRequest", receivedHistory: "receivedHistory", ackHistory: "ackHistory" };
  const transport = Object.fromEntries(Object.entries(names).map(([key, value]) => [key, (input: unknown) => call(value, input)])) as unknown as E2eeTransport;
  return { context, page: await context.newPage(), transport, call };
}
async function installLegacyStore(page: Page, store: E2eeStore, conversationId: string) {
  const device = (await store.device())!;
  const group = (await store.group(conversationId))!;
  const messages = [...await store.messages(conversationId)];
  await page.goto("/privacy");
  await page.evaluate(async ({ device, group, conversationId, messages }) => {
    const open = indexedDB.open("freeholder-e2ee", 4);
    open.onupgradeneeded = () => { for (const name of ["device", "keyPackages", "groups", "messages", "callKeys", "seenDevices", "history"]) if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name); };
    const database = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(new Error("Fixture IndexedDB open failed")); });
    const tx = database.transaction(["device", "groups", "messages"], "readwrite");
    tx.objectStore("device").put({ ...device, signKey: new Uint8Array(device.signKey), publicKey: new Uint8Array(device.publicKey) }, "self");
    tx.objectStore("groups").put({ ...group, state: new Uint8Array(group.state) }, conversationId);
    tx.objectStore("messages").put(Object.fromEntries(messages), conversationId);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error("Fixture IndexedDB write failed")); });
    database.close();
  }, { device: { ...device, signKey: [...device.signKey], publicKey: [...device.publicKey] }, group: { ...group, state: [...group.state!] }, conversationId, messages });
}
async function nativeState(page: Page, conversationId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const open = indexedDB.open("freeholder-e2ee");
    const database = await new Promise<IDBDatabase>((resolve) => { open.onsuccess = () => resolve(open.result); });
    const read = database.transaction("groups").objectStore("groups").get(id);
    const value = await new Promise<{ state?: Uint8Array }>((resolve) => { read.onsuccess = () => resolve(read.result as { state?: Uint8Array }); });
    database.close();
    return Boolean(value?.state && new TextDecoder().decode(value.state).startsWith("freeholder:openmls:v1\n"));
  }, conversationId);
}

test.describe("existing member devices migrate to OpenMLS (C12.39)", () => {
  test.setTimeout(180_000);
  test.afterAll(async () => { const { closeDb } = await import("@/core/db"); await closeDb(); });
  test("preserves identities, messages and history across an old client's skipped public commit", async ({ browser }) => {
    await seedC11Owner("OpenMLS browser proof");
    await db().update(businessProfile).set({ enabledLocales: ["en", "es", "fr", "ar"] });
    await db().insert(users).values([{ id: RAE, email: "rae@example.test", role: "customer" }, { id: SAM, email: "sam@example.test", role: "customer" }]);
    await db().insert(memberProfiles).values([{ userId: RAE, handle: "rae", displayName: "Rae Lane", ageAttestedAt: new Date(), isPrivate: false }, { userId: SAM, handle: "sam", displayName: "Sam Ito", ageAttestedAt: new Date(), isPrivate: false }]);
    await db().insert(memberFollows).values([{ followerId: RAE, followeeId: SAM, status: "active" }, { followerId: SAM, followeeId: RAE, status: "active" }]);
    const rae = await signedIn(browser, RAE), sam = await signedIn(browser, SAM);
    const raeStore = memoryStore(), samStore = memoryStore();
    const legacy = (userId: string, store: E2eeStore, transport: E2eeTransport) => new LegacyE2eeDevice(userId, store as unknown as ConstructorParameters<typeof LegacyE2eeDevice>[1], transport, "Existing browser");
    const legacyRae = legacy(RAE, raeStore, rae.transport), legacySam = legacy(SAM, samStore, sam.transport);
    await Promise.all([legacyRae.device(), legacySam.device()]);
    const { id } = await rae.call("startConversation", { handles: ["sam"] }) as { id: string };
    await legacyRae.send(id, "Before OpenMLS: opal-lantern");
    await legacySam.sync(id);
    const before = (await legacyRae.verification(id))!;
    await installLegacyStore(rae.page, raeStore, id);
    const errors: string[] = [];
    rae.page.on("pageerror", (error) => errors.push(error.message));
    let wasmRequests = 0;
    await rae.page.route("**/_freeholder/openmls/0.1.0/freeholder_openmls_bg.wasm", async (route) => {
      wasmRequests++;
      if (wasmRequests === 1) await route.abort("failed");
      else await route.continue();
    });
    await rae.page.goto(`/messages/${id}`);
    await expect.poll(() => wasmRequests).toBeGreaterThanOrEqual(1);
    await rae.page.bringToFront();
    // Retry in this document: no page reload, local-state reset or new identity.
    await rae.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

    await expect.poll(() => nativeState(rae.page, id)).toBe(true);
    expect(wasmRequests).toBeGreaterThan(1);
    await expect(rae.page.getByText("Before OpenMLS: opal-lantern", { exact: true })).toBeVisible();
    await rae.page.locator("textarea[name=body]").fill("After OpenMLS: cedar-window");
    await rae.page.getByRole("button", { name: "Send", exact: true }).focus();
    await rae.page.keyboard.press("Enter");
    await expect(rae.page.getByText("After OpenMLS: cedar-window", { exact: true })).toBeVisible();
    await legacySam.sync(id); // old client advances its cursor past the public resync
    await installLegacyStore(sam.page, samStore, id);
    await sam.page.goto(`/messages/${id}`);
    await expect.poll(() => nativeState(sam.page, id)).toBe(true);
    await expect(sam.page.getByText("After OpenMLS: cedar-window", { exact: true })).toBeVisible();
    await sam.page.locator("textarea[name=body]").fill("The existing device still replies");
    await sam.page.getByRole("button", { name: "Send", exact: true }).click();
    await rae.page.reload();
    await expect(rae.page.getByText("The existing device still replies", { exact: true })).toBeVisible({ timeout: 20_000 });
    const secondTab = await rae.context.newPage();
    await secondTab.goto(`/messages/${id}`);
    await expect.poll(() => nativeState(secondTab, id)).toBe(true);
    await rae.page.locator("textarea[name=body]").fill("First real tab concurrent send");
    await secondTab.locator("textarea[name=body]").fill("Second real tab concurrent send");
    await Promise.all([rae.page.getByRole("button", { name: "Send", exact: true }).click(), secondTab.getByRole("button", { name: "Send", exact: true }).click()]);
    await expect(rae.page.getByText("First real tab concurrent send", { exact: true })).toBeVisible();
    await expect(secondTab.getByText("Second real tab concurrent send", { exact: true })).toBeVisible();
    await sam.page.reload();
    await expect(sam.page.getByText("First real tab concurrent send", { exact: true })).toBeVisible();
    await expect(sam.page.getByText("Second real tab concurrent send", { exact: true })).toBeVisible();
    await secondTab.close();
    const actualDevices = await rae.page.evaluate(async (conversationId) => {
      const open = indexedDB.open("freeholder-e2ee");
      const database = await new Promise<IDBDatabase>((resolve) => { open.onsuccess = () => resolve(open.result); });
      const request = database.transaction("groups").objectStore("groups").get(conversationId);
      const saved = await new Promise<{ state: Uint8Array }>((resolve) => { request.onsuccess = () => resolve(request.result as { state: Uint8Array }); });
      database.close();
      return (JSON.parse(new TextDecoder().decode(saved.state).split("\n").slice(1).join("\n")) as { value: { devices: { deviceId: string; signatureKey: string }[] } }).value.devices.map((d) => [d.deviceId, d.signatureKey]).sort();
    }, id);
    expect(actualDevices).toEqual(before.devices.map((d) => [d.deviceId, d.signatureKey]).sort());
    const tablet = await signedIn(browser, SAM);
    await tablet.page.goto("/messages");
    await tablet.page.getByText("Bring earlier messages to this browser", { exact: true }).click();
    await tablet.page.getByRole("button", { name: "Ask my other devices", exact: true }).click();
    await expect(tablet.page.locator("[data-my-code]")).toBeVisible();
    const shown = await tablet.page.locator("[data-my-code]").innerText();
    await sam.page.goto("/messages");
    await expect(sam.page.locator("[data-history-code]")).toHaveText(shown);
    await sam.page.getByRole("button", { name: "Send my messages", exact: true }).click();
    await expect(tablet.page.getByText(/Brought [0-9]+ earlier messages to this browser/)).toBeVisible({ timeout: 20_000 });
    await rae.page.reload(); // admits the newly registered device before its next send
    await tablet.page.goto(`/messages/${id}`);
    await expect(tablet.page.getByText("Before OpenMLS: opal-lantern", { exact: true })).toBeVisible();
    await expect(tablet.page.getByText("After OpenMLS: cedar-window", { exact: true })).toBeVisible();
    await tablet.context.close();
    const stored = JSON.stringify(await db().select().from(memberMessages));
    expect(stored).not.toContain("opal-lantern");
    expect(stored).not.toContain("cedar-window");
    expect((await db().select().from(memberMlsGroups).where(eq(memberMlsGroups.conversationId, id)))[0]!.epoch).toBeGreaterThanOrEqual(3);
    for (const locale of ["en", "es", "fr", "ar"]) {
      for (const theme of ["light", "dark"]) {
        await rae.context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
        await rae.page.goto(`${locale === "en" ? "" : `/${locale}`}/messages/${id}`);
        await expect(rae.page.locator("html")).toHaveAttribute("lang", locale);
        await expect(rae.page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
        await expect(rae.page.getByText("After OpenMLS: cedar-window", { exact: true })).toBeVisible();
        await rae.page.locator("textarea[name=body]").focus();
        await rae.page.keyboard.press("Tab");
        expect(await rae.page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))).toEqual({ viewport: 320, document: 320 });
        const control = await rae.page.locator("#sealed-files").evaluate((element) => { const bounds = element.getBoundingClientRect(); const parent = element.parentElement!.getBoundingClientRect(); return { inside: bounds.left >= parent.left && bounds.right <= parent.right, visible: bounds.width > 0 }; });
        expect(control).toEqual({ inside: true, visible: true });
        expect((await new AxeBuilder({ page: rae.page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        await rae.page.screenshot({ path: test.info().outputPath(`openmls-${locale}-${theme}.png`), fullPage: true });
      }
    }
    expect(errors).toEqual([]);
    await rae.context.close(); await sam.context.close();
  });
});
