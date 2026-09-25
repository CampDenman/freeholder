// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scoring an assessment, and proving its bands leave nobody without an answer
// (MASTER.md §4.18, C8.14).
//
// Two jobs live here, and they are the same job seen from either end. Scoring
// turns answers into a number. Coverage proves, before anything is published,
// that every number the questions can produce has an authored band waiting for
// it. Without the second, the first eventually hands somebody a score that
// matches nothing — and a module whose whole promise is "the outcome was
// written by the owner" cannot answer that case at request time. So it is
// refused at publish time instead, when there is an owner present to fix it.
import { z } from "zod";
import type { AssessmentQuestion } from "./questions";

/** A band as coverage cares about it: inclusive bounds, nothing else. */
export interface ScoreBand {
  minScore: number;
  maxScore: number;
}

/**
 * The validator a respondent's answers are checked against, derived from the
 * questions the owner wrote — so the two can never disagree (§4.6 does the
 * same for form fields).
 *
 * An answer is always an option *key*, never free text: the score comes from
 * the option, so an unrecognised value has no score and inventing one is the
 * whole failure mode.
 */
export function answersSchema(questions: AssessmentQuestion[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const question of questions) {
    const keys = question.options.map((option) => option.key);
    const one = z.enum(keys as [string, ...string[]]);
    const value = question.kind === "multi" ? z.array(one).max(keys.length) : one;
    shape[question.key] = question.required ? value : value.optional();
  }
  return z.object(shape).strict();
}

export type Answers = Record<string, string | string[] | undefined>;

/**
 * The total for a set of answers.
 *
 * Unanswered optional questions contribute nothing, which is what
 * `reachableScoreRange` assumes when it admits zero for them.
 */
export function scoreAnswers(
  questions: AssessmentQuestion[],
  answers: Answers,
): number {
  let total = 0;
  for (const question of questions) {
    const answer = answers[question.key];
    if (answer === undefined) continue;
    const chosen = Array.isArray(answer) ? answer : [answer];
    for (const optionKey of chosen) {
      const option = question.options.find((candidate) => candidate.key === optionKey);
      // An unknown key scores nothing rather than throwing: the schema above
      // has already refused it, so reaching here means a caller bypassed
      // validation, and silently adding points would be the worse failure.
      if (option) total += option.score;
    }
  }
  return total;
}

/**
 * Scores in `range` that no band covers.
 *
 * Returned as inclusive spans so an owner is told "nothing covers 7 to 9"
 * rather than being handed a list of forty integers.
 */
export function coverageGaps(
  bands: ScoreBand[],
  range: { min: number; max: number },
): Array<{ from: number; to: number }> {
  const gaps: Array<{ from: number; to: number }> = [];
  const sorted = [...bands].sort((a, b) => a.minScore - b.minScore);
  let cursor = range.min;
  for (const band of sorted) {
    if (band.minScore > cursor) {
      gaps.push({ from: cursor, to: Math.min(band.minScore - 1, range.max) });
    }
    cursor = Math.max(cursor, band.maxScore + 1);
    if (cursor > range.max) break;
  }
  if (cursor <= range.max) gaps.push({ from: cursor, to: range.max });
  return gaps.filter((gap) => gap.from <= gap.to);
}

/** Human wording for a refusal an owner has to act on. */
export function describeGaps(gaps: Array<{ from: number; to: number }>): string {
  return gaps
    .map((gap) => (gap.from === gap.to ? `${gap.from}` : `${gap.from} to ${gap.to}`))
    .join(", ");
}
