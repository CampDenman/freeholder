// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A provider-returned checkout link is authenticated, never a refill URL.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/core/env";

function signature(payload: string, paymentId: string, owner: string): Buffer {
  const secret = env().SESSION_SECRET;
  if (!secret) throw new Error("An authenticated payment review requires the configured session secret.");
  return createHmac("sha256", secret).update("freeholder:merchant-checkout-review:v1\0").update(paymentId).update("\0").update(owner).update("\0").update(payload).digest();
}
export function sealCheckoutLink(input: { url: string; expiresAt: string; paymentId: string; owner: string }, now = Date.now()): string | null {
  const payload = Buffer.from(JSON.stringify({ url: input.url, expiresAt: input.expiresAt, issuedAt: now }), "utf8").toString("base64url");
  if (payload.length > 3000) return null;
  return `${payload}.${signature(payload, input.paymentId, input.owner).toString("base64url")}`;
}
export function readCheckoutLink(raw: string | undefined, paymentId: string, owner: string, now = Date.now()): string | null {
  try {
    if (!raw || raw.length > 3500) return null;
    const [payload, encodedSignature, extra] = raw.split(".");
    if (!payload || !encodedSignature || extra !== undefined) return null;
    const observed = Buffer.from(encodedSignature, "base64url"), expected = signature(payload, paymentId, owner);
    if (observed.length !== expected.length || !timingSafeEqual(observed, expected)) return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { url?: unknown; expiresAt?: unknown; issuedAt?: unknown };
    if (typeof value.url !== "string" || typeof value.expiresAt !== "string" || typeof value.issuedAt !== "number" || !Number.isFinite(value.issuedAt)
      || value.issuedAt > now + 30000 || now - value.issuedAt > 300000 || !(Date.parse(value.expiresAt) > now)) return null;
    const url = new URL(value.url);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
