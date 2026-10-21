// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState, useEffect } from "react";
import { Button } from "@/ui/primitives";
import { voiceVideoHostJoinAction } from "../../first-party-plugin-actions";
import { CallCredentialPanel, type CallCredentialLabels } from "./GuestInvite";

/**
 * Host join control. Daily issues a hosted prebuilt URL and the action
 * redirects there; Paradise Comms issues LiveKit connection details, which
 * render in a copyable panel instead of navigating to a wss: URL.
 */
export function HostJoin({ roomId, hostName, label, credentialHelp, credentialLabels }: { roomId: string; hostName: string; label: string; credentialHelp: string; credentialLabels: CallCredentialLabels }) {
  const [state, action, pending] = useActionState(voiceVideoHostJoinAction, {});
  useEffect(() => {
    if (state.redirectUrl) window.location.href = state.redirectUrl;
  }, [state.redirectUrl]);
  return <form action={action} className="grid gap-2">
    <input type="hidden" name="roomId" value={roomId} />
    <input type="hidden" name="hostName" value={hostName} />
    <Button type="submit" variant="quiet" disabled={pending}>{label}</Button>
    {state.error ? <p role="alert" className="text-danger">{state.error}</p> : null}
    {state.credential ? <CallCredentialPanel credential={state.credential} help={credentialHelp} labels={credentialLabels} /> : null}
  </form>;
}
