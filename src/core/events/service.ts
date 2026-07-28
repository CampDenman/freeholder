// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Reading the audit trail (MASTER.md §4.8). The doc makes a promise —
// "the owner can read a plain-English log of everything their AI did" — and a
// log nobody can read does not keep it. This is the read side of the rows the
// service wrapper has been writing since the spine landed.
import { z } from "zod";
import { desc } from "drizzle-orm";
import { auditLog } from "@/core/events/schema";
import { defineService } from "@/core/service";

export const recentActivity = defineService({
  name: "events.recentActivity",
  summary: "What has changed on this site lately, newest first.",
  kind: "query",
  permission: "staff",
  input: z.object({
    limit: z.number().int().min(1).max(100).default(20),
  }),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.at))
      .limit(input.limit),
});

export default [recentActivity];
