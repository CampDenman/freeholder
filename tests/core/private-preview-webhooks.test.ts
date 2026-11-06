// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stripe's webhooks reach a private preview (MASTER.md §43 C3.35).
//
// Stripe cannot hold a preview cookie, so the gate lets through exactly a
// POST that carries `Stripe-Signature` to one of Stripe's two webhook routes,
// and nothing else. The routes then verify the signature themselves. These
// tests drive the real proxy, then the real route behind it, the way a
// delivery travels: an unsigned request still gets the preview page, and a
// badly signed one gets the route's own refusal and nothing more.
import { createHmac } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const KEY = "k".repeat(40);
const PAYMENTS_SECRET = "whsec_preview_payments_test";
const CONNECT_SECRET = "whsec_preview_connect_test";
const saved = {
  FREEHOLDER_PREVIEW_KEY: process.env.FREEHOLDER_PREVIEW_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
};
// The Stripe adapters read their secrets when they are built, so set them
// before the first import that builds one.
process.env.FREEHOLDER_PREVIEW_KEY = KEY;
process.env.STRIPE_SECRET_KEY = "sk_test_preview";
process.env.STRIPE_WEBHOOK_SECRET = PAYMENTS_SECRET;
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
const { resetEnvForTests } = await import("@/core/env");
resetEnvForTests();
const { proxy } = await import("../../proxy");
const { previewGated } = await import("@/core/preview/private-preview");
const { POST: payments } = await import("../../app/api/payments/webhooks/stripe/route");
const { POST: payouts } = await import("../../app/api/payouts/[provider]/webhook/route");

afterAll(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
});
afterEach(() => {
  process.env.FREEHOLDER_PREVIEW_KEY = KEY;
  resetEnvForTests();
});

const CONNECT = "/api/payouts/stripe_connect/webhook" as const;
const PAYMENTS = "/api/payments/webhooks/stripe" as const;
const EVENT = JSON.stringify({ id: "evt_preview", type: "account.updated", data: { object: { id: "acct_preview" } } });

function signature(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

function gate(path: string, init: { method?: string; signature?: string; body?: string } = {}) {
  const headers = new Headers();
  if (init.signature !== undefined) headers.set("stripe-signature", init.signature);
  const method = init.method ?? "POST";
  return proxy(new NextRequest(new URL(`https://preview.test${path}`), { method, headers, body: method === "GET" ? undefined : init.body ?? EVENT }));
}

const passed = (response: Response) => response.headers.get("x-middleware-next") === "1";

/** The proxy first, then the route, as a delivery travels. */
async function deliver(path: typeof CONNECT | typeof PAYMENTS, init: { signature?: string; body?: string } = {}) {
  const body = init.body ?? EVENT;
  const gated = gate(path, { ...init, body });
  if (!passed(gated)) return gated;
  const headers = new Headers();
  if (init.signature !== undefined) headers.set("stripe-signature", init.signature);
  const request = new Request(`https://preview.test${path}`, { method: "POST", headers, body });
  return path === CONNECT
    ? payouts(request, { params: Promise.resolve({ provider: "stripe_connect" }) })
    : payments(request);
}

describe("the preview gate and Stripe's signed webhooks", () => {
  it("opens only a signed POST to Stripe's two webhook routes", () => {
    for (const path of [CONNECT, PAYMENTS]) {
      expect(previewGated(path, false, { method: "POST", hasStripeSignature: true }), path).toBe(false);
      expect(previewGated(path, false, { method: "POST", hasStripeSignature: false }), path).toBe(true);
      expect(previewGated(path, false, { method: "GET", hasStripeSignature: true }), path).toBe(true);
      expect(previewGated(path, false), path).toBe(true);
    }
    for (const path of [
      "/",
      "/pricing",
      "/api/v1/pages",
      "/api/payments/webhooks/paypal",
      "/api/payments/webhooks/square",
      "/api/payouts/paypal_payouts/webhook",
      "/api/payouts/razorpay_route/webhook",
      "/api/payments/webhooks/stripe/extra",
      "/api/payments/webhooks/stripex",
      "/api/payouts/stripe_connect/webhook/",
      "/api/mail/webhooks/postmark",
      "/fr/api/payments/webhooks/stripe",
    ]) {
      expect(previewGated(path, false, { method: "POST", hasStripeSignature: true }), path).toBe(true);
    }
  });

  it("still gives an unsigned delivery the preview page, as before", async () => {
    for (const path of [CONNECT, PAYMENTS] as const) {
      for (const signatureHeader of [undefined, ""]) {
        const response = await deliver(path, { signature: signatureHeader });
        expect(response.status, path).toBe(401);
        expect(await response.text()).toContain("Private preview");
      }
    }
  });

  it("keeps every other path gated even when the request carries a Stripe signature", async () => {
    for (const path of ["/", "/pricing", "/api/v1/pages", "/api/payments/webhooks/paypal", "/api/payouts/paypal_payouts/webhook"]) {
      const response = gate(path, { signature: signature(PAYMENTS_SECRET, EVENT) });
      expect(response.status, path).toBe(401);
      expect(await response.text()).toContain("Private preview");
    }
    for (const path of [CONNECT, PAYMENTS]) {
      expect(gate(path, { method: "GET", signature: signature(PAYMENTS_SECRET, EVENT) }).status, path).toBe(401);
    }
  });

  it("lets a signed delivery reach the route, which refuses a bad signature with nothing about the site", async () => {
    const forged = `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`;
    const otherSecret = signature("whsec_someone_else", EVENT);
    const stale = signature(CONNECT_SECRET, EVENT, Math.floor(Date.now() / 1000) - 3600);
    for (const bad of [forged, otherSecret, stale, "garbage"]) {
      expect(passed(gate(CONNECT, { signature: bad }))).toBe(true);
      const connect = await deliver(CONNECT, { signature: bad });
      expect(connect.status).toBe(401);
      expect(await connect.text()).toBe("");

      expect(passed(gate(PAYMENTS, { signature: bad }))).toBe(true);
      const charge = await deliver(PAYMENTS, { signature: bad });
      expect(charge.status).toBe(400);
      expect(Object.keys((await charge.json()) as Record<string, unknown>)).toEqual(["error"]);
    }
    // The payments secret does not sign Connect deliveries, nor the reverse.
    expect((await deliver(CONNECT, { signature: signature(PAYMENTS_SECRET, EVENT) })).status).toBe(401);
    expect((await deliver(PAYMENTS, { signature: signature(CONNECT_SECRET, EVENT) })).status).toBe(400);
  });

  it("changes nothing for a published site", () => {
    delete process.env.FREEHOLDER_PREVIEW_KEY;
    resetEnvForTests();
    expect(passed(gate(CONNECT))).toBe(true);
    expect(passed(gate("/pricing", { method: "GET" }))).toBe(true);
  });
});
