// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Durable, listener-aware transactional outbox (MASTER.md §11, C1.11).
//
// An event row says that committed work must be announced. A delivery receipt
// says whether one stable listener has consumed that event. Keeping those two
// facts separate is what makes replay safe: a successful listener is never run
// again merely because a different listener failed.
import { and, eq, lt, lte, or, sql } from "drizzle-orm";
import {
  eventListeners,
  runEventListener,
  type BusListener,
} from "@/core/events";
import {
  outboxEventDeliveries,
  outboxEvents,
} from "@/core/events/schema";
import { db } from "@/core/db";
import type { Tx } from "@/core/service";

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_LEASE_SECONDS = 5 * 60;
export const OUTBOX_DEAD_LETTER_RETENTION_DAYS = 90;
const OUTBOX_BASE_DELAY_SECONDS = 60;
const OUTBOX_MAX_DELAY_SECONDS = 6 * 60 * 60;
const MAX_ERROR_LENGTH = 4_000;

type StoredEvent = typeof outboxEvents.$inferSelect;
type Delivery = typeof outboxEventDeliveries.$inferSelect;

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_ERROR_LENGTH,
  );
}

function retryAt(attempt: number): Date {
  const seconds = Math.min(
    OUTBOX_MAX_DELAY_SECONDS,
    OUTBOX_BASE_DELAY_SECONDS * 2 ** Math.max(0, attempt - 1),
  );
  return new Date(Date.now() + seconds * 1_000);
}

/** Write an event inside the caller's transaction. Returns its durable id. */
export async function enqueue(
  tx: Tx,
  eventName: string,
  payload: unknown,
): Promise<string> {
  const [row] = await tx
    .insert(outboxEvents)
    .values({ eventName, payload: payload ?? {} })
    .returning({ id: outboxEvents.id });
  return row!.id;
}

async function claimDelivery(
  eventId: string,
  listenerId: string,
): Promise<{ attempt: number } | undefined> {
  const leaseUntil = new Date(Date.now() + OUTBOX_LEASE_SECONDS * 1_000);
  const [claimed] = await db()
    .update(outboxEventDeliveries)
    .set({
      status: "processing",
      attempts: sql`${outboxEventDeliveries.attempts} + 1`,
      leaseExpiresAt: leaseUntil,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboxEventDeliveries.eventId, eventId),
        eq(outboxEventDeliveries.listenerId, listenerId),
        or(
          and(
            eq(outboxEventDeliveries.status, "pending"),
            lte(outboxEventDeliveries.nextAttemptAt, sql`now()`),
          ),
          and(
            eq(outboxEventDeliveries.status, "processing"),
            lt(outboxEventDeliveries.leaseExpiresAt, sql`now()`),
          ),
        ),
      ),
    )
    .returning({ attempt: outboxEventDeliveries.attempts });

  return claimed;
}

async function markDelivered(
  eventId: string,
  listenerId: string,
  attempt: number,
): Promise<void> {
  await db()
    .update(outboxEventDeliveries)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      deadLetteredAt: null,
      leaseExpiresAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboxEventDeliveries.eventId, eventId),
        eq(outboxEventDeliveries.listenerId, listenerId),
        eq(outboxEventDeliveries.status, "processing"),
        eq(outboxEventDeliveries.attempts, attempt),
      ),
    );
}

async function markFailed(
  eventId: string,
  listenerId: string,
  attempt: number,
  error: unknown,
): Promise<void> {
  const dead = attempt >= OUTBOX_MAX_ATTEMPTS;
  await db()
    .update(outboxEventDeliveries)
    .set({
      status: dead ? "dead_letter" : "pending",
      nextAttemptAt: retryAt(attempt),
      leaseExpiresAt: null,
      deadLetteredAt: dead ? new Date() : null,
      lastError: errorMessage(error),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboxEventDeliveries.eventId, eventId),
        eq(outboxEventDeliveries.listenerId, listenerId),
        eq(outboxEventDeliveries.status, "processing"),
        eq(outboxEventDeliveries.attempts, attempt),
      ),
    );
}

async function runDelivery(
  event: StoredEvent,
  delivery: Delivery,
  listener: BusListener | undefined,
): Promise<void> {
  if (delivery.status === "delivered" || delivery.status === "dead_letter") {
    return;
  }

  const claim = await claimDelivery(event.id, delivery.listenerId);
  if (!claim) return;

  if (!listener) {
    await markFailed(
      event.id,
      delivery.listenerId,
      claim.attempt,
      new Error(`listener "${delivery.listenerId}" is not registered`),
    );
    return;
  }

  try {
    await runEventListener(listener, event.eventName, event.payload, {
      eventId: event.id,
      listenerId: listener.id,
      attempt: claim.attempt,
      replay: event.replayCount > 0,
    });
    await markDelivered(event.id, delivery.listenerId, claim.attempt);
  } catch (error) {
    await markFailed(
      event.id,
      delivery.listenerId,
      claim.attempt,
      error,
    );
  }
}

async function aggregateEvent(event: StoredEvent): Promise<void> {
  const deliveries = await db()
    .select()
    .from(outboxEventDeliveries)
    .where(eq(outboxEventDeliveries.eventId, event.id));

  if (deliveries.length === 0) {
    const attempt = event.attempts;
    const dead = attempt >= OUTBOX_MAX_ATTEMPTS;
    await db()
      .update(outboxEvents)
      .set({
        status: dead ? "dead_letter" : "pending",
        nextAttemptAt: retryAt(attempt),
        deadLetteredAt: dead ? new Date() : null,
        lastError: `no listener is registered for "${event.eventName}"`,
      })
      .where(
        and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, "pending")),
      );
    return;
  }

  const dead = deliveries.find((delivery) => delivery.status === "dead_letter");
  if (dead) {
    await db()
      .update(outboxEvents)
      .set({
        status: "dead_letter",
        dispatchedAt: null,
        deadLetteredAt: dead.deadLetteredAt ?? new Date(),
        lastError: dead.lastError,
      })
      .where(
        and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, "pending")),
      );
    return;
  }

  if (deliveries.every((delivery) => delivery.status === "delivered")) {
    await db()
      .update(outboxEvents)
      .set({
        status: "dispatched",
        dispatchedAt: new Date(),
        deadLetteredAt: null,
        lastError: null,
      })
      .where(
        and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, "pending")),
      );
    return;
  }

  const dueDates = deliveries
    .filter((delivery) =>
      delivery.status === "processing"
        ? delivery.leaseExpiresAt !== null
        : delivery.status === "pending",
    )
    .map((delivery) =>
      delivery.status === "processing"
        ? delivery.leaseExpiresAt!
        : delivery.nextAttemptAt,
    );
  const nextAttemptAt = dueDates.reduce(
    (earliest, candidate) => (candidate < earliest ? candidate : earliest),
    dueDates[0] ?? new Date(),
  );
  const failed = deliveries.find((delivery) => delivery.lastError !== null);
  await db()
    .update(outboxEvents)
    .set({
      status: "pending",
      nextAttemptAt,
      deadLetteredAt: null,
      lastError: failed?.lastError ?? null,
    })
    .where(
      and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, "pending")),
    );
}

/** Deliver one stored event, claiming each unfinished listener independently. */
export async function deliverOutboxEvent(event: StoredEvent): Promise<void> {
  if (event.status !== "pending") return;

  const [attempted] = await db()
    .update(outboxEvents)
    .set({ attempts: sql`${outboxEvents.attempts} + 1` })
    .where(
      and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, "pending")),
    )
    .returning({ attempts: outboxEvents.attempts });
  if (!attempted) return;
  event = { ...event, attempts: attempted.attempts };

  const registered = eventListeners(event.eventName);
  if (registered.length > 0) {
    await db()
      .insert(outboxEventDeliveries)
      .values(
        registered.map((listener) => ({
          eventId: event.id,
          listenerId: listener.id,
        })),
      )
      .onConflictDoNothing();
  }

  const deliveryRows = await db()
    .select()
    .from(outboxEventDeliveries)
    .where(eq(outboxEventDeliveries.eventId, event.id));
  const byId = new Map(registered.map((listener) => [listener.id, listener]));
  await Promise.all(
    deliveryRows.map((delivery) =>
      runDelivery(event, delivery, byId.get(delivery.listenerId)),
    ),
  );
  await aggregateEvent(event);
}

/** Fast path after the caller's transaction commits. Failures remain durable. */
export async function dispatchNow(
  events: Array<{ id: string; eventName: string; payload: unknown }>,
): Promise<void> {
  for (const event of events) {
    const stored: StoredEvent = {
      ...event,
      status: "pending",
      dispatchedAt: null,
      deadLetteredAt: null,
      nextAttemptAt: new Date(),
      attempts: 0,
      replayCount: 0,
      lastError: null,
      createdAt: new Date(),
    };
    try {
      await deliverOutboxEvent(stored);
    } catch (error) {
      console.warn(
        `[outbox] "${event.eventName}" will be retried by the sweeper`,
        error,
      );
    }
  }
}

/** Crash recovery and retry sweep for events whose next attempt is due. */
export async function redeliverPending(
  graceSeconds = 60,
  limit = 100,
): Promise<{ redelivered: number; failed: number }> {
  const pending = await db()
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "pending"),
        lte(outboxEvents.nextAttemptAt, sql`now()`),
        lt(
          outboxEvents.createdAt,
          sql`now() - make_interval(secs => ${graceSeconds})`,
        ),
      ),
    )
    .orderBy(outboxEvents.nextAttemptAt, outboxEvents.createdAt)
    .limit(limit);

  let redelivered = 0;
  let failed = 0;
  for (const event of pending) {
    try {
      await deliverOutboxEvent(event);
      const [after] = await db()
        .select({ status: outboxEvents.status })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, event.id))
        .limit(1);
      if (after?.status === "dispatched") redelivered += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { redelivered, failed };
}

/** Reset only failed receipts in the caller's transaction. */
export async function resetOutboxEventForReplay(
  tx: Tx,
  id: string,
): Promise<number | undefined> {
  const [event] = await tx
    .update(outboxEvents)
    .set({
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      deadLetteredAt: null,
      lastError: null,
      replayCount: sql`${outboxEvents.replayCount} + 1`,
    })
    .where(
      and(
        eq(outboxEvents.id, id),
        eq(outboxEvents.status, "dead_letter"),
      ),
    )
    .returning({ replayCount: outboxEvents.replayCount });
  if (!event) return undefined;

  await tx
    .update(outboxEventDeliveries)
    .set({
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      leaseExpiresAt: null,
      deadLetteredAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboxEventDeliveries.eventId, id),
        eq(outboxEventDeliveries.status, "dead_letter"),
      ),
    );
  return event.replayCount;
}

/** Standalone replay helper; services use the transactional reset above. */
export async function replayOutboxEvent(id: string): Promise<boolean> {
  return db().transaction(async (tx) =>
    (await resetOutboxEventForReplay(tx, id)) !== undefined,
  );
}

/** Targeted dispatch used immediately after an owner requests replay. */
export async function redeliverOutboxEvent(id: string): Promise<boolean> {
  const [event] = await db()
    .select()
    .from(outboxEvents)
    .where(
      and(eq(outboxEvents.id, id), eq(outboxEvents.status, "pending")),
    )
    .limit(1);
  if (!event) return false;
  await deliverOutboxEvent(event);
  return true;
}

/** Delivered events are short-lived; dead letters remain 90 days for recovery. */
export async function pruneDispatched(olderThanDays = 7): Promise<number> {
  const deleted = await db()
    .delete(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "dispatched"),
        lt(
          outboxEvents.dispatchedAt,
          sql`now() - make_interval(days => ${olderThanDays})`,
        ),
      ),
    )
    .returning({ id: outboxEvents.id });
  return deleted.length;
}

export async function pruneDeadLetters(
  olderThanDays = OUTBOX_DEAD_LETTER_RETENTION_DAYS,
): Promise<number> {
  const deleted = await db()
    .delete(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "dead_letter"),
        lt(
          outboxEvents.deadLetteredAt,
          sql`now() - make_interval(days => ${olderThanDays})`,
        ),
      ),
    )
    .returning({ id: outboxEvents.id });
  return deleted.length;
}
