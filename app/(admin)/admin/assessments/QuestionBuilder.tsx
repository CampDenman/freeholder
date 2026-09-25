// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Authoring the questions, the answers, and what each answer is worth.
//
// The score box beside every option is the unusual part, and it is deliberate:
// the owner is authoring the judgement, not just the wording. A platform that
// scored on weights we chose would be inventing the half that matters, so the
// number is on screen next to the words it belongs to rather than hidden in a
// settings panel.
//
// The running total at the bottom is the other half. Bands have to cover every
// score these questions can reach before the assessment will publish, so the
// reachable range is shown here, while the questions are being written, rather
// than as a refusal later.
import { useActionState, useId, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Plus,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
  Select,
} from "@/ui/primitives";
import {
  deriveQuestionKey,
  reachableScoreRange,
  type AssessmentOption,
  type AssessmentQuestion,
} from "@/modules/assessments/questions";
import {
  saveAssessmentAction,
  type AssessmentActionState,
} from "../../assessments-actions";

export interface QuestionLabels {
  aboutTitle: string;
  name: string;
  slug: string;
  slugHint: string;
  intro: string;
  introHint: string;
  destination: string;
  destinationContact: string;
  destinationNone: string;
  destinationHint: string;
  notify: string;
  notifyHint: string;
  questionsTitle: string;
  noQuestions: string;
  question: string;
  questionLabel: string;
  key: string;
  keyHint: string;
  kind: string;
  kindHint: string;
  kindSingle: string;
  kindMulti: string;
  kindScale: string;
  help: string;
  helpHint: string;
  required: string;
  answers: string;
  answerLabel: string;
  score: string;
  addAnswer: string;
  removeAnswer: string;
  twoAnswers: string;
  addQuestion: string;
  removeQuestion: string;
  moveUp: string;
  moveDown: string;
  reachable: string;
  save: string;
  saving: string;
  saved: string;
}

/*
 * Aliases, not copies.
 *
 * These were duplicate interfaces until the compiler pointed out that the
 * assertions between them did nothing. A second definition of "what a question
 * is" would drift from the schema the moment either changed, and the builder
 * would then happily compose something the service refuses — so the builder
 * uses the schema's own types and cannot disagree with it.
 */
export type BuilderOption = AssessmentOption;
export type BuilderQuestion = AssessmentQuestion;

export interface BuilderAssessment {
  id?: string;
  slug: string;
  name: string;
  intro: string | null;
  destination: "contact" | "none";
  notify: string[];
  questions: BuilderQuestion[];
}

const CONTROL =
  "w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-muted focus-visible:border-accent";

function blankQuestion(taken: string[]): BuilderQuestion {
  return {
    key: deriveQuestionKey("New question", taken),
    label: "New question",
    kind: "single",
    required: true,
    options: [
      { key: "yes", label: "Yes", score: 1 },
      { key: "no", label: "No", score: 0 },
    ],
  };
}

export function QuestionBuilder({
  assessment,
  labels,
}: {
  assessment: BuilderAssessment;
  labels: QuestionLabels;
}) {
  const [state, action, pending] = useActionState<AssessmentActionState, FormData>(
    saveAssessmentAction,
    {},
  );
  const [questions, setQuestions] = useState<BuilderQuestion[]>(assessment.questions);
  const formId = useId();

  // The same function the server uses to decide whether the bands cover
  // everything, so the number here and the refusal there can never disagree.
  const range = useMemo(() => {
    try {
      return reachableScoreRange(questions);
    } catch {
      return null;
    }
  }, [questions]);

  function patch(index: number, next: Partial<BuilderQuestion>) {
    setQuestions((current) =>
      current.map((question, at) => (at === index ? { ...question, ...next } : question)),
    );
  }

  function patchOption(qi: number, oi: number, next: Partial<BuilderOption>) {
    setQuestions((current) =>
      current.map((question, at) =>
        at === qi
          ? {
              ...question,
              options: question.options.map((option, oat) =>
                oat === oi ? { ...option, ...next } : option,
              ),
            }
          : question,
      ),
    );
  }

  function move(index: number, by: -1 | 1) {
    setQuestions((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <form action={action} className="grid gap-6">
      {assessment.id ? <input type="hidden" name="id" value={assessment.id} /> : null}
      <input type="hidden" name="questions" value={JSON.stringify(questions)} />

      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={16} weight="bold" />}>
          {state.error}
        </Callout>
      ) : null}
      {state.saved ? (
        <Callout tone="success" icon={<CheckCircle size={16} weight="bold" />}>
          {labels.saved}
        </Callout>
      ) : null}

      <Card>
        <CardHeader title={labels.aboutTitle} />
        <CardBody>
          <Field label={labels.name} htmlFor={`${formId}-name`}>
            <Input
              id={`${formId}-name`}
              name="name"
              defaultValue={assessment.name}
              required
              maxLength={120}
            />
          </Field>
          {assessment.id ? null : (
            <Field label={labels.slug} htmlFor={`${formId}-slug`} hint={labels.slugHint}>
              <Input
                id={`${formId}-slug`}
                name="slug"
                defaultValue={assessment.slug}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={60}
              />
            </Field>
          )}
          <Field label={labels.intro} htmlFor={`${formId}-intro`} hint={labels.introHint}>
            <textarea
              id={`${formId}-intro`}
              name="intro"
              rows={3}
              maxLength={2000}
              defaultValue={assessment.intro ?? ""}
              className={CONTROL}
            />
          </Field>
          <Field
            label={labels.destination}
            htmlFor={`${formId}-destination`}
            hint={labels.destinationHint}
          >
            <Select
              id={`${formId}-destination`}
              name="destination"
              defaultValue={assessment.destination}
            >
              <option value="contact">{labels.destinationContact}</option>
              <option value="none">{labels.destinationNone}</option>
            </Select>
          </Field>
          <Field label={labels.notify} htmlFor={`${formId}-notify`} hint={labels.notifyHint}>
            <textarea
              id={`${formId}-notify`}
              name="notify"
              rows={2}
              defaultValue={assessment.notify.join("\n")}
              className={CONTROL}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={labels.questionsTitle}
          status={
            range ? (
              <span className="ms-auto font-mono text-xs text-ink-muted tabular-nums">
                {labels.reachable.replace("%min%", String(range.min)).replace("%max%", String(range.max))}
              </span>
            ) : null
          }
        />
        <CardBody>
          {questions.length === 0 ? (
            <p className="text-sm text-ink-muted">{labels.noQuestions}</p>
          ) : null}

          {questions.map((question, qi) => (
            <fieldset
              key={`${question.key}-${qi}`}
              className="grid gap-4 rounded-md border border-rule p-4"
            >
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {labels.question.replace("%n%", String(qi + 1))}
              </legend>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="quiet"
                  aria-label={labels.moveUp}
                  disabled={qi === 0}
                  onClick={() => move(qi, -1)}
                >
                  <ArrowUp size={14} weight="bold" />
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  aria-label={labels.moveDown}
                  disabled={qi === questions.length - 1}
                  onClick={() => move(qi, 1)}
                >
                  <ArrowDown size={14} weight="bold" />
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="ms-auto"
                  onClick={() =>
                    setQuestions((current) => current.filter((_, at) => at !== qi))
                  }
                >
                  <Trash size={14} weight="bold" />
                  {labels.removeQuestion}
                </Button>
              </div>

              <Field label={labels.questionLabel} htmlFor={`${formId}-q${qi}-label`}>
                <Input
                  id={`${formId}-q${qi}-label`}
                  value={question.label}
                  maxLength={300}
                  onChange={(event) => {
                    const label = event.target.value;
                    const taken = questions.filter((_, at) => at !== qi).map((q) => q.key);
                    patch(qi, { label, key: deriveQuestionKey(label, taken) });
                  }}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={labels.kind} htmlFor={`${formId}-q${qi}-kind`} hint={labels.kindHint}>
                  <Select
                    id={`${formId}-q${qi}-kind`}
                    value={question.kind}
                    onChange={(event) =>
                      patch(qi, { kind: event.target.value as BuilderQuestion["kind"] })
                    }
                  >
                    <option value="single">{labels.kindSingle}</option>
                    <option value="multi">{labels.kindMulti}</option>
                    <option value="scale">{labels.kindScale}</option>
                  </Select>
                </Field>
                <Field label={labels.key} htmlFor={`${formId}-q${qi}-key`} hint={labels.keyHint}>
                  <Input
                    id={`${formId}-q${qi}-key`}
                    value={question.key}
                    maxLength={40}
                    onChange={(event) => patch(qi, { key: event.target.value })}
                    className="font-mono"
                  />
                </Field>
              </div>

              <Field label={labels.help} htmlFor={`${formId}-q${qi}-help`} hint={labels.helpHint}>
                <Input
                  id={`${formId}-q${qi}-help`}
                  value={question.help ?? ""}
                  maxLength={500}
                  onChange={(event) => patch(qi, { help: event.target.value || undefined })}
                />
              </Field>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={question.required}
                  onChange={(event) => patch(qi, { required: event.target.checked })}
                />
                {labels.required}
              </label>

              <div className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {labels.answers}
                </p>
                {question.options.map((option, oi) => (
                  <div
                    key={`${option.key}-${oi}`}
                    className="flex flex-wrap items-end gap-2 rounded-md bg-surface-muted p-2"
                  >
                    <div className="min-w-[12rem] flex-1">
                      <label
                        className="text-xs text-ink-muted"
                        htmlFor={`${formId}-q${qi}-o${oi}-label`}
                      >
                        {labels.answerLabel}
                      </label>
                      <Input
                        id={`${formId}-q${qi}-o${oi}-label`}
                        value={option.label}
                        maxLength={200}
                        onChange={(event) => {
                          const label = event.target.value;
                          const taken = question.options
                            .filter((_, at) => at !== oi)
                            .map((o) => o.key);
                          patchOption(qi, oi, {
                            label,
                            key: deriveQuestionKey(label, taken),
                          });
                        }}
                      />
                    </div>
                    <div className="w-24">
                      <label
                        className="text-xs text-ink-muted"
                        htmlFor={`${formId}-q${qi}-o${oi}-score`}
                      >
                        {labels.score}
                      </label>
                      <Input
                        id={`${formId}-q${qi}-o${oi}-score`}
                        type="number"
                        value={option.score}
                        min={-1000}
                        max={1000}
                        className="tabular-nums"
                        onChange={(event) =>
                          patchOption(qi, oi, {
                            score: Number.parseInt(event.target.value, 10) || 0,
                          })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="quiet"
                      aria-label={labels.removeAnswer}
                      disabled={question.options.length <= 2}
                      onClick={() =>
                        patch(qi, {
                          options: question.options.filter((_, at) => at !== oi),
                        })
                      }
                    >
                      <Trash size={14} weight="bold" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="quiet"
                  className="justify-self-start"
                  onClick={() =>
                    patch(qi, {
                      options: [
                        ...question.options,
                        {
                          key: deriveQuestionKey(
                            "Answer",
                            question.options.map((o) => o.key),
                          ),
                          label: "Answer",
                          score: 0,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={14} weight="bold" />
                  {labels.addAnswer}
                </Button>
                {question.options.length <= 2 ? (
                  <p className="text-xs text-ink-muted">{labels.twoAnswers}</p>
                ) : null}
              </div>
            </fieldset>
          ))}
        </CardBody>
        <CardFooter>
          <Button
            type="button"
            variant="quiet"
            onClick={() =>
              setQuestions((current) => [...current, blankQuestion(current.map((q) => q.key))])
            }
          >
            <Plus size={15} weight="bold" />
            {labels.addQuestion}
          </Button>
          <Button type="submit" disabled={pending} className="ms-auto">
            {pending ? labels.saving : labels.save}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
