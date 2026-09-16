// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { Button, Input } from "@/ui/primitives";
import { voiceVideoInviteAction } from "../../first-party-plugin-actions";

export function GuestInvite({ roomId, label, help }: { roomId: string; label: string; help: string }) {
  const [state, action, pending] = useActionState(voiceVideoInviteAction, {});
  return <form action={action} className="grid gap-2">
    <input type="hidden" name="roomId" value={roomId} />
    <Button type="submit" variant="quiet" disabled={pending}>{label}</Button>
    {state.error ? <p role="alert" className="text-danger">{state.error}</p> : null}
    {state.inviteTokenUrl ? <>
      <Input aria-label={label} readOnly value={state.inviteTokenUrl} onFocus={event => event.currentTarget.select()} />
      <p className="text-sm text-ink-muted">{help}</p>
    </> : null}
  </form>;
}
