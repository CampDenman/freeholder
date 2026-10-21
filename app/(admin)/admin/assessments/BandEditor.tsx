// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Authoring the outcomes, and showing which scores still have none.
//
// This is the screen the whole module exists for. What an owner types into
// "What the person is told" is the only text a respondent will ever see — no
// template wraps it, nothing summarises it, and there is no path by which it
// becomes anything else. So the box is large, and the help beside it says
// exactly that.
//
// The coverage strip is the other half. Publishing is refused while any
// reachable score has no band, and finding that out at publish time is finding
// it out too late to think about, so the gaps are listed here, live, against
// the same `coverageGaps` the service refuses with.
import { useActionState, useId, useMemo, useState } from "react";
import { CheckCircle, Plus, Trash, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
  Pill,
} from "@/ui/primitives";
import { coverageGaps, describeGaps } from "@/modules/assessments/scoring";
import {
  deleteBandAction,
  saveBandAction,
  type AssessmentActionState,
} from "../../assessments-actions";

export interface BandLabels {
  title: string;
  intro: string;
  empty: string;
  label: string;
  key: string;
  keyHint: string;
  min: string;
  max: string;
  body: string;
  bodyHint: string;
  add: string;
  save: string;
  cancel: string;
  remove: string;
  covered: string;
  coveredDetail: string;
  gaps: string;
  gapsDetail: string;
}

export interface EditableBand {
  id: string;
  key: string;
  label: string;
  body: string;
  minScore: number;
  maxScore: number;
  ordinal: number;
}

const CONTROL =
  "w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-muted focus-visible:border-accent";

export function BandEditor({
  assessmentId,
  bands,
  range,
  labels,
}: {
  assessmentId: string;
  bands: EditableBand[];
  range: { min: number; max: number };
  labels: BandLabels;
}) {
  const [saveState, save, saving] = useActionState<AssessmentActionState, FormData>(
    saveBandAction,
    {},
  );
  const [removeState, remove] = useActionState<AssessmentActionState, FormData>(
    deleteBandAction,
    {},
  );
  const [adding, setAdding] = useState(false);
  const formId = useId();

  const gaps = useMemo(() => coverageGaps(bands, range), [bands, range]);

  return (
    <Card>
      <CardHeader
        title={labels.title}
        status={
          gaps.length === 0 ? (
            <Pill tone="success">{labels.covered}</Pill>
          ) : (
            <Pill tone="warning">{labels.gaps}</Pill>
          )
        }
      />
      <CardBody>
        <p className="text-sm text-ink-muted">{labels.intro}</p>

        {gaps.length === 0 ? (
          <Callout tone="success" icon={<CheckCircle size={16} weight="bold" />}>
            {labels.coveredDetail
              .replace("%min%", String(range.min))
              .replace("%max%", String(range.max))}
          </Callout>
        ) : (
          <Callout tone="warning" icon={<WarningCircle size={16} weight="bold" />}>
            {labels.gapsDetail.replace("%gaps%", describeGaps(gaps))}
          </Callout>
        )}

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

        {bands.length === 0 ? <p className="text-sm text-ink-muted">{labels.empty}</p> : null}

        {bands.map((band) => (
          <form
            key={band.id}
            action={save}
            className="grid gap-3 rounded-md border border-rule p-4"
          >
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <input type="hidden" name="id" value={band.id} />
            <input type="hidden" name="ordinal" value={band.ordinal} />

            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={labels.label} htmlFor={`${formId}-${band.id}-label`}>
                <Input
                  id={`${formId}-${band.id}-label`}
                  name="label"
                  defaultValue={band.label}
                  maxLength={120}
                  required
                />
              </Field>
              <Field label={labels.key} htmlFor={`${formId}-${band.id}-key`} hint={labels.keyHint}>
                <Input
                  id={`${formId}-${band.id}-key`}
                  name="key"
                  defaultValue={band.key}
                  maxLength={40}
                  required
                  className="font-mono"
                />
              </Field>
              <Field label={labels.min} htmlFor={`${formId}-${band.id}-min`}>
                <Input
                  id={`${formId}-${band.id}-min`}
                  name="minScore"
                  type="number"
                  defaultValue={band.minScore}
                  className="tabular-nums"
                  required
                />
              </Field>
              <Field label={labels.max} htmlFor={`${formId}-${band.id}-max`}>
                <Input
                  id={`${formId}-${band.id}-max`}
                  name="maxScore"
                  type="number"
                  defaultValue={band.maxScore}
                  className="tabular-nums"
                  required
                />
              </Field>
            </div>

            <Field label={labels.body} htmlFor={`${formId}-${band.id}-body`} hint={labels.bodyHint}>
              <textarea
                id={`${formId}-${band.id}-body`}
                name="body"
                rows={4}
                maxLength={4000}
                defaultValue={band.body}
                required
                className={CONTROL}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="quiet" disabled={saving}>
                {labels.save}
              </Button>
              <span className="ms-auto" />
            </div>
          </form>
        ))}

        {/* Deleting is its own form: a destructive verb inside the edit form
            would submit the edits on the way out. */}
        {bands.length ? (
          <div className="flex flex-wrap gap-2">
            {bands.map((band) => (
              <form key={`del-${band.id}`} action={remove}>
                <input type="hidden" name="assessmentId" value={assessmentId} />
                <input type="hidden" name="id" value={band.id} />
                <Button type="submit" variant="danger">
                  <Trash size={14} weight="bold" />
                  {labels.remove.replace("%label%", band.label)}
                </Button>
              </form>
            ))}
          </div>
        ) : null}

        {adding ? (
          <form action={save} className="grid gap-3 rounded-md border border-accent p-4">
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <input type="hidden" name="ordinal" value={bands.length} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={labels.label} htmlFor={`${formId}-new-label`}>
                <Input id={`${formId}-new-label`} name="label" required maxLength={120} />
              </Field>
              <Field label={labels.key} htmlFor={`${formId}-new-key`} hint={labels.keyHint}>
                <Input
                  id={`${formId}-new-key`}
                  name="key"
                  required
                  maxLength={40}
                  pattern="[a-z][a-z0-9_]*"
                  className="font-mono"
                />
              </Field>
              <Field label={labels.min} htmlFor={`${formId}-new-min`}>
                <Input
                  id={`${formId}-new-min`}
                  name="minScore"
                  type="number"
                  defaultValue={gaps[0]?.from ?? range.min}
                  required
                  className="tabular-nums"
                />
              </Field>
              <Field label={labels.max} htmlFor={`${formId}-new-max`}>
                <Input
                  id={`${formId}-new-max`}
                  name="maxScore"
                  type="number"
                  defaultValue={gaps[0]?.to ?? range.max}
                  required
                  className="tabular-nums"
                />
              </Field>
            </div>
            <Field label={labels.body} htmlFor={`${formId}-new-body`} hint={labels.bodyHint}>
              <textarea
                id={`${formId}-new-body`}
                name="body"
                rows={4}
                maxLength={4000}
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
        {adding ? null : (
          <Button type="button" variant="quiet" onClick={() => setAdding(true)}>
            <Plus size={15} weight="bold" />
            {labels.add}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
