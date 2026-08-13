// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { signInAction, type ActionState } from "../actions";

export interface SignInFormLabels {
  email: string;
  password: string;
  submit: string;
  pending: string;
}

export function SignInForm({ labels }: { labels: SignInFormLabels }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    signInAction,
    {},
  );
  const generation = state.attempt ?? 0;

  return (
    <form action={action} className="grid gap-5">
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      <Field label={labels.email} htmlFor="email">
        <Input
          key={`email-${generation}`}
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={state.values?.email ?? ""}
          required
          autoFocus
        />
      </Field>
      <Field label={labels.password} htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </Button>
      </div>
    </form>
  );
}
