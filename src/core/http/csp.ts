// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Edge-safe Content Security Policy construction (MASTER.md C1.19, §36).
// Exact origins only: a wildcard quietly grants every tenant on a host.

export const CSP_NONCE_HEADER = "x-nonce";
export const CSP_REPORT_GROUP = "freeholder-csp";
export const CSP_REPORT_PATH = "/api/security/csp-report";
/** Separate from anonymous analytics consent: creative code is a different risk. */
export const THIRD_PARTY_CREATIVE_CONSENT_COOKIE = "fh_tc";

const CSP_SKIPPED =
  /^\/(?:api|media|privacy\/artifacts|sitemaps)(?:\/|$)|\.(?:xml|txt|ico|png|jpe?g|svg|webp|avif)$/i;

export function cspAppliesToPath(path: string): boolean {
  return !CSP_SKIPPED.test(path);
}

export function parseCspOrigins(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  const origins = value.split(/[\s,]+/).filter(Boolean).map((candidate) => {
    const url = new URL(candidate);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.hostname.includes("*")
    ) {
      throw new Error(
        `CSP origin "${candidate}" must be one exact HTTPS origin with no path, query, credentials, or wildcard.`,
      );
    }
    return url.origin;
  });
  return [...new Set(origins)].sort();
}

function sources(values: string[]): string {
  return values.length > 0 ? ` ${values.join(" ")}` : "";
}

export interface ContentSecurityPolicyOptions {
  nonce: string;
  path: string;
  production: boolean;
  mediaOrigins?: string[];
  uploadOrigins?: string[];
  creativeOrigins?: string[];
  thirdPartyCreativeConsent?: boolean;
}

/**
 * A nonce-based strict policy compatible with Next's dynamic App Router.
 *
 * `style-src-attr 'unsafe-inline'` is intentionally narrower than allowing all
 * inline style elements: React uses bounded style attributes for bar widths
 * and image crop anchors, while every `<style>` element still needs the nonce.
 */
export function contentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  const media = [...new Set(options.mediaOrigins ?? [])].sort();
  const upload = options.path.startsWith("/admin")
    ? [...new Set(options.uploadOrigins ?? [])].sort()
    : [];
  const creative = options.thirdPartyCreativeConsent
    ? [...new Set(options.creativeOrigins ?? [])].sort()
    : [];
  const preview = options.path === "/preview" || options.path.startsWith("/preview/");
  const development = options.production
    ? ""
    : " 'unsafe-eval'";
  const policy = [
    "default-src 'self'",
    `script-src 'nonce-${options.nonce}' 'strict-dynamic' 'self'${development}${sources(creative)}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${options.nonce}'${sources(creative)}`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob:${sources([...media, ...creative])}`,
    `font-src 'self' data:${sources(creative)}`,
    `media-src 'self' blob:${sources([...media, ...creative])}`,
    `connect-src 'self'${sources([...upload, ...creative])}`,
    `frame-src 'self'${sources(creative)}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${preview ? "'self'" : "'none'"}`,
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
    ...(options.production ? ["upgrade-insecure-requests"] : []),
  ];
  return policy.join("; ");
}

export function reportingEndpointsHeader(): string {
  return `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
}

export function thirdPartyCreativeConsentGranted(
  value: string | null | undefined,
): boolean {
  return value === "granted";
}
