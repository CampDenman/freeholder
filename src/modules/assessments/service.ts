// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Assessment services (MASTER.md §4.18, C8.14).
//
// Read `respond` first: it is the whole argument. It takes answers, adds up
// scores the owner set, looks up the band the owner wrote, and returns that
// band's text. There is no branch in it that produces a sentence. The nearest
// thing to a judgement it makes is choosing *which* authored row to return,
// and even that choice is unambiguous because the database refuses overlapping
// bands.
//
// The other half of the guarantee lives in `publish`. A band set with a gap in
// it would eventually hand somebody a score matching nothing, and at that
// moment the only options are to invent something or to fail in front of a
// visitor. So publishing is refused until the bands cover every score the
// questions can reach — a refusal an owner sees while editing, instead of a
// stranger seeing it mid-enquiry.
import { z } from "zod";
import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, lte, gte, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { isUniqueViolation } from "@/core/db";
import { violates } from "@/core/db/errors";
import { consumeAccepted } from "@/core/security/rate-limit";
import {
  registerContactReference,
  resolveContact,
} from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { withoutHoldCascade } from "@/core/retention/holds";
import { makeTrashServices } from "@/core/trash";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
} from "@/core/onboarding/contract";
import { requireDemoHandlerRun } from "@/core/demo/handler";
import {
  assessments,
  assessmentBands,
  assessmentEscalations,
  assessmentResponses,
} from "./schema";
import {
  duplicateQuestionKeys,
  questionsSchema,
  reachableScoreRange,
  type AssessmentQuestion,
} from "./questions";
import { answersSchema, coverageGaps, describeGaps, scoreAnswers } from "./scoring";

/*
 * The spine obligations for `assessment_responses.contact_id`.
 *
 * CLAUDE.md's non-negotiable is blunt about why the first one exists: merge is
 * a hand-maintained list, and a table missing from it orphans rows the first
 * time an owner merges two duplicates. The second is the erasure counterpart —
 * what a person told this business about themselves is theirs to withdraw.
 *
 * Erasure clears the answers and the source URL but keeps the score and the
 * band. The business is entitled to know that somebody scored into "urgent"
 * and was told to call; it is not entitled to keep the answers once the person
 * has asked for them to go.
 */
registerContactReference({
  table: "assessment_responses",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(assessmentResponses)
      .set({ contactId: survivingId })
      .where(eq(assessmentResponses.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: assessmentResponses.id, contactId: assessmentResponses.contactId })
      .from(assessmentResponses)
      .where(inArray(assessmentResponses.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(
      z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }),
    );
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: assessmentResponses.id, contactId: assessmentResponses.contactId })
          .from(assessmentResponses)
          .where(inArray(assessmentResponses.id, after.map((row) => row.id)))
      : [];
    const byId = new Map(current.map((row) => [row.id, row.contactId]));
    if (
      current.length !== after.length ||
      after.some((row) => byId.get(row.id) !== row.contactId)
    ) {
      throw new ServiceError(
        "conflict",
        "An assessment response changed after this merge. Leave the merge in place or restore that response first.",
      );
    }
    const moved = before.filter((row) => row.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(assessmentResponses)
        .set({ contactId: duplicateId })
        .where(inArray(assessmentResponses.id, moved.map((row) => row.id)));
    }
  },
});

registerContactPrivacySource({
  scope: "assessments.responses",
  tables: ["assessment_responses"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(assessmentResponses)
      .where(eq(assessmentResponses.contactId, contactId))
      .orderBy(assessmentResponses.createdAt),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(assessmentResponses)
      .set({ answers: {}, sourceUrl: null })
      .where(eq(assessmentResponses.contactId, contactId))
      .returning({ id: assessmentResponses.id });
    return { affected: rows.length };
  },
});

const slug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case letters, digits and hyphens.");

const assessmentRow = row({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  intro: z.string().nullable(),
  questions: z.array(z.unknown()),
  destination: z.enum(["contact", "none"]),
  notify: z.array(z.string()),
  status: z.enum(["draft", "active", "closed"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const bandRow = row({
  id: uuid,
  assessmentId: uuid,
  key: z.string(),
  label: z.string(),
  body: z.string(),
  minScore: z.number().int(),
  maxScore: z.number().int(),
  ordinal: z.number().int(),
});

const escalationRow = row({
  id: uuid,
  assessmentId: uuid,
  questionKey: z.string(),
  optionKey: z.string(),
  instruction: z.string(),
  ordinal: z.number().int(),
});

/* ------------------------------------------------------------ the definition */

/** The assessment, or the refusal. Trashed rows are gone as far as callers go. */
async function liveAssessment(ctx: { tx: Tx }, id: string) {
  const [found] = await ctx.tx
    .select()
    .from(assessments)
    .where(and(eq(assessments.id, id), isNull(assessments.trashedAt)))
    .limit(1);
  if (!found) throw new ServiceError("not_found", "That assessment is gone.");
  return found;
}

export const listAssessments = defineService({
  name: "assessments.list",
  summary: "Every assessment, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(assessmentRow),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(assessments)
      .where(isNull(assessments.trashedAt))
      .orderBy(desc(assessments.createdAt));
    return rows;
  },
});

export const getAssessment = defineService({
  name: "assessments.get",
  summary: "One assessment with its bands and escalation rules.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: uuid }),
  output: assessmentRow.extend({
    bands: z.array(bandRow),
    escalations: z.array(escalationRow),
    responseCount: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const found = await liveAssessment(ctx, input.id);
    const bands = await ctx.tx
      .select()
      .from(assessmentBands)
      .where(eq(assessmentBands.assessmentId, found.id))
      .orderBy(asc(assessmentBands.minScore));
    const escalations = await ctx.tx
      .select()
      .from(assessmentEscalations)
      .where(eq(assessmentEscalations.assessmentId, found.id))
      .orderBy(asc(assessmentEscalations.ordinal));
    const [counted] = await ctx.tx
      .select({ value: count() })
      .from(assessmentResponses)
      .where(eq(assessmentResponses.assessmentId, found.id));
    return { ...found, bands, escalations, responseCount: counted?.value ?? 0 };
  },
});

export const createAssessment = defineService({
  name: "assessments.create",
  summary: "Add an assessment. It starts as a draft and publishes separately.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    slug,
    name: z.string().min(1).max(120),
    intro: z.string().max(2000).optional(),
    questions: questionsSchema.default([]),
    destination: z.enum(["contact", "none"]).default("contact"),
    notify: z.array(z.string().email()).default([]),
  }),
  output: assessmentRow,
  handler: async (input, ctx) => {
    const dupes = duplicateQuestionKeys(input.questions);
    if (dupes.length) {
      throw new ServiceError(
        "validation",
        `Repeated keys make an answer ambiguous: ${dupes.join(", ")}.`,
      );
    }
    const [created] = await ctx.tx
      .insert(assessments)
      .values({
        slug: input.slug,
        name: input.name,
        intro: input.intro ?? null,
        questions: input.questions,
        destination: input.destination,
        notify: input.notify,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ServiceError(
            "conflict",
            `There is already an assessment at "${input.slug}".`,
          );
        }
        throw error;
      });
    ctx.setSubject("assessment", created!.id);
    return created!;
  },
});

export const updateAssessment = defineService({
  name: "assessments.update",
  summary: "Change an assessment's wording, questions or routing.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuid,
    name: z.string().min(1).max(120).optional(),
    intro: z.string().max(2000).nullable().optional(),
    questions: questionsSchema.optional(),
    destination: z.enum(["contact", "none"]).optional(),
    notify: z.array(z.string().email()).optional(),
  }),
  output: assessmentRow,
  handler: async (input, ctx) => {
    const found = await liveAssessment(ctx, input.id);
    if (input.questions) {
      const dupes = duplicateQuestionKeys(input.questions);
      if (dupes.length) {
        throw new ServiceError(
          "validation",
          `Repeated keys make an answer ambiguous: ${dupes.join(", ")}.`,
        );
      }
      // Changing the questions changes the reachable range, so an assessment
      // that is already taking responses has to be re-proved rather than
      // quietly drifting into a gap.
      if (found.status === "active") {
        const bands = await ctx.tx
          .select()
          .from(assessmentBands)
          .where(eq(assessmentBands.assessmentId, found.id));
        const gaps = coverageGaps(bands, reachableScoreRange(input.questions));
        if (gaps.length) {
          throw new ServiceError(
            "validation",
            `These questions can produce scores no band covers (${describeGaps(gaps)}). Close the assessment or add a band first.`,
          );
        }
      }
    }
    const [updated] = await ctx.tx
      .update(assessments)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.intro === undefined ? {} : { intro: input.intro }),
        ...(input.questions === undefined ? {} : { questions: input.questions }),
        ...(input.destination === undefined ? {} : { destination: input.destination }),
        ...(input.notify === undefined ? {} : { notify: input.notify }),
        updatedAt: new Date(),
      })
      .where(eq(assessments.id, found.id))
      .returning();
    ctx.setSubject("assessment", found.id);
    return updated!;
  },
});

/* ------------------------------------------------------------------- bands */

export const saveBand = defineService({
  name: "assessments.saveBand",
  summary: "Write one outcome band. This text is what a respondent is shown.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    assessmentId: uuid,
    id: uuid.optional(),
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, "Use lower-case letters, digits and underscores."),
    label: z.string().min(1).max(120),
    body: z.string().min(1).max(4000),
    minScore: z.number().int().min(-40000).max(40000),
    maxScore: z.number().int().min(-40000).max(40000),
    ordinal: z.number().int().min(0).max(1000).default(0),
  }),
  output: bandRow,
  handler: async (input, ctx) => {
    const found = await liveAssessment(ctx, input.assessmentId);
    if (input.maxScore < input.minScore) {
      throw new ServiceError("validation", "A band's top score cannot be below its bottom.");
    }
    const values = {
      assessmentId: found.id,
      key: input.key,
      label: input.label,
      body: input.body,
      minScore: input.minScore,
      maxScore: input.maxScore,
      ordinal: input.ordinal,
      updatedAt: new Date(),
    };
    const saved = await (input.id
      ? ctx.tx
          .update(assessmentBands)
          .set(values)
          .where(
            and(
              eq(assessmentBands.id, input.id),
              eq(assessmentBands.assessmentId, found.id),
            ),
          )
          .returning()
      : ctx.tx.insert(assessmentBands).values(values).returning()
    ).catch((error: unknown) => {
      // The exclusion constraint speaks in Postgres; an owner needs the
      // sentence that tells them what to change. Drizzle wraps the driver
      // error, so the constraint name is found by walking `.cause` — which is
      // exactly what `violates` exists to do.
      if (violates(error, "assessment_bands_no_overlap")) {
        throw new ServiceError(
          "conflict",
          `Scores ${input.minScore} to ${input.maxScore} overlap a band that already exists. Two bands covering one score would make the outcome depend on row order.`,
        );
      }
      if (isUniqueViolation(error)) {
        throw new ServiceError("conflict", `This assessment already has a band called "${input.key}".`);
      }
      throw error;
    });
    const band = saved[0];
    if (!band) throw new ServiceError("not_found", "That band is gone.");
    ctx.setSubject("assessment", found.id);
    return band;
  },
});

export const deleteBand = defineService({
  name: "assessments.deleteBand",
  summary: "Remove an outcome band.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ assessmentId: uuid, id: uuid }),
  output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    const found = await liveAssessment(ctx, input.assessmentId);
    // The foreign key would refuse this anyway; catching it here turns a
    // constraint violation into a sentence that explains why the refusal is
    // the point — somebody was told this, and that record stands.
    const [used] = await ctx.tx
      .select({ value: count() })
      .from(assessmentResponses)
      .where(eq(assessmentResponses.bandId, input.id));
    if ((used?.value ?? 0) > 0) {
      throw new ServiceError(
        "conflict",
        `${used!.value} ${used!.value === 1 ? "person has" : "people have"} already been shown this outcome, so it cannot be deleted. Re-word it instead.`,
      );
    }
    await ctx.tx
      .delete(assessmentBands)
      .where(
        and(eq(assessmentBands.id, input.id), eq(assessmentBands.assessmentId, found.id)),
      );
    ctx.setSubject("assessment", found.id);
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------- escalations */

export const saveEscalation = defineService({
  name: "assessments.saveEscalation",
  summary: "An answer that outranks the score, with the instruction to show.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    assessmentId: uuid,
    id: uuid.optional(),
    questionKey: z.string().min(1).max(40),
    optionKey: z.string().min(1).max(40),
    instruction: z.string().min(1).max(2000),
    ordinal: z.number().int().min(0).max(1000).default(0),
  }),
  output: escalationRow,
  handler: async (input, ctx) => {
    const found = await liveAssessment(ctx, input.assessmentId);
    const questions = found.questions as AssessmentQuestion[];
    const question = questions.find((candidate) => candidate.key === input.questionKey);
    if (!question) {
      throw new ServiceError("validation", `There is no question called "${input.questionKey}".`);
    }
    if (!question.options.some((option) => option.key === input.optionKey)) {
      throw new ServiceError(
        "validation",
        `"${input.questionKey}" has no answer called "${input.optionKey}". An escalation nobody can trigger is worse than none.`,
      );
    }
    const values = {
      assessmentId: found.id,
      questionKey: input.questionKey,
      optionKey: input.optionKey,
      instruction: input.instruction,
      ordinal: input.ordinal,
      updatedAt: new Date(),
    };
    const saved = await (input.id
      ? ctx.tx
          .update(assessmentEscalations)
          .set(values)
          .where(
            and(
              eq(assessmentEscalations.id, input.id),
              eq(assessmentEscalations.assessmentId, found.id),
            ),
          )
          .returning()
      : ctx.tx.insert(assessmentEscalations).values(values).returning()
    ).catch((error: unknown) => {
      if (isUniqueViolation(error)) {
        throw new ServiceError(
          "conflict",
          "That answer already escalates. One instruction per answer, so which one shows is never a guess.",
        );
      }
      throw error;
    });
    const escalation = saved[0];
    if (!escalation) throw new ServiceError("not_found", "That escalation rule is gone.");
    ctx.setSubject("assessment", found.id);
    return escalation;
  },
});

export const deleteEscalation = defineService({
  name: "assessments.deleteEscalation",
  summary: "Remove an escalation rule.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ assessmentId: uuid, id: uuid }),
  output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    const found = await liveAssessment(ctx, input.assessmentId);
    const [used] = await ctx.tx
      .select({ value: count() })
      .from(assessmentResponses)
      .where(eq(assessmentResponses.escalationId, input.id));
    if ((used?.value ?? 0) > 0) {
      throw new ServiceError(
        "conflict",
        `${used!.value} ${used!.value === 1 ? "person was" : "people were"} shown this instruction, so it cannot be deleted. Re-word it instead.`,
      );
    }
    await ctx.tx
      .delete(assessmentEscalations)
      .where(
        and(
          eq(assessmentEscalations.id, input.id),
          eq(assessmentEscalations.assessmentId, found.id),
        ),
      );
    ctx.setSubject("assessment", found.id);
    return { ok: true as const };
  },
});

/* --------------------------------------------------------- publish / close */

export const publishAssessment = defineService({
  name: "assessments.publish",
  summary: "Open an assessment to visitors, once its bands cover every score.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid }),
  output: assessmentRow,
  handler: async (input, ctx) => {
    const found = await liveAssessment(ctx, input.id);
    const questions = found.questions as AssessmentQuestion[];
    if (!questions.length) {
      throw new ServiceError("validation", "An assessment needs at least one question.");
    }
    const bands = await ctx.tx
      .select()
      .from(assessmentBands)
      .where(eq(assessmentBands.assessmentId, found.id));
    if (!bands.length) {
      throw new ServiceError(
        "validation",
        "An assessment needs at least one outcome band. The band is the answer — without one there is nothing to say.",
      );
    }
    const range = reachableScoreRange(questions);
    const gaps = coverageGaps(bands, range);
    if (gaps.length) {
      throw new ServiceError(
        "validation",
        `These questions can produce scores no band covers (${describeGaps(gaps)}). Every reachable score needs an authored outcome, or somebody eventually gets none.`,
      );
    }
    const [updated] = await ctx.tx
      .update(assessments)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(assessments.id, found.id))
      .returning();
    ctx.setSubject("assessment", found.id);
    ctx.queueEvent("assessment.published", { assessmentId: found.id, slug: found.slug });
    return updated!;
  },
});

export const closeAssessment = defineService({
  name: "assessments.close",
  summary: "Stop accepting responses. Existing responses are kept.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid }),
  output: assessmentRow,
  handler: async (input, ctx) => {
    const found = await liveAssessment(ctx, input.id);
    const [updated] = await ctx.tx
      .update(assessments)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(assessments.id, found.id))
      .returning();
    ctx.setSubject("assessment", found.id);
    ctx.queueEvent("assessment.closed", { assessmentId: found.id, slug: found.slug });
    return updated!;
  },
});

/* ------------------------------------------------------------- responding */

/**
 * What a visitor is allowed to know before answering.
 *
 * Bands come back too, because the public block renders the outcome from the
 * band the response names rather than from anything in the URL (§5 keeps the
 * surface server-rendered, and the action doctrine keeps messages out of query
 * strings). They are authored public content on that page in any case.
 */
export const getPublicAssessment = defineService({
  name: "assessments.getPublic",
  summary: "An assessment as a visitor sees it, or nothing.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  output: z
    .object({
      id: uuid,
      slug: z.string(),
      name: z.string(),
      intro: z.string().nullable(),
      status: z.enum(["draft", "active", "closed"]),
      questions: z.array(z.unknown()),
      bands: z.array(z.object({ key: z.string(), label: z.string(), body: z.string() })),
      escalations: z.array(z.object({ id: uuid, instruction: z.string() })),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(assessments)
      .where(and(eq(assessments.slug, input.slug), isNull(assessments.trashedAt)))
      .limit(1);
    if (!found) return null;
    const bands = await ctx.tx
      .select({
        key: assessmentBands.key,
        label: assessmentBands.label,
        body: assessmentBands.body,
      })
      .from(assessmentBands)
      .where(eq(assessmentBands.assessmentId, found.id))
      .orderBy(asc(assessmentBands.minScore));
    const escalations = await ctx.tx
      .select({
        id: assessmentEscalations.id,
        instruction: assessmentEscalations.instruction,
      })
      .from(assessmentEscalations)
      .where(eq(assessmentEscalations.assessmentId, found.id));
    return {
      id: found.id,
      slug: found.slug,
      name: found.name,
      intro: found.intro,
      status: found.status,
      questions: found.questions as unknown[],
      bands,
      escalations,
    };
  },
});

export const respond = defineService({
  name: "assessments.respond",
  summary: "Answer an assessment and receive the outcome its owner wrote.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    slug,
    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    /**
     * Optional, and separate from the answers on purpose: questions are
     * closed-ended so they can be scored, and a name is not.
     */
    respondent: z
      .object({
        email: z.string().email().optional(),
        name: z.string().max(120).optional(),
      })
      .optional(),
    /**
     * The nonce the page was rendered with. A retry carrying the same key
     * resolves to the answer already stored rather than producing a second.
     */
    idempotencyKey: z.string().min(1).max(200).optional(),
    sourceUrl: z.string().max(2000).optional(),
  }),
  output: z.object({
    ok: z.literal(true),
    responseId: uuid,
    /** True when this call resolved to an answer a previous post had stored. */
    repeat: z.boolean(),
    score: z.number().int(),
    band: z.object({ key: z.string(), label: z.string(), body: z.string() }),
    /** Present when an answer escalated. Shown above the band, never instead of it. */
    escalation: z.object({ id: uuid, instruction: z.string() }).nullable(),
  }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(assessments)
      .where(and(eq(assessments.slug, input.slug), isNull(assessments.trashedAt)))
      .limit(1);
    if (!found) throw new ServiceError("not_found", "That assessment no longer exists.");
    if (found.status !== "active") {
      throw new ServiceError("validation", "This assessment is not accepting responses.");
    }

    // Before the rate limiter, deliberately: a retry is the honest case this
    // exists for, and throttling it would turn a flaky connection into a
    // refusal for somebody who already answered.
    if (input.idempotencyKey) {
      const prior = await priorResponse(ctx, found.id, input.idempotencyKey);
      if (prior) return prior;
    }

    const questions = found.questions as AssessmentQuestion[];
    const parsed = answersSchema(questions).safeParse(input.answers);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ServiceError("validation", first?.message ?? "Some answers need another look.");
    }
    const answers = parsed.data as Record<string, string | string[] | undefined>;

    // C11.10: one visitor cannot exhaust the assessment for everybody. Keyed
    // on the address when there is one, else the answers themselves, so a
    // repeated identical submission throttles and two different people do not.
    if (ctx.actor.kind !== "system") {
      const identity =
        ctx.actor.kind === "user"
          ? `user:${ctx.actor.userId}`
          : (ctx.actor.request?.trustedIp ??
            input.respondent?.email?.trim().toLowerCase() ??
            JSON.stringify(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))));
      const verdict = await consumeAccepted(
        ctx.tx,
        `assessments.respond:${found.id}:${createHash("sha256").update(identity).digest("hex")}`,
        { limit: 20, windowSeconds: 10 * 60 },
      );
      if (!verdict.allowed) {
        throw new ServiceError("rate_limited", "Too many attempts. Try again shortly.", verdict.retryAfterSeconds);
      }
    }

    const score = scoreAnswers(questions, answers);

    // At most one band can match, because the database refuses overlaps.
    const [band] = await ctx.tx
      .select()
      .from(assessmentBands)
      .where(
        and(
          eq(assessmentBands.assessmentId, found.id),
          lte(assessmentBands.minScore, score),
          gte(assessmentBands.maxScore, score),
        ),
      )
      .limit(1);
    if (!band) {
      // `publish` proves this cannot happen, so reaching it means the bands
      // were changed underneath a live assessment. Refuse rather than
      // improvise: there is no safe sentence to say here.
      throw new ServiceError(
        "conflict",
        "This assessment cannot be answered right now. Nobody has been told anything incorrect.",
      );
    }

    const escalation = await firstEscalation(ctx, found.id, questions, answers);

    let contactId: string | null = null;
    const email = input.respondent?.email?.trim();
    if (found.destination === "contact" && email) {
      // §4.1's identity rule on an anonymous path: `resolve`, not `create`,
      // through the one greppable elevation.
      const resolved = await ctx.callAsSystem(resolveContact, {
        email,
        name: input.respondent?.name,
        source: `assessment:${found.slug}`,
      });
      contactId = resolved.contact.id;
    }

    const inserted = await ctx.tx
      .insert(assessmentResponses)
      .values({
        assessmentId: found.id,
        contactId,
        answers,
        score,
        bandId: band.id,
        escalationId: escalation?.id ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        sourceUrl: input.sourceUrl,
      })
      // Two posts of the same key at once: one wins the unique index and the
      // other must read the winner's answer. `onConflictDoNothing` rather than
      // catching the violation, because a constraint error aborts the whole
      // transaction — the re-read below would then fail too, and the person
      // who merely double-clicked would see an error for doing nothing wrong.
      .onConflictDoNothing()
      .returning();
    const response = inserted[0];
    if (!response) {
      const prior = input.idempotencyKey
        ? await priorResponse(ctx, found.id, input.idempotencyKey)
        : null;
      if (prior) return prior;
      throw new ServiceError("conflict", "That answer could not be stored. Try again.");
    }

    ctx.setSubject("assessment_response", response.id);

    if (contactId) {
      await ctx.emitTimeline({
        contactId,
        eventType: "assessment.responded",
        subjectType: "assessment_response",
        subjectId: response.id,
        payload: { assessment: found.slug, name: found.name, band: band.label },
      });
    }
    ctx.queueEvent("assessment.responded", {
      assessmentId: found.id,
      responseId: response.id,
      contactId,
      bandKey: band.key,
    });
    if (escalation) {
      // A separate event because it needs separate handling: an owner who
      // wants a text message when somebody reports gas should not have to
      // filter every response to find it.
      ctx.queueEvent("assessment.escalated", {
        assessmentId: found.id,
        responseId: response.id,
        contactId,
        questionKey: escalation.questionKey,
        optionKey: escalation.optionKey,
      });
    }

    return {
      ok: true as const,
      responseId: response.id,
      repeat: false,
      score,
      band: { key: band.key, label: band.label, body: band.body },
      escalation: escalation
        ? { id: escalation.id, instruction: escalation.instruction }
        : null,
    };
  },
});

/**
 * The answer a previous post with this key already stored.
 *
 * Returns the whole outcome, not just the id, because a retry has to be shown
 * exactly what the first attempt was shown. Re-deriving it from the score
 * would risk a different answer if a band moved in between, and "you were told
 * something else a minute ago" is the failure this is meant to prevent.
 */
async function priorResponse(ctx: { tx: Tx }, assessmentId: string, key: string) {
  const [prior] = await ctx.tx
    .select({
      id: assessmentResponses.id,
      score: assessmentResponses.score,
      bandKey: assessmentBands.key,
      bandLabel: assessmentBands.label,
      bandBody: assessmentBands.body,
      escalationId: assessmentResponses.escalationId,
    })
    .from(assessmentResponses)
    .innerJoin(assessmentBands, eq(assessmentResponses.bandId, assessmentBands.id))
    .where(
      and(
        eq(assessmentResponses.assessmentId, assessmentId),
        eq(assessmentResponses.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (!prior) return null;

  let instruction: string | null = null;
  if (prior.escalationId) {
    const [rule] = await ctx.tx
      .select({ instruction: assessmentEscalations.instruction })
      .from(assessmentEscalations)
      .where(eq(assessmentEscalations.id, prior.escalationId))
      .limit(1);
    instruction = rule?.instruction ?? null;
  }
  return {
    ok: true as const,
    responseId: prior.id,
    repeat: true,
    score: prior.score,
    band: { key: prior.bandKey, label: prior.bandLabel, body: prior.bandBody },
    escalation:
      prior.escalationId && instruction
        ? { id: prior.escalationId, instruction }
        : null,
  };
}

/** The lowest-ordinal escalation any given answer triggers, or nothing. */
async function firstEscalation(
  ctx: { tx: Tx },
  assessmentId: string,
  questions: AssessmentQuestion[],
  answers: Record<string, string | string[] | undefined>,
) {
  const rules = await ctx.tx
    .select()
    .from(assessmentEscalations)
    .where(eq(assessmentEscalations.assessmentId, assessmentId))
    .orderBy(asc(assessmentEscalations.ordinal));
  for (const rule of rules) {
    const answer = answers[rule.questionKey];
    if (answer === undefined) continue;
    const chosen = Array.isArray(answer) ? answer : [answer];
    if (chosen.includes(rule.optionKey)) return rule;
  }
  return null;
}

export const listResponses = defineService({
  name: "assessments.responses",
  summary: "What people answered, and what they were told.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    assessmentId: uuid,
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(
    row({
      id: uuid,
      contactId: uuid.nullable(),
      score: z.number().int(),
      bandLabel: z.string(),
      escalated: z.boolean(),
      createdAt: timestamp,
    }),
  ),
  handler: async (input, ctx) => {
    await liveAssessment(ctx, input.assessmentId);
    const rows = await ctx.tx
      .select({
        id: assessmentResponses.id,
        contactId: assessmentResponses.contactId,
        score: assessmentResponses.score,
        bandLabel: assessmentBands.label,
        escalationId: assessmentResponses.escalationId,
        createdAt: assessmentResponses.createdAt,
      })
      .from(assessmentResponses)
      .innerJoin(assessmentBands, eq(assessmentResponses.bandId, assessmentBands.id))
      .where(eq(assessmentResponses.assessmentId, input.assessmentId))
      .orderBy(desc(assessmentResponses.createdAt))
      .limit(input.limit);
    // `escalated` rather than the id: whether an answer escalated is what a
    // queue needs to triage on, and the rule it matched is on the response.
    return rows.map((response) => {
      const { escalationId, ...rest } = response;
      return { ...rest, escalated: escalationId !== null };
    });
  },
});


/* -------------------------------------------------------------------- demo */

/**
 * The demo assessment: a heating triage.
 *
 * Chosen because it shows the two things that are hard to explain in prose —
 * an answer that outranks the score, and an outcome nobody composed. A visitor
 * who says they can smell gas is told to leave the building whatever else they
 * answered, and every word of that is a row somebody could edit.
 */
const DEMO_ASSESSMENT = {
  en: {
    name: "[Demo] Heating check",
    intro: "Two questions. We will tell you what we would do next.",
    symptom: "What is happening?",
    noHeat: "No heat at all",
    noise: "An unusual noise",
    gas: "I can smell gas",
    age: "Roughly how old is the system?",
    newSystem: "Under five years",
    oldSystem: "Over fifteen years",
    routine: "Routine",
    routineBody: "Book a routine visit. Nothing here suggests it cannot wait.",
    urgent: "Urgent",
    urgentBody: "Call us today. We keep same-day slots for this.",
    escalation: "Leave the building, then call the gas emergency line. Do not touch switches.",
  },
  es: {
    name: "[Demo] Revisión de calefacción",
    intro: "Dos preguntas. Te diremos qué haríamos a continuación.",
    symptom: "¿Qué está pasando?",
    noHeat: "No hay calefacción",
    noise: "Un ruido extraño",
    gas: "Huelo a gas",
    age: "¿Qué antigüedad tiene el sistema?",
    newSystem: "Menos de cinco años",
    oldSystem: "Más de quince años",
    routine: "Rutinario",
    routineBody: "Reserva una visita de rutina. Nada aquí indica que no pueda esperar.",
    urgent: "Urgente",
    urgentBody: "Llámanos hoy. Guardamos huecos para el mismo día.",
    escalation: "Sal del edificio y llama al servicio de emergencias de gas. No toques los interruptores.",
  },
  fr: {
    name: "[Demo] Vérification du chauffage",
    intro: "Deux questions. Nous vous dirons ce que nous ferions ensuite.",
    symptom: "Que se passe-t-il ?",
    noHeat: "Aucun chauffage",
    noise: "Un bruit inhabituel",
    gas: "Je sens du gaz",
    age: "Quel âge a l’installation ?",
    newSystem: "Moins de cinq ans",
    oldSystem: "Plus de quinze ans",
    routine: "Courant",
    routineBody: "Prenez un rendez-vous courant. Rien ici n’indique que cela ne peut pas attendre.",
    urgent: "Urgent",
    urgentBody: "Appelez-nous aujourd’hui. Nous gardons des créneaux le jour même.",
    escalation: "Sortez du bâtiment, puis appelez le numéro d’urgence gaz. N’actionnez aucun interrupteur.",
  },
} as const;

const DEMO_CONTRIBUTION = { key: "assessments.demo-assessment", version: 1 };
const DEMO_OUTCOME = "assessments.demo-assessment.visible";

export const loadDemoAssessment = defineService({
  name: "assessments.loadDemoFixture",
  summary: "Load the assessments contribution for a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, DEMO_CONTRIBUTION, "load");
    const copy = DEMO_ASSESSMENT[input.locale as keyof typeof DEMO_ASSESSMENT];
    if (!copy) throw new ServiceError("validation", "Unsupported demo locale.");

    const made = await ctx.callAsSystem(createAssessment, {
      slug: "freeholder-demo-heating-check",
      name: copy.name,
      intro: copy.intro,
      destination: "none",
      questions: [
        {
          key: "symptom",
          label: copy.symptom,
          kind: "single",
          required: true,
          options: [
            { key: "no_heat", label: copy.noHeat, score: 2 },
            { key: "noise", label: copy.noise, score: 1 },
            { key: "gas_smell", label: copy.gas, score: 5 },
          ],
        },
        {
          key: "age",
          label: copy.age,
          kind: "single",
          required: true,
          options: [
            { key: "new", label: copy.newSystem, score: 0 },
            { key: "old", label: copy.oldSystem, score: 2 },
          ],
        },
      ],
    });
    // Between them the bands cover every reachable score, so the demo can be
    // published — which is the point: a demo that would be refused would be
    // teaching the wrong lesson.
    await ctx.callAsSystem(saveBand, {
      assessmentId: made.id,
      key: "routine",
      label: copy.routine,
      body: copy.routineBody,
      minScore: 0,
      maxScore: 3,
    });
    await ctx.callAsSystem(saveBand, {
      assessmentId: made.id,
      key: "urgent",
      label: copy.urgent,
      body: copy.urgentBody,
      minScore: 4,
      maxScore: 7,
    });
    await ctx.callAsSystem(saveEscalation, {
      assessmentId: made.id,
      questionKey: "symptom",
      optionKey: "gas_smell",
      instruction: copy.escalation,
    });
    await ctx.callAsSystem(publishAssessment, { id: made.id });

    return demoLoadResultSchema.parse({
      records: [
        {
          fixtureKey: "demo-assessment",
          subjectType: "assessment",
          subjectId: made.id,
          label: made.name,
        },
      ],
    });
  },
});

export const purgeDemoAssessment = defineService({
  name: "assessments.purgeDemoFixture",
  summary: "Purge only assessments proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, DEMO_CONTRIBUTION, "purge");
    const purged: Array<{ subjectType: string; subjectId: string }> = [];
    for (const record of input.records) {
      if (record.fixtureKey !== "demo-assessment" || record.subjectType !== "assessment") {
        throw new ServiceError("validation", "Unexpected assessments demo provenance.");
      }
      // Responses restrict the delete, which is right everywhere except here:
      // these are answers somebody gave a demo, and the run that created them
      // is the run removing them. Bands and escalations cascade.
      await ctx.tx
        .delete(assessmentResponses)
        .where(eq(assessmentResponses.assessmentId, record.subjectId));
      await ctx.tx.delete(assessments).where(eq(assessments.id, record.subjectId));
      purged.push({ subjectType: record.subjectType, subjectId: record.subjectId });
    }
    return demoPurgeResultSchema.parse({ purged });
  },
});

export const verifyDemoAssessment = defineService({
  name: "assessments.verifyDemoFixture",
  summary: "Verify the visible assessments outcome for a tracked demo run.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, DEMO_CONTRIBUTION, "verify");
    const ids = input.records
      .filter((record) => record.subjectType === "assessment")
      .map((record) => record.subjectId);
    const [found] = ids.length
      ? await ctx.tx
          .select({
            slug: assessments.slug,
            name: assessments.name,
            status: assessments.status,
          })
          .from(assessments)
          .where(eq(assessments.id, ids[0]!))
          .limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: DEMO_OUTCOME,
          // Open, not merely present: a demo assessment nobody can answer
          // would prove the screen exists and nothing else.
          achieved:
            found?.slug === "freeholder-demo-heating-check" &&
            found.name.startsWith("[Demo]") &&
            found.status === "active",
          detail: found?.name,
        },
      ],
    });
  },
});

/* ------------------------------------------------------------------- trash */

const trash = makeTrashServices({
  family: "assessments",
  table: assessments,
  rowSchema: assessmentRow,
  subjectKind: "assessment",
  gone: "That assessment is gone.",
  holdGuard: withoutHoldCascade(
    assessmentResponses,
    assessmentResponses.assessmentId,
    sql`${assessments.id}`,
    assessmentResponses.contactId,
    "assessments.responses",
  ),
});

export default [
  listAssessments,
  getPublicAssessment,
  getAssessment,
  createAssessment,
  updateAssessment,
  saveBand,
  deleteBand,
  saveEscalation,
  deleteEscalation,
  publishAssessment,
  closeAssessment,
  respond,
  listResponses,
  loadDemoAssessment,
  purgeDemoAssessment,
  verifyDemoAssessment,
  trash.remove,
  trash.restore,
  trash.purge,
  trash.purgeExpired,
];
