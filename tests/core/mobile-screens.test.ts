// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Screen contracts and deep links (C10.13).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SCREENS,
  SCREEN_IDS,
  TAB_ORDER,
  OWNER_TAB_ORDER,
  tabOrderFor,
  tabFileName,
  screensNeedingSignIn,
  staffScreens,
  customerSignedInScreens,
  servicesUsed,
} from "../../packages/mobile-app/src/screens";
import {
  APP_SCHEME,
  needsSignIn,
  pushLink,
  resolveDeepLink,
} from "../../packages/mobile-app/src/deep-links";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { appText } from "../../packages/mobile-app/src/strings";
import { appMessages } from "../../packages/mobile-app/src/messages.generated";

function sdkServiceNames(): Set<string> {
  const source = readFileSync("packages/sdk/src/generated.ts", "utf8");
  return new Set([...source.matchAll(/^ {2}"([a-z][\w.]+)",$/gm)].map((m) => m[1]!));
}

describe("screen contracts (C10.13)", () => {
  it("resolves every contract label from the shared catalogs in en/es/fr (C10.24)", () => {
    for (const locale of ["en", "es", "fr"] as const) {
      const catalog = JSON.parse(readFileSync(`locales/${locale}.json`, "utf8")) as Record<string, string>;
      expect(appMessages[locale]).toEqual(Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith("app."))));
      for (const screen of Object.values(SCREENS)) {
        for (const key of [screen.titleKey, screen.emptyKey]) {
          expect(catalog[key], `${locale}:${key}`).toBeTruthy();
          expect(appText(locale, key)).toBe(catalog[key]);
          // This lightweight resolver deliberately handles literal labels.
          expect(catalog[key]).not.toMatch(/[{}]/);
        }
      }
    }
    expect(appText("fr-CA", "app.catalog.title")).toBe("Boutique");
    expect(appText("unknown", "app.catalog.title")).toBe("Shop");
    expect(appText("es", "app.missing")).toBe(appMessages.es["app.unavailable"]);
  });

  it("uses session/contact equivalents instead of business replies and email-footer tokens (C10.24)", () => {
    expect(SCREENS.newsletters.writes).toContain("privacy.setMyMarketingPreference");
    expect(servicesUsed()).not.toContain("newsletters.unsubscribe");
    expect(customerSignedInScreens().flatMap((id) => [...SCREENS[id].reads, ...SCREENS[id].writes])).not.toContain("conversations.reply");
    expect(SCREENS.inboxThread.writes).toContain("conversations.reply");
    expect(SCREENS.bookings.reads).toContain("portal.myProfile");
    expect(SCREENS.messages.reads).toContain("portal.myProfile");
    expect(SCREENS.message.writes).toContain("conversations.replyAsContact");
    expect(SCREENS.account.writes).toContain("notifications.revokeDevice");
    expect(SCREENS.gallery.reads).toContain("galleries.viewSession");
    expect(SCREENS.gallery.writes).toContain("galleries.openWithLogin");
    expect(servicesUsed()).not.toContain("galleries.list");
    expect(servicesUsed()).not.toContain("galleries.listSelections");
  });
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
    for (const id of ["invoice", "invoices", "gallery", "galleries", "messages", "message", "account"] as const) {
      expect(SCREENS[id].audience, id).toBe("signed-in");
    }
    expect(screensNeedingSignIn()).toContain("bookings");
    expect(screensNeedingSignIn()).toContain("today");
    for (const id of staffScreens()) expect(SCREENS[id].audience, id).toBe("staff");
  });

  it("lets a public screen name only services a stranger may call", async () => {
    // Registered is not the same as callable. C10.23's catalog first read
    // `catalog.listProducts` — a real name, so the check above passed — and an
    // owner-only service, so every customer saw the error state. A screen the
    // app shows before sign-in may read only what an anonymous visitor may
    // call, plus the `authenticated` reads it adds once a session exists; it
    // never reads a scoped or system service, and it never writes.
    await ready();
    const publicScreens = SCREEN_IDS.filter((id) => SCREENS[id].audience === "public");
    const offending = publicScreens.flatMap((id) =>
      SCREENS[id].reads
        .map((name) => ({ screen: id, service: name, permission: getService(name).def.permission }))
        .filter((entry) => entry.permission !== "public" && entry.permission !== "authenticated"),
    );
    expect(offending).toEqual([]);
    for (const id of publicScreens) expect(SCREENS[id].writes, id).toEqual([]);
  });

  it("does not let the app take payment in-app", () => {
    // §35.1: digital sales are web checkout, because the stores take 15–30%
    // and Freeholder's whole argument is that the business keeps its money.
    expect(SCREENS.invoice.writes).toEqual([]);
    const paying = servicesUsed().filter((name) => /pay|checkout|charge/i.test(name));
    expect(paying).toEqual([]);
  });

  it("lets signed-in screens call only customer-authorized services of the declared kind (C10.24)", async () => {
    await ready();
    const offending = customerSignedInScreens().flatMap((id) =>
      (["reads", "writes"] as const).flatMap((operation) => SCREENS[id][operation].flatMap((name) => {
        const definition = getService(name).def;
        const expected = operation === "reads" ? "query" : "mutation";
        const customer = definition.permission === "public" || definition.permission === "authenticated" ||
          (expected === "query" && definition.permission === "scoped" && Boolean(definition.selfService));
        return customer && definition.kind === expected && definition.external !== false ? [] :
          [{ screen: id, service: name, permission: definition.permission, kind: definition.kind }];
      })),
    );
    expect(offending).toEqual([]);
  });

  it("lets staff companion screens call only existing owner services of the declared kind (C10.17)", async () => {
    await ready();
    expect(staffScreens().sort()).toEqual([
      "agents", "alerts", "approvals", "capture", "inbox", "inboxThread",
      "ownerInvoice", "ownerInvoices", "reviews", "staffAccount", "today",
    ]);
    const offending = staffScreens().flatMap((id) =>
      (["reads", "writes"] as const).flatMap((operation) => SCREENS[id][operation].flatMap((name) => {
        const definition = getService(name).def;
        const expected = operation === "reads" ? "query" : "mutation";
        const allowed = definition.permission === "public" || definition.permission === "authenticated" || definition.permission === "scoped";
        return allowed && definition.kind === expected && definition.external !== false ? [] :
          [{ screen: id, service: name, permission: definition.permission, kind: definition.kind, expected }];
      })),
    );
    expect(offending).toEqual([]);
    expect(SCREENS.inboxThread.writes).toContain("conversations.reply");
    expect(SCREENS.message.writes).toContain("conversations.replyAsContact");
    expect(SCREENS.capture.writes).toContain("media.createCaptureSession");
    expect(SCREENS.capture.writes).toContain("media.createUploadLink");
    expect(SCREENS.capture.writes).toContain("media.signUploadParts");
    expect(SCREENS.capture.writes).toContain("media.completeUpload");
    expect(SCREENS.capture.writes).toContain("media.confirmCapture");
    expect(SCREENS.ownerInvoices.writes).toEqual(["invoicing.createDraft"]);
    expect(SCREENS.ownerInvoice.writes).toEqual(["invoicing.issue"]);
  });

  it("only writes from screens where a write is a decision, not a queue", () => {
    // §35.1's offline rule: writes are never queued. A screen with no writes
    // behaves identically with and without signal.
    const writing = SCREEN_IDS.filter((id) => SCREENS[id].writes.length > 0);
    expect(writing.sort()).toEqual([
      "account", "alerts", "approvals", "booking", "capture", "gallery",
      "inboxThread", "message", "newsletters", "ownerInvoice", "ownerInvoices",
      "reviews", "staffAccount", "today",
    ]);
  });

  it("does not cache the one screen whose data expires", () => {
    // A cached booking screen would show availability that may be gone.
    expect(SCREENS.booking.cacheable).toBe(false);
    expect(SCREENS.gallery.cacheable).toBe(true);
  });

  it("puts every tab on a real screen", () => {
    for (const id of TAB_ORDER) expect(SCREEN_IDS).toContain(id);
    expect(new Set(TAB_ORDER).size).toBe(TAB_ORDER.length);
    expect(TAB_ORDER).toEqual(["home", "catalog", "bookings", "invoices", "galleries", "account"]);
    expect(OWNER_TAB_ORDER).toEqual(["today", "ownerInvoices", "inbox", "reviews", "alerts", "staffAccount"]);
    expect(tabOrderFor("customer")).toEqual(TAB_ORDER);
    expect(tabOrderFor("staff")).toEqual(OWNER_TAB_ORDER);
    expect(tabFileName("home")).toBe("index");
    expect(tabFileName("ownerInvoices")).toBe("owner-invoices");
    expect(tabFileName("staffAccount")).toBe("staff-account");
    for (const id of OWNER_TAB_ORDER) expect(SCREEN_IDS).toContain(id);
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
      ["https://aurora.test/portal/messages", "messages", undefined],
      ["https://aurora.test/portal/messages/thread-9", "message", "thread-9"],
      ["https://aurora.test/portal", "account", undefined],
      ["https://aurora.test/admin", "today", undefined],
      ["https://aurora.test/admin/briefing", "today", undefined],
      ["https://aurora.test/admin/invoices", "ownerInvoices", undefined],
      ["https://aurora.test/admin/invoices/inv-9", "ownerInvoice", "inv-9"],
      ["https://aurora.test/admin/inbox", "inbox", undefined],
      ["https://aurora.test/admin/inbox/thread-9", "inboxThread", "thread-9"],
      ["https://aurora.test/admin/reviews", "reviews", undefined],
      ["https://aurora.test/admin/work", "agents", undefined],
      ["https://aurora.test/admin/work/approvals", "approvals", undefined],
      ["https://aurora.test/admin/notifications", "alerts", undefined],
      ["https://aurora.test/admin/media/record", "capture", undefined],
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
      expect(resolveDeepLink("freeholder://invoices?instance=https%3A%2F%2Fsomeone-else.test", { instanceUrl })).toMatchObject({ ok: false, reason: "wrong-instance" });
      expect(resolveDeepLink(`freeholder://invoices?instance=${encodeURIComponent(instanceUrl)}`, { instanceUrl })).toMatchObject({ ok: true, destination: { screen: "invoices" } });
      expect(resolveDeepLink("freeholder://invoices?instance=not-a-url", { instanceUrl })).toMatchObject({ ok: false, reason: "not-a-link" });
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
      expect(() => pushLink("invoice")).toThrow(/needs a id/);
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
    expect(needsSignIn({ screen: "today" })).toBe(true);
    expect(needsSignIn({ screen: "capture" })).toBe(true);
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
