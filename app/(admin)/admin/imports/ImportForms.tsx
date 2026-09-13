// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/ui/primitives";
import {
  commitImportAction,
  mapImportAction,
  previewImportAction,
  publishImportAction,
  reconcileImportAction,
  reviewImportConflictsAction,
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
    pageKind: string;
    page: string;
    post: string;
    map: string;
    review: string;
    keep: string;
    replace: string;
    rename: string;
    renamedSlug: string;
    commit: string;
    reconcile: string;
    publish: string;
    rollback: string;
  };
}) {
  return (
    <div className="grid gap-4">
      {status === "discover" ? (
        <form action={mapImportAction} className="grid gap-3">
          <input type="hidden" name="id" value={id} />
          <Field htmlFor="map-url" label={labels.url}>
            <Input id="map-url" name="url" type="url" required />
          </Field>
          <Field htmlFor="map-slug" label={labels.slug}>
            <Input id="map-slug" name="slug" required />
          </Field>
          <Field htmlFor="map-title" label={labels.title}>
            <Input id="map-title" name="title" required />
          </Field>
          <Field htmlFor="map-kind" label={labels.pageKind}>
            <Select id="map-kind" name="kind" defaultValue="page">
              <option value="page">{labels.page}</option>
              <option value="post">{labels.post}</option>
            </Select>
          </Field>
          <Button type="submit">{labels.map}</Button>
        </form>
      ) : null}
      {status === "mapped" ? (
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
        <form action={reviewImportConflictsAction} className="grid gap-3">
          <input type="hidden" name="id" value={id} />
          <Field htmlFor="conflict-slug" label={labels.slug}>
            <Input id="conflict-slug" name="slug" required />
          </Field>
          <Field htmlFor="conflict-resolution" label={labels.review}>
            <Select id="conflict-resolution" name="resolution" defaultValue="keep-existing">
              <option value="keep-existing">{labels.keep}</option>
              <option value="replace">{labels.replace}</option>
              <option value="rename">{labels.rename}</option>
            </Select>
          </Field>
          <Field htmlFor="conflict-renamed" label={labels.renamedSlug}>
            <Input id="conflict-renamed" name="renamedSlug" />
          </Field>
          <Button type="submit">{labels.review}</Button>
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
