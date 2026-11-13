// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner recovery links carry provider provenance, not unsigned refill data.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/core/env";
import { readCheckoutLink, sealCheckoutLink } from "../../app/(admin)/admin/payments/[id]/merchant/checkout-link";

const now = Date.parse("2026-11-12T12:00:00.000Z"), paymentId = "00000000-0000-4000-8000-000000000001", owner = "user:original-owner";
const input = { paymentId, owner, url: "https://checkout.stripe.com/c/pay/original", expiresAt: new Date(now + 3600000).toISOString() };
beforeEach(() => { vi.stubEnv("SESSION_SECRET", "merchant-checkout-review-test-secret-only-2026"); resetEnvForTests(); });
afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); });
describe("original merchant checkout review link", () => {
  it("accepts only the provider-returned link for the same payment and owner", () => {
    const cookie = sealCheckoutLink(input, now)!;
    expect(readCheckoutLink(cookie, paymentId, owner, now + 1000)).toBe(input.url);
    expect(readCheckoutLink(cookie, "another-payment", owner, now)).toBeNull();
    expect(readCheckoutLink(cookie, paymentId, "user:another-owner", now)).toBeNull();
    const [, signature] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ url: "https://attacker.example/pay", expiresAt: input.expiresAt, issuedAt: now })).toString("base64url");
    expect(readCheckoutLink(`${forged}.${signature}`, paymentId, owner, now)).toBeNull();
  });
  it("expires the browser witness after five minutes and rejects expired or unsafe destinations", () => {
    expect(readCheckoutLink(sealCheckoutLink(input, now)!, paymentId, owner, now + 300001)).toBeNull();
    expect(readCheckoutLink(sealCheckoutLink({ ...input, expiresAt: new Date(now).toISOString() }, now)!, paymentId, owner, now)).toBeNull();
    for (const url of ["javascript:alert(1)", "http://checkout.stripe.com/pay", "https://user:password@checkout.stripe.com/pay"]) {
      expect(readCheckoutLink(sealCheckoutLink({ ...input, url }, now)!, paymentId, owner, now)).toBeNull();
    }
    expect(readCheckoutLink("malformed", paymentId, owner, now)).toBeNull();
  });
});
