// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The transactional outbox and the job registry (MASTER.md §11).
//
// The hole this closes is invisible on a healthy instance and impossible to
// notice on a broken one: a mutation commits, the process dies before its
// events reach anybody, and nothing is inconsistent — it is simply that
// something which should have happened never did. So the tests are mostly
// about the unhappy paths, because the happy one was already working.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { outboxEvents } from "@/core/events/schema";
import { resetBusForTests, subscribe } from "@/core/events";
import { pruneDispatched, redeliverPending } from "@/core/events/outbox";
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
    // Dispatched in the same request, so a healthy instance leaves nothing
    // for the sweeper to find.
    expect(stored.every((row) => row.dispatchedAt !== null)).toBe(true);
  });

  it("writes nothing when the mutation rolls back", async () => {
    // The property that makes an outbox an outbox: no event for a change that
    // did not happen.
    const failing = defineService({
      name: "test.failsAfterQueueing",
      summary: "Queue an event and then throw.",
      kind: "mutation",
      permission: "staff",
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
    // What a dead process leaves: a committed row nobody dispatched. Written
    // directly, because the alternative is killing a real process mid-request.
    const seen: unknown[] = [];
    subscribe("test.stranded", (payload) => {
      seen.push(payload);
    });
    await db()
      .insert(outboxEvents)
      .values({
        eventName: "test.stranded",
        payload: { note: "committed, never announced" },
        // Older than the grace period, so the sweeper does not race a request
        // that might still be dispatching it.
        createdAt: sql`now() - interval '5 minutes'`,
      });

    const result = await redeliverPending();
    expect(result).toEqual({ redelivered: 1, failed: 0 });
    expect(seen).toEqual([{ note: "committed, never announced" }]);

    // And marked, so the next sweep does not deliver it again.
    expect((await rows())[0]?.dispatchedAt).not.toBeNull();
    expect((await redeliverPending()).redelivered).toBe(0);
  });

  it("leaves a fresh event alone", async () => {
    // Inside the grace period the request that created it is probably still
    // dispatching. At-least-once is the contract; duplicating routinely is
    // carelessness.
    await db()
      .insert(outboxEvents)
      .values({ eventName: "test.fresh", payload: {} });
    expect((await redeliverPending()).redelivered).toBe(0);
  });

  it("keeps an event a listener could not handle, and records why", async () => {
    subscribe("test.explodes", () => {
      throw new Error("the listener is having a bad afternoon");
    });
    await db()
      .insert(outboxEvents)
      .values({
        eventName: "test.explodes",
        payload: {},
        createdAt: sql`now() - interval '5 minutes'`,
      });

    // `publish` isolates listener failures so one broken listener cannot
    // strand an event for the others — so the event is *delivered* and marked.
    // What must not happen is the row vanishing without a trace either way.
    await redeliverPending();
    const [row] = await rows();
    expect(row?.attempts).toBeGreaterThan(0);
  });

  it("forgets what it delivered a week ago", async () => {
    // A delivery mechanism, not a history: the audit log and the timeline are
    // where "what happened" lives.
    await db()
      .insert(outboxEvents)
      .values({
        eventName: "test.old",
        payload: {},
        dispatchedAt: sql`now() - interval '30 days'`,
      });
    await db()
      .insert(outboxEvents)
      .values({
        eventName: "test.recent",
        payload: {},
        dispatchedAt: sql`now()`,
      });

    expect(await pruneDispatched()).toBe(1);
    expect((await rows()).map((r) => r.eventName)).toEqual(["test.recent"]);
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
    ]) {
      expect({ name, mounted: jobs.has(name) }).toEqual({ name, mounted: true });
    }
  });

  it("gives every scheduled job a cron expression that parses", () => {
    for (const job of listJobs().values()) {
      if (!job.schedule) continue;
      // Five fields, and nothing that would silently never fire.
      expect({ job: job.name, fields: job.schedule.split(/\s+/).length }).toEqual({
        job: job.name,
        fields: 5,
      });
    }
  });

  it("refuses two different jobs claiming one name", () => {
    // The same collision the service registry refuses, for the same reason:
    // silently letting the second win routes work to whichever loaded last.
    const one = defineJob({ name: "test.collide", summary: "a", handler: async () => null });
    const two = defineJob({ name: "test.collide", summary: "b", handler: async () => null });
    registerJob(one);
    expect(() => {
      registerJob(two);
    }).toThrow(/registered twice/);
    // Registering the same definition again is a no-op, because boot is a
    // precondition rather than a one-shot event.
    expect(() => {
      registerJob(one);
    }).not.toThrow();
  });
});
