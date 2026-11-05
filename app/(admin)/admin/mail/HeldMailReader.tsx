// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// One held preview message, opened on request (C3.36). The body is fetched by
// the audited `mail.openHeld` action only when the owner asks for it, and is
// shown as plain text: links become anchors, nothing else is interpreted.
import { useActionState } from "react";
import { Button, Callout } from "@/ui/primitives";
import { openHeldMailAction, type HeldMailState } from "../../mail-preview-actions";

const LINK = /(https?:\/\/[^\s<>"']+)/g;

function linked(text: string) {
  return text.split(LINK).map((part, index) =>
    index % 2 === 1 ? (
      <a key={index} href={part} className="break-all text-accent underline" rel="noreferrer">
        {part}
      </a>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

export function HeldMailReader({
  id,
  labels,
}: {
  id: string;
  labels: { open: string; opening: string; to: string };
}) {
  const [state, action, pending] = useActionState<HeldMailState, FormData>(openHeldMailAction, {});
  return (
    <div className="grid gap-2">
      {state.opened ? (
        <div className="grid gap-1 rounded-md border border-rule bg-surface-muted p-3">
          <p className="text-xs text-ink-muted">
            {labels.to} <span className="font-mono text-ink">{state.opened.recipient}</span>
          </p>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-ink">{linked(state.opened.text)}</pre>
        </div>
      ) : (
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="quiet" disabled={pending}>
            {pending ? labels.opening : labels.open}
          </Button>
        </form>
      )}
      {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
    </div>
  );
}
