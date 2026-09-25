// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Calculator services (MASTER.md §4.18, C5.26).
//
// Read `compute` first. What it does when a published constant is missing or
// past its date is the feature: it refuses, and names which one. It does not
// substitute a default, carry forward the last value it saw, or quietly leave
// a term out of the sum — and it will not return a figure whose oldest input
// stopped being true in March.
//
// That is a stronger position than it sounds. A mortgage affordability figure
// computed from a stale rate looks exactly like one computed from today's, and
// the person reading it has no way to tell. The only honest thing a page can
// do with an out-of-date constant is decline to do the arithmetic.
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { isUniqueViolation } from "@/core/db";
import { currentFact } from "@/core/attestations/service";
import { makeTrashServices } from "@/core/trash";
import { calculators } from "./schema";
import {
  configurationProblems,
  evaluate,
  factKeys,
  inputsSchema,
  stepsSchema,
  type CalculatorInput,
  type CalculatorStep,
} from "./formula";

const slug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case letters, digits and hyphens.");

const calculatorRow = row({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  intro: z.string().nullable(),
  inputs: z.array(z.unknown()),
  steps: z.array(z.unknown()),
  resultLabel: z.string(),
  resultUnit: z.string().nullable(),
  assumptions: z.string(),
  status: z.enum(["draft", "active", "closed"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

async function live(ctx: { tx: Tx }, id: string) {
  const [found] = await ctx.tx
    .select()
    .from(calculators)
    .where(and(eq(calculators.id, id), isNull(calculators.trashedAt)))
    .limit(1);
  if (!found) throw new ServiceError("not_found", "That calculator is gone.");
  return found;
}

export const listCalculators = defineService({
  name: "calculators.list",
  summary: "Every calculator, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(calculatorRow),
  handler: async (_input, ctx) =>
    ctx.tx
      .select()
      .from(calculators)
      .where(isNull(calculators.trashedAt))
      .orderBy(desc(calculators.createdAt)),
});

export const getCalculator = defineService({
  name: "calculators.get",
  summary: "One calculator, with what it asks and what it works out.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: uuid }),
  output: calculatorRow,
  handler: async (input, ctx) => live(ctx, input.id),
});

const writable = {
  name: z.string().min(1).max(120),
  intro: z.string().max(2000).optional(),
  inputs: inputsSchema.default([]),
  steps: stepsSchema,
  resultLabel: z.string().min(1).max(120),
  resultUnit: z.string().max(24).optional(),
  assumptions: z.string().min(1).max(4000),
};

/** Configuration problems are refused here, never discovered by a visitor. */
function assertConfigured(inputs: CalculatorInput[], steps: CalculatorStep[]): void {
  const problems = configurationProblems(inputs, steps);
  if (problems.length) {
    throw new ServiceError("validation", problems.join(" "));
  }
}

export const createCalculator = defineService({
  name: "calculators.create",
  summary: "Add a calculator. It starts as a draft.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ slug, ...writable }),
  output: calculatorRow,
  handler: async (input, ctx) => {
    assertConfigured(input.inputs, input.steps);
    const [created] = await ctx.tx
      .insert(calculators)
      .values({
        slug: input.slug,
        name: input.name,
        intro: input.intro ?? null,
        inputs: input.inputs,
        steps: input.steps,
        resultLabel: input.resultLabel,
        resultUnit: input.resultUnit ?? null,
        assumptions: input.assumptions,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ServiceError(
            "conflict",
            `There is already a calculator at "${input.slug}".`,
          );
        }
        throw error;
      });
    ctx.setSubject("calculator", created!.id);
    return created!;
  },
});

export const updateCalculator = defineService({
  name: "calculators.update",
  summary: "Change what a calculator asks, works out, or assumes.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid, ...writable }),
  output: calculatorRow,
  handler: async (input, ctx) => {
    const found = await live(ctx, input.id);
    assertConfigured(input.inputs, input.steps);
    const [updated] = await ctx.tx
      .update(calculators)
      .set({
        name: input.name,
        intro: input.intro ?? null,
        inputs: input.inputs,
        steps: input.steps,
        resultLabel: input.resultLabel,
        resultUnit: input.resultUnit ?? null,
        assumptions: input.assumptions,
        updatedAt: new Date(),
      })
      .where(eq(calculators.id, found.id))
      .returning();
    ctx.setSubject("calculator", found.id);
    return updated!;
  },
});

export const publishCalculator = defineService({
  name: "calculators.publish",
  summary: "Open a calculator to visitors, once every constant it needs exists.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid }),
  output: calculatorRow,
  handler: async (input, ctx) => {
    const found = await live(ctx, input.id);
    const steps = found.steps as CalculatorStep[];
    assertConfigured(found.inputs as CalculatorInput[], steps);

    // Every published constant it refers to has to exist *now*. A calculator
    // that goes live pointing at a rate nobody has published yet is one that
    // will refuse the first visitor who tries it.
    const missing: string[] = [];
    for (const key of factKeys(steps)) {
      const fact = await ctx.callAsSystem(currentFact, { key });
      if (!fact) missing.push(key);
    }
    if (missing.length) {
      throw new ServiceError(
        "validation",
        `These figures have not been published yet, so the calculator has nothing to work from: ${missing.join(", ")}.`,
      );
    }

    const [updated] = await ctx.tx
      .update(calculators)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(calculators.id, found.id))
      .returning();
    ctx.setSubject("calculator", found.id);
    ctx.queueEvent("calculator.published", { id: found.id, slug: found.slug });
    return updated!;
  },
});

export const closeCalculator = defineService({
  name: "calculators.close",
  summary: "Take a calculator off the site.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid }),
  output: calculatorRow,
  handler: async (input, ctx) => {
    const found = await live(ctx, input.id);
    const [updated] = await ctx.tx
      .update(calculators)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(calculators.id, found.id))
      .returning();
    ctx.setSubject("calculator", found.id);
    ctx.queueEvent("calculator.closed", { id: found.id, slug: found.slug });
    return updated!;
  },
});

export const getPublicCalculator = defineService({
  name: "calculators.getPublic",
  summary: "A calculator as a visitor sees it, or nothing.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  output: z
    .object({
      slug: z.string(),
      name: z.string(),
      intro: z.string().nullable(),
      inputs: z.array(z.unknown()),
      resultLabel: z.string(),
      resultUnit: z.string().nullable(),
      assumptions: z.string(),
      status: z.enum(["draft", "active", "closed"]),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(calculators)
      .where(and(eq(calculators.slug, input.slug), isNull(calculators.trashedAt)))
      .limit(1);
    // The steps are deliberately not returned. What a visitor needs is the
    // questions, the answer and the assumptions; the working is the owner's
    // configuration, not part of the public contract.
    if (!found) return null;
    return {
      slug: found.slug,
      name: found.name,
      intro: found.intro,
      inputs: found.inputs as unknown[],
      resultLabel: found.resultLabel,
      resultUnit: found.resultUnit,
      assumptions: found.assumptions,
      status: found.status,
    };
  },
});

export const compute = defineService({
  name: "calculators.compute",
  summary: "Work out the figure, or say why it will not.",
  kind: "query",
  permission: "public",
  input: z.object({
    slug,
    answers: z.record(z.string(), z.number().finite()),
  }),
  output: z.object({
    ok: z.boolean(),
    /** Why not. Named, because "it did not work" is not actionable. */
    refusal: z.string().nullable(),
    value: z.number().nullable(),
    resultLabel: z.string(),
    resultUnit: z.string().nullable(),
    assumptions: z.string(),
    /**
     * Every published figure this rests on, with its source and date, and the
     * oldest of those dates — which is how old the answer really is.
     */
    basedOn: z.array(
      z.object({
        key: z.string(),
        value: z.number(),
        source: z.string(),
        asOf: timestamp,
      }),
    ),
    oldestAsOf: timestamp.nullable(),
  }),
  handler: async (input, ctx) => {
    const [found] = await ctx.tx
      .select()
      .from(calculators)
      .where(and(eq(calculators.slug, input.slug), isNull(calculators.trashedAt)))
      .limit(1);
    if (!found) throw new ServiceError("not_found", "That calculator no longer exists.");
    if (found.status !== "active") {
      throw new ServiceError("validation", "This calculator is not open.");
    }

    const inputs = found.inputs as CalculatorInput[];
    const steps = found.steps as CalculatorStep[];
    const refuse = (refusal: string) => ({
      ok: false,
      refusal,
      value: null,
      resultLabel: found.resultLabel,
      resultUnit: found.resultUnit,
      assumptions: found.assumptions,
      basedOn: [],
      oldestAsOf: null,
    });

    // The visitor's answers, held to the bounds the owner set.
    const answers: Record<string, number> = {};
    for (const declared of inputs) {
      const given = input.answers[declared.key];
      if (given === undefined) return refuse(`"${declared.label}" is needed.`);
      if (declared.min !== undefined && given < declared.min) {
        return refuse(`"${declared.label}" cannot be below ${declared.min}.`);
      }
      if (declared.max !== undefined && given > declared.max) {
        return refuse(`"${declared.label}" cannot be above ${declared.max}.`);
      }
      answers[declared.key] = given;
    }

    // The published constants. Missing and stale are both refusals, and both
    // say which figure is at fault — an owner reading the refusal has to know
    // what to go and publish.
    const facts: Record<string, number> = {};
    const basedOn: Array<{ key: string; value: number; source: string; asOf: Date }> = [];
    for (const key of factKeys(steps)) {
      const fact = await ctx.callAsSystem(currentFact, { key });
      if (!fact) {
        return refuse(`This cannot be worked out yet: ${key} has not been published.`);
      }
      if (fact.stale) {
        return refuse(
          `This cannot be worked out right now: ${key} is past the date it was good for.`,
        );
      }
      const numeric = typeof fact.value === "number" ? fact.value : Number(fact.value);
      if (!Number.isFinite(numeric)) {
        return refuse(`${key} is not a number this can calculate with.`);
      }
      facts[key] = numeric;
      basedOn.push({ key, value: numeric, source: fact.source, asOf: fact.asOf });
    }

    const result = evaluate(steps, { inputs: answers, facts });
    if (!result.ok) return refuse(result.reason);

    const oldestAsOf = basedOn.length
      ? basedOn.reduce((oldest, entry) => (entry.asOf < oldest ? entry.asOf : oldest), basedOn[0]!.asOf)
      : null;

    return {
      ok: true,
      refusal: null,
      value: result.value,
      resultLabel: found.resultLabel,
      resultUnit: found.resultUnit,
      assumptions: found.assumptions,
      basedOn,
      oldestAsOf,
    };
  },
});

const trash = makeTrashServices({
  family: "calculators",
  table: calculators,
  rowSchema: calculatorRow,
  subjectKind: "calculator",
  gone: "That calculator is gone.",
});

export default [
  listCalculators,
  getCalculator,
  getPublicCalculator,
  createCalculator,
  updateCalculator,
  publishCalculator,
  closeCalculator,
  compute,
  trash.remove,
  trash.restore,
  trash.purge,
  trash.purgeExpired,
];
