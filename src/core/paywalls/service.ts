// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paywalls over grants (MASTER.md §4.15, C9.15).
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid as uuidSchema } from "@/core/contract";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { decidePaywall } from "./evaluate";
import {
  CONTENT_KINDS,
  PAYWALL_MODES,
  PAYWALL_STATUSES,
  PREVIEW_STRATEGIES,
  SEO_POLICIES,
  meterCounters,
  paywalls,
} from "./schema";

const appliesSchema = z.object({
  kind: z.enum(CONTENT_KINDS),
  selector: z.string().trim().min(1).max(200),
});

const paywallRow = row({
  id: uuidSchema,
  name: z.string(),
  appliesTo: appliesSchema,
  mode: z.enum(PAYWALL_MODES),
  meterCount: z.number().int(),
  meterWindowDays: z.number().int(),
  previewStrategy: z.enum(PREVIEW_STRATEGIES),
  previewValue: z.number().int(),
  requiredEntitlementIds: z.array(uuidSchema),
  upsellPageId: uuidSchema.nullable(),
  seoPolicy: z.enum(SEO_POLICIES),
  status: z.enum(PAYWALL_STATUSES),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const decisionRow = row({
  gated: z.boolean(),
  allowed: z.boolean(),
  reveal: z.enum(["all", "preview", "none"]),
  previewStrategy: z.enum(PREVIEW_STRATEGIES),
  previewValue: z.number().int(),
  seoPolicy: z.enum(SEO_POLICIES).nullable(),
  paywallId: uuidSchema.nullable(),
  upsellPageId: uuidSchema.nullable(),
});

export const savePaywall = defineService({
  name: "paywalls.save",
  writeClass: "write",
  summary: "Say which content is gated, and how.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    name: z.string().trim().min(1).max(200),
    appliesTo: appliesSchema,
    mode: z.enum(PAYWALL_MODES).default("hard"),
    meterCount: z.number().int().min(0).max(1000).default(0),
    meterWindowDays: z.number().int().min(1).max(365).default(30),
    previewStrategy: z.enum(PREVIEW_STRATEGIES).default("blocks"),
    previewValue: z.number().int().min(0).max(100).default(1),
    requiredEntitlementIds: z.array(uuidSchema).max(20).default([]),
    upsellPageId: uuidSchema.nullish(),
    seoPolicy: z.enum(SEO_POLICIES).default("fully_gated"),
    status: z.enum(PAYWALL_STATUSES).default("active"),
  }),
  output: paywallRow,
  handler: async (input, ctx) => {
    const values = {
      name: input.name,
      appliesTo: {
        kind: input.appliesTo.kind,
        selector: input.appliesTo.selector.replace(/^\/+|\/+$/g, "") || "*",
      },
      mode: input.mode,
      meterCount: input.meterCount,
      meterWindowDays: input.meterWindowDays,
      previewStrategy: input.previewStrategy,
      previewValue: input.previewValue,
      requiredEntitlementIds: input.requiredEntitlementIds,
      upsellPageId: input.upsellPageId ?? null,
      seoPolicy: input.seoPolicy,
      status: input.status,
    };
    if (input.mode === "metered" && input.meterCount < 1) {
      throw new ServiceError(
        "validation",
        "A metered paywall has to say how many free views it gives.",
      );
    }
    if (input.id) {
      const [updated] = await ctx.tx
        .update(paywalls)
        .set(values)
        .where(eq(paywalls.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such paywall.");
      ctx.setSubject("paywall", updated.id);
      return updated;
    }
    const [created] = await ctx.tx.insert(paywalls).values(values).returning();
    ctx.setSubject("paywall", created!.id);
    return created!;
  },
});

export const listPaywalls = defineService({
  name: "paywalls.list",
  summary: "Paywalls, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(PAYWALL_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  output: listed(paywallRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(paywalls)
      .where(input.status ? eq(paywalls.status, input.status) : undefined)
      .orderBy(desc(paywalls.createdAt))
      .limit(input.limit),
});

export const evaluatePaywall = defineService({
  name: "paywalls.evaluate",
  writeClass: "write",
  summary: "Decide what this visitor may see of a gated tree.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    paywallId: uuidSchema.optional(),
    kind: z.enum(CONTENT_KINDS).default("page"),
    selector: z.string().trim().max(200),
    anonId: z.string().trim().min(1).max(120).nullish(),
  }),
  output: decisionRow,
  handler: async (input, ctx) =>
    decidePaywall(ctx.tx, {
      actor: ctx.actor,
      paywallId: input.paywallId,
      kind: input.kind,
      selector: input.selector,
      anonId: input.anonId,
    }),
});

registerContactReference({
  table: "paywall_meter_counters",
  repoint: async (tx, duplicateId, survivingId) => {
    const survivor = await tx
      .select()
      .from(meterCounters)
      .where(eq(meterCounters.contactId, survivingId));
    const taken = new Map(survivor.map((row) => [row.paywallId, row]));
    const duplicate = await tx
      .select()
      .from(meterCounters)
      .where(eq(meterCounters.contactId, duplicateId));
    for (const row of duplicate) {
      const existing = taken.get(row.paywallId);
      if (existing) {
        const windowStartsAt =
          existing.windowStartsAt <= row.windowStartsAt
            ? existing.windowStartsAt
            : row.windowStartsAt;
        await tx
          .update(meterCounters)
          .set({
            windowStartsAt,
            count: Math.max(existing.count, row.count),
          })
          .where(eq(meterCounters.id, existing.id));
        await tx.delete(meterCounters).where(eq(meterCounters.id, row.id));
        continue;
      }
      await tx
        .update(meterCounters)
        .set({ contactId: survivingId })
        .where(eq(meterCounters.id, row.id));
      taken.set(row.paywallId, { ...row, contactId: survivingId });
    }
  },
  captureForUndo: async (tx, duplicateId) => {
    const moved = await tx
      .select({ id: meterCounters.id })
      .from(meterCounters)
      .where(eq(meterCounters.contactId, duplicateId));
    return {
      state: moved.map((row) => row.id),
      undoable: moved.length === 0,
      blocker:
        moved.length > 0
          ? "Metered view counts cannot be split back out after a merge."
          : undefined,
    };
  },
  restoreAfterUndo: async () => undefined,
});

registerContactPrivacySource({
  scope: "paywalls.meters",
  tables: ["paywall_meter_counters"],
  exportData: (tx: Tx, contactId: string) =>
    tx.select().from(meterCounters).where(eq(meterCounters.contactId, contactId)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .delete(meterCounters)
      .where(eq(meterCounters.contactId, contactId))
      .returning({ id: meterCounters.id });
    return { affected: rows.length };
  },
});

export default [savePaywall, listPaywalls, evaluatePaywall];
