// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Changing your own password (MASTER.md §9).
//
// Separate from the business settings form on purpose. They save to different
// services with different permissions, and one submit button that sometimes
// changes a password and sometimes changes a tagline is a button nobody should
// have to think about before pressing.
import { useActionState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { changePasswordAction, type ActionState } from "../../actions";
import { Callout, Card, CardBody, CardHeader, Field, Input } from "@/ui/primitives";

export interface PasswordFormLabels {
  cardTitle: string;
  intro: string;
  current: string;
  next: string;
  nextHint: string;
  submit: string;
}

export function PasswordForm({ labels }: { labels: PasswordFormLabels }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <form action={action}>
      <Card>
        <CardHeader title={labels.cardTitle} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{labels.intro}</p>

          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}
          {state.saved ? (
            <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
              {state.message}
            </Callout>
          ) : null}

          <Field label={labels.current} htmlFor="currentPassword">
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>

          <Field
            label={labels.next}
            htmlFor="newPassword"
            hint={labels.nextHint}
          >
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              // Tells a password manager to offer a generated one, which is
              // the outcome worth steering somebody towards.
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Field>

          <button
            type="submit"
            disabled={pending}
            className="inline-flex w-fit items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)] disabled:opacity-60"
          >
            {labels.submit}
          </button>
        </CardBody>
      </Card>
    </form>
  );
}
