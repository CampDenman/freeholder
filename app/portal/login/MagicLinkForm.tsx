// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import {
  requestMagicLinkAction,
  type MagicLinkState,
} from "../actions";

export function MagicLinkForm({ labels }: { labels: Record<string, string> }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(
    requestMagicLinkAction,
    {},
  );
  return (
    <form action={action} className="grid gap-4">
      {state.sent ? <Callout tone="success">{labels.sent}</Callout> : null}
      {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
      <Field label={labels.email!} htmlFor="portal-email">
        <Input id="portal-email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? labels.pending : labels.submit}
      </Button>
    </form>
  );
}
