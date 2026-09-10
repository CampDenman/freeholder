// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer app package (C10.12). Everything worth testing here is what the
// app does when something is *wrong* — a mistyped address, a contract it does
// not understand, no signal, a broken fingerprint sensor — because those are
// the paths a simulator screenshot never covers.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CONTRACT_VERSION, checkCompatibility } from "@/core/discovery";
import {
  APP_CONTRACT_VERSION,
  formatMoney,
  brandFrom,
  discover,
  freshnessLabel,
  loadSession,
  normalizeAddress,
  OfflineWriteRefused,
  readThrough,
  writeThrough,
  saveSession,
  signOut,
  signIn,
  redeemSignInLink,
  unlockOnResume,
  type Cache,
  type Instance,
  type SecretStore,
} from "../../packages/mobile-app/src/index";

function document(overrides: Record<string, unknown> = {}) {
  return {
    freeholder: true as const,
    contractVersion: CONTRACT_VERSION,
    platformVersion: "0.1.0",
    name: "Aurora Coast Photography",
    tagline: "Weddings on the west coast",
    locales: { default: "en", enabled: ["en"] },
    currency: "CAD",
    timezone: "America/Vancouver",
    country: "CA",
    branding: { logoUrl: null, colors: {}, fontSans: null },
    api: { base: "", openapi: "", mcp: "" },
    storeUrls: { ios: "https://apps.apple.test/x", android: null },
    ...overrides,
  };
}

function fetching(payload: unknown, status = 200) {
  return async () => ({ ok: status < 400, status, json: async () => payload });
}

function memoryStore(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

function memoryCache(): Cache {
  const data = new Map<string, string>();
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

describe("the customer app (C10.12)", () => {
  describe("typing an address", () => {
    it("accepts what people actually type", () => {
      for (const typed of [
        "example.com",
        "www.example.com/",
        "https://example.com/portal",
        "  Example.com ",
      ]) {
        const result = normalizeAddress(typed);
        expect("url" in result, typed).toBe(true);
      }
    });

    it("insists on https, because everything after this carries a token", () => {
      const result = normalizeAddress("http://example.com");
      expect("error" in result).toBe(true);
      if (!("error" in result)) return;
      expect(result.error.ok).toBe(false);
      if (result.error.ok) return;
      expect(result.error.reason).toBe("insecure");
    });

    it("still allows loopback, so a developer can point at their own machine", () => {
      expect("url" in normalizeAddress("http://localhost:3000")).toBe(true);
    });

    it("rejects something that is not an address at all", () => {
      const result = normalizeAddress("my photographer");
      expect("error" in result).toBe(true);
      if (!("error" in result)) return;
      expect(result.error.ok).toBe(false);
      if (result.error.ok) return;
      expect(result.error.reason).toBe("invalid-address");
    });
  });

  describe("discovering an instance", () => {
    it("reads the name, brand and API from the well-known document", async () => {
      const result = await discover("example.com", fetching(document()));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.instance.name).toBe("Aurora Coast Photography");
      expect(result.instance.url).toBe("https://example.com");
      expect(result.instance.currency).toBe("CAD");
    });

    it("says plainly when an address is not a Freeholder site", async () => {
      const result = await discover("example.com", fetching({ hello: "world" }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("not-freeholder");
    });

    it("distinguishes an unfinished instance from a typo", async () => {
      // One is the owner's problem and the customer should wait; the other is
      // the customer's and they should retype. Same screen, different advice.
      const result = await discover(
        "example.com",
        fetching({ freeholder: true, contractVersion: 1, setupComplete: false }, 503),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("setup-incomplete");
    });

    it("hands over the store link when the binary is too old", async () => {
      // §35.1: "with the store link to update, not a broken screen."
      const result = await discover(
        "example.com",
        fetching(document({ contractVersion: APP_CONTRACT_VERSION + 1 })),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("app-too-old");
      expect(result.storeUrls?.ios).toBe("https://apps.apple.test/x");
      expect(result.message).toContain("Aurora Coast Photography");
    });

    it("does not lock the app out of an instance older than itself", async () => {
      // The platform only ever adds; an owner who has not updated should not
      // lose their own app.
      const result = await discover(
        "example.com",
        fetching(document({ contractVersion: APP_CONTRACT_VERSION })),
        APP_CONTRACT_VERSION + 5,
      );
      expect(result.ok).toBe(true);
    });

    it("survives an address that does not answer", async () => {
      const result = await discover("example.com", async () => {
        throw new Error("fetch failed");
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("unreachable");
    });

    it("agrees with the server's own compatibility check", () => {
      expect(checkCompatibility(document(), APP_CONTRACT_VERSION).ok).toBe(true);
      expect(
        checkCompatibility(document({ contractVersion: 99 }), APP_CONTRACT_VERSION).ok,
      ).toBe(false);
    });
  });

  it("renders native invoice money in zero, two and three-decimal currencies without losing minor units", () => {
    expect(formatMoney(1000, "JPY", "en")).toBe("¥1,000");
    expect(formatMoney(12345, "USD", "en")).toBe("$123.45");
    expect(formatMoney(1001, "KWD", "en")).toContain("1.001");
    expect(formatMoney(-1, "USD", "en")).toBe("-$0.01");
  });

  describe("holding a session on a device", () => {
    it("rejects another business's email link before sending anything and preserves one-time failures", async () => {
      const transport = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: "session-token" }) }));
      const input = { instanceUrl: "https://example.test", email: "rae@example.test", link: "https://other.test/portal/magic?token=abcdefghijklmnopqrstuv" };
      expect((await redeemSignInLink(input, transport)).ok).toBe(false);
      expect(transport).not.toHaveBeenCalled();
      expect((await redeemSignInLink({ ...input, link: "https://example.test/fr/portal/magic?token=abcdefghijklmnopqrstuv" }, transport)).ok).toBe(true);
      expect(transport).toHaveBeenCalledWith("https://example.test/api/v1/auth.consumeCustomerMagicLink", expect.objectContaining({ credentials: "omit", body: JSON.stringify({ token: "abcdefghijklmnopqrstuv" }) }));
      const denied = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
      expect((await redeemSignInLink({ ...input, link: "https://example.test/portal/magic?token=abcdefghijklmnopqrstuv" }, denied)).ok).toBe(false);
      expect(denied).toHaveBeenCalledTimes(1);
    });
    it("uses real auth services and never treats an OTP challenge or failed email request as a session", async () => {
      const transport = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: "", twoFactorRequired: true }) }));
      const result = await signIn({ instanceUrl: "https://example.test", email: "rae@example.test", password: "password" }, transport);
      expect(result).toMatchObject({ ok: false, reason: "two-factor" });
      expect(transport).toHaveBeenCalledWith("https://example.test/api/v1/auth.login", expect.objectContaining({ credentials: "omit" }));
      const failed = await signIn({ instanceUrl: "https://example.test", email: "rae@example.test" }, async () => ({ ok: false, status: 429, json: async () => ({}) }));
      expect(failed).toMatchObject({ ok: false, reason: "invalid" });
    });
    it("keeps the token where only the keychain writes", async () => {
      const store = memoryStore();
      await saveSession(store, {
        instanceUrl: "https://example.com",
        token: "tok",
        email: "a@example.test",
        issuedAt: new Date().toISOString(),
      });
      expect(await loadSession(store)).not.toBeNull();
      await signOut(store);
      expect(await loadSession(store)).toBeNull();
      expect(store.data.size).toBe(0);
    });

    it("does not treat a fingerprint as an authentication factor", async () => {
      // §35.1: biometric unlock guards re-opening, never the login. A broken
      // sensor must not lock a customer out of their own bookings.
      const unavailable = await unlockOnResume(
        { available: async () => false, authenticate: async () => false },
        true,
      );
      expect(unavailable.show).toBe(true);

      const failed = await unlockOnResume(
        { available: async () => true, authenticate: async () => false },
        true,
      );
      expect(failed.show).toBe(false);
      // Locked, not signed out: the session the server granted still stands.
      expect(failed.reason).toContain("or sign out");
    });
  });

  describe("offline is read-through, write-never", () => {
    it("refuses offline writes before calling the provider and never retries a failed write", async () => {
      const call = vi.fn(async () => "saved");
      await expect(writeThrough({ service: "galleries.setSelection", online: false }, call)).rejects.toBeInstanceOf(OfflineWriteRefused);
      expect(call).not.toHaveBeenCalled();
      expect(await writeThrough({ service: "galleries.setSelection", online: true }, call)).toBe("saved");
      expect(call).toHaveBeenCalledTimes(1);
      const failure = new Error("network disconnected after sending");
      call.mockRejectedValue(failure);
      await expect(writeThrough({ service: "galleries.setSelection", online: true }, call)).rejects.toBe(failure);
      expect(call).toHaveBeenCalledTimes(2);
    });
    it("refuses to queue a mutation, loudly", async () => {
      await expect(
        readThrough(
          { key: "k", kind: "mutation", service: "booking.create" },
          async () => ({}),
          memoryCache(),
        ),
      ).rejects.toBeInstanceOf(OfflineWriteRefused);
    });

    it("serves what was already shown, and says when it was fetched", async () => {
      const cache = memoryCache();
      const live = await readThrough(
        { key: "gallery", kind: "query", service: "galleries.get" },
        async () => ({ photos: 12 }),
        cache,
      );
      expect(live.freshness.state).toBe("live");

      const offline = await readThrough(
        { key: "gallery", kind: "query", service: "galleries.get" },
        async () => {
          throw new Error("network request failed");
        },
        cache,
      );
      expect(offline.value).toEqual({ photos: 12 });
      expect(offline.freshness.state).toBe("cached");
    });

    it("admits when it has nothing rather than showing an empty gallery", async () => {
      const result = await readThrough(
        { key: "cold", kind: "query", service: "galleries.get" },
        async () => {
          throw new Error("network request failed");
        },
        memoryCache(),
      );
      expect(result.value).toBeNull();
      expect(result.freshness.state).toBe("empty");
      expect(freshnessLabel(result.freshness)).toContain("not been loaded on this device");
    });

    it("says when, not just that — a gallery from four minutes ago is still worth proofing", () => {
      const now = new Date("2026-09-10T12:00:00.000Z");
      expect(
        freshnessLabel(
          { state: "cached", fetchedAt: "2026-09-10T11:56:00.000Z", reason: "offline" },
          now,
        ),
      ).toBe("Offline — showing what was loaded 4 minutes ago.");
      expect(
        freshnessLabel(
          { state: "cached", fetchedAt: "2026-09-08T12:00:00.000Z", reason: "offline" },
          now,
        ),
      ).toContain("2 days ago");
    });

    it("shows nothing above live content", () => {
      expect(freshnessLabel({ state: "live" })).toBeNull();
    });
  });

  describe("branding arrives at runtime", () => {
    const base = (colors: Record<string, string>): Instance => ({
      url: "https://example.com",
      contractVersion: 1,
      platformVersion: "0.1.0",
      name: "Aurora Coast",
      tagline: null,
      locales: { default: "en", enabled: ["en"] },
      currency: "CAD",
      timezone: "America/Vancouver",
      country: "CA",
      branding: { logoUrl: null, colors, fontSans: null },
      api: { base: "", openapi: "", mcp: "" },
      storeUrls: { ios: null, android: null },
    });

    it("uses the instance's own tokens", () => {
      const brand = brandFrom(base({ accent: "#116644", ink: "#101010" }));
      expect(brand.colors.accent).toBe("#116644");
      expect(brand.branded).toBe(true);
    });

    it("falls back to a neutral rather than guessing at a brand", () => {
      // A wrong brand colour looks like a bug in the business, not a gap in
      // the app.
      const brand = brandFrom(base({}));
      expect(brand.branded).toBe(false);
      expect(brand.colors.accent).toMatch(/^#/);
    });

    it("ignores a value that is not a colour", () => {
      const brand = brandFrom(base({ accent: "javascript:alert(1)" }));
      expect(brand.colors.accent).not.toContain("javascript");
    });
  });

  describe("a client, never a second implementation", () => {
    it("reaches the platform only over its HTTP API", () => {
      // §35.1: "a rule that exists only in the app is a rule that stops being
      // true the moment somebody uses the website instead."
      //
      // Checked structurally rather than by keyword. A word-scan for "price"
      // or "availability" flagged a biometric `available()` and the sentence
      // explaining why bookings are not queued — a tripwire that needs
      // exceptions is not a test. What actually keeps this honest is that the
      // package cannot reach the database or the platform's source at all.
      for (const name of ["discovery", "session", "offline", "branding"]) {
        const source = readFileSync(`packages/mobile-app/src/${name}.ts`, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        expect(source, name).not.toMatch(/\bdrizzle\b/);
        // No reaching into the monolith: no `@/…`, no `../../src`.
        expect(source, name).not.toMatch(/from\s+["']@\//);
        expect(source, name).not.toMatch(/from\s+["'][^"']*\.\.\/src\//);
        // Every import is relative to this package or a node: builtin.
        for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
          const specifier = match[1] ?? "";
          expect(
            specifier.startsWith("./") || specifier.startsWith("node:"),
            `${name} imports ${specifier}`,
          ).toBe(true);
        }
      }
    });

    it("depends on nothing that could implement a business rule", () => {
      const manifest = JSON.parse(
        readFileSync("packages/mobile-app/package.json", "utf8"),
      ) as { dependencies?: Record<string, string> };
      expect(manifest.dependencies ?? {}).toEqual({});
    });

    it("ships under the repository licence", () => {
      const manifest = JSON.parse(
        readFileSync("packages/mobile-app/package.json", "utf8"),
      ) as { license: string };
      expect(manifest.license).toBe("Apache-2.0");
    });
  });
});
