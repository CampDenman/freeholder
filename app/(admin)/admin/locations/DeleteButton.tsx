// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { Button } from "@/ui/primitives";
import { deleteLocationAction, type ActionState } from "../../actions";

/**
 * Delete a location.
 *
 * The confirmation is a native `confirm` on submit rather than a dialog
 * component, which is a deliberate floor rather than a finished design: it
 * works with no JavaScript framework in the loop, it is announced by screen
 * readers, and it cannot be dismissed by a stray click. The service refuses
 * anyway when this is the primary location and others exist.
 */
export function DeleteButton({
  id,
  label,
  confirm: message,
}: {
  id: string;
  label: string;
  confirm: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    deleteLocationAction,
    {},
  );
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
      className="flex items-center gap-3"
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="danger" disabled={pending}>
        {label}
      </Button>
      {state.error ? (
        <span className="text-sm text-danger">{state.error}</span>
      ) : null}
    </form>
  );
}
