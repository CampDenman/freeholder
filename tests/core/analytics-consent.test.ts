// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Analytics consent, edge identity and keyboard-native choice contracts (C1.18).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { translator } from "@/core/i18n";
import { resetEnvForTests } from "@/core/env";
import {
  analyticsCollectionAllowed,
  analyticsConsentNeedsSync,
} from "@/modules/analytics/settings";
import {
  ANALYTICS_BOOTSTRAP_COOKIE,
  ANALYTICS_BOOTSTRAP_HEADER,
  ANALYTICS_CONSENT_COOKIE,
  ANON_COOKIE,
  ANON_HEADER,
  SESSION_COOKIE_NAME,
  SESSION_HEADER,
} from "@/modules/analytics/visitor";
import { setModuleConfig } from "@/core/settings/service";
import { AnalyticsConsentControl } from "../../app/(public)/AnalyticsConsentControl";
import { POST as chooseConsent } from "../../app/api/analytics/consent/route";
import { proxy } from "../../proxy";
import { auditHtml } from "../../scripts/a11y-smoke.mjs";
import {
  closeDb,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("analytics policy decisions", () => {
  it("defaults to minimal collection with opt-out and requires a grant in opt-in mode", () => {
    expect(analyticsCollectionAllowed("privacy_first", null)).toBe(true);
    expect(analyticsCollectionAllowed("privacy_first", "denied")).toBe(false);
    expect(analyticsCollectionAllowed("opt_in", null)).toBe(false);
    expect(analyticsCollectionAllowed("opt_in", "pending")).toBe(false);
    expect(analyticsCollectionAllowed("opt_in", "granted")).toBe(true);
    expect(analyticsCollectionAllowed("disabled", "granted")).toBe(false);
  });

  it("reconciles stale browser choices when instance policy changes", () => {
    expect(analyticsConsentNeedsSync("privacy_first", null)).toBe(true);
    expect(analyticsConsentNeedsSync("opt_in", "implicit")).toBe(true);
    expect(analyticsConsentNeedsSync("opt_in", "pending")).toBe(false);
    expect(analyticsConsentNeedsSync("disabled", "granted")).toBe(true);
  });
});

describe("analytics identity at the edge", () => {
  it("uses only a five-minute bootstrap on the first public request", () => {
    const response = proxy(new NextRequest("https://example.test/services"));
    const bootstrap = response.cookies.get(ANALYTICS_BOOTSTRAP_COOKIE)?.value;
    expect(bootstrap).toBeTruthy();
    expect(forwarded(response, ANALYTICS_BOOTSTRAP_HEADER)).toBe(bootstrap);
    expect(response.cookies.get(ANON_COOKIE)).toBeUndefined();
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
    expect(forwarded(response, ANON_HEADER)).toBeNull();
  });

  it("forwards established first-party identity and only slides its session", () => {
    const response = proxy(new NextRequest("https://example.test/services", {
      headers: {
        cookie: `${ANALYTICS_CONSENT_COOKIE}=implicit; ${ANON_COOKIE}=known-visitor; ${SESSION_COOKIE_NAME}=known-session`,
      },
    }));
    expect(forwarded(response, ANON_HEADER)).toBe("known-visitor");
    expect(forwarded(response, SESSION_HEADER)).toBe("known-session");
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("known-session");
    expect(response.cookies.get(ANON_COOKIE)).toBeUndefined();
  });

  it("falls back to bootstrap when consent exists but retained identity expired", () => {
    const response = proxy(new NextRequest("https://example.test/", {
      headers: { cookie: `${ANALYTICS_CONSENT_COOKIE}=implicit` },
    }));
    expect(response.cookies.get(ANALYTICS_BOOTSTRAP_COOKIE)?.value).toBeTruthy();
    expect(forwarded(response, ANON_HEADER)).toBeNull();
  });

  it("mints and forwards nothing after opt-out", () => {
    const response = proxy(new NextRequest("https://example.test/", {
      headers: { cookie: `${ANALYTICS_CONSENT_COOKIE}=denied` },
    }));
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(forwarded(response, ANALYTICS_BOOTSTRAP_HEADER)).toBeNull();
    expect(forwarded(response, ANON_HEADER)).toBeNull();
  });
});

describe("analytics consent markup", () => {
  function page(policy: "privacy_first" | "opt_in", state: "implicit" | null) {
    const control = renderToStaticMarkup(createElement(AnalyticsConsentControl, {
      policy,
      state,
      retentionDays: 90,
      returnTo: "/services?utm_source=test",
      t: translator("en"),
    }));
    return `<!doctype html><html lang="en"><head><title>Services</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Services</h1></main>${control}</body></html>`;
  }

  it("passes the static accessibility gate", async () => {
    expect((await auditHtml(page("opt_in", null), "https://example.test/services")).violations)
      .toEqual([]);
  });

  it("offers native allow and decline forms before opt-in collection", () => {
    const document = new JSDOM(page("opt_in", null)).window.document;
    expect(document.querySelector("aside")?.getAttribute("aria-label"))
      .toBe("Anonymous analytics");
    expect([...document.querySelectorAll('form[method="post"] input[name="decision"]')]
      .map((input) => input.getAttribute("value")))
      .toEqual(["grant", "deny"]);
  });

  it("keeps privacy-first controls quiet but keyboard native", () => {
    const document = new JSDOM(page("privacy_first", "implicit")).window.document;
    expect(document.querySelector("details > summary")?.textContent)
      .toContain("Privacy choices");
    expect(document.querySelector('input[name="decision"]')?.getAttribute("value"))
      .toBe("deny");
  });
});

describe.runIf(hasDatabase)("the policy-aware consent endpoint", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("keeps opt-in pending until grant, then promotes bootstrap within retention", async () => {
    await setModuleConfig.call({
      module: "analytics",
      config: { consentPolicy: "opt_in", retentionDays: 45 },
    }, OWNER);
    const pending = await chooseConsent(new NextRequest(
      "https://example.test/api/analytics/consent",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${ANALYTICS_BOOTSTRAP_COOKIE}=bootstrap-visitor`,
        },
        body: JSON.stringify({ decision: "sync" }),
      },
    ));
    expect(await pending.json()).toEqual({ state: "pending", enabled: false });
    expect(pending.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value).toBe("pending");

    const granted = await chooseConsent(new NextRequest(
      "https://example.test/api/analytics/consent",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${ANALYTICS_BOOTSTRAP_COOKIE}=bootstrap-visitor; ${ANALYTICS_CONSENT_COOKIE}=pending`,
        },
        body: JSON.stringify({ decision: "grant" }),
      },
    ));
    expect(await granted.json()).toEqual({ state: "granted", enabled: true });
    expect(granted.cookies.get(ANON_COOKIE)?.value).toBe("bootstrap-visitor");
    expect(granted.cookies.get(ANON_COOKIE)?.maxAge).toBe(45 * 86_400);
    expect(granted.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("bootstrap-visitor");
    expect(granted.cookies.get(ANALYTICS_BOOTSTRAP_COOKIE)?.value).toBe("");
  });

  it("clears analytics identity when collection is disabled", async () => {
    await setModuleConfig.call({
      module: "analytics",
      config: { consentPolicy: "disabled" },
    }, OWNER);
    const response = await chooseConsent(new NextRequest(
      "https://example.test/api/analytics/consent",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${ANON_COOKIE}=old-visitor; ${SESSION_COOKIE_NAME}=old-session`,
        },
        body: JSON.stringify({ decision: "grant" }),
      },
    ));
    expect(await response.json()).toEqual({ state: "disabled", enabled: false });
    expect(response.cookies.get(ANON_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
  });

  it("rejects a cross-site choice before reading policy", async () => {
    const response = await chooseConsent(new NextRequest(
      "https://example.test/api/analytics/consent",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ decision: "grant" }),
      },
    ));
    expect(response.status).toBe(403);
  });

  it("accepts the configured public origin when the app runs behind a loopback proxy", async () => {
    const prior = process.env.APP_URL;
    process.env.APP_URL = "https://public.example.test";
    resetEnvForTests();
    try {
      const response = await chooseConsent(new NextRequest(
        "http://127.0.0.1:3000/api/analytics/consent",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://public.example.test",
            "sec-fetch-site": "same-origin",
          },
          body: JSON.stringify({ decision: "sync" }),
        },
      ));
      expect(response.status).toBe(200);
    } finally {
      if (prior === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prior;
      resetEnvForTests();
    }
  });

  it("still refuses an unconfigured origin behind the proxy", async () => {
    const response = await chooseConsent(new NextRequest(
      "http://127.0.0.1:3000/api/analytics/consent",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ decision: "grant" }),
      },
    ));
    expect(response.status).toBe(403);
  });

  it("never turns a form return path into an external redirect", async () => {
    const response = await chooseConsent(new NextRequest(
      "https://example.test/api/analytics/consent",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          decision: "deny",
          returnTo: "/\\attacker.example/collect",
        }),
      },
    ));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://example.test/");
  });
});
