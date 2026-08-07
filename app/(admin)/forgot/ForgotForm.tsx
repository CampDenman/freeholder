// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { requestResetAction, type ResetState } from "../reset-actions";

export interface ForgotFormLabels {
  email: string;
  submit: string;
  sent: string;
}

export function ForgotForm({ labels }: { labels: ForgotFormLabels }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    requestResetAction,
    {},
  );

  // The confirmation replaces the form rather than sitting under it: somebody
  // who sees their own address still in a box wonders whether it went, and
  // pressing send four times is the usual result.
  if (state.sent) {
    return (
      <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
        {labels.sent}
      </Callout>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      <Field label={labels.email} htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
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
