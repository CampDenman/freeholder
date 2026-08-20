// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState } from "react";
import { Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/ui/primitives";
import {
  createPlaybookAction,
  importPlaybookAction,
  type PlaybookActionState,
} from "../../../playbook-actions";

const empty: PlaybookActionState = {};

export interface PlaybookFormLabels {
  create: string;
  name: string;
  description: string;
  brief: string;
  briefHint: string;
  params: string;
  paramsHint: string;
  trigger: string;
  triggerManual: string;
  triggerSchedule: string;
  triggerEvent: string;
  cron: string;
  event: string;
  ceiling: string;
  ceilingNone: string;
  budget: string;
  submit: string;
  importTitle: string;
  importHint: string;
  document: string;
  importName: string;
  importSubmit: string;
  suggest: string;
  approve: string;
  autonomous: string;
}

export function PlaybookForms({ labels }: { labels: PlaybookFormLabels }) {
  const [created, createAction] = useActionState(createPlaybookAction, empty);
  const [imported, importAction] = useActionState(importPlaybookAction, empty);

  return (
    <>
      <Card>
        <CardHeader title={labels.create} />
        <CardBody>
          <form action={createAction} className="grid gap-4">
            {created.error ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {created.error}
              </p>
            ) : null}
            <Field htmlFor="name" label={labels.name}>
              <Input id="name" name="name" required maxLength={120} />
            </Field>
            <Field htmlFor="description" label={labels.description}>
              <Input id="description" name="description" maxLength={2000} />
            </Field>
            <Field htmlFor="briefTemplate" label={labels.brief} hint={labels.briefHint}>
              <textarea
                id="briefTemplate"
                name="briefTemplate"
                required
                rows={4}
                maxLength={50000}
                className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field htmlFor="params" label={labels.params} hint={labels.paramsHint}>
              <textarea
                id="params"
                name="params"
                rows={3}
                className="w-full rounded-md border border-rule bg-field px-3 py-2 font-mono text-sm text-ink"
              />
            </Field>
            <Field htmlFor="trigger" label={labels.trigger}>
              <Select id="trigger" name="trigger" defaultValue="manual">
                <option value="manual">{labels.triggerManual}</option>
                <option value="schedule">{labels.triggerSchedule}</option>
                <option value="event">{labels.triggerEvent}</option>
              </Select>
            </Field>
            <Field htmlFor="scheduleCron" label={labels.cron}>
              <Input id="scheduleCron" name="scheduleCron" maxLength={120} />
            </Field>
            <Field htmlFor="eventPattern" label={labels.event}>
              <Input id="eventPattern" name="eventPattern" maxLength={200} />
            </Field>
            <Field htmlFor="autonomyCeiling" label={labels.ceiling}>
              <Select id="autonomyCeiling" name="autonomyCeiling" defaultValue="">
                <option value="">{labels.ceilingNone}</option>
                <option value="suggest">{labels.suggest}</option>
                <option value="approve">{labels.approve}</option>
                <option value="autonomous">{labels.autonomous}</option>
              </Select>
            </Field>
            <Field htmlFor="budgetCents" label={labels.budget}>
              <Input id="budgetCents" name="budgetCents" type="number" min={0} />
            </Field>
            <Button type="submit">{labels.submit}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={labels.importTitle} />
        <CardBody>
          <form action={importAction} className="grid gap-4">
            {imported.error ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {imported.error}
              </p>
            ) : null}
            <p className="text-sm text-ink-muted">{labels.importHint}</p>
            <Field htmlFor="document" label={labels.document}>
              <textarea
                id="document"
                name="document"
                required
                rows={5}
                className="w-full rounded-md border border-rule bg-field px-3 py-2 font-mono text-sm text-ink"
              />
            </Field>
            <Field htmlFor="importName" label={labels.importName}>
              <Input id="importName" name="name" maxLength={120} />
            </Field>
            <Button type="submit">{labels.importSubmit}</Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
