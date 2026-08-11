// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import {
  acceptInvitationAction,
  type InvitationActionState,
} from "../invitation-actions";

export interface AcceptInvitationLabels {
  password: string;
  passwordConfirm: string;
  passwordHint: string;
  submit: string;
  accepting: string;
}

export function AcceptInvitationForm({
  token,
  labels,
}: {
  token: string;
  labels: AcceptInvitationLabels;
}) {
  const [state, action, pending] = useActionState<
    InvitationActionState,
    FormData
  >(acceptInvitationAction, {});
  return (
    <form action={action} className="grid gap-5">
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <Field
        label={labels.password}
        htmlFor="invitation-password"
        hint={labels.passwordHint}
      >
        <Input
          id="invitation-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={200}
          required
          autoFocus
        />
      </Field>
      <Field label={labels.passwordConfirm} htmlFor="invitation-password-confirm">
        <Input
          id="invitation-password-confirm"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={200}
          required
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? labels.accepting : labels.submit}
      </Button>
    </form>
  );
}
