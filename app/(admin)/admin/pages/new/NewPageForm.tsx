// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { createPageAction, type SaveResult } from "../../../cms-actions";

export function NewPageForm({
  labels,
  templates,
}: {
  labels: {
    title: string;
    slug: string;
    slugHint: string;
    template: string;
    templateNone: string;
    submit: string;
    pending: string;
  };
  templates: { key: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<SaveResult, FormData>(
    createPageAction,
    {},
  );
  return (
    <form action={action} className="grid gap-5">
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      <Field label={labels.title} htmlFor="title">
        <Input id="title" name="title" required autoFocus />
      </Field>
      <Field label={labels.slug} htmlFor="slug" hint={labels.slugHint}>
        <Input id="slug" name="slug" className="font-mono" />
      </Field>
      {templates.length > 0 ? (
        <Field label={labels.template} htmlFor="templateKey">
          <select
            id="templateKey"
            name="templateKey"
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
            defaultValue=""
          >
            <option value="">{labels.templateNone}</option>
            {templates.map((template) => (
              <option key={template.key} value={template.key}>
                {template.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </Button>
      </div>
    </form>
  );
}
