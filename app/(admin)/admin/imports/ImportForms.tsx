// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/ui/primitives";
import {
  commitImportAction,
  previewImportAction,
  publishImportAction,
  reconcileImportAction,
  rollbackImportAction,
  startImportAction,
  type ImportActionState,
} from "../../import-actions";

const empty: ImportActionState = {};

export function StartImportForm({
  labels,
}: {
  labels: {
    origin: string;
    kind: string;
    kinds: Array<{ value: string; label: string }>;
    submit: string;
    error: string;
  };
}) {
  const [state, action] = useActionState(startImportAction, empty);
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
      <Field htmlFor="origin" label={labels.origin}>
        <Input id="origin" name="origin" type="url" required />
      </Field>
      <Field htmlFor="kind" label={labels.kind}>
        <Select id="kind" name="kind" defaultValue="html" required>
          {labels.kinds.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit">{labels.submit}</Button>
    </form>
  );
}

export function ImportStepForms({
  id,
  status,
  labels,
}: {
  id: string;
  status: string;
  labels: {
    preview: string;
    url: string;
    slug: string;
    title: string;
    commit: string;
    reconcile: string;
    publish: string;
    rollback: string;
  };
}) {
  return (
    <div className="grid gap-4">
      {status === "discover" || status === "mapped" ? (
        <form action={previewImportAction} className="grid gap-3">
          <input type="hidden" name="id" value={id} />
          <Field htmlFor="url" label={labels.url}>
            <Input id="url" name="url" type="url" required />
          </Field>
          <Field htmlFor="slug" label={labels.slug}>
            <Input id="slug" name="slug" required />
          </Field>
          <Field htmlFor="title" label={labels.title}>
            <Input id="title" name="title" required />
          </Field>
          <Button type="submit">{labels.preview}</Button>
        </form>
      ) : null}
      {status === "previewed" ? (
        <form action={commitImportAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit">{labels.commit}</Button>
        </form>
      ) : null}
      {status === "committed" ? (
        <form action={reconcileImportAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit">{labels.reconcile}</Button>
        </form>
      ) : null}
      {status === "reconciled" ? (
        <form action={publishImportAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit">{labels.publish}</Button>
        </form>
      ) : null}
      {status !== "rolled_back" ? (
        <form action={rollbackImportAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit">{labels.rollback}</Button>
        </form>
      ) : null}
    </div>
  );
}
