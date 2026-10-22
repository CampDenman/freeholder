// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading the audit trail (MASTER.md §4.8). The doc makes a promise —
// "the owner can read a plain-English log of everything their AI did" — and a
// log nobody can read does not keep it. This is the read side of the rows the
// service wrapper has been writing since the spine landed.
import { z } from "zod";
import { and, desc, ne, notInArray } from "drizzle-orm";
import { auditLog } from "@/core/events/schema";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService } from "@/core/service";

/** Actions a person can trigger that are still not news to the owner. */
export const HOUSEKEEPING_ACTIONS = ["playground.enter"] as const;

export const recentActivity = defineService({
  name: "events.recentActivity",
  summary: "What has changed on this site lately, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    limit: z.number().int().min(1).max(100).default(20),
    /**
     * `people` leaves out the platform's own housekeeping (scheduled sweeps,
     * presence clean-up, job recovery — all written as `system`) and demo
     * entry: true, but meaningless in an owner's "what changed". `all` is the
     * full trail for diagnostics and stays the default for API callers.
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
          ? and(
              ne(auditLog.actor, "system"),
              notInArray(auditLog.action, [...HOUSEKEEPING_ACTIONS]),
            )
          : undefined,
      )
      .orderBy(desc(auditLog.at))
      .limit(input.limit),
});

export default [recentActivity];
