// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { Button, Callout } from "@/ui/primitives";
import {
  confirmMagicLinkAction,
  type MagicLinkState,
} from "../../actions";

export function ConfirmMagicLink({ labels }: { labels: Record<string, string> }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(
    confirmMagicLinkAction,
    {},
  );
  return (
    <form action={action} className="grid gap-4">
      {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
      <Button type="submit" disabled={pending}>
        {pending ? labels.pending : labels.confirm}
      </Button>
    </form>
  );
}
