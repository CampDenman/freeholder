// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The Expo application's wiring (C10.23). Rendering needs a device; these are
// the claims that hold without one — and the contract enforcement, which is
// the whole reason C10.13 was written down.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { SCREENS, TAB_ORDER } from "../../packages/mobile-app/src/screens";

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
    expect(callers).toEqual(["src/lib/screen-data.ts"]);
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
    expect(read("app/(tabs)/_layout.tsx")).toContain("TAB_ORDER");
    // The tabs this release actually renders are a subset, and the rest are
    // C10.24 — a tab leading to a screen that does not exist is a dead end.
    expect(TAB_ORDER).toContain("home");
    expect(TAB_ORDER).toContain("catalog");
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
    for (const file of ["src/lib/ui.tsx", "src/screens/sign-in.tsx", "app/(tabs)/index.tsx", "app/(tabs)/catalog.tsx", "app/(tabs)/bookings.tsx", "app/booking/[token].tsx", "app/(tabs)/invoices.tsx", "app/invoice/[id].tsx", "app/(tabs)/galleries.tsx", "app/gallery/[slug].tsx", "src/lib/gallery-image.ts"]) {
      const source = read(file).replace(/^\s*\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("gives every built screen a loading, empty and error state", () => {
    // F04: a screen that renders nothing while it waits looks broken.
    for (const file of ["app/(tabs)/index.tsx", "app/(tabs)/catalog.tsx", "app/(tabs)/bookings.tsx", "app/booking/[token].tsx", "app/(tabs)/invoices.tsx", "app/invoice/[id].tsx", "app/(tabs)/galleries.tsx", "app/gallery/[slug].tsx"]) {
      const source = read(file);
      expect(source, file).toContain("Loading");
      expect(source, file).toMatch(/Empty|emptyKey/);
      expect(source, file).toContain("Problem");
    }
  });

  it("proofs through the declared gallery services and private image bytes (C10.27)", () => {
    expect(TAB_ORDER).toEqual(["home", "catalog", "bookings", "invoices", "galleries", "account"]);
    expect(read("app/(tabs)/_layout.tsx")).toContain('"galleries"');
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
});
