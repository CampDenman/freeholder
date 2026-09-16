// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-facing retention policies for registered user-owned stores (C11.14).
import { asc } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import { retentionPolicies } from "./schema";
import { retentionSources } from "./registry";
import "./sources";

const policyRow = row({
  id: uuid,
  kind: z.string(),
  ttlDays: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const kindRow = row({
  kind: z.string(),
  table: z.string(),
  privacyScope: z.string(),
});

function requireKnownKind(kind: string): void {
  if (!retentionSources().some((source) => source.kind === kind)) {
    throw new ServiceError("validation", "Choose a registered retention kind.");
  }
}

export const listRetentionPolicies = defineService({
  name: "retention.listPolicies",
  summary: "List per-kind retention policies and the stores they can cover.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    kinds: listed(kindRow),
    policies: listed(policyRow),
  }),
  handler: async (_input, ctx) => {
    const policies = await ctx.tx
      .select()
      .from(retentionPolicies)
      .orderBy(asc(retentionPolicies.kind));
    return {
      kinds: retentionSources().map((source) => ({
        kind: source.kind,
        table: source.tables[0]!,
        privacyScope: source.privacyScope,
      })),
      policies,
    };
  },
});

export const upsertRetentionPolicy = defineService({
  name: "retention.upsertPolicy",
  summary: "Set how many days a registered user-owned store is kept.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    kind: z.string().trim().min(1).max(80),
    ttlDays: z.number().int().min(1).max(36_500),
  }),
  output: policyRow,
  handler: async (input, ctx) => {
    requireKnownKind(input.kind);
    const [row] = await ctx.tx
      .insert(retentionPolicies)
      .values({ kind: input.kind, ttlDays: input.ttlDays })
      .onConflictDoUpdate({
        target: retentionPolicies.kind,
        set: { ttlDays: input.ttlDays },
      })
      .returning();
    ctx.setSubject("retentionPolicy", row!.id);
    return row!;
  },
});

export const applyRetention = defineService({
  name: "retention.apply",
  summary: "Enqueue the job that purges rows older than each stored policy.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({}),
  output: z.object({
    jobId: z.string(),
    deduplicated: z.boolean(),
  }),
  handler: async (_input, ctx) => {
    const queued = await ctx.queueJob("core.applyRetention");
    ctx.setSubject("retentionApply", queued.id);
    return { jobId: queued.id, deduplicated: queued.deduplicated };
  },
});

export { applyRetentionPolicies } from "./apply";
export {
  RETENTION_TABLE_OPT_OUTS,
  registerRetentionSource,
  retentionSources,
} from "./registry";

export default [listRetentionPolicies, upsertRetentionPolicy, applyRetention];
