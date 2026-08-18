// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { createFromTemplateAction, type SaveResult } from "../../../cms-actions";

export function CreateFromTemplateForm({
  templateKey,
  labels,
}: {
  templateKey: string;
  labels: {
    title: string;
    slug: string;
    slugHint: string;
    submit: string;
    pending: string;
  };
}) {
  const [state, action, pending] = useActionState<SaveResult, FormData>(
    createFromTemplateAction,
    {},
  );
  return (
    <form action={action} className="grid gap-4 rounded-lg border border-rule p-4">
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      <input type="hidden" name="key" value={templateKey} />
      <Field label={labels.title} htmlFor="from-template-title">
        <Input id="from-template-title" name="title" required />
      </Field>
      <Field label={labels.slug} htmlFor="from-template-slug" hint={labels.slugHint}>
        <Input id="from-template-slug" name="slug" className="font-mono" />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </Button>
      </div>
    </form>
  );
}
