// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What an assessment question is, and how an answer is checked against one.
//
// Same idea as form fields (§4.6) and the block registry (§32): the *kinds* of
// question are code, the questions themselves are data. What differs here is
// that every option carries the score it contributes, because the owner is
// authoring the judgement as well as the wording. A platform that scored on
// our own weights would be inventing the part that matters most.
//
// Deliberately a small set, and deliberately closed-ended. There is no
// free-text question kind: prose cannot be scored without interpreting it, and
// interpreting it is the thing §4.18 forbids. An owner who wants the story
// asks for it on the form that follows, where it reaches a human.
import { z } from "zod";

export const QUESTION_KINDS = ["single", "multi", "scale"] as const;

export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** A stable key: stored on the response, never shown to a respondent. */
const key = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lower-case letters, digits and underscores.");

export const optionSchema = z.object({
  key,
  label: z.string().min(1).max(200),
  /**
   * What choosing this contributes to the total.
   *
   * Signed on purpose: "I already have a service plan" should be able to pull
   * an urgency score *down*. Bounded so a single option cannot swamp a band
   * range by accident and silently make every other question decorative.
   */
  score: z.number().int().min(-1000).max(1000).default(0),
});

export const questionSchema = z.object({
  key,
  label: z.string().min(1).max(300),
  kind: z.enum(QUESTION_KINDS),
  help: z.string().max(500).optional(),
  required: z.boolean().default(true),
  /**
   * At least two options, because a question with one answer is not a
   * question, and a respondent who cannot say "no" has been led.
   */
  options: z.array(optionSchema).min(2).max(20),
});

export const questionsSchema = z.array(questionSchema).max(40);

export type AssessmentOption = z.output<typeof optionSchema>;
export type AssessmentQuestion = z.output<typeof questionSchema>;

/** Keys must be unique within one assessment, or an answer is ambiguous. */
export function duplicateQuestionKeys(questions: AssessmentQuestion[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.key)) dupes.add(question.key);
    seen.add(question.key);
    const options = new Set<string>();
    for (const option of question.options) {
      if (options.has(option.key)) dupes.add(`${question.key}.${option.key}`);
      options.add(option.key);
    }
  }
  return [...dupes];
}

/**
 * The score range this question set can produce.
 *
 * Bands are validated against this at publish time (§4.18): if the reachable
 * range is not fully covered, some respondent gets no outcome — and "no
 * outcome" is the one answer the module must never have to invent on the spot.
 * `multi` can select every option, so its ceiling is the sum of the positive
 * ones and its floor the sum of the negative; `single` and `scale` pick one.
 */
export function reachableScoreRange(questions: AssessmentQuestion[]): {
  min: number;
  max: number;
} {
  let min = 0;
  let max = 0;
  for (const question of questions) {
    const scores = question.options.map((option) => option.score);
    if (question.kind === "multi") {
      min += scores.filter((score) => score < 0).reduce((a, b) => a + b, 0);
      max += scores.filter((score) => score > 0).reduce((a, b) => a + b, 0);
      continue;
    }
    // An optional single-choice question can also be left unanswered, which
    // contributes nothing — so zero is reachable whenever it is not required.
    const candidates = question.required ? scores : [...scores, 0];
    min += Math.min(...candidates);
    max += Math.max(...candidates);
  }
  return { min, max };
}

/**
 * A key for `label`, avoiding everything in `taken`.
 *
 * Derived rather than asked for, for the reason `deriveFieldKey` gives in the
 * forms module: nobody authoring a questionnaire should have to invent an
 * identifier, and the ones people invent by hand are the ones that collide.
 * Kept here rather than imported so an assessment does not need the forms
 * module switched on to have a key.
 */
export function deriveQuestionKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      // The schema wants a letter first, and "2026" is a plausible label.
      .replace(/^([0-9])/, "q$1")
      .slice(0, 40) || "question";
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Too many questions share that wording.");
}
