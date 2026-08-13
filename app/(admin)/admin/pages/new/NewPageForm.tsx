// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { createPageAction, type SaveResult } from "../../../cms-actions";

export function NewPageForm({
  labels,
}: {
  labels: {
    title: string;
    slug: string;
    slugHint: string;
    submit: string;
    pending: string;
  };
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
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </Button>
      </div>
    </form>
  );
}
