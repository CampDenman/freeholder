// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { resetPasswordAction, type ResetState } from "../reset-actions";

export interface ResetFormLabels {
  password: string;
  hint: string;
  submit: string;
  done: string;
  backToSignIn: string;
}

export function ResetForm({
  token,
  labels,
}: {
  token: string;
  labels: ResetFormLabels;
}) {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    resetPasswordAction,
    {},
  );

  if (state.done) {
    return (
      <div className="grid gap-5">
        <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
          {labels.done}
        </Callout>
        <a href="/login" className="text-sm font-medium text-accent">
          {labels.backToSignIn}
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      {/* The token rides the form rather than being read from the URL by the
          action: a Server Action does not see the page's query string. */}
      <input type="hidden" name="token" value={token} />
      <Field label={labels.password} htmlFor="newPassword" hint={labels.hint}>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          autoFocus
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {labels.submit}
      </Button>
    </form>
  );
}
