// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Nonce-based browser containment and consent boundaries (MASTER.md C1.19).
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/core/env";
import {
  CSP_NONCE_HEADER,
  THIRD_PARTY_CREATIVE_CONSENT_COOKIE,
  contentSecurityPolicy,
  cspAppliesToPath,
  parseCspOrigins,
} from "@/core/http/csp";
import { proxy } from "../../proxy";

function directive(policy: string, name: string): string {
  return policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
}

function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("the Content Security Policy contract", () => {
  it("accepts only exact secure origins", () => {
    expect(parseCspOrigins("https://media.example, https://ads.example"))
      .toEqual(["https://ads.example", "https://media.example"]);
    expect(parseCspOrigins("http://localhost:3001")).toEqual(["http://localhost:3001"]);

    for (const unsafe of [
      "http://ads.example",
      "https://*.example",
      "https://ads.example/path",
      "https://user:secret@ads.example",
    ]) {
      expect(() => parseCspOrigins(unsafe)).toThrow(/exact HTTPS origin/);
    }
  });

  it("uses a strict nonce and keeps inline permission narrow", () => {
    const policy = contentSecurityPolicy({
      nonce: "one-time-token",
      path: "/admin/pages",
      production: true,
    });
    expect(directive(policy, "script-src")).toContain("'nonce-one-time-token'");
    expect(directive(policy, "script-src")).toContain("'strict-dynamic'");
    expect(directive(policy, "script-src")).not.toContain("'unsafe-inline'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("permits embedding only the same-origin editor preview", () => {
    const preview = contentSecurityPolicy({
      nonce: "preview",
      path: "/preview",
      production: true,
    });
    const nested = contentSecurityPolicy({
      nonce: "preview",
      path: "/preview/services",
      production: true,
    });
    expect(preview).toContain("frame-ancestors 'self'");
    expect(nested).toContain("frame-ancestors 'self'");
  });

  it("opens uploads only in admin and creatives only after separate consent", () => {
    const options = {
      nonce: "bounded",
      production: true,
      uploadOrigins: ["https://uploads.example"],
      creativeOrigins: ["https://creative.example"],
    };
    const publicPolicy = contentSecurityPolicy({ ...options, path: "/services" });
    const adminPolicy = contentSecurityPolicy({ ...options, path: "/admin/media" });
    const consentedPolicy = contentSecurityPolicy({
      ...options,
      path: "/services",
      thirdPartyCreativeConsent: true,
    });

    expect(directive(publicPolicy, "connect-src")).not.toContain("uploads.example");
    expect(directive(adminPolicy, "connect-src")).toContain("https://uploads.example");
    expect(publicPolicy).not.toContain("creative.example");
    expect(consentedPolicy).toContain("https://creative.example");
  });

  it("does not override API and file responses", () => {
    expect(cspAppliesToPath("/services")).toBe(true);
    expect(cspAppliesToPath("/api/security/csp-report")).toBe(false);
    expect(cspAppliesToPath("/media/an-image")).toBe(false);
    expect(cspAppliesToPath("/sitemap-fr-CA.xml")).toBe(false);
  });

  it("keeps development's evaluator allowance out of production", () => {
    const development = contentSecurityPolicy({ nonce: "n", path: "/", production: false });
    const production = contentSecurityPolicy({ nonce: "n", path: "/", production: true });
    expect(directive(development, "script-src")).toContain("'unsafe-eval'");
    expect(directive(production, "script-src")).not.toContain("'unsafe-eval'");
  });
});

describe("CSP at the edge", () => {
  const saved = {
    CSP_THIRD_PARTY_ORIGINS: process.env.CSP_THIRD_PARTY_ORIGINS,
    FREEHOLDER_STORAGE: process.env.FREEHOLDER_STORAGE,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvForTests();
  });

  it("forwards and enforces one identical per-request policy", () => {
    const first = proxy(new NextRequest("https://example.test/services"));
    const second = proxy(new NextRequest("https://example.test/services"));
    const nonce = forwarded(first, CSP_NONCE_HEADER);
    const requestPolicy = forwarded(first, "content-security-policy");

    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(requestPolicy).toBe(first.headers.get("content-security-policy"));
    expect(requestPolicy).toContain(`'nonce-${nonce}'`);
    expect(first.headers.get("reporting-endpoints"))
      .toBe('freeholder-csp="/api/security/csp-report"');
    expect(forwarded(second, CSP_NONCE_HEADER)).not.toBe(nonce);
  });

  it("does not attach a document policy to API responses", () => {
    const response = proxy(new NextRequest("https://example.test/api/health"));
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(forwarded(response, CSP_NONCE_HEADER)).toBeNull();
  });

  it("adds exact storage and creative origins only in their allowed contexts", () => {
    process.env.FREEHOLDER_STORAGE = "s3";
    process.env.S3_ENDPOINT = "https://uploads.example";
    process.env.S3_PUBLIC_BASE_URL = "https://media.example/cdn";
    process.env.CSP_THIRD_PARTY_ORIGINS = "https://creative.example";
    resetEnvForTests();

    const withoutConsent = proxy(new NextRequest("https://example.test/services"));
    const withConsent = proxy(new NextRequest("https://example.test/services", {
      headers: { cookie: `${THIRD_PARTY_CREATIVE_CONSENT_COOKIE}=granted` },
    }));
    const admin = proxy(new NextRequest("https://example.test/admin/media"));

    expect(withoutConsent.headers.get("content-security-policy")).toContain("media.example");
    expect(withoutConsent.headers.get("content-security-policy")).not.toContain("creative.example");
    expect(withConsent.headers.get("content-security-policy")).toContain("creative.example");
    expect(directive(admin.headers.get("content-security-policy") ?? "", "connect-src"))
      .toContain("https://uploads.example");
  });
});

describe("handwritten inline elements", () => {
  it("passes the request nonce to every inline script and style element", () => {
    const root = readFileSync("app/layout.tsx", "utf8");
    const preview = readFileSync("app/(preview)/layout.tsx", "utf8");
    const page = readFileSync("app/(public)/[[...slug]]/page.tsx", "utf8");

    expect(root).toMatch(/<style nonce=\{nonce\}/);
    expect(preview).toMatch(/<style nonce=\{nonce\}/);
    expect(preview).toMatch(/<script\s+nonce=\{nonce\}/);
    expect(page).toMatch(/<script[\s\S]{0,100}nonce=\{nonce\}/);
  });
});
