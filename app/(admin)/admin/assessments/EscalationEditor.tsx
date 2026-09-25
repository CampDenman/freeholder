// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Answers that outrank the score.
//
// A high band is not enough for this. "I can smell gas" has to beat a low
// total on its own, and the instruction has to be able to name the actual
// action — leave the building, call the utility, attend an emergency
// department — rather than a severity adjective the reader has to interpret
// while something is going wrong.
//
// The answer is chosen from the questions the owner already wrote, never
// typed: an escalation on an option that does not exist is a rule that can
// never fire, which is worse than no rule at all because it looks like cover.
import { useActionState, useId, useState } from "react";
import { Plus, Trash, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Select,
} from "@/ui/primitives";
import type { BuilderQuestion } from "./QuestionBuilder";
import {
  deleteEscalationAction,
  saveEscalationAction,
  type AssessmentActionState,
} from "../../assessments-actions";

export interface EscalationLabels {
  title: string;
  intro: string;
  empty: string;
  question: string;
  answer: string;
  instruction: string;
  instructionHint: string;
  add: string;
  save: string;
  cancel: string;
  remove: string;
  orphaned: string;
  needQuestions: string;
}

export interface EditableEscalation {
  id: string;
  questionKey: string;
  optionKey: string;
  instruction: string;
  ordinal: number;
}

const CONTROL =
  "w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-muted focus-visible:border-accent";

export function EscalationEditor({
  assessmentId,
  escalations,
  questions,
  labels,
}: {
  assessmentId: string;
  escalations: EditableEscalation[];
  questions: BuilderQuestion[];
  labels: EscalationLabels;
}) {
  const [saveState, save, saving] = useActionState<AssessmentActionState, FormData>(
    saveEscalationAction,
    {},
  );
  const [removeState, remove] = useActionState<AssessmentActionState, FormData>(
    deleteEscalationAction,
    {},
  );
  const [adding, setAdding] = useState(false);
  const [questionKey, setQuestionKey] = useState(questions[0]?.key ?? "");
  const formId = useId();

  const chosen = questions.find((question) => question.key === questionKey);

  function describe(escalation: EditableEscalation): string {
    const question = questions.find((candidate) => candidate.key === escalation.questionKey);
    const option = question?.options.find(
      (candidate) => candidate.key === escalation.optionKey,
    );
    // A rule whose question or answer has since been re-worded still shows
    // something useful, and shows that it is now orphaned.
    if (!question || !option) {
      return labels.orphaned
        .replace("%question%", escalation.questionKey)
        .replace("%option%", escalation.optionKey);
    }
    return `${question.label} → ${option.label}`;
  }

  return (
    <Card>
      <CardHeader title={labels.title} />
      <CardBody>
        <p className="text-sm text-ink-muted">{labels.intro}</p>

        {saveState.error ? (
          <Callout tone="danger" icon={<WarningCircle size={16} weight="bold" />}>
            {saveState.error}
          </Callout>
        ) : null}
        {removeState.error ? (
          <Callout tone="danger" icon={<WarningCircle size={16} weight="bold" />}>
            {removeState.error}
          </Callout>
        ) : null}

        {escalations.length === 0 ? (
          <p className="text-sm text-ink-muted">{labels.empty}</p>
        ) : null}

        {escalations.map((escalation) => (
          <div key={escalation.id} className="grid gap-3 rounded-md border border-rule p-4">
            <p className="text-sm font-semibold text-ink">{describe(escalation)}</p>
            <form action={save} className="grid gap-3">
              <input type="hidden" name="assessmentId" value={assessmentId} />
              <input type="hidden" name="id" value={escalation.id} />
              <input type="hidden" name="questionKey" value={escalation.questionKey} />
              <input type="hidden" name="optionKey" value={escalation.optionKey} />
              <input type="hidden" name="ordinal" value={escalation.ordinal} />
              <Field
                label={labels.instruction}
                htmlFor={`${formId}-${escalation.id}-instruction`}
                hint={labels.instructionHint}
              >
                <textarea
                  id={`${formId}-${escalation.id}-instruction`}
                  name="instruction"
                  rows={3}
                  maxLength={2000}
                  defaultValue={escalation.instruction}
                  required
                  className={CONTROL}
                />
              </Field>
              <Button type="submit" variant="quiet" disabled={saving} className="justify-self-start">
                {labels.save}
              </Button>
            </form>
            <form action={remove}>
              <input type="hidden" name="assessmentId" value={assessmentId} />
              <input type="hidden" name="id" value={escalation.id} />
              <Button type="submit" variant="danger">
                <Trash size={14} weight="bold" />
                {labels.remove}
              </Button>
            </form>
          </div>
        ))}

        {adding ? (
          <form action={save} className="grid gap-3 rounded-md border border-accent p-4">
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <input type="hidden" name="ordinal" value={escalations.length} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={labels.question} htmlFor={`${formId}-new-question`}>
                <Select
                  id={`${formId}-new-question`}
                  name="questionKey"
                  value={questionKey}
                  onChange={(event) => setQuestionKey(event.target.value)}
                >
                  {questions.map((question) => (
                    <option key={question.key} value={question.key}>
                      {question.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={labels.answer} htmlFor={`${formId}-new-answer`}>
                <Select id={`${formId}-new-answer`} name="optionKey" required>
                  {(chosen?.options ?? []).map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label={labels.instruction}
              htmlFor={`${formId}-new-instruction`}
              hint={labels.instructionHint}
            >
              <textarea
                id={`${formId}-new-instruction`}
                name="instruction"
                rows={3}
                maxLength={2000}
                required
                className={CONTROL}
              />
            </Field>
            <div className="flex gap-3">
              <Button type="submit" disabled={saving}>
                {labels.add}
              </Button>
              <Button type="button" variant="quiet" onClick={() => setAdding(false)}>
                {labels.cancel}
              </Button>
            </div>
          </form>
        ) : null}
      </CardBody>
      <CardFooter>
        {adding || questions.length === 0 ? null : (
          <Button type="button" variant="quiet" onClick={() => setAdding(true)}>
            <Plus size={15} weight="bold" />
            {labels.add}
          </Button>
        )}
        {questions.length === 0 ? (
          <p className="text-sm text-ink-muted">{labels.needQuestions}</p>
        ) : null}
      </CardFooter>
    </Card>
  );
}
