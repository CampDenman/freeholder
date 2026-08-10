// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The transactional outbox (MASTER.md §11).
//
// ── The hole this fills ───────────────────────────────────────────────────
//
// Bus events were published in-process after commit. §11 requires that: a
// listener must never observe state that later rolled back. But it left a
// window — the transaction commits, the process dies, and the events for that
// mutation are gone. Nothing is inconsistent, and nothing that should have
// happened has happened. A form submission that produced a contact but never
// reached analytics; a page published without its search engines told.
//
// ── The shape ─────────────────────────────────────────────────────────────
//
// The event is written *inside* the caller's transaction, so it commits with
// the change that caused it or not at all. After the commit, the same request
// dispatches it in-process — the fast path, and the one that keeps a listener
// inside the request that produced it. Dispatch marks the row.
//
// Whatever is still unmarked a minute later is redelivered by a job. That is
// the crash-recovery path, and it is the reason for the table.
//
// ── The consequence, stated plainly ───────────────────────────────────────
//
// Delivery is **at least once**. A crash between dispatching and marking means
// a listener runs twice. Listeners must therefore be idempotent — which is
// cheap to honour and impossible to retrofit once several are not.
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { outboxEvents } from "@/core/events/schema";
import { publish } from "@/core/events";
import { db } from "@/core/db";
import type { Tx } from "@/core/service";


/** Write an event inside the caller's transaction. Returns its id. */
export async function enqueue(
  tx: Tx,
  eventName: string,
  payload: unknown,
): Promise<string> {
  const [row] = await tx
    .insert(outboxEvents)
    .values({ eventName, payload: (payload ?? {}) })
    .returning({ id: outboxEvents.id });
  return row!.id;
}

/**
 * Run the listeners for one stored event and mark it done.
 *
 * A listener that throws leaves the row unmarked, with the error recorded, for
 * the sweeper to retry. `publish` already isolates listener failures from each
 * other, so one broken listener does not strand the event for the rest.
 */
async function deliver(id: string, eventName: string, payload: unknown): Promise<void> {
  try {
    await publish(eventName, payload);
    await db()
      .update(outboxEvents)
      .set({ dispatchedAt: sql`now()`, attempts: sql`${outboxEvents.attempts} + 1` })
      .where(eq(outboxEvents.id, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db()
      .update(outboxEvents)
      .set({ attempts: sql`${outboxEvents.attempts} + 1`, lastError: message })
      .where(eq(outboxEvents.id, id));
    throw error;
  }
}

/**
 * The fast path: dispatch immediately after the caller's commit.
 *
 * Failures are swallowed rather than raised. The mutation has committed and
 * the caller is owed their answer; the event is durable and the sweeper will
 * carry it. Turning a listener's bad afternoon into a failed request would be
 * the opposite of what the outbox is for.
 */
export async function dispatchNow(
  events: Array<{ id: string; eventName: string; payload: unknown }>,
): Promise<void> {
  for (const event of events) {
    try {
      await deliver(event.id, event.eventName, event.payload);
    } catch (error) {
      console.warn(
        `[outbox] "${event.eventName}" will be retried by the sweeper`,
        error,
      );
    }
  }
}

/**
 * The crash-recovery path.
 *
 * Anything still unmarked after a grace period is redelivered. The grace
 * period exists so this never races the request that is already dispatching
 * the same row — one duplicate delivery is permitted by the contract, but
 * causing one routinely would be careless.
 */
export async function redeliverPending(
  graceSeconds = 60,
  limit = 100,
): Promise<{ redelivered: number; failed: number }> {
  const pending = await db()
    .select()
    .from(outboxEvents)
    .where(
      and(
        isNull(outboxEvents.dispatchedAt),
        lt(outboxEvents.createdAt, sql`now() - make_interval(secs => ${graceSeconds})`),
      ),
    )
    .orderBy(outboxEvents.createdAt)
    .limit(limit);

  let redelivered = 0;
  let failed = 0;
  for (const event of pending) {
    try {
      await deliver(event.id, event.eventName, event.payload);
      redelivered += 1;
    } catch {
      // Already recorded on the row; counted here so the job can report.
      failed += 1;
    }
  }
  return { redelivered, failed };
}

/**
 * Forget events that were delivered long ago.
 *
 * The table is a delivery mechanism, not a history: the audit log and the
 * timeline are where "what happened" lives, and keeping a second copy forever
 * would make every instance's disk bill grow for nothing.
 */
export async function pruneDispatched(olderThanDays = 7): Promise<number> {
  const deleted = await db()
    .delete(outboxEvents)
    .where(
      lt(outboxEvents.dispatchedAt, sql`now() - make_interval(days => ${olderThanDays})`),
    )
    .returning({ id: outboxEvents.id });
  return deleted.length;
}
