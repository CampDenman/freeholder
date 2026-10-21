// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { Button, Input } from "@/ui/primitives";
import { voiceVideoInviteAction, type IssuedCallCredential } from "../../first-party-plugin-actions";

export interface CallCredentialLabels {
  serverLabel: string;
  tokenLabel: string;
  iceLabel: string;
}

export function CallCredentialPanel({ credential, help, labels }: { credential: IssuedCallCredential; help: string; labels: CallCredentialLabels }) {
  const ice = JSON.stringify(credential.iceServers ?? []);
  return (
    <div className="grid w-full gap-2">
      <Input aria-label={labels.serverLabel} readOnly value={credential.livekitUrl ?? credential.roomUrl} onFocus={event => event.currentTarget.select()} />
      <Input aria-label={labels.tokenLabel} readOnly value={credential.meetingToken} onFocus={event => event.currentTarget.select()} />
      <Input aria-label={labels.iceLabel} readOnly value={ice} onFocus={event => event.currentTarget.select()} />
      <p className="text-sm text-ink-muted">{help}</p>
      <p className="text-sm text-ink-muted">{credential.expiresAtLabel}</p>
    </div>
  );
}

export function GuestInvite({ roomId, label, help, credentialHelp, credentialLabels }: { roomId: string; label: string; help: string; credentialHelp: string; credentialLabels: CallCredentialLabels }) {
  const [state, action, pending] = useActionState(voiceVideoInviteAction, {});
  return <form action={action} className="grid gap-2">
    <input type="hidden" name="roomId" value={roomId} />
    <Button type="submit" variant="quiet" disabled={pending}>{label}</Button>
    {state.error ? <p role="alert" className="text-danger">{state.error}</p> : null}
    {state.inviteTokenUrl ? <>
      <Input aria-label={label} readOnly value={state.inviteTokenUrl} onFocus={event => event.currentTarget.select()} />
      <p className="text-sm text-ink-muted">{help}</p>
    </> : null}
    {state.credential ? <CallCredentialPanel credential={state.credential} help={credentialHelp} labels={credentialLabels} /> : null}
  </form>;
}
