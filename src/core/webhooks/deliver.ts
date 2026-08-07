// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Sending a delivery, and deciding what to do when it fails.
//
// The delivery table is the queue. pg-boss schedules the sweep, but the work
// list is a SQL query for rows that are due — which means a restart mid-flight
// loses nothing, a backlog drains oldest-first, and an owner can read the
// whole state of "what have we been trying to tell them" in one table rather
// than inferring it from a job runner's internals.
//
// Delivery is **at least once**. A receiver that times out after doing the
// work still gets a retry, because from here those two outcomes are
// indistinguishable. Every request carries a stable delivery id in a header so
// the receiver can recognise the repeat — the same contract the outbox has
// with in-process listeners.
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { webhookDeliveries, webhookSubscriptions } from "@/core/webhooks/schema";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  signPayload,
} from "@/core/webhooks/sign";

/** How long to wait for somebody else's server before giving up on a try. */
const TIMEOUT_MS = 10_000;

/** Attempts before a delivery is abandoned. Roughly six hours of trying. */
export const MAX_ATTEMPTS = 8;

/** Never store more of a response than is useful for debugging. */
const MAX_BODY = 2_000;

/**
 * Exponential, in seconds: 30s, 1m, 2m, 4m … capped at an hour.
 *
 * Capped because the point of the late attempts is to survive a deploy or a
 * short outage, and doubling past an hour just delays the abandonment without
 * making success more likely.
 */
export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** (attempt - 1), 3600);
}

/** How many failures in a row before an endpoint is presumed gone. */
export const FAILURES_BEFORE_PAUSE = 20;

interface Claimed extends Record<string, unknown> {
  id: string;
  subscriptionId: string;
  eventName: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
}

/**
 * Take up to `limit` due deliveries, marking them `sending` in the same
 * statement.
 *
 * `for update skip locked` is what makes a second worker safe: two processes
 * asking at once take disjoint sets rather than the same rows twice. Without
 * it, scaling to two replicas would double every delivery.
 */
async function claim(limit: number): Promise<Claimed[]> {
  const rows = await db().execute<Claimed>(sql`
    with due as (
      select d.id
      from ${webhookDeliveries} d
      join ${webhookSubscriptions} s on s.id = d.subscription_id
      where d.status in ('pending', 'sending')
        and d.next_attempt_at <= now()
        and s.status = 'active'
      order by d.next_attempt_at
      limit ${limit}
      for update of d skip locked
    )
    update ${webhookDeliveries} d
    set status = 'sending', updated_at = now()
    from due, ${webhookSubscriptions} s
    where d.id = due.id and s.id = d.subscription_id
    returning
      d.id as "id",
      d.subscription_id as "subscriptionId",
      d.event_name as "eventName",
      d.payload as "payload",
      d.attempts as "attempts",
      s.url as "url",
      s.secret as "secret"
  `);
  return [...rows];
}

async function succeed(
  delivery: Claimed,
  status: number,
  body: string,
): Promise<void> {
  await db()
    .update(webhookDeliveries)
    .set({
      status: "succeeded",
      attempts: delivery.attempts + 1,
      responseStatus: status,
      responseBody: body.slice(0, MAX_BODY),
      error: null,
      completedAt: sql`now()`,
    })
    .where(eq(webhookDeliveries.id, delivery.id));

  await db()
    .update(webhookSubscriptions)
    .set({ consecutiveFailures: 0, lastDeliveryAt: sql`now()` })
    .where(eq(webhookSubscriptions.id, delivery.subscriptionId));
}

async function fail(
  delivery: Claimed,
  detail: { status?: number; body?: string; error: string },
): Promise<void> {
  const attempts = delivery.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;

  await db()
    .update(webhookDeliveries)
    .set({
      status: exhausted ? "failed" : "pending",
      attempts,
      responseStatus: detail.status ?? null,
      responseBody: detail.body?.slice(0, MAX_BODY) ?? null,
      error: detail.error,
      nextAttemptAt: exhausted
        ? sql`now()`
        : sql`now() + ${`${backoffSeconds(attempts)} seconds`}::interval`,
      completedAt: exhausted ? sql`now()` : null,
    })
    .where(eq(webhookDeliveries.id, delivery.id));

  // Counted per *delivery* given up on, not per attempt: an endpoint that is
  // merely slow retries a lot and should not be paused for it, while one that
  // is gone exhausts delivery after delivery.
  if (!exhausted) return;

  const [subscription] = await db()
    .update(webhookSubscriptions)
    .set({ consecutiveFailures: sql`${webhookSubscriptions.consecutiveFailures} + 1` })
    .where(eq(webhookSubscriptions.id, delivery.subscriptionId))
    .returning({ failures: webhookSubscriptions.consecutiveFailures });

  if ((subscription?.failures ?? 0) >= FAILURES_BEFORE_PAUSE) {
    await db()
      .update(webhookSubscriptions)
      .set({
        status: "paused",
        pausedReason: `Paused automatically after ${FAILURES_BEFORE_PAUSE} deliveries in a row could not be delivered. Fix the address or the receiving server, then turn it back on.`,
      })
      .where(eq(webhookSubscriptions.id, delivery.subscriptionId));
  }
}

async function attempt(delivery: Claimed): Promise<void> {
  const body = JSON.stringify({
    id: delivery.id,
    event: delivery.eventName,
    // Seconds, matching the signature's timestamp, so a receiver comparing
    // the two is comparing like with like.
    at: Math.floor(Date.now() / 1000),
    data: delivery.payload,
  });
  const signature = signPayload(
    delivery.secret,
    body,
    Math.floor(Date.now() / 1000),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch(delivery.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Freeholder-Webhooks/1",
        [EVENT_HEADER]: delivery.eventName,
        [DELIVERY_HEADER]: delivery.id,
        [SIGNATURE_HEADER]: signature,
      },
      body,
      signal: controller.signal,
      // A redirect is not followed on purpose: it is the ordinary way an
      // allowed address turns into a disallowed one after the check, and a
      // receiver that wants to move can be told to update the address.
      redirect: "manual",
    });

    const text = await response.text().catch(() => "");
    if (response.status >= 200 && response.status < 300) {
      await succeed(delivery, response.status, text);
    } else {
      await fail(delivery, {
        status: response.status,
        body: text,
        error: `The receiving server answered ${response.status}.`,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `No answer within ${TIMEOUT_MS / 1000} seconds.`
        : error instanceof Error
          ? error.message
          : String(error);
    await fail(delivery, { error: message });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One pass: claim what is due and try it.
 *
 * Returns how many were attempted, so the caller can decide whether to run
 * again immediately rather than waiting for the next tick.
 */
export async function deliverDue(limit = 25): Promise<number> {
  const claimed = await claim(limit);
  // Concurrent rather than sequential: these are independent network calls to
  // different servers, and one slow receiver should not hold up everybody
  // else's events behind it.
  await Promise.all(claimed.map((delivery) => attempt(delivery)));
  return claimed.length;
}

/** Deliveries older than `days`, gone. The log is for debugging, not forever. */
export async function pruneDeliveries(days = 30): Promise<number> {
  const rows = await db()
    .delete(webhookDeliveries)
    .where(
      and(
        inArray(webhookDeliveries.status, ["succeeded", "failed"]),
        lte(webhookDeliveries.createdAt, sql`now() - ${`${days} days`}::interval`),
      ),
    )
    .returning({ id: webhookDeliveries.id });
  return rows.length;
}
