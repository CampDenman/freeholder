// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Screen contracts and deep links (C10.13).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SCREENS,
  SCREEN_IDS,
  TAB_ORDER,
  screensNeedingSignIn,
  servicesUsed,
} from "../../packages/mobile-app/src/screens";
import {
  APP_SCHEME,
  needsSignIn,
  pushLink,
  resolveDeepLink,
} from "../../packages/mobile-app/src/deep-links";

function sdkServiceNames(): Set<string> {
  const source = readFileSync("packages/sdk/src/generated.ts", "utf8");
  return new Set([...source.matchAll(/^ {2}"([a-z][\w.]+)",$/gm)].map((m) => m[1]!));
}

describe("screen contracts (C10.13)", () => {
  it("names only services the platform actually exposes", () => {
    // The whole point of declaring the contract: a screen that asks for a
    // service nobody wrote is a failing test here rather than an error on a
    // customer's phone a week after store review. Fourteen of the first
    // twenty-two names written for this file were invented; this is what
    // caught them.
    const real = sdkServiceNames();
    const missing = servicesUsed().filter((name) => !real.has(name));
    expect(missing).toEqual([]);
  });

  it("gives every screen somewhere to sit and something to say when empty", () => {
    for (const id of SCREEN_IDS) {
      const screen = SCREENS[id];
      expect(screen.id, id).toBe(id);
      expect(screen.titleKey, id).toMatch(/^app\./);
      expect(screen.emptyKey, id).toMatch(/^app\./);
      expect(screen.reads.length, id).toBeGreaterThan(0);
    }
  });

  it("keeps browsing public and everything personal behind sign-in", () => {
    // A customer who has just installed the app should see what the business
    // offers before being asked who they are.
    expect(SCREENS.home.audience).toBe("public");
    expect(SCREENS.catalog.audience).toBe("public");
    expect(SCREENS.service.audience).toBe("public");
    expect(SCREENS.product.audience).toBe("public");
    for (const id of ["invoice", "invoices", "gallery", "galleries", "messages", "account"] as const) {
      expect(SCREENS[id].audience, id).toBe("signed-in");
    }
    expect(screensNeedingSignIn()).toContain("bookings");
  });

  it("does not let the app take payment in-app", () => {
    // §35.1: digital sales are web checkout, because the stores take 15–30%
    // and Freeholder's whole argument is that the business keeps its money.
    expect(SCREENS.invoice.writes).toEqual([]);
    const paying = servicesUsed().filter((name) => /pay|checkout|charge/i.test(name));
    expect(paying).toEqual([]);
  });

  it("only writes from screens where a write is a decision, not a queue", () => {
    // §35.1's offline rule: writes are never queued. A screen with no writes
    // behaves identically with and without signal.
    const writing = SCREEN_IDS.filter((id) => SCREENS[id].writes.length > 0);
    expect(writing.sort()).toEqual(["booking", "gallery", "messages", "newsletters"]);
  });

  it("does not cache the one screen whose data expires", () => {
    // A cached booking screen would show availability that may be gone.
    expect(SCREENS.booking.cacheable).toBe(false);
    expect(SCREENS.gallery.cacheable).toBe(true);
  });

  it("puts every tab on a real screen", () => {
    for (const id of TAB_ORDER) expect(SCREEN_IDS).toContain(id);
    expect(new Set(TAB_ORDER).size).toBe(TAB_ORDER.length);
  });
});

describe("deep links (C10.13)", () => {
  const instanceUrl = "https://aurora.test";

  describe("website links, which must keep working in a browser", () => {
    const cases: [string, string, string | undefined][] = [
      ["https://aurora.test/", "home", undefined],
      ["https://aurora.test/shop", "catalog", undefined],
      ["https://aurora.test/shop/prints", "product", "prints"],
      ["https://aurora.test/services/wedding", "service", "wedding"],
      ["https://aurora.test/portal/appointments", "bookings", undefined],
      ["https://aurora.test/portal/appointments/tok123", "booking", "tok123"],
      ["https://aurora.test/portal/invoices/inv-9", "invoice", "inv-9"],
      ["https://aurora.test/g/spring-shoot", "gallery", "spring-shoot"],
      ["https://aurora.test/portal", "account", undefined],
    ];
    for (const [url, screen, param] of cases) {
      it(`opens ${url} on ${screen}`, () => {
        const result = resolveDeepLink(url, { instanceUrl });
        expect(result.ok, url).toBe(true);
        if (!result.ok) return;
        expect(result.destination.screen).toBe(screen);
        expect(result.destination.param).toBe(param);
      });
    }

    it("ignores a locale prefix, because §4.9 path-prefixes every other locale", () => {
      const result = resolveDeepLink("https://aurora.test/fr/portal/invoices/inv-9", {
        instanceUrl,
        locales: ["fr", "es"],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.destination.screen).toBe("invoice");
      expect(result.destination.param).toBe("inv-9");
    });

    it("hands an unknown path back to the browser rather than guessing", () => {
      // Swallowing a link and showing the home screen loses the customer's
      // place, which is worse than not opening it.
      const result = resolveDeepLink("https://aurora.test/careers", { instanceUrl });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("unknown-path");
      expect(result.message).toContain("browser");
    });

    it("refuses a link for a different business", () => {
      // Silently switching which business a customer is looking at is how
      // somebody pays the wrong invoice.
      const result = resolveDeepLink("https://someone-else.test/portal/invoices/x", {
        instanceUrl,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("wrong-instance");
      expect(result.message).toContain("someone-else.test");
    });

    it("refuses anything that is not an http(s) or app link", () => {
      for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "not a link", ""]) {
        const result = resolveDeepLink(bad, { instanceUrl });
        expect(result.ok, bad).toBe(false);
      }
    });
  });

  describe("push links, which only this app mints", () => {
    it("round-trips every screen it can address", () => {
      for (const id of SCREEN_IDS) {
        const param = SCREENS[id].param ? "abc-123" : undefined;
        const link = pushLink(id, param);
        expect(link.startsWith(`${APP_SCHEME}://`), id).toBe(true);
        const result = resolveDeepLink(link);
        expect(result.ok, `${id} → ${link}`).toBe(true);
        if (!result.ok) return;
        expect(result.destination.screen, id).toBe(id);
        expect(result.destination.param, id).toBe(param);
      }
    });

    it("refuses to mint a link that would open a screen with no argument", () => {
      expect(() => pushLink("gallery")).toThrow(/needs a slug/);
      expect(() => pushLink("invoice")).toThrow(/needs a token/);
    });

    it("does not open an app link naming a screen that does not exist", () => {
      expect(resolveDeepLink(`${APP_SCHEME}://admin`).ok).toBe(false);
      expect(resolveDeepLink(`${APP_SCHEME}://gallery`).ok).toBe(false);
    });

    it("escapes a parameter that would otherwise change the path", () => {
      const link = pushLink("gallery", "a/b?c=d");
      const result = resolveDeepLink(link);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.destination.param).toBe("a/b?c=d");
    });
  });

  it("says up front when a destination will need signing in", () => {
    // So the app can hold the destination and show sign-in, rather than
    // bouncing the customer to the home tab and losing what they tapped.
    expect(needsSignIn({ screen: "gallery", param: "x" })).toBe(true);
    expect(needsSignIn({ screen: "catalog" })).toBe(false);
  });

  it("carries a screen and one argument, and nothing else", () => {
    // A link that could authenticate authenticates whoever finds the phone; a
    // link that could act is a link an attacker can send.
    const result = resolveDeepLink(
      "https://aurora.test/portal/invoices/inv-9?token=secret&action=pay",
      { instanceUrl },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.destination).sort()).toEqual(["instanceUrl", "param", "screen"]);
    expect(JSON.stringify(result.destination)).not.toContain("secret");
    expect(JSON.stringify(result.destination)).not.toContain("pay");
  });
});
