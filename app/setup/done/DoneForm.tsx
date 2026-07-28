// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout } from "@/ui/primitives";
import { completeSetupAction, type ActionState } from "../actions";

export function DoneForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    completeSetupAction,
    {},
  );
  return (
    <form action={action} className="grid gap-5">
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Finishing…" : "Finish setup"}
        </Button>
      </div>
    </form>
  );
}
