// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { Button } from "@/ui/primitives";
import { setPrimaryLocationAction, type ActionState } from "../../actions";

/**
 * Make this location the one whose NAP is the site's own (§4.10).
 *
 * A form rather than a link, because it changes two rows and a GET that
 * changes state is a link a crawler can follow.
 */
export function PrimaryButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setPrimaryLocationAction,
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {state.error ? (
        <span className="text-xs text-danger">{state.error}</span>
      ) : null}
      <Button type="submit" variant="quiet" disabled={pending}>
        {label}
      </Button>
    </form>
  );
}
