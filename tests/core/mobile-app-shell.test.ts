// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The Expo application's wiring (C10.23). Rendering needs a device; these are
// the claims that hold without one — and the contract enforcement, which is
// the whole reason C10.13 was written down.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { SCREENS, TAB_ORDER, OWNER_TAB_ORDER, tabFileName } from "../../packages/mobile-app/src/screens";

const read = (path: string) => readFileSync(`apps/mobile/${path}`, "utf8");

/**
 * The file with its commentary removed.
 *
 * These files explain *why* AsyncStorage and colour literals are wrong, and a
 * check that cannot tell an explanation from an implementation would forbid
 * saying so.
 */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the Expo application (C10.23)", () => {
  it("keeps the write-contract assertion in the shared write helper (C10.24)", () => {
    const paths = ["app", "src"].flatMap((directory) => readdirSync(`apps/mobile/${directory}`, { recursive: true })
      .map((entry) => `${directory}/${String(entry).replace(/\\/g, "/")}`).filter((path) => /\.tsx?$/.test(path)));
    const callers = paths.filter((path) => /assertOnContract\([^)]*,\s*true\)/.test(code(path)));
    expect(callers.sort()).toEqual(["src/lib/capture.ts", "src/lib/screen-data.ts"]);
    const helper = code("src/lib/screen-data.ts");
    expect(helper).toContain("export function useScreenWrite");
    expect(helper).toContain("await writeThrough({ service, online }");
    for (const path of paths.filter((path) => path.startsWith("app/") || path.startsWith("src/screens/"))) {
      expect(code(path), path).not.toMatch(/\bcallService\b|\bfetch\s*\(|assertOnContract\s*\(/);
    }
  });

  it("resolves contract copy and keeps read dependencies stable (C10.24)", () => {
    for (const file of ["app/(tabs)/index.tsx", "app/(tabs)/catalog.tsx", "app/(tabs)/_layout.tsx"]) {
      expect(code(file), file).toContain("useAppText");
      expect(code(file), file).not.toMatch(/message=\{SCREENS\./);
    }
    const data = code("src/lib/screen-data.ts");
    expect(data).toContain("[screen, service, instanceUrl, token, scopedCache, privateCache, serialized, enabled, visible, identity, reload]");
    expect(data).toContain("useSyncExternalStore(privateCaches.subscribe");
    expect(data).toContain("state.identity !== identity || state.cache !== scopedCache || state.scope !== privateCache || !visible");
    expect(data).toContain("maxAgeMs: PRIVATE_CACHE_LEASE_MS");
    expect(data).toContain("result.expiresAt - Date.now()");
  });
  it("stays outside the root pnpm workspace", () => {
    // Every CI job runs `pnpm install --frozen-lockfile` at the root. A React
    // Native dependency graph that only one app needs must not be billed to
    // all of them.
    const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
    expect(workspace).toContain('"packages/*"');
    expect(workspace).not.toContain("apps/");
  });

  it("declares the scheme its own push links use", () => {
    // `pushLink()` mints freeholder://…; the binary has to claim that scheme
    // or every push it sends opens nothing.
    const config = JSON.parse(read("app.json")) as { expo: { scheme: string } };
    expect(config.expo.scheme).toBe("freeholder");
  });

  it("keeps the session in the platform keychain, never in JS-reachable storage", () => {
    // §35.1. AsyncStorage is a JSON file in the app sandbox that lands in
    // unencrypted device backups.
    const instance = code("src/lib/instance.tsx");
    expect(instance).toContain("expo-secure-store");
    expect(instance).not.toContain("AsyncStorage");
  });

  it("takes its tab order from the contract rather than retyping it", () => {
    expect(read("app/(tabs)/_layout.tsx")).toContain("tabOrderFor");
    expect(read("app/(tabs)/_layout.tsx")).toContain("OWNER_TAB_ORDER");
    expect(TAB_ORDER).toContain("home");
    expect(TAB_ORDER).toContain("catalog");
    expect(OWNER_TAB_ORDER).toContain("today");
  });

  it("asks only for services its screen contract allows", () => {
    // Home reads portal.myRecords; catalog reads catalog.listVisibleProducts. If a
    // screen ever asks for something else, `assertOnContract` throws before a
    // request is made.
    expect(read("app/(tabs)/index.tsx")).toContain('service: "portal.myRecords"');
    expect(SCREENS.home.reads).toContain("portal.myRecords");
    expect(read("app/(tabs)/catalog.tsx")).toContain('service: "catalog.listVisibleProducts"');
    expect(SCREENS.catalog.reads).toContain("catalog.listVisibleProducts");
  });

  it("speaks the platform's own HTTP API, not a mobile endpoint", () => {
    // §35.1: "There is no mobile-only endpoint, no mobile-only business rule."
    const data = code("src/lib/screen-data.ts");
    expect(data).toContain("/api/v1/");
    expect(data).not.toMatch(/\/api\/mobile|\/mobile\/v1/);
  });

  it("renders no colour of its own", () => {
    // Colours come from the instance's semantic tokens. A literal here is a
    // colour that cannot be rebranded without a store review.
    for (const file of ["src/lib/ui.tsx", "src/screens/sign-in.tsx", "app/(tabs)/index.tsx", "app/(tabs)/catalog.tsx", "app/(tabs)/bookings.tsx", "app/booking/[token].tsx", "app/(tabs)/invoices.tsx", "app/invoice/[id].tsx", "app/(tabs)/galleries.tsx", "app/gallery/[slug].tsx", "src/lib/gallery-image.ts", "app/(tabs)/account.tsx", "app/messages.tsx", "app/message/[id].tsx", "app/newsletters.tsx", "app/(tabs)/today.tsx", "app/(tabs)/owner-invoices.tsx", "app/owner-invoice/[id].tsx", "app/(tabs)/inbox.tsx", "app/inbox-thread/[id].tsx", "app/(tabs)/reviews.tsx", "app/approvals.tsx", "app/agents.tsx", "app/(tabs)/alerts.tsx", "app/capture.tsx", "app/(tabs)/staff-account.tsx", "src/lib/capture.ts", "src/lib/capture-store.ts", "src/lib/staff.tsx"]) {
      const source = read(file).replace(/^\s*\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("gives every built screen a loading, empty and error state", () => {
    // F04: a screen that renders nothing while it waits looks broken.
    for (const file of ["app/(tabs)/index.tsx", "app/(tabs)/catalog.tsx", "app/(tabs)/bookings.tsx", "app/booking/[token].tsx", "app/(tabs)/invoices.tsx", "app/invoice/[id].tsx", "app/(tabs)/galleries.tsx", "app/gallery/[slug].tsx", "app/(tabs)/account.tsx", "app/messages.tsx", "app/message/[id].tsx", "app/newsletters.tsx", "app/(tabs)/today.tsx", "app/(tabs)/owner-invoices.tsx", "app/owner-invoice/[id].tsx", "app/(tabs)/inbox.tsx", "app/inbox-thread/[id].tsx", "app/(tabs)/reviews.tsx", "app/approvals.tsx", "app/agents.tsx", "app/(tabs)/alerts.tsx", "app/capture.tsx", "app/(tabs)/staff-account.tsx"]) {
      const source = read(file);
      expect(source, file).toContain("Loading");
      expect(source, file).toMatch(/Empty|emptyKey/);
      expect(source, file).toContain("Problem");
    }
  });

  it("proofs through the declared gallery services and private image bytes (C10.27)", () => {
    expect(TAB_ORDER).toEqual(["home", "catalog", "bookings", "invoices", "galleries", "account"]);
    expect(read("app/(tabs)/_layout.tsx")).toContain("ALL_TABS.map");
    expect(code("app/(tabs)/_layout.tsx")).not.toContain("BUILT");
    const list = read("app/(tabs)/galleries.tsx");
    expect(list).toContain('service: "portal.myRecords"');
    expect(SCREENS.galleries.reads).toContain("portal.myRecords");
    const proof = read("app/gallery/[slug].tsx");
    expect(proof).toContain('service: "galleries.openWithLogin"');
    expect(proof).toContain('service: "galleries.viewSession"');
    expect(proof).toContain('service: "galleries.setSelection"');
    expect(proof).toContain('service: "galleries.clearSelection"');
    expect(proof).toContain('service: "galleries.submitRound"');
    expect(proof).toContain("usePrivateImage");
    expect(proof).toContain("useScreenWrite");
    expect(code("app/gallery/[slug].tsx")).not.toMatch(/\bgalleries\.list\b|\bgalleries\.listSelections\b/);
    expect(code("app/gallery/[slug].tsx")).toContain("held?.identity === identity");
    expect(code("app/gallery/[slug].tsx")).toContain("request !== generation.current");
    expect(code("app/gallery/[slug].tsx")).toContain("opening.current = false");
    expect(code("app/gallery/[slug].tsx")).toContain("open.pending");
    expect(code("app/gallery/[slug].tsx")).toContain("A request is already in progress.");
    expect(code("app/gallery/[slug].tsx")).toContain("FlatList");
    const images = code("src/lib/gallery-image.ts");
    expect(images).toContain("/g/");
    expect(images).toContain("/view/");
    expect(images).toContain("authorization");
    expect(images).toContain("maxAgeMs: PRIVATE_CACHE_LEASE_MS");
    expect(images).toContain("result.expiresAt - Date.now()");
    expect(images).not.toMatch(/\/api\/v1\/galleries\.viewItem/);
    expect(code("src/lib/transport.ts")).toContain("status: response.status");
    expect(code("src/lib/transport.ts")).toContain("export async function decodeGalleryImageResponse");
  });

  it("wires customer reply, newsletters and account sign-out (C10.28)", () => {
    expect(read("app/(tabs)/account.tsx")).toContain('service: "portal.myProfile"');
    expect(read("app/(tabs)/account.tsx")).toContain('service: "portal.myRecords"');
    expect(read("app/(tabs)/account.tsx")).toContain('service: "notifications.revokeDevice"');
    expect(read("app/messages.tsx")).toContain('service: "conversations.list"');
    expect(read("app/message/[id].tsx")).toContain('service: "conversations.get"');
    expect(read("app/message/[id].tsx")).toContain('service: "conversations.replyAsContact"');
    expect(code("app/message/[id].tsx")).not.toMatch(/\bconversations\.reply\b/);
    expect(read("app/newsletters.tsx")).toContain('service: "newsletters.listPublic"');
    expect(read("app/newsletters.tsx")).toContain('service: "newsletters.listPublicIssues"');
    expect(read("app/newsletters.tsx")).toContain('service: "newsletters.subscribe"');
    expect(read("app/newsletters.tsx")).toContain('service: "privacy.setMyMarketingPreference"');
    expect(code("app/newsletters.tsx")).not.toMatch(/\bnewsletters\.unsubscribe\b/);
    expect(read("src/screens/sign-in.tsx")).toContain("challengeToken");
    expect(read("src/screens/sign-in.tsx")).toContain("app.auth.verify");
    expect(read("src/screens/sign-in.tsx")).toContain("app.auth.recovery");
    expect(code("src/screens/sign-in.tsx")).toContain('keyboardType="number-pad"');
    expect(code("src/screens/sign-in.tsx")).toContain('keyboardType="default"');
    expect(code("src/screens/sign-in.tsx")).toContain("methods.recovery");
    expect(code("src/screens/sign-in.tsx")).toContain("methods.totp");
  });

  it("wires owner companion screens through existing services (C10.17)", () => {
    expect(read("src/lib/instance.tsx")).toContain("resolveSessionRole");
    expect(read("src/lib/instance.tsx")).toContain("sessionAudience");
    expect(read("app/(tabs)/_layout.tsx")).toContain("tabOrderFor");
    expect(read("app/(tabs)/_layout.tsx")).toContain("href: visible.has(name) ? undefined : null");
    expect(read("app/(tabs)/today.tsx")).toContain('service: "briefing.today"');
    expect(read("app/(tabs)/today.tsx")).toContain('service: "bookings.list"');
    expect(read("app/(tabs)/owner-invoices.tsx")).toContain('service: "invoicing.list"');
    expect(read("app/(tabs)/owner-invoices.tsx")).toContain('service: "invoicing.createDraft"');
    expect(code("app/(tabs)/owner-invoices.tsx")).not.toContain("invoicing.issue");
    expect(code("app/(tabs)/owner-invoices.tsx")).not.toContain("not_applicable");
    expect(code("app/(tabs)/owner-invoices.tsx")).toContain('mode: "calculate"');
    expect(read("app/owner-invoice/[id].tsx")).toContain('service: "invoicing.get"');
    expect(read("app/owner-invoice/[id].tsx")).toContain('service: "invoicing.issue"');
    expect(read("app/(tabs)/inbox.tsx")).toContain('service: "conversations.list"');
    expect(read("app/inbox-thread/[id].tsx")).toContain('service: "conversations.reply"');
    expect(code("app/inbox-thread/[id].tsx")).not.toMatch(/\breplyAsContact\b/);
    expect(read("app/(tabs)/reviews.tsx")).toContain('service: "reviews.moderate"');
    expect(read("app/approvals.tsx")).toContain('service: "agents.listApprovals"');
    expect(read("app/agents.tsx")).toContain('service: "agents.list"');
    expect(read("app/(tabs)/alerts.tsx")).toContain('service: "notifications.list"');
    expect(read("app/capture.tsx")).toContain("enqueuePickedCapture");
    expect(read("app/capture.tsx")).toContain("app.capture.discard");
    expect(read("app/capture.tsx")).toContain("app.capture.confirm");
    expect(read("app/capture.tsx")).toContain("app.capture.consent");
    expect(read("app/capture.tsx")).toContain("app.capture.pause");
    expect(read("app/capture.tsx")).toContain("app.capture.resume");
    expect(read("app/capture.tsx")).toContain("app.capture.cancel");
    expect(read("app/capture.tsx")).toContain("app.capture.retry");
    expect(read("app/capture.tsx")).toContain("app.capture.destination");
    expect(read("app/capture.tsx")).toContain("app.capture.batches");
    expect(read("app/capture.tsx")).toContain("catalog.listProducts");
    expect(read("app/capture.tsx")).toContain("cms.listPages");
    expect(code("app/capture.tsx")).not.toMatch(/data\.error \? <Problem[\s\S]*?: <ScrollView/);
    expect(code("src/lib/capture-store.ts")).toContain("createCaptureBatchStore");
    expect(code("src/lib/capture-store.ts")).toContain("copySync");
    expect(code("src/lib/capture.ts")).toContain("enqueuePickedCapture");
    expect(read("src/lib/instance.tsx")).toContain("bindCaptureBatches");
    expect(read("src/lib/instance.tsx")).toContain("clearCaptureBatches");
    expect(code("src/lib/capture.ts")).toContain("/api/media");
    expect(code("src/lib/capture.ts")).toContain("media.signUploadParts");
    expect(code("src/lib/capture.ts")).toContain("media.completeUpload");
    expect(code("src/lib/capture.ts")).toContain("captureStartService");
    expect(code("src/lib/capture.ts")).not.toMatch(/\/api\/mobile/);
    expect(read("src/lib/staff.tsx")).toContain('audience !== "staff"');
    for (const file of ["app/(tabs)/today.tsx", "app/(tabs)/owner-invoices.tsx", "app/owner-invoice/[id].tsx", "app/(tabs)/inbox.tsx", "app/inbox-thread/[id].tsx", "app/(tabs)/reviews.tsx", "app/approvals.tsx", "app/agents.tsx", "app/(tabs)/alerts.tsx", "app/capture.tsx", "app/(tabs)/staff-account.tsx"]) {
      expect(read(file), file).toContain("StaffScreen");
      expect(read(file), file).toContain('audience === "staff"');
    }
    expect(read("app/inbox-thread/[id].tsx")).toContain("app.inbox.customer");
    expect(read("app/approvals.tsx")).toContain("app.approvals.needNote");
    expect(read("app/(tabs)/staff-account.tsx")).toContain('service: "auth.whoami"');
    for (const id of OWNER_TAB_ORDER) {
      expect(read("app/(tabs)/_layout.tsx")).toContain("tabFileName");
      expect(tabFileName(id)).toBeTruthy();
    }
    expect(SCREENS.capture.writes).toContain("media.beginUpload");
    expect(SCREENS.capture.writes).toContain("media.signUploadParts");
    expect(SCREENS.capture.writes).toContain("media.completeUpload");
  });
});
