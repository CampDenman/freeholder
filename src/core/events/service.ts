// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading the audit trail (MASTER.md §4.8). The doc makes a promise —
// "the owner can read a plain-English log of everything their AI did" — and a
// log nobody can read does not keep it. This is the read side of the rows the
// service wrapper has been writing since the spine landed.
import { z } from "zod";
import { desc, notInArray } from "drizzle-orm";
import { auditLog } from "@/core/events/schema";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService } from "@/core/service";

/**
 * Scheduled sweeps that record a row on every tick whether or not anything
 * happened, plus demo entry. Named one by one rather than "everything the
 * system actor did": payment and payout webhooks, refunds, disputes and
 * every nested `ctx.callAsSystem` are recorded as `system` too, and an owner
 * must still see "invoice paid" in what changed. A new sweep joins this list
 * when it starts cluttering the feed; forgetting it costs a noisy row, not a
 * hidden payment.
 */
export const HOUSEKEEPING_ACTIONS = [
  "playground.enter",
  "cms.expireStalePresence",
  "cms.applyDueSchedules",
  "broadcasts.tick",
  "subscriptions.finishSignups",
  "subscriptions.pendingCustomerSchedules",
  "catalog.abandonStaleCarts",
  "catalog.recoverAbandonedCarts",
  "catalog.expireReservations",
  "media.expireCaptureSessions",
  "galleries.expireSessions",
  "events.expireHeldRegistrations",
  "ads.rollUpStats",
  "assistant.reindex",
  "seo.submitIndexNow",
  "projects.sweepLapsedConsent",
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
     * clean-up, signup recovery, demo entry): true, but meaningless in an
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
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(auditLog)
      .where(
        input.include === "people"
          ? notInArray(auditLog.action, [...HOUSEKEEPING_ACTIONS])
          : undefined,
      )
      .orderBy(desc(auditLog.at))
      .limit(input.limit),
});

export default [recentActivity];
