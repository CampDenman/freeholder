// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Outbound webhooks (MASTER.md §11's bus, §28's integration surface).
//
// The delivery tests run against a *real* HTTP server, started here on a
// loopback port. Mocking `fetch` would have tested that this code calls fetch,
// which is not the interesting part — what matters is that a receiver gets a
// request it can verify, that a 500 is retried and a 200 is not, and that a
// signature computed here validates in an implementation written from the
// receiver's side. So there is a receiver.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import type { Actor } from "@/core/service";
import { users } from "@/core/auth/schema";
import { outboxEvents } from "@/core/events/schema";
import { webhookDeliveries, webhookSubscriptions } from "@/core/webhooks/schema";
import {
  createWebhook,
  deleteWebhook,
  fanOut,
  listDeliveries,
  listWebhooks,
  revealWebhookSecret,
  rotateWebhookSecret,
  testWebhook,
  updateWebhook,
} from "@/core/webhooks/service";
import {
  assertDeliverableUrl,
  matches,
  signPayload,
  verifySignature,
} from "@/core/webhooks/sign";
import {
  backoffSeconds,
  deliverDue,
  FAILURES_BEFORE_PAUSE,
  MAX_ATTEMPTS,
  pruneDeliveries,
} from "@/core/webhooks/deliver";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

interface Received {
  body: string;
  headers: Record<string, string | undefined>;
}

afterAll(async () => {
  await stopJobs();
});

/** A receiver, as a customer would run one. */
function receiver(handler: (received: Received) => { status: number; body?: string }) {
  const seen: Received[] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += String(chunk)));
    request.on("end", () => {
      const received: Received = {
        body,
        headers: request.headers as Record<string, string | undefined>,
      };
      seen.push(received);
      const answer = handler(received);
      response.writeHead(answer.status, { "content-type": "text/plain" });
      response.end(answer.body ?? "");
    });
  });
  return {
    seen,
    listen: () =>
      new Promise<string>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address() as AddressInfo;
          resolve(`http://127.0.0.1:${port}/hook`);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

const agent: Actor = { kind: "agent", keyName: "k", scopes: ["webhooks.*"] };

describe("what a receiver can check", () => {
  it("verifies a signature this code produced", () => {
    // The two halves have to agree or none of the signing is worth anything.
    const body = JSON.stringify({ event: "contact.created" });
    const now = 1_800_000_000;
    const header = signPayload("whsec_test", body, now);
    expect(verifySignature("whsec_test", body, header, { nowSeconds: now })).toBe(true);
  });

  it("rejects a body that was altered in flight", () => {
    const now = 1_800_000_000;
    const header = signPayload("whsec_test", '{"amount":10}', now);
    expect(
      verifySignature("whsec_test", '{"amount":1000}', header, { nowSeconds: now }),
    ).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const now = 1_800_000_000;
    const header = signPayload("whsec_one", "{}", now);
    expect(verifySignature("whsec_two", "{}", header, { nowSeconds: now })).toBe(false);
  });

  it("rejects a replay of yesterday's request", () => {
    // Why the timestamp is inside what gets signed: without it, anybody who
    // ever saw one request could send it again forever.
    const then = 1_800_000_000;
    const header = signPayload("whsec_test", "{}", then);
    expect(
      verifySignature("whsec_test", "{}", header, { nowSeconds: then + 3600 }),
    ).toBe(false);
  });

  it("rejects a header that is missing or malformed", () => {
    expect(verifySignature("s", "{}", "")).toBe(false);
    expect(verifySignature("s", "{}", "v1=abc")).toBe(false);
    expect(verifySignature("s", "{}", "t=notanumber,v1=abc")).toBe(false);
  });
});

describe("where a delivery may be sent", () => {
  const strict = { allowLocal: false };

  it("refuses the cloud metadata service", () => {
    // On AWS, GCP and Azure alike this address hands credentials to anything
    // that asks, and a webhook is a request this server makes unattended.
    expect(() =>
      assertDeliverableUrl("https://169.254.169.254/latest/meta-data/", strict),
    ).toThrow(/own network/);
    expect(() =>
      assertDeliverableUrl("https://metadata.google.internal/", strict),
    ).toThrow(/own network/);
  });

  it("refuses loopback and private ranges", () => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://localhost/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.10/hook",
      "https://172.16.4.4/hook",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
    ]) {
      expect({ url, threw: (() => {
        try {
          assertDeliverableUrl(url, strict);
          return false;
        } catch {
          return true;
        }
      })() }).toEqual({ url, threw: true });
    }
  });

  it("insists on https when it is not being lenient", () => {
    expect(() => assertDeliverableUrl("http://example.test/hook", strict)).toThrow(
      /https/,
    );
  });

  it("allows an ordinary public address", () => {
    expect(assertDeliverableUrl("https://example.test/hook", strict).hostname).toBe(
      "example.test",
    );
    // A public IP is fine; only the private ranges are refused.
    expect(assertDeliverableUrl("https://93.184.216.34/hook", strict)).toBeTruthy();
  });

  it("refuses something that is not a URL at all", () => {
    expect(() => assertDeliverableUrl("not a url", strict)).toThrow(/valid web address/);
  });
});

describe("which events a subscription wants", () => {
  it("matches an exact name, a family, or everything", () => {
    expect(matches(["contact.created"], "contact.created")).toBe(true);
    expect(matches(["contact.created"], "contact.merged")).toBe(false);
    expect(matches(["contact.*"], "contact.merged")).toBe(true);
    expect(matches(["*"], "anything.atAll")).toBe(true);
    expect(matches(["contact.*"], "location.created")).toBe(false);
  });
});

describe("the retry schedule", () => {
  it("backs off and then stops doubling", () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);
    expect(backoffSeconds(3)).toBe(120);
    expect(backoffSeconds(20)).toBe(3600);
  });
});

describe.runIf(hasDatabase)("keeping subscriptions", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("creates one with a secret the owner can read back", async () => {
    const hook = await createWebhook.call(
      { name: "Zapier", url: "https://example.test/hook", events: ["contact.*"] },
      OWNER,
    );
    const revealed = await revealWebhookSecret.call({ id: hook.id }, OWNER);
    expect(revealed.secret).toBe(hook.secret);
    expect(revealed.secret.startsWith("whsec_")).toBe(true);
  });

  it("keeps the secret out of the list", async () => {
    // It is readable on request rather than sitting in the markup of a screen
    // somebody leaves open.
    await createWebhook.call(
      { name: "Zapier", url: "https://example.test/hook", events: ["*"] },
      OWNER,
    );
    const listed = await listWebhooks.call({}, OWNER);
    expect(JSON.stringify(listed)).not.toContain("whsec_");
  });

  it("rotates the secret to something different", async () => {
    const hook = await createWebhook.call(
      { name: "Zapier", url: "https://example.test/hook", events: ["*"] },
      OWNER,
    );
    const rotated = await rotateWebhookSecret.call({ id: hook.id }, OWNER);
    expect(rotated.secret).not.toBe(hook.secret);
  });

  it("refuses a second subscription with the same name", async () => {
    await createWebhook.call(
      { name: "Zapier", url: "https://example.test/hook", events: ["*"] },
      OWNER,
    );
    const error = await failure(
      createWebhook.call(
        { name: "Zapier", url: "https://other.test/hook", events: ["*"] },
        OWNER,
      ),
    );
    expect(error.code).toBe("conflict");
  });

  it("refuses an event pattern that is not one", async () => {
    const error = await failure(
      createWebhook.call(
        { name: "Bad", url: "https://example.test/hook", events: ["contact created"] },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("requires webhooks manage and remains closed to API keys", async () => {
    // A key that could point the business's events at an address of its
    // choosing is exfiltration wearing configuration's clothes.
    expect(
      (
        await failure(
          createWebhook.call(
            { name: "X", url: "https://example.test/h", events: ["*"] },
            {
              ...STAFF,
              grants: [{ module: "webhooks", access: "view" }],
            },
          ),
        )
      ).code,
    ).toBe("permission");

    const error = await failure(
      createWebhook.call(
        { name: "X", url: "https://evil.test/h", events: ["*"] },
        agent,
      ),
    );
    expect(error.code).toBe("permission");
    expect(error.message).toContain("Sign in");
  });

  it("clears the pause when an owner turns one back on", async () => {
    // Otherwise the next single failure pauses it again and the owner never
    // gets a real second chance.
    const hook = await createWebhook.call(
      { name: "Zapier", url: "https://example.test/hook", events: ["*"] },
      OWNER,
    );
    await db()
      .update(webhookSubscriptions)
      .set({ status: "paused", pausedReason: "gave up", consecutiveFailures: 25 })
      .where(eq(webhookSubscriptions.id, hook.id));

    const back = await updateWebhook.call({ id: hook.id, status: "active" }, OWNER);
    expect(back.status).toBe("active");
    expect(back.pausedReason).toBeNull();
    expect(back.consecutiveFailures).toBe(0);
  });

  it("takes its deliveries with it when removed", async () => {
    const hook = await createWebhook.call(
      { name: "Zapier", url: "https://example.test/hook", events: ["*"] },
      OWNER,
    );
    await testWebhook.call({ id: hook.id }, OWNER);
    await deleteWebhook.call({ id: hook.id }, OWNER);
    expect(await db().select().from(webhookDeliveries)).toHaveLength(0);
  });
});

describe.runIf(hasDatabase)("queueing what happened", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });

  it("queues one delivery per interested subscription", async () => {
    await createWebhook.call(
      { name: "Wants contacts", url: "https://a.test/hook", events: ["contact.*"] },
      OWNER,
    );
    await createWebhook.call(
      { name: "Wants everything", url: "https://b.test/hook", events: ["*"] },
      OWNER,
    );
    await createWebhook.call(
      { name: "Wants pages", url: "https://c.test/hook", events: ["cms.*"] },
      OWNER,
    );

    expect(await fanOut("contact.created", { id: "x" })).toBe(2);
    expect(await db().select().from(webhookDeliveries)).toHaveLength(2);
  });

  it("uses the outbox event id to make webhook fan-out replay idempotent", async () => {
    await createWebhook.call(
      { name: "Replay safe", url: "https://a.test/hook", events: ["contact.*"] },
      OWNER,
    );
    const [event] = await db()
      .insert(outboxEvents)
      .values({ eventName: "contact.created", payload: { id: "x" } })
      .returning({ id: outboxEvents.id });

    expect(await fanOut("contact.created", { id: "x" }, event!.id)).toBe(1);
    expect(await fanOut("contact.created", { id: "x" }, event!.id)).toBe(1);
    const deliveries = await db().select().from(webhookDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.outboxEventId).toBe(event!.id);
  });

  it("skips a paused subscription", async () => {
    const hook = await createWebhook.call(
      { name: "Paused", url: "https://a.test/hook", events: ["*"] },
      OWNER,
    );
    await updateWebhook.call({ id: hook.id, status: "paused" }, OWNER);
    expect(await fanOut("contact.created", {})).toBe(0);
  });

  it("queues nothing when nobody is listening", async () => {
    expect(await fanOut("contact.created", {})).toBe(0);
  });

  it("does not report on itself", async () => {
    // A `*` subscription would otherwise be told about its own creation, and
    // the day a failed delivery emits an event that becomes a loop.
    await createWebhook.call(
      { name: "Everything", url: "https://a.test/hook", events: ["*"] },
      OWNER,
    );
    expect(await fanOut("webhook.created", { id: "x" })).toBe(0);
    expect(await db().select().from(webhookDeliveries)).toHaveLength(0);
  });
});

describe.runIf(hasDatabase)("actually delivering", () => {
  let stop: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("sends a request a receiver can verify, and marks it succeeded", async () => {
    const server = receiver(() => ({ status: 200, body: "ok" }));
    const url = await server.listen();
    stop = server.close;

    const hook = await createWebhook.call(
      { name: "Local", url, events: ["contact.*"] },
      OWNER,
    );
    await fanOut("contact.created", { id: "abc", name: "Rae" });
    expect(await deliverDue()).toBe(1);

    expect(server.seen).toHaveLength(1);
    const received = server.seen[0]!;

    // The receiver's side of the contract, exercised for real.
    const signature = received.headers["freeholder-signature"]!;
    expect(verifySignature(hook.secret, received.body, signature)).toBe(true);
    expect(received.headers["freeholder-event"]).toBe("contact.created");
    expect(received.headers["freeholder-delivery"]).toBeTruthy();

    const envelope = JSON.parse(received.body) as {
      id: string;
      event: string;
      data: { name: string };
    };
    expect(envelope.event).toBe("contact.created");
    expect(envelope.data.name).toBe("Rae");
    // The delivery id is in the body and the header, so a receiver can dedupe
    // however it prefers.
    expect(envelope.id).toBe(received.headers["freeholder-delivery"]);

    const [delivery] = await db().select().from(webhookDeliveries);
    expect(delivery?.status).toBe("succeeded");
    expect(delivery?.responseStatus).toBe(200);
    expect(delivery?.attempts).toBe(1);
  });

  it("retries later when the receiver is broken", async () => {
    const server = receiver(() => ({ status: 500, body: "boom" }));
    const url = await server.listen();
    stop = server.close;

    await createWebhook.call({ name: "Broken", url, events: ["*"] }, OWNER);
    await fanOut("contact.created", {});
    await deliverDue();

    const [delivery] = await db().select().from(webhookDeliveries);
    expect(delivery?.status).toBe("pending");
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.responseStatus).toBe(500);
    // Scheduled into the future, so the next sweep does not hammer it.
    expect(delivery!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not pick up a delivery that is not due yet", async () => {
    const server = receiver(() => ({ status: 200 }));
    const url = await server.listen();
    stop = server.close;

    await createWebhook.call({ name: "Later", url, events: ["*"] }, OWNER);
    await fanOut("contact.created", {});
    await db()
      .update(webhookDeliveries)
      .set({ nextAttemptAt: sql`now() + interval '5 minutes'` });

    expect(await deliverDue()).toBe(0);
    expect(server.seen).toHaveLength(0);
  });

  it("gives up after the last attempt and says so", async () => {
    const server = receiver(() => ({ status: 500 }));
    const url = await server.listen();
    stop = server.close;

    await createWebhook.call({ name: "Gone", url, events: ["*"] }, OWNER);
    await fanOut("contact.created", {});

    // Walk it to the end, clearing the backoff each time rather than waiting.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await db().update(webhookDeliveries).set({ nextAttemptAt: sql`now()` });
      await deliverDue();
    }

    const [delivery] = await db().select().from(webhookDeliveries);
    expect(delivery?.status).toBe("failed");
    expect(delivery?.attempts).toBe(MAX_ATTEMPTS);
    expect(delivery?.completedAt).not.toBeNull();
  });

  it("pauses an endpoint that has been gone for a long time", async () => {
    const server = receiver(() => ({ status: 500 }));
    const url = await server.listen();
    stop = server.close;

    const hook = await createWebhook.call({ name: "Dead", url, events: ["*"] }, OWNER);
    // Count failures directly rather than sending hundreds of requests: what
    // is being tested is the threshold, not the arithmetic that reaches it.
    await db()
      .update(webhookSubscriptions)
      .set({ consecutiveFailures: FAILURES_BEFORE_PAUSE - 1 })
      .where(eq(webhookSubscriptions.id, hook.id));

    await fanOut("contact.created", {});
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await db().update(webhookDeliveries).set({ nextAttemptAt: sql`now()` });
      await deliverDue();
    }

    const [subscription] = await db()
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, hook.id));
    expect(subscription?.status).toBe("paused");
    expect(subscription?.pausedReason).toContain("Fix the address");
  });

  it("forgets the failures once a delivery gets through", async () => {
    let broken = true;
    const server = receiver(() => ({ status: broken ? 500 : 200 }));
    const url = await server.listen();
    stop = server.close;

    const hook = await createWebhook.call({ name: "Flaky", url, events: ["*"] }, OWNER);
    await db()
      .update(webhookSubscriptions)
      .set({ consecutiveFailures: 5 })
      .where(eq(webhookSubscriptions.id, hook.id));

    broken = false;
    await fanOut("contact.created", {});
    await deliverDue();

    const [subscription] = await db().select().from(webhookSubscriptions);
    expect(subscription?.consecutiveFailures).toBe(0);
    expect(subscription?.lastDeliveryAt).not.toBeNull();
  });

  it("sends a test delivery an owner asked for", async () => {
    const server = receiver(() => ({ status: 204 }));
    const url = await server.listen();
    stop = server.close;

    const hook = await createWebhook.call(
      { name: "Trying", url, events: ["*"] },
      OWNER,
    );
    await testWebhook.call({ id: hook.id }, OWNER);
    await deliverDue();

    expect(server.seen).toHaveLength(1);
    expect(server.seen[0]!.headers["freeholder-event"]).toBe("webhook.test");
  });

  it("shows the owner what happened", async () => {
    const server = receiver(() => ({ status: 200 }));
    const url = await server.listen();
    stop = server.close;

    await createWebhook.call({ name: "Watched", url, events: ["*"] }, OWNER);
    await fanOut("contact.created", {});
    await deliverDue();

    const log = await listDeliveries.call({}, OWNER);
    expect(log).toHaveLength(1);
    expect(log[0]!.status).toBe("succeeded");
    expect(log[0]!.eventName).toBe("contact.created");
  });

  it("prunes what finished long ago and keeps what has not", async () => {
    const server = receiver(() => ({ status: 200 }));
    const url = await server.listen();
    stop = server.close;

    await createWebhook.call({ name: "Old", url, events: ["*"] }, OWNER);
    await fanOut("contact.created", {});
    await deliverDue();
    await db()
      .update(webhookDeliveries)
      .set({ createdAt: sql`now() - interval '60 days'` });

    await fanOut("contact.merged", {});
    expect(await pruneDeliveries(30)).toBe(1);
    expect(await db().select().from(webhookDeliveries)).toHaveLength(1);
  });
});
