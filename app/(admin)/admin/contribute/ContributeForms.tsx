// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/ui/primitives";
import {
  determineContributionAction,
  submitContributionAction,
  updateContributeSettingsAction,
  type ContributeActionState,
} from "../../contribute-actions";

const empty: ContributeActionState = {};

export function SubmitForm({
  labels,
}: {
  labels: {
    kind: string;
    kinds: Array<{ value: string; label: string }>;
    title: string;
    body: string;
    email: string;
    name: string;
    externalUrl: string;
    dco: string;
    dcoSigner: string;
    submit: string;
    error: string;
  };
}) {
  const [state, action] = useActionState(submitContributionAction, empty);
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="kind" label={labels.kind}>
        <Select id="kind" name="kind" defaultValue="bug" required>
          {labels.kinds.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field htmlFor="title" label={labels.title}>
        <Input id="title" name="title" required maxLength={200} />
      </Field>
      <Field htmlFor="body" label={labels.body}>
        <textarea
          id="body"
          name="body"
          required
          maxLength={20_000}
          rows={8}
          className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
        />
      </Field>
      <Field htmlFor="email" label={labels.email}>
        <Input id="email" name="email" type="email" autoComplete="email" />
      </Field>
      <Field htmlFor="name" label={labels.name}>
        <Input id="name" name="name" autoComplete="name" />
      </Field>
      <Field htmlFor="externalUrl" label={labels.externalUrl}>
        <Input id="externalUrl" name="externalUrl" type="url" />
      </Field>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input id="dcoAttested" name="dcoAttested" type="checkbox" className="mt-1" />
        <span>{labels.dco}</span>
      </label>
      <Field htmlFor="dcoSigner" label={labels.dcoSigner}>
        <Input id="dcoSigner" name="dcoSigner" />
      </Field>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}

export function SettingsForm({
  hubEnabled,
  hubUrl,
  labels,
}: {
  hubEnabled: boolean;
  hubUrl: string;
  labels: {
    hubEnabled: string;
    hubUrl: string;
    save: string;
  };
}) {
  const [state, action] = useActionState(updateContributeSettingsAction, empty);
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          id="hubEnabled"
          name="hubEnabled"
          type="checkbox"
          defaultChecked={hubEnabled}
          className="mt-1"
        />
        <span>{labels.hubEnabled}</span>
      </label>
      <Field htmlFor="hubUrl" label={labels.hubUrl}>
        <Input id="hubUrl" name="hubUrl" defaultValue={hubUrl} />
      </Field>
      <Button type="submit" variant="quiet">
        {labels.save}
      </Button>
    </form>
  );
}

export function DetermineForm({
  id,
  labels,
}: {
  id: string;
  labels: {
    status: string;
    statuses: Array<{ value: string; label: string }>;
    note: string;
    checklistId: string;
    parentId: string;
    save: string;
  };
}) {
  const [state, action] = useActionState(determineContributionAction, empty);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="status" label={labels.status}>
        <Select id="status" name="status" defaultValue="triage" required>
          {labels.statuses.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field htmlFor="checklistId" label={labels.checklistId}>
        <Input id="checklistId" name="checklistId" placeholder="C2.12" />
      </Field>
      <Field htmlFor="parentId" label={labels.parentId}>
        <Input id="parentId" name="parentId" />
      </Field>
      <Field htmlFor="note" label={labels.note}>
        <textarea
          id="note"
          name="note"
          rows={3}
          className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
        />
      </Field>
      <Button type="submit">{labels.save}</Button>
    </form>
  );
}
