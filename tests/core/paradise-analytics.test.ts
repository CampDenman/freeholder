// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: PM measurement only on explicit consent, the CSP edge origin, and
// the lead conversion body. Mocked HTTP only.
import { afterEach, describe, expect, it } from "vitest";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { resetEnvForTests } from "@/core/env";
import { contentSecurityPolicy } from "@/core/http/csp";
import {
  clickIdsFromCookie,
  paradiseMeasurement,
  paradiseMeasurementAllowed,
  paradiseScriptSources,
  sendLeadConversion,
} from "@/modules/analytics/paradise";

const SITE_ID = "6f1c1f5e-5d43-4f5a-9a0e-8a7b6c5d4e3f";
const changed = new Map<string, string | undefined>();
function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changed.has(name)) changed.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
}

function configured(): void {
  environment({
    PARADISEMODERN_ANALYTICS: "on",
    PARADISEMODERN_API_KEY: "site-key",
    PARADISEMODERN_SITE_ID: SITE_ID,
    PARADISEMODERN_EDGE_URL: "https://pm.auroracoast.test",
  });
}

afterEach(() => {
  for (const [name, value] of changed) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  changed.clear();
  resetEnvForTests();
  setParadiseFetchForTests(undefined);
});

describe("consent gating", () => {
  it("is off until every setting is present", () => {
    environment({ PARADISEMODERN_ANALYTICS: undefined, PARADISEMODERN_SITE_ID: SITE_ID });
    expect(paradiseMeasurement()).toBeNull();
    environment({ PARADISEMODERN_ANALYTICS: "on", PARADISEMODERN_API_KEY: "k", PARADISEMODERN_EDGE_URL: undefined });
    expect(paradiseMeasurement()).toBeNull();
    configured();
    expect(paradiseMeasurement()).toEqual({ siteId: SITE_ID, edgeOrigin: "https://pm.auroracoast.test" });
  });

  it("loads only after an explicit allow, under a policy that collects", () => {
    configured();
    expect(paradiseMeasurementAllowed("opt_in", "granted")).toBe(true);
    expect(paradiseMeasurementAllowed("privacy_first", "granted")).toBe(true);
    // The privacy-first default's implied state is not permission for this.
    expect(paradiseMeasurementAllowed("privacy_first", "implicit")).toBe(false);
    expect(paradiseMeasurementAllowed("privacy_first", null)).toBe(false);
    expect(paradiseMeasurementAllowed("opt_in", "pending")).toBe(false);
    expect(paradiseMeasurementAllowed("opt_in", "denied")).toBe(false);
    expect(paradiseMeasurementAllowed("disabled", "granted")).toBe(false);
  });

  it("serves PM's scripts from the site's own edge", () => {
    configured();
    expect(paradiseScriptSources(paradiseMeasurement()!)).toEqual([
      `https://pm.auroracoast.test/sdk/track.js?site=${SITE_ID}`,
      `https://pm.auroracoast.test/capi.js?site=${SITE_ID}`,
    ]);
  });

  it("rejects an edge URL that is not one https origin", () => {
    environment({ PARADISEMODERN_EDGE_URL: "http://pm.auroracoast.test" });
    expect(() => paradiseMeasurement()).toThrow(/https origin/);
  });
});

describe("content security policy", () => {
  it("opens the edge origin only when the caller passes it, and never in admin", () => {
    const base = { nonce: "n", production: true };
    const open = contentSecurityPolicy({ ...base, path: "/", measurementOrigins: ["https://pm.auroracoast.test"] });
    expect(open).toMatch(/connect-src 'self' https:\/\/pm\.auroracoast\.test/);
    expect(open).toMatch(/img-src [^;]*https:\/\/pm\.auroracoast\.test/);
    expect(contentSecurityPolicy({ ...base, path: "/" })).not.toContain("pm.auroracoast.test");
    expect(
      contentSecurityPolicy({ ...base, path: "/admin/traffic", measurementOrigins: ["https://pm.auroracoast.test"] }),
    ).not.toContain("pm.auroracoast.test");
  });
});

describe("lead conversions", () => {
  it("reads only recognised click IDs from capi.js's cookie", () => {
    const cookie = encodeURIComponent(JSON.stringify({
      ids: { gclid: "abc", fbclid: "def", evil: "x", msclkid: "a b<script>" },
      ts: 1,
    }));
    expect(clickIdsFromCookie(cookie)).toEqual({ gclid: "abc", fbclid: "def" });
    expect(clickIdsFromCookie("not json")).toEqual({});
    expect(clickIdsFromCookie(undefined)).toEqual({});
  });

  it("posts one deduplicable lead event to the site's CAPI endpoint", async () => {
    configured();
    let call: { url: string; body: Record<string, unknown> } | undefined;
    setParadiseFetchForTests(async (url, init) => {
      call = { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await sendLeadConversion({
      submissionId: "sub-1",
      email: "ada@example.test",
      ip: "198.51.100.7",
      userAgent: "Mozilla/5.0",
      sourceUrl: "https://auroracoast.test/contact",
      clickIds: { gclid: "abc" },
    });
    expect(call!.url).toBe(`https://paradisemodern.com/api/capi/${SITE_ID}/event`);
    expect(call!.body).toMatchObject({
      eventId: "freeholder-form:sub-1",
      eventName: "lead",
      user: { email: "ada@example.test", ip: "198.51.100.7", userAgent: "Mozilla/5.0", externalId: "sub-1" },
      context: { sourceUrl: "https://auroracoast.test/contact", clickIds: { gclid: "abc" } },
    });
  });

  it("sends nothing when measurement is off", async () => {
    environment({ PARADISEMODERN_ANALYTICS: "off" });
    let called = false;
    setParadiseFetchForTests(async () => { called = true; return new Response("{}"); });
    await sendLeadConversion({ submissionId: "s", clickIds: {} });
    expect(called).toBe(false);
  });
});
