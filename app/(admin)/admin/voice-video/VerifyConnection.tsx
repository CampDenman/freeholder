// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { Button } from "@/ui/primitives";
import { voiceVideoVerifyAction } from "../../first-party-plugin-actions";

/** Verify-connection probe for the voice/video setup card. */
export function VerifyConnection({ label, topUpLabel }: { label: string; topUpLabel: string }) {
  const [state, action, pending] = useActionState(voiceVideoVerifyAction, {});
  return (
    <div className="grid gap-2">
      <form action={action}>
        <Button type="submit" variant="quiet" disabled={pending}>{label}</Button>
      </form>
      {state.message ? (
        <p role="status" className={state.ok ? "text-success" : "text-danger"}>
          {state.message}
          {state.topUpUrl ? (
            <> <a className="font-medium text-accent underline" href={state.topUpUrl} target="_blank" rel="noreferrer">
              {topUpLabel}
            </a></>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
