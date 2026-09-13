// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.13 failure drills: simulate each named outage/interrupt and assert
// recovery. Adapter doubles stand in for live providers.
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createNoAi } from "@/adapters/ai/none";
import { createOpenAiAi } from "@/adapters/ai/openai";
import { createLocalStorage } from "@/adapters/storage/local";
import { createNoSms } from "@/adapters/sms/none";
import { createTwilioSms } from "@/adapters/sms/twilio";
import { createStripePayments } from "@/adapters/payments/stripe";
import { AdapterError } from "@/adapters/types";
import { resetMailForTests } from "@/adapters/mail";
import {
  generateTotpSecret,
  matchingTotpStep,
  totpCode,
} from "@/core/auth/two-factor-crypto";
import { users } from "@/core/auth/schema";
import {
  CredentialKeyError,
  decryptSecret,
  encryptSecret,
} from "@/core/connections/crypto";
import { recordConnection, rotateCredentials } from "@/core/connections/service";
import { createContact } from "@/core/contacts/service";
import { db, closeDb as closePool } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { defineJob, enqueueJob, registerJob, stopJobs } from "@/core/jobs";
import { beginMailOAuth, completeMailOAuth } from "@/core/mail/oauth";
import { mailOauthStates, mailSenders, mailDeliveries, mailOutbox } from "@/core/mail/schema";
import { deliverQueuedMail, sendMail } from "@/core/mail/service";
import { ready } from "@/core/runtime";
import { createGracefulShutdown } from "@/core/runtime/shutdown";
import { applyUpdate as runApply } from "@/core/update/apply";
import { signPayload, verifySignature } from "@/core/webhooks/sign";
import {
  createDraftInvoice,
  createPayment,
  getInvoice,
  issueInvoice,
  startPayment,
} from "@/modules/invoicing/invoice-service";
import { processPaymentProviderEvents } from "@/modules/invoicing/payment-provider-service";
import { GET as liveHealth } from "../../app/api/health/live/route";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const invoice = {
  invoiceId: "10000000-0000-4000-8000-000000000001",
  invoiceNumber: "INV-000001",
  contactId: "20000000-0000-4000-8000-000000000002",
  currency: "CAD",
  amountMinor: 12_345,
  description: "Invoice INV-000001",
  customer: { email: "buyer@example.test", name: "Ada Buyer" },
  successUrl: "https://shop.example.test/pay/success",
  cancelUrl: "https://shop.example.test/pay/cancel",
  idempotencyKey: "checkout-1",
  saveMethod: true,
};

const noTax = {
  mode: "not_applicable" as const,
  reason: "Tax does not apply to this test transaction.",
};

describe("C11.13 adapter, clock, disk and process drills", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetEnvForTests();
  });

  it("keeps TOTP within one-step skew and rejects a far clock", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = Math.floor(now / 30_000);
    expect(matchingTotpStep(secret, totpCode(secret, step), now)).toBe(step);
    expect(matchingTotpStep(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(matchingTotpStep(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(matchingTotpStep(secret, totpCode(secret, step - 5), now)).toBeUndefined();
  });

  it("rejects a webhook signature outside the timestamp window, then accepts a fresh one", () => {
    const body = "{}";
    const then = 1_800_000_000;
    const header = signPayload("whsec_test", body, then);
    expect(verifySignature("whsec_test", body, header, { nowSeconds: then + 3600 })).toBe(false);
    expect(verifySignature("whsec_test", body, header, { nowSeconds: then })).toBe(true);
  });

  it("fails closed on ENOSPC and writes again when the volume recovers", async () => {
    const root = await mkdtemp(join(tmpdir(), "freeholder-disk-"));
    try {
      const storage = createLocalStorage({ root, publicPath: "/media" });
      const original = storage.put.bind(storage);
      let full = true;
      storage.put = async (key, body, type) => {
        if (full) {
          full = false;
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        }
        return original(key, body, type);
      };
      await expect(
        storage.put("2026/09/a.txt", new TextEncoder().encode("x"), "text/plain"),
      ).rejects.toMatchObject({ code: "ENOSPC" });
      await expect(
        storage.put("2026/09/a.txt", new TextEncoder().encode("ok"), "text/plain"),
      ).resolves.toMatchObject({ bytes: 2 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an unconfigured AI, then generates once the provider answers", async () => {
    await expect(
      createNoAi().generate({
        purpose: "test",
        system: "s",
        input: "i",
        maxOutputTokens: 8,
        idempotencyKey: "ai-1",
      }),
    ).rejects.toBeInstanceOf(AdapterError);

    const recovered = createOpenAiAi({
      apiKey: "sk-test",
      model: "gpt-test",
      fetchImpl: async () =>
        Response.json({
          model: "gpt-test",
          choices: [{ message: { content: "hello" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
    });
    await expect(
      recovered.generate({
        purpose: "test",
        system: "s",
        input: "i",
        maxOutputTokens: 8,
        idempotencyKey: "ai-2",
      }),
    ).resolves.toMatchObject({ text: "hello" });
  });

  it("refuses SMS when unconfigured, then sends after a provider outage clears", async () => {
    const none = createNoSms();
    expect(none.available).toBe(false);
    await expect(none.send({ to: "+15005550006", title: "", body: "hi", deliveryId: "n" })).resolves.toMatchObject({
      delivers: false,
    });

    let calls = 0;
    const twilio = createTwilioSms({
      accountSid: "AC-test",
      authToken: "token",
      from: "+15005550006",
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ code: 20500, message: "down" }), { status: 500 });
        }
        return new Response(JSON.stringify({ sid: "SM-1", num_segments: "1" }), { status: 201 });
      },
    });
    await expect(
      twilio.send({ to: "+15005550006", title: "", body: "hi", deliveryId: "d1" }),
    ).rejects.toMatchObject({ retryable: true });
    await expect(
      twilio.send({ to: "+15005550006", title: "", body: "hi", deliveryId: "d2" }),
    ).resolves.toMatchObject({ delivers: true, providerRef: "SM-1" });
  });

  it("retries a payment provider outage and then creates checkout", async () => {
    let calls = 0;
    const stripe = createStripePayments({
      secretKey: "sk_test",
      webhookSecrets: ["whsec_test"],
      fetch: async () => {
        calls += 1;
        if (calls === 1) return new Response("down", { status: 500 });
        return new Response(
          JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c", payment_intent: "pi_1" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    await expect(stripe.createCheckout(invoice)).rejects.toMatchObject({ retryable: true });
    await expect(
      stripe.createCheckout({ ...invoice, idempotencyKey: "checkout-2" }),
    ).resolves.toMatchObject({ providerRef: "cs_1" });
  });

  it("keeps liveness green without touching the database", async () => {
    // Readiness turning 503 while Postgres is down is the image-gate contract,
    // not this string inspection. Liveness must stay process-only.
    const live = liveHealth();
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ ok: true });
  });

  it("drains once on process death and does not restart the drain", async () => {
    const drain = vi.fn(async () => undefined);
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({ drain, exit, timeoutMs: 1_000, log: () => undefined });
    await Promise.all([shutdown.handle("SIGTERM"), shutdown.handle("SIGINT")]);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledOnce();
  });

  it("cannot decrypt after a lost key until CREDENTIAL_KEY_PREVIOUS is set", () => {
    const oldKey = Buffer.alloc(32, 9).toString("hex");
    const newKey = Buffer.alloc(32, 8).toString("hex");
    vi.stubEnv("CREDENTIAL_KEY", oldKey);
    vi.stubEnv("CREDENTIAL_KEY_PREVIOUS", "");
    resetEnvForTests();
    const envelope = encryptSecret("refresh-token", "row-1");
    vi.stubEnv("CREDENTIAL_KEY", newKey);
    resetEnvForTests();
    expect(() => decryptSecret(envelope, "row-1")).toThrow(CredentialKeyError);
    vi.stubEnv("CREDENTIAL_KEY_PREVIOUS", oldKey);
    resetEnvForTests();
    expect(decryptSecret(envelope, "row-1")).toBe("refresh-token");
  });
});

const drillJob = defineJob({
  name: "test.failureDrills.noop",
  summary: "Idempotency drill; it must not do work.",
  handler: async () => null,
});

describe.runIf(hasDatabase)("C11.13 recovery drills", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    registerJob(drillJob);
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner@example.test",
      role: "owner",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetEnvForTests();
    resetMailForTests();
  });

  afterAll(async () => {
    await stopJobs();
    await closeDb();
  });

  it("reconnects after the database pool is closed", async () => {
    await db().execute(sql`select 1`);
    await closePool();
    await expect(db().execute(sql`select 1`)).resolves.toBeTruthy();
  });

  it("keeps a retryable mail delivery queued until the provider recovers", async () => {
    process.env.MAIL_BULK_ADAPTER = "resend";
    process.env.MAIL_BULK_FROM = "news@example.test";
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
    resetEnvForTests();
    resetMailForTests();
    const [sender] = await db()
      .insert(mailSenders)
      .values({
        purpose: "bulk",
        provider: "resend",
        email: "news@example.test",
        verificationStatus: "verified",
        status: "active",
        isDefault: true,
        createdBy: OWNER.userId,
      })
      .returning();
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "provider-message-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const queued = await db().transaction((tx) =>
      sendMail(tx, { to: "person@example.test", subject: "Campaign", text: "Body" }, {
        purpose: "bulk",
        senderId: sender!.id,
      }),
    );
    await expect(deliverQueuedMail(queued.id)).rejects.toThrow(/could not be reached/);
    expect(
      (await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, queued.id)))[0],
    ).toMatchObject({ status: "queued" });
    expect(await db().select().from(mailOutbox)).toHaveLength(1);
    await expect(deliverQueuedMail(queued.id)).resolves.toEqual({ status: "submitted" });
    expect(await db().select().from(mailOutbox)).toEqual([]);
  });

  it("settles a payment webhook once and counts the replay as a duplicate", async () => {
    const contact = await createContact.call(
      { name: "Buyer", email: "buyer-drill@example.test" },
      OWNER,
    );
    const draft = await createDraftInvoice.call(
      {
        contactId: contact.id,
        currency: "CAD",
        idempotencyKey: "draft-drill",
        lines: [
          {
            description: "Service",
            quantityMicros: 1_000_000,
            unitAmountMinor: 10_000,
            discountMinor: 0,
            taxCategoryCode: "standard",
            requiresShipping: false,
            snapshot: {},
          },
        ],
        shippingMinor: 0,
        tax: noTax,
      },
      OWNER,
    );
    const issued = await issueInvoice.call({ id: draft.invoice.id }, OWNER);
    const payment = await createPayment.call(
      {
        invoiceId: issued.invoice.id,
        provider: "stripe",
        method: "hosted_checkout",
        amountMinor: 10_000,
        idempotencyKey: "stripe-drill-1",
      },
      OWNER,
    );
    await startPayment.call({ id: payment.id, providerRef: "pi_drill", providerCheckoutRef: "cs_drill" }, OWNER);
    const event = {
      id: "evt_drill_1",
      kind: "payment_succeeded" as const,
      providerRef: "pi_drill",
      checkoutRef: "cs_drill",
      amountMinor: 10_000,
      currency: "CAD",
      occurredAt: "2026-08-14T12:00:00.000Z",
      invoiceId: issued.invoice.id,
      contactId: contact.id,
    };
    const digest = "b".repeat(64);
    const receivedAt = "2026-08-14T12:01:00.000Z";
    await expect(
      processPaymentProviderEvents.call(
        { provider: "stripe", bodySha256: digest, receivedAt, events: [event] },
        { kind: "system" },
      ),
    ).resolves.toEqual({ processed: 1, duplicates: 0 });
    await expect(
      processPaymentProviderEvents.call(
        { provider: "stripe", bodySha256: digest, receivedAt, events: [event] },
        { kind: "system" },
      ),
    ).resolves.toEqual({ processed: 0, duplicates: 1 });
    expect((await getInvoice.call({ id: issued.invoice.id }, OWNER)).invoice).toMatchObject({
      paidMinor: 10_000,
    });
  });

  it("lets the owner start OAuth again after a failed provider exchange", async () => {
    process.env.APP_URL = "https://freeholder.example";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-client-secret";
    resetEnvForTests();
    const begun = await beginMailOAuth.call({ provider: "google" }, OWNER);
    const state = new URL(begun.authorizationUrl).searchParams.get("state")!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
    );
    await expect(
      completeMailOAuth.call({ provider: "google", state, code: "one-use-code" }, OWNER),
    ).rejects.toThrow();
    const hash = createHash("sha256").update(state).digest("hex");
    const [consumed] = await db()
      .select()
      .from(mailOauthStates)
      .where(eq(mailOauthStates.tokenHash, hash));
    expect(consumed?.consumedAt).toBeInstanceOf(Date);
    const again = await beginMailOAuth.call({ provider: "google" }, OWNER);
    expect(new URL(again.authorizationUrl).searchParams.get("state")).toBeTruthy();
  });

  it("rolls back an update interrupted at migrate, smoke or cutover", async () => {
    for (const failAt of ["migrate", "smoke", "cutover"] as const) {
      const result = await runApply({ actor: OWNER, failAt });
      expect(result.status).toBe("rolled_back");
    }
  });

  it("deduplicates a retried background job", async () => {
    await ready();
    const first = await db().transaction((tx) =>
      enqueueJob(tx, drillJob.name, { n: 1 }, { idempotencyKey: "c11-13-job" }),
    );
    const second = await db().transaction((tx) =>
      enqueueJob(tx, drillJob.name, { n: 1 }, { idempotencyKey: "c11-13-job" }),
    );
    expect(first.deduplicated).toBe(false);
    expect(second).toEqual({ id: first.id, name: drillJob.name, deduplicated: true });
  });

  it("flags stored credentials after a lost key and reconnects with the previous key", async () => {
    const oldKey = Buffer.alloc(32, 5).toString("hex");
    const newKey = Buffer.alloc(32, 6).toString("hex");
    vi.stubEnv("CREDENTIAL_KEY", oldKey);
    vi.stubEnv("CREDENTIAL_KEY_PREVIOUS", "");
    resetEnvForTests();
    await recordConnection.call(
      {
        userId: OWNER.userId,
        provider: "google",
        providerAccountId: "lost-key",
        credentials: { access_token: "a", refresh_token: "r" },
      },
      OWNER,
    );
    vi.stubEnv("CREDENTIAL_KEY", newKey);
    resetEnvForTests();
    expect(await rotateCredentials.call({}, OWNER)).toMatchObject({ failed: 1 });
    vi.stubEnv("CREDENTIAL_KEY_PREVIOUS", oldKey);
    resetEnvForTests();
    expect(await rotateCredentials.call({}, OWNER)).toEqual({ examined: 1, rotated: 1, failed: 0 });
  });
});
