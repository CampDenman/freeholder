// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private preview mode (MASTER.md §43 C3.35).
//
// A site that is being built for an owner, before the owner approves it for
// the public. Every public surface — pages, media, OG images, llms.txt, the
// sitemap, the public API — answers only to a browser holding a signed
// preview cookie, and every response says `noindex`. Admin, sign-in and
// setup stay reachable: they are already behind the owner's own credentials
// and noindexed, and the owner must be able to claim the site.
//
// The cookie is minted from a link: `/preview-access?t=v1.<exp>.<sig>`, where
// `sig` is an HMAC-SHA256 under FREEHOLDER_PREVIEW_KEY over the expiry. The
// key never leaves the operator; a link stops working at its expiry or when
// the key is rotated. There is no list of viewers to leak and nothing to
// revoke one by one — rotate the key to revoke every link at once.
//
// Edge-safe on purpose: proxy.ts imports this, so it depends on nothing but a
// pure-JS HMAC (synchronous, which the proxy needs) and the Web platform.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const PREVIEW_COOKIE = "fh_preview";
export const PREVIEW_ACCESS_PATH = "/preview-access";
export const PREVIEW_ROBOTS_HEADER = "noindex, nofollow, noarchive";
/** The longest link an operator may mint: thirty days. */
export const PREVIEW_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

const TOKEN = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/;
const encoder = new TextEncoder();

/** Whether private preview mode is on: a key of at least 32 characters is set. */
export function previewEnabled(key: string | undefined): key is string {
  return typeof key === "string" && key.length >= 32;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signature(key: string, expires: number): string {
  return base64url(
    hmac(sha256, encoder.encode(key), encoder.encode(`freeholder-private-preview:v1:${expires}`)),
  );
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Mint a preview token that expires at `expiresAt` (Unix seconds). Refuses a
 * lifetime beyond thirty days, so a forgotten link cannot open a site for
 * ever.
 */
export function mintPreviewToken(key: string, expiresAt: number, now = Math.floor(Date.now() / 1000)): string {
  if (!previewEnabled(key)) throw new Error("FREEHOLDER_PREVIEW_KEY must be at least 32 characters.");
  if (!Number.isInteger(expiresAt) || expiresAt <= now) throw new Error("A preview link must expire in the future.");
  if (expiresAt - now > PREVIEW_MAX_TTL_SECONDS) throw new Error("A preview link may last at most thirty days.");
  return `v1.${expiresAt}.${signature(key, expiresAt)}`;
}

/** The token's expiry when it is genuine and current, otherwise null. */
export function verifyPreviewToken(
  key: string | undefined,
  token: string | undefined | null,
  now = Math.floor(Date.now() / 1000),
): number | null {
  if (!previewEnabled(key) || !token) return null;
  const match = TOKEN.exec(token);
  if (!match) return null;
  const expires = Number(match[1]);
  if (expires <= now || expires - now > PREVIEW_MAX_TTL_SECONDS) return null;
  return sameString(match[2]!, signature(key, expires)) ? expires : null;
}

/**
 * Paths a private preview never gates: the owner's own surfaces (already
 * authenticated and noindexed), liveness for the host's health check, the
 * link exchange itself and Next's static assets.
 */
const OPEN_PATHS =
  /^\/(?:admin|login|forgot|reset|invite|setup|preview|_next\/static|_next\/image)(?:\/|$)|^\/api\/(?:health|auth|setup)(?:\/|$)|^\/preview-access$/;

/**
 * Stripe's two webhook endpoints. Stripe cannot hold a preview cookie or send
 * an Authorization header; it signs each delivery with `Stripe-Signature`,
 * and each route verifies that signature over the raw body before any effect.
 */
const STRIPE_SIGNED_WEBHOOKS = /^\/api\/(?:payouts\/stripe_connect\/webhook|payments\/webhooks\/stripe)$/;

/** What the gate reads from a request besides its path. */
export interface PreviewGateRequest {
  method?: string;
  hasStripeSignature?: boolean;
}

/**
 * Whether `path` needs the preview cookie. The API is gated too — its public
 * reads are the same content as the pages — except for a request that
 * carries its own credential, which the API authenticates itself: a bearer
 * credential, or a POST that Stripe signed to one of its own webhook routes.
 * An unsigned request to those routes stays gated, exactly as before.
 */
export function previewGated(path: string, hasAuthorization: boolean, request: PreviewGateRequest = {}): boolean {
  if (OPEN_PATHS.test(path)) return false;
  if (hasAuthorization && path.startsWith("/api/")) return false;
  if (request.method === "POST" && request.hasStripeSignature && STRIPE_SIGNED_WEBHOOKS.test(path)) return false;
  return true;
}

/** Only a same-site path is a safe place to land after the link exchange. */
export function previewLandingPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

/** The page a visitor without a preview link sees. It names nothing about the business. */
export const PREVIEW_REQUIRED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Private preview</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem}</style>
</head><body><main><h1>Private preview</h1>
<p>This site is a private preview and is not published. Ask its owner for a preview link.</p></main></body></html>`;
