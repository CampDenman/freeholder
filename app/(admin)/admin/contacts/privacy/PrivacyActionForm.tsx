// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState, type ReactNode } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout } from "@/ui/primitives";
import {
  privacyDeskAction,
  type ActionState,
} from "../../../actions";

export function PrivacyActionForm({
  intent,
  hidden = {},
  submitLabel,
  pendingLabel,
  variant = "primary",
  disabled = false,
  children,
  className = "grid gap-4",
}: {
  intent: string;
  hidden?: Record<string, string>;
  submitLabel: string;
  pendingLabel: string;
  variant?: "primary" | "quiet" | "danger";
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    privacyDeskAction,
    {},
  );
  return (
    <form action={action} className={className} aria-busy={pending}>
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(hidden).map(([name, value]) => (
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
