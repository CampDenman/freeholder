// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState, type ReactNode } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout } from "@/ui/primitives";
import { updateControlAction, type ActionState } from "../../actions";

/**
 * One form per update action, each with its own pending state.
 *
 * Deliberately not one form for the whole screen: applying an update and
 * saving a policy are days apart in consequence, and a single submit button
 * that could mean either is how an owner ends up cutting over a live site
 * while trying to change a checkbox.
 */
export function UpdateActionForm({
  intent,
  hidden,
  submitLabel,
  pendingLabel,
  variant = "primary",
  disabled = false,
  confirm,
  children,
}: {
  intent: "check" | "preflight" | "apply" | "savePolicy" | "pause" | "resume" | "forkUpdate";
  hidden?: Record<string, string>;
  submitLabel: string;
  pendingLabel: string;
  variant?: "primary" | "quiet" | "danger";
  disabled?: boolean;
  /** Shown as a native confirm before a destructive or irreversible submit. */
  confirm?: string;
  children?: ReactNode;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateControlAction,
    {},
  );
  return (
    <form
      action={action}
      className="grid gap-4"
      aria-busy={pending}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      {state.saved && state.message ? (
        <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
          {state.message}
        </Callout>
      ) : null}
      <div>
        <Button type="submit" variant={variant} disabled={disabled || pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
