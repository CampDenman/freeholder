// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import {
  requestMagicLinkAction,
  type MagicLinkState,
} from "../actions";

export function MagicLinkForm({ labels, returnTo = "/portal" }: { labels: Record<string, string>; returnTo?: string }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(
    requestMagicLinkAction,
    {},
  );
  return (
    <form action={action} className="grid gap-4">
      {state.sent ? <Callout tone="success">{labels.sent}</Callout> : null}
      {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
      <Field label={labels.name!} htmlFor="portal-name"><Input id="portal-name" name="name" autoComplete="name" maxLength={200} /></Field>
      <Field label={labels.email!} htmlFor="portal-email">
        <Input id="portal-email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? labels.pending : labels.submit}
      </Button>
    </form>
  );
}
