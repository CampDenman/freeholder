// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recording, correcting and reading owner-supplied facts (MASTER.md §4.18,
// C8.15).
//
// `current` is the service every rendering surface calls, and what it does
// when there is nothing to return is the whole point: it returns null. It does
// not fall back to the last known value, interpolate, average, or reach for a
// neighbouring subject. "Areas they named, no invented coverage" and "a figure
// needs the date it was true" are the same rule, and this is where it lives.
//
// `correct` is the other half. Nothing updates a value in place — a correction
// supersedes, the superseded row keeps its words and its dates, and the
// history is therefore a byproduct of the storage rather than a feature that
// could be forgotten.
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { actorString, defineService, ServiceError } from "@/core/service";
import { isUniqueViolation } from "@/core/db";
import { attestations } from "./schema";

/** Namespaced by convention: `rate.30-year-fixed`, `status.service`. */
const factKey = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
    "Use lower-case words separated by dots or hyphens.",
  );

const subject = z.object({
  kind: z.string().min(1).max(60).optional(),
  id: z.string().min(1).max(120).optional(),
});

const factRow = row({
  id: uuid,
  key: z.string(),
  subjectKind: z.string().nullable(),
  subjectId: z.string().nullable(),
  value: z.unknown(),
  source: z.string(),
  asOf: timestamp,
  validUntil: timestamp.nullable(),
  publishedAt: timestamp.nullable(),
  withdrawnAt: timestamp.nullable(),
  supersededAt: timestamp.nullable(),
  correctionNote: z.string().nullable(),
  createdAt: timestamp,
});

/** Published, not withdrawn, not superseded — the one the database allows. */
function currentWhere(key: string, subjectKind?: string, subjectId?: string) {
  return and(
    eq(attestations.key, key),
    subjectKind === undefined
      ? isNull(attestations.subjectKind)
      : eq(attestations.subjectKind, subjectKind),
    subjectId === undefined
      ? isNull(attestations.subjectId)
      : eq(attestations.subjectId, subjectId),
    sql`${attestations.publishedAt} is not null`,
    isNull(attestations.withdrawnAt),
    isNull(attestations.supersededAt),
  );
}

/** `audit_log`'s convention: an actor is not always a person. */
function recordedBy(actor: Parameters<typeof actorString>[0]): string {
  return actorString(actor);
}

/* ----------------------------------------------------------------- reading */

export const currentFact = defineService({
  name: "attestations.current",
  summary: "The fact the business currently stands behind, or nothing.",
  kind: "query",
  permission: "public",
  input: z.object({ key: factKey, subject: subject.optional() }),
  output: z
    .object({
      id: uuid,
      key: z.string(),
      value: z.unknown(),
      source: z.string(),
      asOf: timestamp,
      validUntil: timestamp.nullable(),
      /**
       * True once `validUntil` has passed. Deliberately not hidden: "we last
       * knew this on Tuesday" is honest, and silence about a number the
       * business published is not.
       */
      stale: z.boolean(),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(attestations)
      .where(currentWhere(input.key, input.subject?.kind, input.subject?.id))
      .limit(1);
    // No fallback, by design. A surface with nothing to say says nothing.
    if (!found) return null;
    return {
      id: found.id,
      key: found.key,
      value: found.value,
      source: found.source,
      asOf: found.asOf,
      validUntil: found.validUntil,
      stale: found.validUntil !== null && found.validUntil.getTime() <= Date.now(),
    };
  },
});

export const factHistory = defineService({
  name: "attestations.history",
  summary: "Everything this fact has been, oldest first, corrections included.",
  kind: "query",
  permission: "public",
  input: z.object({ key: factKey, subject: subject.optional() }),
  output: listed(factRow),
  handler: async (input, ctx) => {
    // Public on purpose: a correction that only the owner can see is not a
    // correction. The newsroom editions call this the correction ledger, and
    // it is the same rows a rate history is made of.
    const rows = await ctx.tx
      .select()
      .from(attestations)
      .where(
        and(
          eq(attestations.key, input.key),
          input.subject?.kind === undefined
            ? isNull(attestations.subjectKind)
            : eq(attestations.subjectKind, input.subject.kind),
          input.subject?.id === undefined
            ? isNull(attestations.subjectId)
            : eq(attestations.subjectId, input.subject.id),
          sql`${attestations.publishedAt} is not null`,
        ),
      )
      .orderBy(asc(attestations.asOf), asc(attestations.createdAt));
    return rows;
  },
});

export const listFacts = defineService({
  name: "attestations.list",
  summary: "Every fact currently stood behind, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ key: factKey.optional() }),
  output: listed(factRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(attestations)
      .where(
        and(
          isNull(attestations.supersededAt),
          isNull(attestations.withdrawnAt),
          input.key ? eq(attestations.key, input.key) : undefined,
        ),
      )
      .orderBy(desc(attestations.asOf));
    return rows;
  },
});

/* ----------------------------------------------------------------- writing */

export const recordFact = defineService({
  name: "attestations.record",
  summary: "State a fact, with where it came from and when it was true.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: factKey,
    subject: subject.optional(),
    value: z.unknown(),
    source: z.string().min(1).max(500),
    asOf: z.coerce.date(),
    validUntil: z.coerce.date().optional(),
    /** Draft facts exist so a rate can be prepared before it is live. */
    publish: z.boolean().default(true),
  }),
  output: factRow,
  handler: async (input, ctx) => {
    if (input.validUntil && input.validUntil <= input.asOf) {
      throw new ServiceError(
        "validation",
        "A fact cannot stop being true before the moment it was true.",
      );
    }
    const [created] = await ctx.tx
      .insert(attestations)
      .values({
        key: input.key,
        subjectKind: input.subject?.kind ?? null,
        subjectId: input.subject?.id ?? null,
        value: input.value,
        source: input.source,
        asOf: input.asOf,
        validUntil: input.validUntil ?? null,
        recordedBy: recordedBy(ctx.actor),
        publishedAt: input.publish ? new Date() : null,
      })
      .returning()
      .catch((error: unknown) => {
        // The database refuses a second current fact. Say why, in the words of
        // the thing an owner should do instead.
        if (isUniqueViolation(error)) {
          throw new ServiceError(
            "conflict",
            `"${input.key}" already has a current value. Correct it instead, so the change keeps its history.`,
          );
        }
        throw error;
      });
    ctx.setSubject("attestation", created!.id);
    ctx.queueEvent("attestation.recorded", { id: created!.id, key: created!.key });
    return created!;
  },
});

export const correctFact = defineService({
  name: "attestations.correct",
  summary: "Replace a fact with a newer one. The old value stays readable.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: factKey,
    subject: subject.optional(),
    value: z.unknown(),
    source: z.string().min(1).max(500),
    asOf: z.coerce.date(),
    validUntil: z.coerce.date().optional(),
    /** Why it changed. Shown in the ledger beside the value it replaced. */
    note: z.string().min(1).max(1000),
  }),
  output: factRow,
  handler: async (input, ctx) => {
    if (input.validUntil && input.validUntil <= input.asOf) {
      throw new ServiceError(
        "validation",
        "A fact cannot stop being true before the moment it was true.",
      );
    }
    const [existing] = await ctx.tx
      .select()
      .from(attestations)
      .where(currentWhere(input.key, input.subject?.kind, input.subject?.id))
      .limit(1);
    if (!existing) {
      throw new ServiceError(
        "not_found",
        `There is no current value for "${input.key}" to correct. Record it first.`,
      );
    }
    if (input.asOf < existing.asOf) {
      // A correction that was true *earlier* than the thing it replaces is
      // almost always a typo in the date, and accepting it would make the
      // ledger read backwards.
      throw new ServiceError(
        "validation",
        "A correction cannot be older than the value it replaces. Check the date.",
      );
    }

    // One transaction: the old row is retired and the new one takes its place,
    // or neither happens. A window where a key has no current value is a
    // window where a page has nothing to say about a number it was showing a
    // moment ago.
    await ctx.tx
      .update(attestations)
      .set({ supersededAt: new Date() })
      .where(eq(attestations.id, existing.id));

    const [created] = await ctx.tx
      .insert(attestations)
      .values({
        key: input.key,
        subjectKind: input.subject?.kind ?? null,
        subjectId: input.subject?.id ?? null,
        value: input.value,
        source: input.source,
        asOf: input.asOf,
        validUntil: input.validUntil ?? null,
        recordedBy: recordedBy(ctx.actor),
        publishedAt: new Date(),
        supersedesId: existing.id,
        correctionNote: input.note,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ServiceError(
            "conflict",
            "Somebody corrected this at the same moment. Reload and check what it says now.",
          );
        }
        throw error;
      });
    ctx.setSubject("attestation", created!.id);
    ctx.queueEvent("attestation.corrected", {
      id: created!.id,
      key: created!.key,
      supersedesId: existing.id,
    });
    return created!;
  },
});

export const withdrawFact = defineService({
  name: "attestations.withdraw",
  summary: "Stop publishing a fact. The row and its history stay.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid, reason: z.string().max(1000).optional() }),
  output: factRow,
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(attestations)
      .where(eq(attestations.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That fact is not here.");
    if (existing.withdrawnAt) return existing;

    const [updated] = await ctx.tx
      .update(attestations)
      .set({
        withdrawnAt: new Date(),
        correctionNote: input.reason ?? existing.correctionNote,
      })
      .where(eq(attestations.id, existing.id))
      .returning();
    ctx.setSubject("attestation", existing.id);
    ctx.queueEvent("attestation.withdrawn", { id: existing.id, key: existing.key });
    return updated!;
  },
});

export default [
  currentFact,
  factHistory,
  listFacts,
  recordFact,
  correctFact,
  withdrawFact,
];
