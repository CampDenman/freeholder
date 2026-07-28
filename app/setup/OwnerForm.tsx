// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { createOwnerAction, type ActionState } from "./actions";

export function OwnerForm() {
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
      <Field label="Email" htmlFor="email" hint="You will sign in with this.">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@yourbusiness.com"
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        hint="At least 12 characters. A passphrase beats a short complicated one."
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
          {pending ? "Creating account…" : "Create owner account"}
        </Button>
      </div>
    </form>
  );
}
