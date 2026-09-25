// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Recording and correcting a published fact.
//
// Both forms demand a source and a date, and neither has an "edit" button.
// That shape is the argument made in §4.18 rendered as a screen: a figure
// nobody stands behind should be awkward to publish, and a figure already
// published should be impossible to quietly change.
import { useActionState, useId } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
} from "@/ui/primitives";
import {
  correctFactAction,
  recordFactAction,
  withdrawFactAction,
  type FactActionState,
} from "../../facts-actions";

export interface FactFormLabels {
  recordTitle: string;
  correctTitle: string;
  key: string;
  keyHint: string;
  value: string;
  valueHint: string;
  source: string;
  sourceHint: string;
  asOf: string;
  asOfHint: string;
  validUntil: string;
  validUntilHint: string;
  subjectKind: string;
  subjectId: string;
  subjectHint: string;
  note: string;
  noteHint: string;
  record: string;
  correct: string;
  withdraw: string;
  withdrawReason: string;
  saved: string;
}

export function RecordFactForm({ labels }: { labels: FactFormLabels }) {
  const [state, action, pending] = useActionState<FactActionState, FormData>(
    recordFactAction,
    {},
  );
  const id = useId();
  return (
    <Card>
      <CardHeader title={labels.recordTitle} />
      <form action={action}>
        <CardBody>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={labels.key} htmlFor={`${id}-key`} hint={labels.keyHint}>
              <Input
                id={`${id}-key`}
                name="key"
                required
                maxLength={120}
                pattern="[a-z0-9]+([.-][a-z0-9]+)*"
                className="font-mono"
              />
            </Field>
            <Field label={labels.value} htmlFor={`${id}-value`} hint={labels.valueHint}>
              <Input id={`${id}-value`} name="value" required maxLength={500} />
            </Field>
          </div>
          <Field label={labels.source} htmlFor={`${id}-source`} hint={labels.sourceHint}>
            <Input id={`${id}-source`} name="source" required maxLength={500} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={labels.asOf} htmlFor={`${id}-asOf`} hint={labels.asOfHint}>
              <Input id={`${id}-asOf`} name="asOf" type="datetime-local" required />
            </Field>
            <Field
              label={labels.validUntil}
              htmlFor={`${id}-validUntil`}
              hint={labels.validUntilHint}
            >
              <Input id={`${id}-validUntil`} name="validUntil" type="datetime-local" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={labels.subjectKind} htmlFor={`${id}-sk`} hint={labels.subjectHint}>
              <Input id={`${id}-sk`} name="subjectKind" maxLength={60} className="font-mono" />
            </Field>
            <Field label={labels.subjectId} htmlFor={`${id}-si`}>
              <Input id={`${id}-si`} name="subjectId" maxLength={120} className="font-mono" />
            </Field>
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {labels.record}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function CorrectFactForm({
  factKey,
  subjectKind,
  subjectId,
  labels,
}: {
  factKey: string;
  subjectKind: string | null;
  subjectId: string | null;
  labels: FactFormLabels;
}) {
  const [state, action, pending] = useActionState<FactActionState, FormData>(
    correctFactAction,
    {},
  );
  const id = useId();
  return (
    <Card>
      <CardHeader title={labels.correctTitle} />
      <form action={action}>
        <CardBody>
          <input type="hidden" name="key" value={factKey} />
          {subjectKind ? <input type="hidden" name="subjectKind" value={subjectKind} /> : null}
          {subjectId ? <input type="hidden" name="subjectId" value={subjectId} /> : null}

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

          <Field label={labels.value} htmlFor={`${id}-value`} hint={labels.valueHint}>
            <Input id={`${id}-value`} name="value" required maxLength={500} />
          </Field>
          <Field label={labels.source} htmlFor={`${id}-source`} hint={labels.sourceHint}>
            <Input id={`${id}-source`} name="source" required maxLength={500} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={labels.asOf} htmlFor={`${id}-asOf`} hint={labels.asOfHint}>
              <Input id={`${id}-asOf`} name="asOf" type="datetime-local" required />
            </Field>
            <Field
              label={labels.validUntil}
              htmlFor={`${id}-validUntil`}
              hint={labels.validUntilHint}
            >
              <Input id={`${id}-validUntil`} name="validUntil" type="datetime-local" />
            </Field>
          </div>
          <Field label={labels.note} htmlFor={`${id}-note`} hint={labels.noteHint}>
            <Input id={`${id}-note`} name="note" required maxLength={1000} />
          </Field>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {labels.correct}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function WithdrawFactForm({
  id: factId,
  factKey,
  labels,
}: {
  id: string;
  factKey: string;
  labels: FactFormLabels;
}) {
  const [state, action, pending] = useActionState<FactActionState, FormData>(
    withdrawFactAction,
    {},
  );
  const fieldId = useId();
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={factId} />
      <input type="hidden" name="key" value={factKey} />
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={16} weight="bold" />}>
          {state.error}
        </Callout>
      ) : null}
      <Field label={labels.withdrawReason} htmlFor={`${fieldId}-reason`}>
        <Input id={`${fieldId}-reason`} name="reason" maxLength={1000} />
      </Field>
      <Button type="submit" variant="danger" disabled={pending} className="justify-self-start">
        {labels.withdraw}
      </Button>
    </form>
  );
}
