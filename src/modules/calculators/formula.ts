// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What an owner-configured calculation is, and how it is evaluated
// (MASTER.md §4.18, C5.26).
//
// A list of named steps, not an expression to parse and certainly not a string
// to evaluate. An owner configuring arithmetic must not be a way to run code on
// the instance, and "we sanitise it first" is the sentence at the top of most
// of the ways that goes wrong.
//
// So the vocabulary is closed: seven operations, and three kinds of operand —
// a literal the owner typed, an answer the visitor gave, or a fact the business
// published through `core/attestations`. Anything a calculator can compute is
// something one of those three supplied, which is the whole point of §4.18
// applied to arithmetic rather than to prose.
import { z } from "zod";

export const OPERATIONS = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "percentOf",
  "min",
  "max",
] as const;

export type Operation = (typeof OPERATIONS)[number];

const key = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lower-case letters, digits and underscores.");

/** A number's provenance: the owner, the visitor, or a published fact. */
export const termSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.number().finite() }),
  z.object({ kind: z.literal("input"), key }),
  z.object({
    kind: z.literal("fact"),
    /** An attestation key: `rate.30-year-fixed`, `price.species.chinook`. */
    factKey: z.string().min(1).max(120),
  }),
  z.object({ kind: z.literal("step"), key }),
]);

export const stepSchema = z.object({
  key,
  label: z.string().min(1).max(160),
  op: z.enum(OPERATIONS),
  first: termSchema,
  second: termSchema,
});

export const inputSchema = z.object({
  key,
  label: z.string().min(1).max(200),
  help: z.string().max(400).optional(),
  /** Bounds are the owner's, and the visitor is held to them. */
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  /** Shown beside the box: "years", "$", "guests". */
  unit: z.string().max(24).optional(),
});

export const stepsSchema = z.array(stepSchema).min(1).max(40);
export const inputsSchema = z.array(inputSchema).max(20);

export type CalculatorStep = z.output<typeof stepSchema>;
export type CalculatorInput = z.output<typeof inputSchema>;
export type CalculatorTerm = z.output<typeof termSchema>;

/**
 * Every fact key a calculation depends on.
 *
 * The compute path needs these before it starts, because a calculator missing
 * one of them must refuse rather than compute around it.
 */
export function factKeys(steps: CalculatorStep[]): string[] {
  const keys = new Set<string>();
  for (const step of steps) {
    for (const term of [step.first, step.second]) {
      if (term.kind === "fact") keys.add(term.factKey);
    }
  }
  return [...keys];
}

/**
 * Problems an owner has to fix before this can be published.
 *
 * Checked when it is saved rather than when somebody uses it: a step that
 * refers to an input nobody is asked for is a calculator that fails in front
 * of a visitor, and the visitor is the worst person to discover it.
 */
export function configurationProblems(
  inputs: CalculatorInput[],
  steps: CalculatorStep[],
): string[] {
  const problems: string[] = [];
  const inputKeys = new Set(inputs.map((input) => input.key));
  const seen = new Set<string>();

  for (const input of inputs) {
    if (input.min !== undefined && input.max !== undefined && input.min > input.max) {
      problems.push(`"${input.label}" has a smallest value above its largest.`);
    }
  }

  for (const step of steps) {
    if (seen.has(step.key)) {
      problems.push(`Two steps are both called "${step.key}".`);
    }
    for (const term of [step.first, step.second]) {
      if (term.kind === "input" && !inputKeys.has(term.key)) {
        problems.push(`"${step.label}" uses an answer nobody is asked for: ${term.key}.`);
      }
      // Only *earlier* steps, so a calculation cannot refer to itself or to
      // something that has not happened yet.
      if (term.kind === "step" && !seen.has(term.key)) {
        problems.push(
          `"${step.label}" uses a step that has not run yet: ${term.key}.`,
        );
      }
    }
    seen.add(step.key);
  }
  return problems;
}

export interface Resolved {
  inputs: Record<string, number>;
  facts: Record<string, number>;
}

export type Evaluation =
  | { ok: true; value: number; steps: Array<{ key: string; label: string; value: number }> }
  | { ok: false; reason: string };

function apply(op: Operation, first: number, second: number): number | null {
  switch (op) {
    case "add":
      return first + second;
    case "subtract":
      return first - second;
    case "multiply":
      return first * second;
    case "divide":
      // Refused rather than returned as Infinity: a figure of Infinity on a
      // page is worse than no figure, and NaN is worse than both.
      return second === 0 ? null : first / second;
    case "percentOf":
      return (first * second) / 100;
    case "min":
      return Math.min(first, second);
    case "max":
      return Math.max(first, second);
  }
}

/** The last step's value, with every step kept so the working can be shown. */
export function evaluate(steps: CalculatorStep[], resolved: Resolved): Evaluation {
  const values = new Map<string, number>();
  const shown: Array<{ key: string; label: string; value: number }> = [];

  function read(term: CalculatorTerm): number | null {
    switch (term.kind) {
      case "literal":
        return term.value;
      case "input":
        return resolved.inputs[term.key] ?? null;
      case "fact":
        return resolved.facts[term.factKey] ?? null;
      case "step":
        return values.get(term.key) ?? null;
    }
  }

  for (const step of steps) {
    const first = read(step.first);
    const second = read(step.second);
    if (first === null || second === null) {
      return { ok: false, reason: `"${step.label}" is missing a number it needs.` };
    }
    const value = apply(step.op, first, second);
    if (value === null || !Number.isFinite(value)) {
      return { ok: false, reason: `"${step.label}" does not produce a usable number.` };
    }
    values.set(step.key, value);
    shown.push({ key: step.key, label: step.label, value });
  }

  const last = shown.at(-1);
  if (!last) return { ok: false, reason: "This calculator has no steps." };
  return { ok: true, value: last.value, steps: shown };
}
