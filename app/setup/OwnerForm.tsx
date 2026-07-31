// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { createOwnerAction, type ActionState } from "./actions";

/**
 * Strings arrive as props rather than being looked up here.
 *
 * This is a client component, and the catalogs are server-side JSON: importing
 * `t` would ship every locale's strings to the browser and re-implement locale
 * resolution on both sides of the boundary. The server already knows the
 * locale, so it translates and passes the result down (MASTER.md §4.9).
 */
export interface OwnerFormLabels {
  email: string;
  emailHint: string;
  emailPlaceholder: string;
  password: string;
  passwordHint: string;
  submit: string;
  pending: string;
}

export function OwnerForm({ labels }: { labels: OwnerFormLabels }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createOwnerAction,
    {},
  );
  return (
    <form action={action} className="grid gap-5">
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      <Field label={labels.email} htmlFor="email" hint={labels.emailHint}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={labels.emailPlaceholder}
        />
      </Field>
      <Field
        label={labels.password}
        htmlFor="password"
        hint={labels.passwordHint}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
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
