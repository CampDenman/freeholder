// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Building a calculation out of named steps.
//
// Every operand is chosen, never typed as an expression: a number the owner
// supplies, an answer the visitor gives, a figure the business published, or
// an earlier step. That shape is the safety property made visible — there is
// no box here into which somebody could write code, because there is no box
// that takes a formula.
//
// The published-figure option is the one worth noticing. Choosing it means the
// number in the sum is whatever the business currently stands behind, with its
// source and date, and the calculator will decline rather than compute if that
// figure has gone stale.
import { useActionState, useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle, Plus, Trash, WarningCircle } from "@phosphor-icons/react/dist/ssr";
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
  OPERATIONS,
  configurationProblems,
  type CalculatorInput,
  type CalculatorStep,
  type CalculatorTerm,
} from "@/modules/calculators/formula";
import {
  saveCalculatorAction,
  type CalculatorActionState,
} from "../../calculators-actions";

export interface CalculatorBuilderLabels {
  aboutTitle: string;
  name: string;
  slug: string;
  slugHint: string;
  intro: string;
  resultLabel: string;
  resultLabelHint: string;
  resultUnit: string;
  assumptions: string;
  assumptionsHint: string;
  askTitle: string;
  noInputs: string;
  inputLabel: string;
  key: string;
  unit: string;
  min: string;
  max: string;
  addInput: string;
  removeInput: string;
  stepsTitle: string;
  noSteps: string;
  step: string;
  stepLabel: string;
  operation: string;
  first: string;
  second: string;
  termKind: string;
  termLiteral: string;
  termInput: string;
  termFact: string;
  termStep: string;
  termValue: string;
  termFactExample: string;
  addStep: string;
  removeStep: string;
  moveUp: string;
  moveDown: string;
  problems: string;
  save: string;
  saving: string;
  saved: string;
}

export interface BuilderCalculator {
  id?: string;
  slug: string;
  name: string;
  intro: string | null;
  inputs: CalculatorInput[];
  steps: CalculatorStep[];
  resultLabel: string;
  resultUnit: string | null;
  assumptions: string;
}

const CONTROL =
  "w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-muted focus-visible:border-accent";

function blankTerm(): CalculatorTerm {
  return { kind: "literal", value: 0 };
}

/** One operand: what kind of number it is, then which one. */
function TermFields({
  id,
  label,
  term,
  inputs,
  earlier,
  labels,
  onChange,
}: {
  id: string;
  label: string;
  term: CalculatorTerm;
  inputs: CalculatorInput[];
  earlier: CalculatorStep[];
  labels: CalculatorBuilderLabels;
  onChange: (next: CalculatorTerm) => void;
}) {
  return (
    <div className="grid gap-2 rounded-md bg-surface-muted p-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <Select
        aria-label={labels.termKind}
        value={term.kind}
        onChange={(event) => {
          const kind = event.target.value as CalculatorTerm["kind"];
          if (kind === "literal") onChange({ kind, value: 0 });
          else if (kind === "input") onChange({ kind, key: inputs[0]?.key ?? "" });
          else if (kind === "step") onChange({ kind, key: earlier[0]?.key ?? "" });
          else onChange({ kind: "fact", factKey: "" });
        }}
      >
        <option value="literal">{labels.termLiteral}</option>
        <option value="input">{labels.termInput}</option>
        <option value="fact">{labels.termFact}</option>
        <option value="step">{labels.termStep}</option>
      </Select>

      {term.kind === "literal" ? (
        <Input
          id={id}
          type="number"
          step="any"
          aria-label={labels.termValue}
          value={term.value}
          className="tabular-nums"
          onChange={(event) =>
            onChange({ kind: "literal", value: Number(event.target.value) || 0 })
          }
        />
      ) : null}

      {term.kind === "input" ? (
        <Select
          id={id}
          aria-label={labels.termValue}
          value={term.key}
          onChange={(event) => onChange({ kind: "input", key: event.target.value })}
        >
          {inputs.map((input) => (
            <option key={input.key} value={input.key}>
              {input.label}
            </option>
          ))}
        </Select>
      ) : null}

      {term.kind === "step" ? (
        <Select
          id={id}
          aria-label={labels.termValue}
          value={term.key}
          onChange={(event) => onChange({ kind: "step", key: event.target.value })}
        >
          {earlier.map((step) => (
            <option key={step.key} value={step.key}>
              {step.label}
            </option>
          ))}
        </Select>
      ) : null}

      {term.kind === "fact" ? (
        <Input
          id={id}
          aria-label={labels.termValue}
          value={term.factKey}
          placeholder={labels.termFactExample}
          className="font-mono"
          onChange={(event) => onChange({ kind: "fact", factKey: event.target.value })}
        />
      ) : null}
    </div>
  );
}

export function CalculatorBuilder({
  calculator,
  labels,
}: {
  calculator: BuilderCalculator;
  labels: CalculatorBuilderLabels;
}) {
  const [state, action, pending] = useActionState<CalculatorActionState, FormData>(
    saveCalculatorAction,
    {},
  );
  const [inputs, setInputs] = useState<CalculatorInput[]>(calculator.inputs);
  const [steps, setSteps] = useState<CalculatorStep[]>(calculator.steps);
  const formId = useId();

  // The same function the service refuses with, so the warning here and the
  // refusal there can never disagree.
  const problems = useMemo(
    () => configurationProblems(inputs, steps),
    [inputs, steps],
  );

  function patchStep(index: number, next: Partial<CalculatorStep>) {
    setSteps((current) =>
      current.map((step, at) => (at === index ? { ...step, ...next } : step)),
    );
  }

  function move(index: number, by: -1 | 1) {
    setSteps((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <form action={action} className="grid gap-6">
      {calculator.id ? <input type="hidden" name="id" value={calculator.id} /> : null}
      <input type="hidden" name="inputs" value={JSON.stringify(inputs)} />
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />

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
      {problems.length ? (
        <Callout tone="warning" icon={<WarningCircle size={16} weight="bold" />}>
          {`${labels.problems} ${problems.join(" ")}`}
        </Callout>
      ) : null}

      <Card>
        <CardHeader title={labels.aboutTitle} />
        <CardBody>
          <Field label={labels.name} htmlFor={`${formId}-name`}>
            <Input id={`${formId}-name`} name="name" defaultValue={calculator.name} required maxLength={120} />
          </Field>
          {calculator.id ? null : (
            <Field label={labels.slug} htmlFor={`${formId}-slug`} hint={labels.slugHint}>
              <Input
                id={`${formId}-slug`}
                name="slug"
                defaultValue={calculator.slug}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={60}
              />
            </Field>
          )}
          <Field label={labels.intro} htmlFor={`${formId}-intro`}>
            <textarea
              id={`${formId}-intro`}
              name="intro"
              rows={2}
              maxLength={2000}
              defaultValue={calculator.intro ?? ""}
              className={CONTROL}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={labels.resultLabel}
              htmlFor={`${formId}-resultLabel`}
              hint={labels.resultLabelHint}
            >
              <Input
                id={`${formId}-resultLabel`}
                name="resultLabel"
                defaultValue={calculator.resultLabel}
                required
                maxLength={120}
              />
            </Field>
            <Field label={labels.resultUnit} htmlFor={`${formId}-resultUnit`}>
              <Input
                id={`${formId}-resultUnit`}
                name="resultUnit"
                defaultValue={calculator.resultUnit ?? ""}
                maxLength={24}
              />
            </Field>
          </div>
          <Field
            label={labels.assumptions}
            htmlFor={`${formId}-assumptions`}
            hint={labels.assumptionsHint}
          >
            <textarea
              id={`${formId}-assumptions`}
              name="assumptions"
              rows={3}
              maxLength={4000}
              defaultValue={calculator.assumptions}
              required
              className={CONTROL}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={labels.askTitle} />
        <CardBody>
          {inputs.length === 0 ? (
            <p className="text-sm text-ink-muted">{labels.noInputs}</p>
          ) : null}
          {inputs.map((input, index) => (
            <div key={index} className="grid gap-3 rounded-md border border-rule p-3 sm:grid-cols-5">
              <Field label={labels.inputLabel} htmlFor={`${formId}-i${index}-label`}>
                <Input
                  id={`${formId}-i${index}-label`}
                  value={input.label}
                  maxLength={200}
                  onChange={(event) =>
                    setInputs((current) =>
                      current.map((row, at) =>
                        at === index ? { ...row, label: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={labels.key} htmlFor={`${formId}-i${index}-key`}>
                <Input
                  id={`${formId}-i${index}-key`}
                  value={input.key}
                  maxLength={40}
                  className="font-mono"
                  onChange={(event) =>
                    setInputs((current) =>
                      current.map((row, at) =>
                        at === index ? { ...row, key: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={labels.unit} htmlFor={`${formId}-i${index}-unit`}>
                <Input
                  id={`${formId}-i${index}-unit`}
                  value={input.unit ?? ""}
                  maxLength={24}
                  onChange={(event) =>
                    setInputs((current) =>
                      current.map((row, at) =>
                        at === index ? { ...row, unit: event.target.value || undefined } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={labels.min} htmlFor={`${formId}-i${index}-min`}>
                <Input
                  id={`${formId}-i${index}-min`}
                  type="number"
                  step="any"
                  value={input.min ?? ""}
                  className="tabular-nums"
                  onChange={(event) =>
                    setInputs((current) =>
                      current.map((row, at) =>
                        at === index
                          ? {
                              ...row,
                              min: event.target.value === "" ? undefined : Number(event.target.value),
                            }
                          : row,
                      ),
                    )
                  }
                />
              </Field>
              <div className="flex items-end gap-2">
                <Field label={labels.max} htmlFor={`${formId}-i${index}-max`}>
                  <Input
                    id={`${formId}-i${index}-max`}
                    type="number"
                    step="any"
                    value={input.max ?? ""}
                    className="tabular-nums"
                    onChange={(event) =>
                      setInputs((current) =>
                        current.map((row, at) =>
                          at === index
                            ? {
                                ...row,
                                max: event.target.value === "" ? undefined : Number(event.target.value),
                              }
                            : row,
                        ),
                      )
                    }
                  />
                </Field>
                <Button
                  type="button"
                  variant="danger"
                  aria-label={labels.removeInput}
                  onClick={() => setInputs((current) => current.filter((_, at) => at !== index))}
                >
                  <Trash size={14} weight="bold" />
                </Button>
              </div>
            </div>
          ))}
        </CardBody>
        <CardFooter>
          <Button
            type="button"
            variant="quiet"
            onClick={() =>
              setInputs((current) => [
                ...current,
                { key: `answer_${current.length + 1}`, label: "A number they give", required: true } as CalculatorInput,
              ])
            }
          >
            <Plus size={15} weight="bold" />
            {labels.addInput}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader title={labels.stepsTitle} />
        <CardBody>
          {steps.length === 0 ? <p className="text-sm text-ink-muted">{labels.noSteps}</p> : null}
          {steps.map((step, index) => (
            <fieldset key={index} className="grid gap-3 rounded-md border border-rule p-4">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {labels.step.replace("%n%", String(index + 1))}
              </legend>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="quiet" aria-label={labels.moveUp} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp size={14} weight="bold" />
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  aria-label={labels.moveDown}
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} weight="bold" />
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="ms-auto"
                  onClick={() => setSteps((current) => current.filter((_, at) => at !== index))}
                >
                  <Trash size={14} weight="bold" />
                  {labels.removeStep}
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={labels.stepLabel} htmlFor={`${formId}-s${index}-label`}>
                  <Input
                    id={`${formId}-s${index}-label`}
                    value={step.label}
                    maxLength={160}
                    onChange={(event) => patchStep(index, { label: event.target.value })}
                  />
                </Field>
                <Field label={labels.key} htmlFor={`${formId}-s${index}-key`}>
                  <Input
                    id={`${formId}-s${index}-key`}
                    value={step.key}
                    maxLength={40}
                    className="font-mono"
                    onChange={(event) => patchStep(index, { key: event.target.value })}
                  />
                </Field>
                <Field label={labels.operation} htmlFor={`${formId}-s${index}-op`}>
                  <Select
                    id={`${formId}-s${index}-op`}
                    value={step.op}
                    onChange={(event) =>
                      patchStep(index, { op: event.target.value as CalculatorStep["op"] })
                    }
                  >
                    {OPERATIONS.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <TermFields
                  id={`${formId}-s${index}-first`}
                  label={labels.first}
                  term={step.first}
                  inputs={inputs}
                  earlier={steps.slice(0, index)}
                  labels={labels}
                  onChange={(term) => patchStep(index, { first: term })}
                />
                <TermFields
                  id={`${formId}-s${index}-second`}
                  label={labels.second}
                  term={step.second}
                  inputs={inputs}
                  earlier={steps.slice(0, index)}
                  labels={labels}
                  onChange={(term) => patchStep(index, { second: term })}
                />
              </div>
            </fieldset>
          ))}
        </CardBody>
        <CardFooter>
          <Button
            type="button"
            variant="quiet"
            onClick={() =>
              setSteps((current) => [
                ...current,
                {
                  key: `step_${current.length + 1}`,
                  label: "A step",
                  op: "multiply",
                  first: blankTerm(),
                  second: blankTerm(),
                },
              ])
            }
          >
            <Plus size={15} weight="bold" />
            {labels.addStep}
          </Button>
          <Button type="submit" disabled={pending} className="ms-auto">
            {pending ? labels.saving : labels.save}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
