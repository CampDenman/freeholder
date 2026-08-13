// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Durable outbox delivery, dead letters, and duplicate-safe replay (§11).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import {
  auditLog,
  outboxEventDeliveries,
  outboxEvents,
} from "@/core/events/schema";
import { resetBusForTests, subscribe } from "@/core/events";
import {
  OUTBOX_MAX_ATTEMPTS,
  pruneDeadLetters,
  pruneDispatched,
  redeliverOutboxEvent,
  redeliverPending,
  replayOutboxEvent,
} from "@/core/events/outbox";
import {
  getOutboxEvent,
  listOutboxEvents,
  replayOutboxEvent as replayOutboxEventService,
} from "@/core/events/outbox-service";
import { defineService, ServiceError } from "@/core/service";
import { defineJob, listJobs, registerJob } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { createContact } from "@/core/contacts/service";
import {
  closeDb,
  failure,
  hasDatabase,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const rows = () => db().select().from(outboxEvents);

async function makeDue(id: string): Promise<void> {
  await db()
    .update(outboxEvents)
    .set({ nextAttemptAt: sql`now() - interval '1 second'` })
    .where(eq(outboxEvents.id, id));
  await db()
    .update(outboxEventDeliveries)
    .set({ nextAttemptAt: sql`now() - interval '1 second'` })
    .where(eq(outboxEventDeliveries.eventId, id));
}

describe.runIf(hasDatabase)("events survive the process that made them", () => {
  beforeEach(async () => {
    await truncateSpine();
    resetBusForTests();
    await db().delete(outboxEvents);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("records the event in the same transaction as the change", async () => {
    await createContact.call({ name: "Ada" }, STAFF);
    const stored = await rows();
    expect(stored.map((row) => row.eventName)).toContain("contact.created");
    expect(stored.every((row) => row.status === "dispatched")).toBe(true);
  });

  it("writes nothing when the mutation rolls back", async () => {
    const failing = defineService({
      name: "test.failsAfterQueueing",
      summary: "Queue an event and then throw.",
      kind: "mutation",
      permission: "scoped",
      input: z.object({}),
      handler: (_input, ctx) => {
        ctx.queueEvent("test.shouldNeverArrive", {});
        throw new ServiceError("validation", "no");
      },
    });

    await failure(failing.call({}, STAFF));
    expect(await rows()).toHaveLength(0);
  });

  it("redelivers what a crash left behind", async () => {
    const seen: unknown[] = [];
    subscribe("test.stranded", "test:stranded:collector", (payload) => {
      seen.push(payload);
    });
    await db().insert(outboxEvents).values({
      eventName: "test.stranded",
      payload: { note: "committed, never announced" },
      createdAt: sql`now() - interval '5 minutes'`,
    });

    expect(await redeliverPending()).toEqual({ redelivered: 1, failed: 0 });
    expect(seen).toEqual([{ note: "committed, never announced" }]);
    expect((await rows())[0]).toMatchObject({ status: "dispatched" });
    expect((await redeliverPending()).redelivered).toBe(0);
  });

  it("leaves a fresh event alone", async () => {
    await db()
      .insert(outboxEvents)
      .values({ eventName: "test.fresh", payload: {} });
    expect((await redeliverPending()).redelivered).toBe(0);
  });

  it("dead-letters only the failing listener and replays without duplicate side effects", async () => {
    let completedSideEffects = 0;
    let failingAttempts = 0;
    let recoveredSideEffects = 0;
    subscribe(
      "test.explodes",
      "test:explodes:completed",
      (_payload, _name, context) => {
        completedSideEffects += 1;
        expect(context?.eventId).toBeTruthy();
      },
    );
    subscribe("test.explodes", "test:explodes:failing", () => {
      failingAttempts += 1;
      throw new Error("the listener is having a bad afternoon");
    });
    const [inserted] = await db()
      .insert(outboxEvents)
      .values({
        eventName: "test.explodes",
        payload: {},
        createdAt: sql`now() - interval '5 minutes'`,
      })
      .returning({ id: outboxEvents.id });

    for (let attempt = 0; attempt < OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      await redeliverPending(0);
      if (attempt < OUTBOX_MAX_ATTEMPTS - 1) await makeDue(inserted!.id);
    }
    const [event] = await rows();
    expect(event).toMatchObject({
      status: "dead_letter",
      attempts: OUTBOX_MAX_ATTEMPTS,
      replayCount: 0,
    });
    expect(event?.lastError).toContain("bad afternoon");
    expect(completedSideEffects).toBe(1);
    expect(failingAttempts).toBe(OUTBOX_MAX_ATTEMPTS);

    const deliveries = await db()
      .select()
      .from(outboxEventDeliveries)
      .where(eq(outboxEventDeliveries.eventId, inserted!.id));
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          listenerId: "test:explodes:completed",
          status: "delivered",
          attempts: 1,
        }),
        expect.objectContaining({
          listenerId: "test:explodes:failing",
          status: "dead_letter",
          attempts: OUTBOX_MAX_ATTEMPTS,
        }),
      ]),
    );

    resetBusForTests();
    subscribe("test.explodes", "test:explodes:completed", () => {
      completedSideEffects += 1;
    });
    subscribe(
      "test.explodes",
      "test:explodes:failing",
      (_payload, _name, context) => {
        recoveredSideEffects += 1;
        expect(context).toMatchObject({ replay: true, attempt: 1 });
      },
    );
    expect(await replayOutboxEvent(inserted!.id)).toBe(true);
    expect(await redeliverOutboxEvent(inserted!.id)).toBe(true);

    expect(completedSideEffects).toBe(1);
    expect(recoveredSideEffects).toBe(1);
    expect((await rows())[0]).toMatchObject({
      status: "dispatched",
      replayCount: 1,
    });
  });

  it("dead-letters an unconsumed event and recovers when a listener appears", async () => {
    const [inserted] = await db()
      .insert(outboxEvents)
      .values({
        eventName: "test.noListenerYet",
        payload: { durable: true },
        createdAt: sql`now() - interval '5 minutes'`,
      })
      .returning({ id: outboxEvents.id });

    for (let attempt = 0; attempt < OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      await redeliverPending(0);
      if (attempt < OUTBOX_MAX_ATTEMPTS - 1) await makeDue(inserted!.id);
    }
    expect((await rows())[0]).toMatchObject({ status: "dead_letter" });
    expect(await db().select().from(outboxEventDeliveries)).toHaveLength(0);

    const seen: unknown[] = [];
    subscribe("test.noListenerYet", "test:no-listener:recovered", (payload) => {
      seen.push(payload);
    });
    expect(await replayOutboxEvent(inserted!.id)).toBe(true);
    expect(await redeliverOutboxEvent(inserted!.id)).toBe(true);
    expect(seen).toEqual([{ durable: true }]);
    expect((await rows())[0]).toMatchObject({ status: "dispatched" });
  });

  it("claims a listener once when dispatchers race", async () => {
    let sideEffects = 0;
    subscribe("test.race", "test:race:once", async () => {
      sideEffects += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const [inserted] = await db()
      .insert(outboxEvents)
      .values({ eventName: "test.race", payload: {} })
      .returning({ id: outboxEvents.id });

    await Promise.all([
      redeliverOutboxEvent(inserted!.id),
      redeliverOutboxEvent(inserted!.id),
      redeliverOutboxEvent(inserted!.id),
    ]);
    expect(sideEffects).toBe(1);
    expect((await rows())[0]).toMatchObject({ status: "dispatched" });
  });

  it("keeps inspection human-only, redacts payloads, and audits replay", async () => {
    const [inserted] = await db()
      .insert(outboxEvents)
      .values({
        eventName: "test.operator",
        payload: { email: "ada@example.test", password: "never-show-this" },
        status: "dead_letter",
        deadLetteredAt: new Date(),
        lastError: "listener exhausted",
      })
      .returning({ id: outboxEvents.id });

    const agentError = await failure(
      listOutboxEvents.call(
        { status: "dead_letter" },
        { kind: "agent", keyName: "operator", scopes: ["platform.*"] },
      ),
    );
    expect(agentError.code).toBe("permission");

    const detail = await getOutboxEvent.call({ id: inserted!.id }, STAFF);
    expect(detail.payload).toEqual({
      email: "ada@example.test",
      password: "[redacted]",
    });

    const stepUpError = await failure(
      replayOutboxEventService.call(
        { id: inserted!.id, confirm: "REPLAY" },
        {
          ...STAFF,
          security: {
            twoFactorRequired: true,
            twoFactorEnrolled: true,
            twoFactorVerified: true,
            stepUpValid: false,
          },
        },
      ),
    );
    expect(stepUpError.code).toBe("step_up_required");

    const confirmationError = await failure(
      replayOutboxEventService.call(
        { id: inserted!.id, confirm: "WRONG" as "REPLAY" },
        STAFF,
      ),
    );
    expect(confirmationError.code).toBe("validation");

    await expect(
      replayOutboxEventService.call(
        { id: inserted!.id, confirm: "REPLAY" },
        STAFF,
      ),
    ).resolves.toMatchObject({ replayed: true, replayCount: 1 });
    const [replayed] = await db()
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, inserted!.id));
    expect(replayed).toMatchObject({ status: "pending", replayCount: 1 });
    expect(
      (await db().select().from(auditLog)).some(
        (entry) =>
          entry.action === "platform.replayOutboxEvent" &&
          entry.subjectId === inserted!.id,
      ),
    ).toBe(true);
  });

  it("forgets what it delivered a week ago", async () => {
    await db().insert(outboxEvents).values([
      {
        eventName: "test.old",
        payload: {},
        status: "dispatched",
        dispatchedAt: sql`now() - interval '30 days'`,
      },
      {
        eventName: "test.recent",
        payload: {},
        status: "dispatched",
        dispatchedAt: sql`now()`,
      },
    ]);

    expect(await pruneDispatched()).toBe(1);
    expect((await rows()).map((row) => row.eventName)).toEqual(["test.recent"]);
  });

  it("never leaves an undelivered event behind when pruning", async () => {
    await db().insert(outboxEvents).values({
      eventName: "test.pending",
      payload: {},
      createdAt: sql`now() - interval '30 days'`,
    });
    expect(await pruneDispatched()).toBe(0);
    expect(await rows()).toHaveLength(1);
  });

  it("retains dead letters for 90 days and then prunes them", async () => {
    await db().insert(outboxEvents).values([
      {
        eventName: "test.dead.old",
        payload: {},
        status: "dead_letter",
        deadLetteredAt: sql`now() - interval '91 days'`,
      },
      {
        eventName: "test.dead.recent",
        payload: {},
        status: "dead_letter",
        deadLetteredAt: sql`now() - interval '89 days'`,
      },
    ]);
    expect(await pruneDeadLetters()).toBe(1);
    expect((await rows()).map((row) => row.eventName)).toEqual([
      "test.dead.recent",
    ]);
  });
});

describe("the job registry", () => {
  it("mounts core's jobs at boot", async () => {
    await ready();
    const jobs = listJobs();
    for (const name of [
      "core.sweepSessions",
      "core.sweepRateLimits",
      "core.dispatchOutbox",
      "core.pruneOutbox",
      "core.pruneAnalytics",
      "core.pruneCspViolations",
    ]) {
      expect({ name, mounted: jobs.has(name) }).toEqual({ name, mounted: true });
    }
  });

  it("gives every scheduled job a cron expression that parses", () => {
    for (const job of listJobs().values()) {
      if (!job.schedule) continue;
      expect({ job: job.name, fields: job.schedule.split(/\s+/).length }).toEqual({
        job: job.name,
        fields: 5,
      });
    }
  });

  it("refuses two different jobs claiming one name", () => {
    const one = defineJob({
      name: "test.collide",
      summary: "a",
      handler: async () => null,
    });
    const two = defineJob({
      name: "test.collide",
      summary: "b",
      handler: async () => null,
    });
    registerJob(one);
    expect(() => {
      registerJob(two);
    }).toThrow(/registered twice/);
    expect(() => {
      registerJob(one);
    }).not.toThrow();
  });
});
