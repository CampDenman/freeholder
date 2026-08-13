// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState, useState, useTransition } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Key, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import {
  beginWebAuthnStepUpAction,
  finishWebAuthnStepUpAction,
  verifyStepUpCodeAction,
  type SecurityActionState,
} from "../../security-actions";

export function StepUpForm({
  hasCode,
  hasWebAuthn,
  returnTo,
  labels,
}: {
  hasCode: boolean;
  hasWebAuthn: boolean;
  returnTo: string;
  labels: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<SecurityActionState, FormData>(
    verifyStepUpCodeAction,
    {},
  );
  const [keyError, setKeyError] = useState("");
  const [keyPending, startTransition] = useTransition();

  const verifyKey = () => startTransition(async () => {
    setKeyError("");
    const begun = await beginWebAuthnStepUpAction();
    if (!("options" in begun)) return setKeyError(begun.error ?? labels.keyFailed!);
    try {
      const response = await startAuthentication({ optionsJSON: begun.options });
      const result = await finishWebAuthnStepUpAction({
        verificationToken: begun.verificationToken,
        credentialResponse: response as unknown as Record<string, unknown>,
        returnTo,
      });
      if (result?.error) setKeyError(result.error);
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : labels.keyFailed!);
    }
  });

  return (
    <div className="grid gap-5">
      {state.error || keyError ? <Callout tone="danger" icon={<WarningCircle size={17} />}>{state.error ?? keyError}</Callout> : null}
      {hasCode ? (
        <form action={action} className="grid gap-4">
          <input type="hidden" name="returnTo" value={returnTo} />
          <Field label={labels.code!} htmlFor="step-up-code" hint={labels.codeHint}>
            <Input id="step-up-code" name="code" autoComplete="one-time-code" required autoFocus />
          </Field>
          <Button type="submit" disabled={pending}>{pending ? labels.checking : labels.continue}</Button>
        </form>
      ) : null}
      {hasWebAuthn ? (
        <Button type="button" variant="quiet" disabled={keyPending} onClick={verifyKey}>
          <Key size={17} /> {keyPending ? labels.waitingForKey : labels.useKey}
        </Button>
      ) : null}
    </div>
  );
}
