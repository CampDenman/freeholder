// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Segments: the one definition of "who" (MASTER.md §4.14, C7.04).
//
// Four things this file is careful about.
//
// **A rule the platform cannot answer is refused, never ignored.** A definition
// naming a field that does not exist — a module switched off, a key renamed —
// fails loudly at save and matches nobody at read. The alternative is an
// audience that silently widens the day somebody disables a module, which is
// how a campaign goes to people who were meant to be excluded.
//
// **Explainability is running the rules, not describing them.** `segments.why`
// evaluates each rule separately against one contact and says which passed.
// A prose summary generated from the definition would be a second
// implementation of the query and would eventually disagree with the first —
// and the moment somebody asks "why did they get this" is exactly the moment a
// plausible-but-wrong answer does damage.
//
// **A count is a number with a date on it.** `memberCountCached` is only ever
// written beside `lastEvaluatedAt`, because a stale number nobody can date is a
// number people start trusting.
//
// **Static means frozen.** Capturing writes the membership once; re-capturing
// is a deliberate, separate act. "Who received the March email" must not change
// in April because somebody's lifecycle stage moved.
import { z } from "zod";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { isUniqueViolation } from "@/core/db";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { defineService, ServiceError, type Actor, type Tx } from "@/core/service";
import {
  OPERATORS,
  OPERATORS_FOR,
  segmentField,
  segmentFields,
} from "./fields";
import { SEGMENT_KINDS, segmentMembers, segments } from "./schema";

export { registerSegmentField, countOfRelated, lastRelatedAt, sumOfRelated } from "./fields";
export type { SegmentField } from "./fields";

const id = z.string().uuid();

function requirePerson(actor: Actor): void {
  // System passes: a campaign resolving its own audience, or a price list
  // deciding eligibility for an anonymous shopper, is elevation from a caller
  // that has already established authority.
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage segments.");
  }
}

export const segmentRule = z.object({
  field: z.string().trim().min(1).max(100),
  op: z.enum(OPERATORS),
  /** Free-form because the field decides what it means; validated on compile. */
  value: z.unknown().optional(),
});

export const segmentDefinition = z.object({
  /** "all" is AND, "any" is OR. Two words an owner already understands. */
  match: z.enum(["all", "any"]).default("all"),
  rules: z.array(segmentRule).min(1).max(30),
});

export type SegmentDefinition = z.infer<typeof segmentDefinition>;

/**
 * One rule, as a condition on `contacts`.
 *
 * Throws rather than returning null for anything it cannot answer: an unknown
 * field, or an operator the field does not accept. Both are the same failure —
 * the definition asks something the platform cannot answer — and swallowing it
 * would widen the audience rather than narrow it.
 */
function compileRule(rule: z.infer<typeof segmentRule>): SQL {
  const field = segmentField(rule.field);
  if (!field) {
    throw new ServiceError(
      "validation",
      `Nothing here knows about "${rule.field}". If it came from a module, that module may be switched off.`,
    );
  }
  if (!OPERATORS_FOR[field.type].includes(rule.op)) {
    throw new ServiceError(
      "validation",
      `"${field.label}" cannot be asked that way.`,
    );
  }
  const condition = field.condition(rule.op, rule.value);
  if (!condition) {
    throw new ServiceError("validation", `"${field.label}" needs a different value.`);
  }
  return condition;
}

/** The whole definition, as one condition. */
export function compileDefinition(definition: SegmentDefinition): SQL {
  const conditions = definition.rules.map(compileRule);
  const combined =
    definition.match === "any" ? or(...conditions) : and(...conditions);
  // `and()`/`or()` return undefined for an empty list; the schema forbids one,
  // and this keeps the type honest without a cast.
  return combined ?? sql`true`;
}

const segmentRow = row({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  kind: z.enum(SEGMENT_KINDS),
  definition: z.unknown(),
  memberCountCached: z.number().int().nullable(),
  lastEvaluatedAt: timestamp.nullable(),
  capturedAt: timestamp.nullable(),
});

export const listSegmentFields = defineService({
  name: "segments.fields",
  summary: "What a segment can ask about, and how.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      key: z.string(),
      label: z.string(),
      type: z.string(),
      source: z.string(),
      options: z.array(z.string()).nullable(),
      operators: z.array(z.string()),
    }),
  ),
  handler: async () =>
    segmentFields().map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      source: field.source,
      options: field.options ? [...field.options] : null,
      operators: [...OPERATORS_FOR[field.type]],
    })),
});

export const saveSegment = defineService({
  name: "segments.save",
  summary: "Save a definition of who, by name.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id: id.optional(),
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case words separated by hyphens.")
      .max(120)
      .optional(),
    description: z.string().trim().max(1_000).nullish(),
    kind: z.enum(SEGMENT_KINDS).default("dynamic"),
    definition: segmentDefinition,
  }),
  output: segmentRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // Compiled before it is stored, so a definition that cannot be answered is
    // refused at the door rather than at three in the morning when a campaign
    // resolves its audience.
    const condition = compileDefinition(input.definition);
    const slug = input.slug ?? slugify(input.name);
    const count = await countMatching(ctx.tx, condition);

    if (input.id) {
      const [existing] = await ctx.tx
        .select({ kind: segments.kind })
        .from(segments)
        .where(eq(segments.id, input.id))
        .limit(1);
      if (!existing) throw new ServiceError("not_found", "That segment is not here.");
      if (existing.kind === "static" && input.kind !== "static") {
        // Turning a frozen list back into a live query would silently rewrite
        // the answer to "who received this", which is the one thing a static
        // segment exists to hold still.
        throw new ServiceError(
          "conflict",
          "A captured segment stays captured. Make a new one if the rules have changed.",
        );
      }
      const [updated] = await ctx.tx
        .update(segments)
        .set({
          name: input.name,
          slug,
          description: input.description ?? null,
          definition: input.definition,
          memberCountCached: count,
          lastEvaluatedAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(segments.id, input.id))
        .returning();
      ctx.setSubject("segment", updated!.id);
      return updated!;
    }

    const [created] = await ctx.tx
      .insert(segments)
      .values({
        name: input.name,
        slug,
        description: input.description ?? null,
        // A new segment is always dynamic to begin with: `segments.capture` is
        // what freezes one, and it stamps the date the check constraint wants.
        kind: "dynamic",
        definition: input.definition,
        memberCountCached: count,
        lastEvaluatedAt: new Date(),
        createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .returning()
      .catch((error: unknown) => {
        throw slugTaken(error);
      });
    ctx.setSubject("segment", created!.id);
    ctx.queueEvent("segment.saved", { id: created!.id });
    return created!;
  },
});

export const listSegments = defineService({
  name: "segments.list",
  summary: "Every saved definition of who, with the last count taken.",
  kind: "query",
  permission: "scoped",
  input: z.object({ kind: z.enum(SEGMENT_KINDS).optional() }),
  output: listed(segmentRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(segments)
      .where(input.kind ? eq(segments.kind, input.kind) : undefined)
      .orderBy(asc(segments.name))
      .limit(200),
});

export const removeSegment = defineService({
  name: "segments.remove",
  summary: "Delete a segment.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [removed] = await ctx.tx
      .delete(segments)
      .where(eq(segments.id, input.id))
      .returning({ id: segments.id });
    if (!removed) throw new ServiceError("not_found", "That segment is not here.");
    ctx.setSubject("segment", removed.id);
    return removed;
  },
});

/**
 * Count and sample without saving anything (C7.04's preview).
 *
 * Takes a definition rather than an id, because the question an owner asks is
 * "how many would this be" *before* they commit to it. A preview that required
 * saving first would leave a trail of abandoned segments and would make the
 * count a thing you find out after the decision.
 */
export const previewSegment = defineService({
  name: "segments.preview",
  summary: "How many people this would be, and a few of them.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    definition: segmentDefinition,
    sample: z.number().int().min(0).max(50).default(10),
  }),
  output: row({
    count: z.number().int(),
    sample: listed(row({ id: uuid, name: z.string(), email: z.string().nullable() })),
  }),
  handler: async (input, ctx) => {
    const condition = compileDefinition(input.definition);
    const count = await countMatching(ctx.tx, condition);
    const sample =
      input.sample === 0
        ? []
        : await ctx.tx
            .select({ id: contacts.id, name: contacts.name, email: contacts.email })
            .from(contacts)
            .where(condition)
            .orderBy(asc(contacts.name))
            .limit(input.sample);
    return { count, sample };
  },
});

/**
 * Who is in this segment, right now or as captured.
 *
 * The one door every consumer uses: a campaign's audience, a price list's
 * eligibility, and later an automation's entry condition and a report's cohort
 * (C7.17). That is what makes "customers in Ontario who bought twice" mean one
 * thing everywhere.
 */
export const segmentMembership = defineService({
  name: "segments.members",
  summary: "The contacts a segment currently contains, or contained when frozen.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    id: id.optional(),
    slug: z.string().trim().max(120).optional(),
    limit: z.number().int().min(1).max(10_000).default(1_000),
  }),
  output: listed(row({ id: uuid, name: z.string(), email: z.string().nullable() })),
  handler: async (input, ctx) => {
    const segment = await findSegment(ctx.tx, input);
    if (segment.kind === "static") {
      return ctx.tx
        .select({ id: contacts.id, name: contacts.name, email: contacts.email })
        .from(segmentMembers)
        .innerJoin(contacts, eq(contacts.id, segmentMembers.contactId))
        .where(eq(segmentMembers.segmentId, segment.id))
        .orderBy(asc(contacts.name))
        .limit(input.limit);
    }
    return ctx.tx
      .select({ id: contacts.id, name: contacts.name, email: contacts.email })
      .from(contacts)
      .where(compileDefinition(segmentDefinition.parse(segment.definition)))
      .orderBy(asc(contacts.name))
      .limit(input.limit);
  },
});

/**
 * Freeze a segment's membership (C7.04's static mode).
 *
 * Separate from saving on purpose. A campaign captures its audience the moment
 * it sends, so "who received the March email" is answerable in April even
 * though half of them have since become customers.
 */
export const captureSegment = defineService({
  name: "segments.capture",
  summary: "Freeze who is in a segment, so the answer stops moving.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid, count: z.number().int(), capturedAt: timestamp }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [segment] = await ctx.tx
      .select()
      .from(segments)
      .where(eq(segments.id, input.id))
      .limit(1);
    if (!segment) throw new ServiceError("not_found", "That segment is not here.");
    if (segment.kind === "static") {
      throw new ServiceError(
        "conflict",
        "That segment has already been captured. Freezing it again would rewrite who it says it went to.",
      );
    }

    const matched = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(compileDefinition(segmentDefinition.parse(segment.definition)));
    const capturedAt = new Date();
    if (matched.length > 0) {
      await ctx.tx
        .insert(segmentMembers)
        .values(matched.map((c) => ({ segmentId: segment.id, contactId: c.id, capturedAt })));
    }
    await ctx.tx
      .update(segments)
      .set({
        kind: "static",
        capturedAt,
        memberCountCached: matched.length,
        lastEvaluatedAt: capturedAt,
        updatedAt: sql`now()`,
      })
      .where(eq(segments.id, segment.id));

    ctx.setSubject("segment", segment.id);
    ctx.queueEvent("segment.captured", { id: segment.id, count: matched.length });
    return { id: segment.id, count: matched.length, capturedAt };
  },
});

/**
 * Why this person is, or is not, in this segment (C7.04's explainability).
 *
 * Each rule is run on its own against the one contact, so the answer is the
 * query itself rather than a description of it. That matters because the moment
 * somebody asks "why did they get this email" is exactly the moment a
 * plausible-but-wrong explanation does damage.
 */
export const explainMembership = defineService({
  name: "segments.why",
  summary: "Why somebody is or is not in a segment, rule by rule.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: id.optional(), slug: z.string().trim().max(120).optional(), contactId: id }),
  output: row({
    member: z.boolean(),
    match: z.enum(["all", "any"]),
    reasons: listed(
      row({
        field: z.string(),
        label: z.string(),
        op: z.string(),
        value: z.string(),
        passed: z.boolean(),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const segment = await findSegment(ctx.tx, input);
    const definition = segmentDefinition.parse(segment.definition);

    if (segment.kind === "static") {
      // A frozen segment's honest answer is "they were in it when it was
      // taken". Re-running the rules would explain today's world, not the one
      // the campaign actually went out into.
      const [found] = await ctx.tx
        .select({ contactId: segmentMembers.contactId })
        .from(segmentMembers)
        .where(
          and(
            eq(segmentMembers.segmentId, segment.id),
            eq(segmentMembers.contactId, input.contactId),
          ),
        )
        .limit(1);
      return {
        member: Boolean(found),
        match: definition.match,
        reasons: [
          {
            field: "segment.captured",
            label: "Captured membership",
            op: "is",
            value: segment.capturedAt?.toISOString() ?? "",
            passed: Boolean(found),
          },
        ],
      };
    }

    const reasons = [];
    for (const rule of definition.rules) {
      const field = segmentField(rule.field);
      const passed = await matchesOne(ctx.tx, input.contactId, compileRule(rule));
      reasons.push({
        field: rule.field,
        label: field?.label ?? rule.field,
        op: rule.op,
        value: describeValue(rule.value),
        passed,
      });
    }
    const member =
      definition.match === "any"
        ? reasons.some((reason) => reason.passed)
        : reasons.every((reason) => reason.passed);
    return { member, match: definition.match, reasons };
  },
});

/**
 * Does one contact match this segment?
 *
 * The narrow question a price list asks for one shopper, answered without
 * materialising an audience. Every consumer that decides something *about one
 * person* uses this rather than pulling the whole membership and searching it.
 */
export const contactInSegment = defineService({
  name: "segments.contains",
  summary: "Whether one contact is in one segment.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: id.optional(), slug: z.string().trim().max(120).optional(), contactId: id }),
  output: row({ member: z.boolean() }),
  handler: async (input, ctx) => {
    const segment = await findSegment(ctx.tx, input);
    if (segment.kind === "static") {
      const [found] = await ctx.tx
        .select({ contactId: segmentMembers.contactId })
        .from(segmentMembers)
        .where(
          and(
            eq(segmentMembers.segmentId, segment.id),
            eq(segmentMembers.contactId, input.contactId),
          ),
        )
        .limit(1);
      return { member: Boolean(found) };
    }
    const condition = compileDefinition(segmentDefinition.parse(segment.definition));
    return { member: await matchesOne(ctx.tx, input.contactId, condition) };
  },
});

async function findSegment(tx: Tx, input: { id?: string; slug?: string }) {
  if (!input.id && !input.slug) {
    throw new ServiceError("validation", "Say which segment.");
  }
  const [segment] = await tx
    .select()
    .from(segments)
    .where(input.id ? eq(segments.id, input.id) : eq(segments.slug, input.slug!))
    .limit(1);
  if (!segment) throw new ServiceError("not_found", "That segment is not here.");
  return segment;
}

async function countMatching(tx: Tx, condition: SQL): Promise<number> {
  const [counted] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(condition);
  return counted?.n ?? 0;
}

async function matchesOne(tx: Tx, contactId: string, condition: SQL): Promise<boolean> {
  const [found] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), condition))
    .limit(1);
  return Boolean(found);
}

/**
 * What a rule was asked, in words, for the explanation.
 *
 * `value` is deliberately `unknown` — each field decides what it means — so
 * anything that is not a primitive or a list is shown as JSON rather than as
 * "[object Object]", which is the shape of an explanation nobody can act on.
 */
function describeValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(describeValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "segment"
  );
}

/**
 * The name is already taken.
 *
 * Detected by the driver's error code rather than by reading the message: the
 * ORM wraps the failure and the index name is not reliably in the text it
 * produces, which is how a "conflict" quietly becomes a stack trace in front of
 * an owner.
 */
function slugTaken(error: unknown): unknown {
  return isUniqueViolation(error, "segments_slug_idx")
    ? new ServiceError("conflict", "A segment already goes by that name.")
    : error;
}

/**
 * Merge repoints a captured membership (§4.1).
 *
 * Only static segments have rows: a dynamic one re-answers itself the moment
 * the survivor is read. Registered through the same list every other table
 * uses, because a table missing from it orphans rows the first time an owner
 * merges two duplicates.
 */
registerContactReference({
  table: "segment_members",
  repoint: async (tx, duplicateId, survivingId) => {
    // The survivor may already be in the same captured segment; the primary key
    // says one row per pair, so the duplicate's row is dropped rather than
    // colliding.
    await tx
      .insert(segmentMembers)
      .select(
        tx
          .select({
            segmentId: segmentMembers.segmentId,
            contactId: sql<string>`${survivingId}::uuid`.as("contact_id"),
            capturedAt: segmentMembers.capturedAt,
          })
          .from(segmentMembers)
          .where(eq(segmentMembers.contactId, duplicateId)),
      )
      .onConflictDoNothing();
    await tx.delete(segmentMembers).where(eq(segmentMembers.contactId, duplicateId));
  },
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ segmentId: segmentMembers.segmentId, contactId: segmentMembers.contactId })
      .from(segmentMembers)
      .where(inArray(segmentMembers.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z
      .array(z.object({ segmentId: z.string().uuid(), contactId: z.string().uuid() }))
      .parse(beforeState)
      .filter((entry) => entry.contactId === duplicateId);
    for (const entry of rows) {
      await tx
        .insert(segmentMembers)
        .values({ segmentId: entry.segmentId, contactId: entry.contactId })
        .onConflictDoNothing();
    }
  },
});

/**
 * What a segment means for the person's own data (§30).
 *
 * A captured membership *is* personal data — it records that this person was
 * sent something — so erasure removes them from every frozen list. The segments
 * themselves are the business's own definitions and survive; their counts do
 * not change, because a count of what was sent in March is a record of what the
 * business did.
 */
registerContactPrivacySource({
  scope: "contact.segments",
  tables: ["segment_members"],
  exportData: async (tx, contactId) =>
    tx
      .select({
        segmentId: segmentMembers.segmentId,
        name: segments.name,
        capturedAt: segmentMembers.capturedAt,
      })
      .from(segmentMembers)
      .innerJoin(segments, eq(segments.id, segmentMembers.segmentId))
      .where(eq(segmentMembers.contactId, contactId)),
  erase: async (tx, contactId) => {
    const removed = await tx
      .delete(segmentMembers)
      .where(eq(segmentMembers.contactId, contactId))
      .returning({ segmentId: segmentMembers.segmentId });
    return { affected: removed.length };
  },
});

export default [
  listSegmentFields,
  saveSegment,
  listSegments,
  removeSegment,
  previewSegment,
  segmentMembership,
  captureSegment,
  explainMembership,
  contactInSegment,
];
