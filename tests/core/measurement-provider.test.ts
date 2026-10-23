// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.32: the measurement-provider category. Its adapter runs only on a
// visitor's explicit consent, the CSP opens its edge only then, and a lead
// conversion is one deduplicable event. Mocked HTTP only.
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  measurement,
  measurementAllowed,
  measurementConfig,
  measurementCspOrigins,
  measurementPathAllowed,
  measurementScriptsFor,
} from "@/adapters/measurement";
import { paradiseClickIds } from "@/adapters/measurement/paradise";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { env, resetEnvForTests } from "@/core/env";
import { contentSecurityPolicy } from "@/core/http/csp";
import { ready } from "@/core/runtime";
import { leadConversionTask } from "@/modules/analytics/measurement";
import { closeDb, hasDatabase } from "../helpers/spine";

const SITE_ID = "6f1c1f5e-5d43-4f5a-9a0e-8a7b6c5d4e3f";
const EDGE = "https://edge.auroracoast.test";
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
    MEASUREMENT_PROVIDER: "paradise",
    PARADISEMODERN_API_KEY: "site-key",
    PARADISEMODERN_SITE_ID: SITE_ID,
    PARADISEMODERN_EDGE_URL: EDGE,
    FREEHOLDER_PLAYGROUND: undefined,
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

describe("the measurement category", () => {
  it("is off by default and until every provider setting is present", () => {
    environment({ MEASUREMENT_PROVIDER: undefined, PARADISEMODERN_SITE_ID: SITE_ID });
    expect(measurement()).toBeNull();
    environment({ MEASUREMENT_PROVIDER: "none" });
    expect(measurement()).toBeNull();
    environment({ MEASUREMENT_PROVIDER: "paradise", PARADISEMODERN_API_KEY: "k", PARADISEMODERN_EDGE_URL: undefined });
    expect(measurement()).toBeNull();
    configured();
    expect(measurementConfig(env())).toEqual({
      provider: "paradise",
      displayName: "Paradise Modern",
      siteId: SITE_ID,
      edgeOrigin: EDGE,
    });
  });

  it("never runs on the public playground", () => {
    configured();
    environment({ FREEHOLDER_PLAYGROUND: "1" });
    expect(measurement()).toBeNull();
    expect(measurementCspOrigins(env(), "granted", { path: "/" })).toEqual([]);
  });

  it("needs an explicit allow under a policy that collects", () => {
    configured();
    const config = measurementConfig(env());
    expect(measurementAllowed(config, "opt_in", "granted")).toBe(true);
    expect(measurementAllowed(config, "privacy_first", "granted")).toBe(true);
    // The privacy-first default's implied state is not permission for this.
    expect(measurementAllowed(config, "privacy_first", "implicit")).toBe(false);
    expect(measurementAllowed(config, "privacy_first", null)).toBe(false);
    expect(measurementAllowed(config, "opt_in", "pending")).toBe(false);
    expect(measurementAllowed(config, "opt_in", "denied")).toBe(false);
    expect(measurementAllowed(config, "disabled", "granted")).toBe(false);
    expect(measurementAllowed(null, "opt_in", "granted")).toBe(false);
  });

  it("serves the provider's scripts from the site's own edge", () => {
    configured();
    expect(measurement()!.scriptSources()).toEqual([
      `${EDGE}/sdk/track.js?site=${SITE_ID}`,
      `${EDGE}/capi.js?site=${SITE_ID}`,
    ]);
  });

  it("rejects an edge URL that is not one https origin", () => {
    environment({ PARADISEMODERN_EDGE_URL: "http://edge.auroracoast.test" });
    expect(() => env()).toThrow(/https origin/);
  });
});

describe("which pages render the provider's scripts", () => {
  const scripts = (state: string | null, path = "/", policy = "privacy_first") =>
    measurementScriptsFor({
      environment: env(),
      policy,
      state,
      path,
      scriptSources: () => measurement()?.scriptSources() ?? [],
    });

  it("renders them only for an explicit allow", () => {
    configured();
    expect(scripts("granted")).toHaveLength(2);
    expect(scripts("denied")).toEqual([]);
    // The privacy-first opt-out default's implied state is not an allow.
    expect(scripts("implicit")).toEqual([]);
    expect(scripts(null)).toEqual([]);
    expect(scripts("granted", "/", "disabled")).toEqual([]);
  });

  it("never renders them on the playground, admin, member, account or portal pages", () => {
    configured();
    for (const path of ["/admin", "/admin/traffic", "/messages", "/messages/1", "/call/group/x", "/m/ada", "/feed", "/community", "/join", "/orders/confirm", "/portal", "/fr/messages", "/es/m/ada", "/checkout", "/fr/checkout/pay", "/cart", "/es/cart", "/buy/print-1", "/ar/buy/x", "/book", "/book/session", "/fr/book/session", "/gifts", "/gifts/registry", "/es/gifts", "/memberships", "/fr/memberships/gold"]) {
      expect(measurementPathAllowed(path), path).toBe(false);
      expect(scripts("granted", path), path).toEqual([]);
    }
    for (const path of ["/", "/contact", "/fr/contact", "/market", "/mentors", "/booking-tips", "/cartography", "/gift-guide"]) {
      expect(measurementPathAllowed(path), path).toBe(true);
    }
    environment({ FREEHOLDER_PLAYGROUND: "1" });
    expect(scripts("granted")).toEqual([]);
  });
});

describe("content security policy", () => {
  it("adds the edge only for an explicit allow, and never in admin", () => {
    configured();
    expect(measurementCspOrigins(env(), "granted", { path: "/" })).toEqual([EDGE]);
    expect(measurementCspOrigins(env(), "implicit", { path: "/" })).toEqual([]);
    expect(measurementCspOrigins(env(), null, { path: "/" })).toEqual([]);
    expect(measurementCspOrigins(env(), "granted", { path: "/", policy: "disabled" })).toEqual([]);
    expect(measurementCspOrigins(env(), "granted", { path: "/messages/abc" })).toEqual([]);
    expect(measurementCspOrigins(env(), "granted", { path: "/fr/portal" })).toEqual([]);
    const base = { nonce: "n", production: true };
    const open = contentSecurityPolicy({ ...base, path: "/", measurementOrigins: [EDGE] });
    expect(open).toMatch(/script-src [^;]*https:\/\/edge\.auroracoast\.test/);
    expect(open).toMatch(/connect-src 'self' https:\/\/edge\.auroracoast\.test/);
    expect(open).toMatch(/img-src [^;]*https:\/\/edge\.auroracoast\.test/);
    expect(contentSecurityPolicy({ ...base, path: "/" })).not.toContain("edge.auroracoast.test");
    expect(
      contentSecurityPolicy({ ...base, path: "/admin/traffic", measurementOrigins: [EDGE] }),
    ).not.toContain("edge.auroracoast.test");
  });
});

describe("lead conversions", () => {
  it("reads only recognised click IDs from the provider's cookie", () => {
    const cookie = encodeURIComponent(JSON.stringify({
      ids: { gclid: "abc", fbclid: "def", evil: "x", msclkid: "a b<script>" },
      ts: 1,
    }));
    expect(paradiseClickIds(cookie)).toEqual({ gclid: "abc", fbclid: "def" });
    expect(paradiseClickIds("not json")).toEqual({});
    expect(paradiseClickIds(undefined)).toEqual({});
  });

  it("posts one deduplicable lead event to the site's conversion endpoint", async () => {
    configured();
    let call: { url: string; body: Record<string, unknown> } | undefined;
    setParadiseFetchForTests(async (url, init) => {
      call = { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await measurement()!.recordConversion({
      submissionId: "sub-1",
      email: "ada@example.test",
      ip: "198.51.100.7",
      userAgent: "Mozilla/5.0",
      sourceUrl: "https://auroracoast.test/contact",
      clickIds: { gclid: "abc" },
    });
    expect(call!.url).toBe(`https://paradisemodern.com/api/capi/${SITE_ID}/event`);
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(call!.body).toMatchObject({
      eventId: "freeholder-form:sub-1",
      eventName: "lead",
      user: { ip: "198.51.100.7", userAgent: "Mozilla/5.0", externalId: "sub-1" },
      context: { sourceUrl: "https://auroracoast.test/contact", clickIds: { gclid: "abc" } },
      custom: { identifierHashes: { em: sha("ada@example.test") } },
    });
  });

  it("sends email and phone only as hashes of their normalised form", async () => {
    configured();
    let body = "";
    setParadiseFetchForTests(async (_url, init) => {
      body = init.body as string;
      return new Response("{}", { status: 200 });
    });
    await measurement()!.recordConversion({
      submissionId: "sub-2",
      email: "  Ada@Example.TEST ",
      phone: "+1 (604) 555-0100",
      clickIds: {},
    });
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    const parsed = JSON.parse(body) as { custom: { identifierHashes: Record<string, string> } };
    expect(parsed.custom.identifierHashes).toEqual({ em: sha("ada@example.test"), ph: sha("16045550100") });
    expect(body).not.toMatch(/ada@example|example\.test|604|555/i);
  });

  it("plans nothing when the category is off", async () => {
    environment({ MEASUREMENT_PROVIDER: "none" });
    await expect(
      leadConversionTask({
        submissionId: "00000000-0000-4000-8000-000000000001",
        consentCookie: "granted",
        readCookie: () => undefined,
        request: {},
        path: "/contact",
      }),
    ).resolves.toBeNull();
  });
});

describe.runIf(hasDatabase)("lead conversion consent (database)", () => {
  beforeAll(ready, 60_000);
  afterAll(closeDb);

  it("plans a conversion only for an explicit allow, and sends none for an unknown submission", async () => {
    configured();
    const calls: string[] = [];
    setParadiseFetchForTests(async (url) => {
      calls.push(url);
      return new Response("{}", { status: 200 });
    });
    const input = {
      submissionId: "00000000-0000-4000-8000-000000000001",
      readCookie: () => undefined,
      request: { ip: "198.51.100.7" },
      path: "/contact",
    };
    expect(await leadConversionTask({ ...input, consentCookie: undefined })).toBeNull();
    expect(await leadConversionTask({ ...input, consentCookie: "implicit" })).toBeNull();
    const task = await leadConversionTask({ ...input, consentCookie: "granted" });
    expect(task).toBeTypeOf("function");
    // Not an accepted submission: nobody's lead, so nothing leaves.
    await task!();
    expect(calls).toEqual([]);
  });
});
