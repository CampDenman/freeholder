// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Typed edges between Contacts, including merge-safe repointing (C1.06).
import { and, asc, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { contactRelationships, contacts } from "@/core/contacts/schema";
import { isUniqueViolation } from "@/core/db";
import {
  defineService,
  ServiceError,
  type ServiceContext,
  type Tx,
} from "@/core/service";

export const RELATIONSHIP_KINDS = [
  "household",
  "employer",
  "referred_by",
  "partner",
  "guardian",
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];
const relationshipKind = z.enum(RELATIONSHIP_KINDS);
const symmetric = new Set<RelationshipKind>(["household", "partner"]);
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a real calendar date.");

function canonicalEdge(
  fromContactId: string,
  toContactId: string,
  kind: RelationshipKind,
): { fromContactId: string; toContactId: string } {
  if (symmetric.has(kind) && fromContactId > toContactId) {
    return { fromContactId: toContactId, toContactId: fromContactId };
  }
  return { fromContactId, toContactId };
}

function duplicateEdge(error: unknown): never {
  if (isUniqueViolation(error, "contact_relationships_edge_idx")) {
    throw new ServiceError("conflict", "That relationship already exists.");
  }
  throw error;
}

async function requireContacts(tx: Tx, ids: string[]): Promise<void> {
  const rows = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(inArray(contacts.id, [...new Set(ids)]));
  if (rows.length !== new Set(ids).size) {
    throw new ServiceError("not_found", "One of those contacts no longer exists.");
  }
}

async function emitRelationship(
  ctx: ServiceContext,
  relationship: typeof contactRelationships.$inferSelect,
  eventType: "contact.relationshipAdded" | "contact.relationshipUpdated" | "contact.relationshipRemoved",
): Promise<void> {
  await Promise.all([
    ctx.emitTimeline({
      contactId: relationship.fromContactId,
      eventType,
      subjectType: "relationship",
      subjectId: relationship.id,
      payload: {
        otherContactId: relationship.toContactId,
        kind: relationship.kind,
        direction: symmetric.has(relationship.kind) ? "peer" : "outgoing",
        since: relationship.since,
      },
    }),
    ctx.emitTimeline({
      contactId: relationship.toContactId,
      eventType,
      subjectType: "relationship",
      subjectId: relationship.id,
      payload: {
        otherContactId: relationship.fromContactId,
        kind: relationship.kind,
        direction: symmetric.has(relationship.kind) ? "peer" : "incoming",
        since: relationship.since,
      },
    }),
  ]);
}

export const createRelationship = defineService({
  name: "contacts.createRelationship",
  summary: "Record how two contacts are related.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    fromContactId: z.string().uuid(),
    toContactId: z.string().uuid(),
    kind: relationshipKind,
    since: calendarDate.nullable().optional(),
    notes: z.string().trim().max(2_000).nullable().optional(),
  }),
  handler: async (input, ctx) => {
    if (input.fromContactId === input.toContactId) {
      throw new ServiceError("validation", "A contact cannot be related to itself.");
    }
    await requireContacts(ctx.tx, [input.fromContactId, input.toContactId]);
    const edge = canonicalEdge(input.fromContactId, input.toContactId, input.kind);
    try {
      const [relationship] = await ctx.tx
        .insert(contactRelationships)
        .values({ ...input, ...edge })
        .returning();
      ctx.setSubject("relationship", relationship!.id);
      await emitRelationship(ctx, relationship!, "contact.relationshipAdded");
      return relationship!;
    } catch (error) {
      duplicateEdge(error);
    }
  },
});

export const updateRelationship = defineService({
  name: "contacts.updateRelationship",
  summary: "Correct the kind, date, or notes on a contact relationship.",
  kind: "mutation",
  permission: "scoped",
  input: z
    .object({
      id: z.string().uuid(),
      kind: relationshipKind.optional(),
      /**
       * Supply both endpoints when changing direction from a contact-facing
       * UI. This removes the ambiguity of turning a canonical peer edge into
       * “works for” or “was referred by”. The pair may only be reordered, not
       * replaced; moving an edge to different people is a delete + create.
       */
      fromContactId: z.string().uuid().optional(),
      toContactId: z.string().uuid().optional(),
      since: calendarDate.nullable().optional(),
      notes: z.string().trim().max(2_000).nullable().optional(),
    })
    .refine(
      (input) => Boolean(input.fromContactId) === Boolean(input.toContactId),
      "Supply both relationship endpoints or neither.",
    ),
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(contactRelationships)
      .where(eq(contactRelationships.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That relationship no longer exists.");
    const kind = input.kind ?? existing.kind;
    if (
      input.kind !== undefined &&
      symmetric.has(input.kind) !== symmetric.has(existing.kind) &&
      !input.fromContactId
    ) {
      throw new ServiceError(
        "validation",
        "Supply relationship endpoints when changing between peer and directional kinds.",
      );
    }
    const requestedEndpoints = input.fromContactId
      ? new Set([input.fromContactId, input.toContactId!])
      : null;
    if (
      requestedEndpoints &&
      (requestedEndpoints.size !== 2 ||
        !requestedEndpoints.has(existing.fromContactId) ||
        !requestedEndpoints.has(existing.toContactId))
    ) {
      throw new ServiceError(
        "validation",
        "A relationship edit cannot replace either contact.",
      );
    }
    const edge = canonicalEdge(
      input.fromContactId ?? existing.fromContactId,
      input.toContactId ?? existing.toContactId,
      kind,
    );
    const { id, fromContactId: _from, toContactId: _to, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "Choose something to change.");
    }
    try {
      const [updated] = await ctx.tx
        .update(contactRelationships)
        .set({ ...changes, ...edge })
        .where(eq(contactRelationships.id, id))
        .returning();
      ctx.setSubject("relationship", id);
      await emitRelationship(ctx, updated!, "contact.relationshipUpdated");
      return updated!;
    } catch (error) {
      duplicateEdge(error);
    }
  },
});

export const deleteRelationship = defineService({
  name: "contacts.deleteRelationship",
  summary: "Remove a relationship while preserving its contact timeline history.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [relationship] = await ctx.tx
      .select()
      .from(contactRelationships)
      .where(eq(contactRelationships.id, input.id))
      .limit(1);
    if (!relationship) {
      throw new ServiceError("not_found", "That relationship no longer exists.");
    }
    await ctx.tx.delete(contactRelationships).where(eq(contactRelationships.id, input.id));
    ctx.setSubject("relationship", input.id);
    await emitRelationship(ctx, relationship, "contact.relationshipRemoved");
    return { ok: true };
  },
});

export const listRelationships = defineService({
  name: "contacts.listRelationships",
  summary: "List both incoming and outgoing relationships for one contact.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: z.string().uuid() }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(contactRelationships)
      .where(
        or(
          eq(contactRelationships.fromContactId, input.contactId),
          eq(contactRelationships.toContactId, input.contactId),
        ),
      )
      .orderBy(asc(contactRelationships.kind), asc(contactRelationships.createdAt));
    const otherIds = rows.map((row) =>
      row.fromContactId === input.contactId ? row.toContactId : row.fromContactId,
    );
    const people = otherIds.length
      ? await ctx.tx
          .select({ id: contacts.id, name: contacts.name, email: contacts.email })
          .from(contacts)
          .where(inArray(contacts.id, otherIds))
      : [];
    const byId = new Map(people.map((person) => [person.id, person]));
    return rows.map((row) => {
      const outgoing = row.fromContactId === input.contactId;
      const otherContactId = outgoing ? row.toContactId : row.fromContactId;
      return {
        ...row,
        direction: symmetric.has(row.kind) ? ("peer" as const) : outgoing ? ("outgoing" as const) : ("incoming" as const),
        otherContact: byId.get(otherContactId)!,
      };
    });
  },
});

function earlierDate(one: string | null, two: string | null): string | null {
  if (!one) return two;
  if (!two) return one;
  return one < two ? one : two;
}

function mergeNotes(one: string | null, two: string | null): string | null {
  const notes = [...new Set([one, two].filter((value): value is string => Boolean(value)))];
  return notes.join("\n\n") || null;
}

/** Repoint every edge touching a duplicate without producing self-edges or collisions. */
export async function repointContactRelationships(
  tx: Tx,
  duplicateId: string,
  survivingId: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(contactRelationships)
    .where(
      or(
        eq(contactRelationships.fromContactId, duplicateId),
        eq(contactRelationships.toContactId, duplicateId),
      ),
    );
  for (const row of rows) {
    const proposed = canonicalEdge(
      row.fromContactId === duplicateId ? survivingId : row.fromContactId,
      row.toContactId === duplicateId ? survivingId : row.toContactId,
      row.kind,
    );
    if (proposed.fromContactId === proposed.toContactId) {
      await tx.delete(contactRelationships).where(eq(contactRelationships.id, row.id));
      continue;
    }
    const [collision] = await tx
      .select()
      .from(contactRelationships)
      .where(
        and(
          eq(contactRelationships.fromContactId, proposed.fromContactId),
          eq(contactRelationships.toContactId, proposed.toContactId),
          eq(contactRelationships.kind, row.kind),
          ne(contactRelationships.id, row.id),
        ),
      )
      .limit(1);
    if (collision) {
      await tx
        .update(contactRelationships)
        .set({
          since: earlierDate(collision.since, row.since),
          notes: mergeNotes(collision.notes, row.notes),
        })
        .where(eq(contactRelationships.id, collision.id));
      await tx.delete(contactRelationships).where(eq(contactRelationships.id, row.id));
      continue;
    }
    await tx
      .update(contactRelationships)
      .set(proposed)
      .where(eq(contactRelationships.id, row.id));
  }
}

interface RelationshipSnapshot {
  id: string;
  fromContactId: string;
  toContactId: string;
  kind: RelationshipKind;
  since: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function relationshipSnapshot(
  row: typeof contactRelationships.$inferSelect,
): RelationshipSnapshot {
  return {
    id: row.id,
    fromContactId: row.fromContactId,
    toContactId: row.toContactId,
    kind: row.kind,
    since: row.since,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Capture every edge a merge can move, coalesce, or remove. */
export async function captureContactRelationships(
  tx: Tx,
  duplicateId: string,
  survivingId: string,
): Promise<RelationshipSnapshot[]> {
  return (
    await tx
      .select()
      .from(contactRelationships)
      .where(
        or(
          inArray(contactRelationships.fromContactId, [duplicateId, survivingId]),
          inArray(contactRelationships.toContactId, [duplicateId, survivingId]),
        ),
      )
      .orderBy(asc(contactRelationships.id))
  ).map(relationshipSnapshot);
}

const relationshipSnapshotSchema = z.array(
  z.object({
    id: z.string().uuid(),
    fromContactId: z.string().uuid(),
    toContactId: z.string().uuid(),
    kind: relationshipKind,
    since: calendarDate.nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);

/** Restore the exact pre-merge edge set only while its post-merge rows are untouched. */
export async function restoreContactRelationships(
  tx: Tx,
  beforeState: unknown,
  afterState: unknown,
): Promise<void> {
  const before = relationshipSnapshotSchema.parse(beforeState);
  const after = relationshipSnapshotSchema.parse(afterState);
  const afterIds = after.map((row) => row.id);
  const current = afterIds.length
    ? await tx
        .select()
        .from(contactRelationships)
        .where(inArray(contactRelationships.id, afterIds))
    : [];
  const expected = new Map(after.map((row) => [row.id, JSON.stringify(row)]));
  if (
    current.length !== after.length ||
    current.some(
      (row) => JSON.stringify(relationshipSnapshot(row)) !== expected.get(row.id),
    )
  ) {
    throw new ServiceError(
      "conflict",
      "A relationship changed after this merge. Leave the merge in place or restore that relationship first.",
    );
  }
  try {
    if (afterIds.length) {
      await tx
        .delete(contactRelationships)
        .where(inArray(contactRelationships.id, afterIds));
    }
    if (before.length) {
      await tx.insert(contactRelationships).values(
        before.map((row) => ({
          ...row,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        })),
      );
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ServiceError(
        "conflict",
        "A newer relationship now occupies an edge this undo would restore.",
      );
    }
    throw error;
  }
}

export default [
  createRelationship,
  updateRelationship,
  deleteRelationship,
  listRelationships,
];
