// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading the audit trail (MASTER.md §4.8). The doc makes a promise —
// "the owner can read a plain-English log of everything their AI did" — and a
// log nobody can read does not keep it. This is the read side of the rows the
// service wrapper has been writing since the spine landed.
import { z } from "zod";
import { and, desc, getTableColumns, ne, notInArray, sql } from "drizzle-orm";
import { auditLog } from "@/core/events/schema";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, SEED_AUDIT_ACTOR } from "@/core/service";

/**
 * Work that is never news to an owner even when it acts: editor presence
 * clean-up, expiring guest and capture sessions, stats roll-ups, search
 * reindexing, IndexNow pings, and demo entry.
 *
 * Named one by one rather than "everything the system actor did": payment
 * and payout webhooks, refunds, disputes and every nested `ctx.callAsSystem`
 * are recorded as `system` too, and an owner must still see "invoice paid".
 * Sweeps that *can* do something an owner cares about (scheduled publishing,
 * cart-recovery emails, released event seats, finished signups) are not
 * listed here: they declare `auditWhen` so a no-op tick writes no row and a
 * run that acted appears like any other change.
 */
export const HOUSEKEEPING_ACTIONS = [
  "playground.enter",
  "cms.expireStalePresence",
  // Opening the page editor heartbeats presence and an edit lease every few
  // seconds; the edit itself is the news (2026-10-23 demo audit).
  "cms.heartbeatPresence",
  "cms.leavePresence",
  "cms.touchEditLease",
  "cms.releaseEditLease",
  "media.expireCaptureSessions",
  "galleries.expireSessions",
  "ads.rollUpStats",
  "assistant.reindex",
  "seo.submitIndexNow",
] as const;

export const recentActivity = defineService({
  name: "events.recentActivity",
  summary: "What has changed on this site lately, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    limit: z.number().int().min(1).max(100).default(20),
    /**
     * `people` leaves out HOUSEKEEPING_ACTIONS (scheduled sweeps, presence
     * clean-up, signup recovery, demo entry) and rows written while seeding
     * (`SEED_AUDIT_ACTOR`, the demo install at boot): true, but meaningless in an
     * owner's "what changed". System-recorded business events such as a
     * webhook-applied payment stay. `all` is the full trail for diagnostics
     * and stays the default for API callers.
     */
    include: z.enum(["all", "people"]).default("all"),
  }),
  output: listed(
    row({
      id: uuid,
      actor: z.string(),
      action: z.string(),
      at: timestamp,
      /**
       * Invented sample history (the busy demo writes it with
       * `diff.seeded = true`), never something that happened on the site.
       */
      sample: z.boolean(),
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        // Every column the response has always carried (subject and diff
        // included), plus the flag.
        ...getTableColumns(auditLog),
        // A jsonb comparison, not a cast: a stray `seeded: "yes"` is simply
        // not sample, and can never make the cast throw and take the feed down.
        sample: sql<boolean>`coalesce(${auditLog.diff} -> 'seeded' = 'true'::jsonb, false)`,
      })
      .from(auditLog)
      .where(
        input.include === "people"
          ? and(notInArray(auditLog.action, [...HOUSEKEEPING_ACTIONS]), ne(auditLog.actor, SEED_AUDIT_ACTOR))
          : undefined,
      )
      .orderBy(desc(auditLog.at))
      .limit(input.limit),
});

export default [recentActivity];
