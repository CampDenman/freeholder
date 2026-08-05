// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Core's own scheduled work.
//
// Three jobs, and every one of them closes a backlog entry that has been open
// since the table it cleans up was written. That is the pattern to expect:
// tables that grow are cheap to write and only become somebody's problem
// months later, on an instance nobody is watching.
import { isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { defineJob } from "@/core/jobs";
import { passwordResets, sessions } from "@/core/auth/schema";
import { rateLimitCounters } from "@/core/security/schema";
import { pruneDispatched, redeliverPending } from "@/core/events/outbox";

/**
 * Expired sessions.
 *
 * They were deleted only when revisited, revoked, or cascaded by a user being
 * removed — so a browser that signed in once and never came back left a row
 * for as long as the instance lived. Harmless, and unbounded.
 */
export const sweepSessions = defineJob({
  name: "core.sweepSessions",
  summary: "Delete sessions that have expired.",
  schedule: "17 3 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(sessions)
      .where(lt(sessions.expiresAt, sql`now()`))
      .returning({ id: sessions.id });
    return { deleted: deleted.length };
  },
});

/**
 * Rate-limit counters whose window has long passed.
 *
 * Bounded by the number of distinct subjects anyone has attempted, which is
 * bounded by nothing on a site somebody is attacking.
 */
export const sweepRateLimits = defineJob({
  name: "core.sweepRateLimits",
  summary: "Delete rate-limit counters from windows that have closed.",
  schedule: "23 * * * *",
  handler: async () => {
    const deleted = await db()
      .delete(rateLimitCounters)
      .where(lt(rateLimitCounters.windowStartedAt, sql`now() - interval '1 day'`))
      .returning({ key: rateLimitCounters.key });
    return { deleted: deleted.length };
  },
});

/**
 * The outbox's crash-recovery path.
 *
 * Everything the fast path already delivered is marked, so on a healthy
 * instance this finds nothing and costs one indexed query a minute. What it
 * catches is the case the outbox exists for: a process that committed a
 * change and died before telling anybody.
 */
export const dispatchOutbox = defineJob({
  name: "core.dispatchOutbox",
  summary: "Redeliver events that were committed but never dispatched.",
  schedule: "* * * * *",
  handler: async () => {
    const result = await redeliverPending();
    if (result.redelivered > 0) {
      console.log(
        `[outbox] redelivered ${result.redelivered} event(s) a crash had stranded`,
      );
    }
    return result;
  },
});

/**
 * Spent and expired reset links.
 *
 * They are harmless — used or out of date, neither can be redeemed — and they
 * accumulate one row per "I forgot my password" forever. The same shape of
 * problem as the sessions above, written down before it becomes somebody's
 * surprise.
 */
export const sweepPasswordResets = defineJob({
  name: "core.sweepPasswordResets",
  summary: "Delete reset links that are spent or expired.",
  schedule: "31 3 * * *",
  handler: async () => {
    const deleted = await db()
      .delete(passwordResets)
      .where(
        or(
          isNotNull(passwordResets.usedAt),
          lt(passwordResets.expiresAt, sql`now() - interval '1 day'`),
        ),
      )
      .returning({ id: passwordResets.id });
    return { deleted: deleted.length };
  },
});

/** The outbox is a delivery mechanism, not a history. */
export const pruneOutbox = defineJob({
  name: "core.pruneOutbox",
  summary: "Forget events that were delivered a week ago.",
  schedule: "41 4 * * *",
  handler: async () => ({ deleted: await pruneDispatched() }),
});

export default [
  sweepSessions,
  sweepRateLimits,
  sweepPasswordResets,
  dispatchOutbox,
  pruneOutbox,
];
