// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The signed click-out (MASTER.md §4.16, C9.18).
//
// §4.16: "Click-outs are counted then redirected through a signed first-party
// endpoint, so the count and the destination cannot disagree, and a creative
// cannot be swapped for a different target after approval."
//
// That sentence asks for two different guarantees, and they need two different
// mechanisms.
//
//   1. *The count and the destination cannot disagree.* Every click leaves
//      through one endpoint, so there is no path that redirects without
//      counting and none that counts without redirecting.
//   2. *A creative cannot be swapped for a different target after approval.*
//      The destination is inside the signed token, so a link that is already
//      on a page names the URL that was approved when it was rendered. If the
//      row has since been edited, the two disagree and the click is refused —
//      the visitor is not silently sent somewhere nobody reviewed.
//
// A redirect endpoint that takes a URL from the request is an open redirect,
// which is a phishing tool with the owner's domain on it. This one takes a URL
// from the request *and* from the row and refuses unless they match, so the
// signature is load-bearing rather than decorative: an unsigned or edited
// token never reaches the redirect at all.
//
// Pure functions over plain values, like `targeting.ts`, so every case above
// is a unit test with no database and no HTTP.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/core/env";

/**
 * A day. A slot may be lazy and a page may sit open in a tab, so a token has
 * to outlive the render by a wide margin — but not so wide that a link
 * scraped out of a page keeps working for a month after the campaign ended.
 */
export const CLICK_TOKEN_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface ClickClaim {
  creativeId: string;
  /** The destination as it stood when the ad was served. */
  url: string;
  /** Unix seconds. Inside the signed material, so it cannot be extended. */
  issuedAt: number;
  /** The slot this fill was shown in, so a click rollup can name the position. */
  slotId?: string;
}

function secret(): string {
  const value = env().SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is required to sign ad click-outs.");
  }
  return value;
}

/**
 * Domain-separated, like every other token in the platform: a gallery token
 * must not open a document, and an ad click token must not do either.
 */
function mac(payload: string): Buffer {
  return createHmac("sha256", secret())
    .update(`freeholder:ad-click:v1\0${payload}`)
    .digest();
}

/**
 * `<base64url(claim)>.<base64url(hmac)>`.
 *
 * The claim is readable by anyone holding the link, and deliberately so:
 * there is nothing secret in "this link goes to example.com". What the
 * signature buys is that nobody else can *write* one.
 */
export function signClickToken(claim: ClickClaim): string {
  const payload = Buffer.from(
    JSON.stringify({
      c: claim.creativeId,
      u: claim.url,
      t: claim.issuedAt,
      ...(claim.slotId ? { s: claim.slotId } : {}),
    }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${mac(payload).toString("base64url")}`;
}

/**
 * The claim, or null for anything that is not exactly one we issued.
 *
 * Null rather than a thrown error with a reason, because the reasons are all
 * the same to the person holding the link — and telling an attacker which
 * half of their forgery was wrong is free help.
 */
export function verifyClickToken(token: string, nowSeconds: number): ClickClaim | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(presented)) {
    return null;
  }

  const expected = mac(payload);
  const offered = Buffer.from(presented, "base64url");
  // Length first: timingSafeEqual throws on a mismatch, and the lengths are
  // not the secret.
  if (offered.length !== expected.length) return null;
  if (!timingSafeEqual(new Uint8Array(offered), new Uint8Array(expected))) return null;

  let claim: unknown;
  try {
    claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claim !== "object" || claim === null) return null;
  const bag = claim as { c?: unknown; u?: unknown; t?: unknown; s?: unknown };
  if (typeof bag.c !== "string" || typeof bag.u !== "string") return null;
  if (typeof bag.t !== "number" || !Number.isFinite(bag.t)) return null;

  // Expiry is checked after the signature, so an expired token and a forged
  // one are indistinguishable in cost.
  if (nowSeconds - bag.t > CLICK_TOKEN_MAX_AGE_SECONDS) return null;
  // A token from the future is a clock problem or a forgery attempt; either
  // way it is not one we are willing to honour.
  if (bag.t - nowSeconds > 60) return null;

  return {
    creativeId: bag.c,
    url: bag.u,
    issuedAt: bag.t,
    ...(typeof bag.s === "string" ? { slotId: bag.s } : {}),
  };
}

/**
 * The destination, or null.
 *
 * Applied when a creative is saved *and* again before the redirect is issued,
 * because the two happen at different times under different code: a row
 * written before this rule existed, or edited straight in SQL, must not become
 * a `javascript:` payload served from the owner's own domain.
 */
export function safeClickUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  // Credentials in a URL are a phishing shape ("https://bank.example@evil"),
  // and no legitimate advertiser destination has them.
  if (url.username || url.password) return null;
  return url.toString();
}

/** Where a served creative points a visitor. First-party, always. */
export function clickPath(token: string): string {
  return `/go/ad?t=${encodeURIComponent(token)}`;
}
