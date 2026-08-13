// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState, useState, useTransition } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Key, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import {
  completeLoginCodeAction,
  completeLoginWebAuthnAction,
  type SecurityActionState,
} from "../../security-actions";

export function VerifyLogin({
  methods,
  webauthnOptions,
  labels,
}: {
  methods: { totp: boolean; recovery: boolean; webauthn: boolean };
  webauthnOptions?: PublicKeyCredentialRequestOptionsJSON;
  labels: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<SecurityActionState, FormData>(
    completeLoginCodeAction,
    {},
  );
  const [browserError, setBrowserError] = useState("");
  const [keyPending, startTransition] = useTransition();

  const useSecurityKey = () => {
    if (!webauthnOptions) return;
    setBrowserError("");
    startTransition(async () => {
      try {
        const response = await startAuthentication({ optionsJSON: webauthnOptions });
        const result = await completeLoginWebAuthnAction(
          response as unknown as Record<string, unknown>,
        );
        if (result?.error) setBrowserError(result.error);
      } catch (error) {
        setBrowserError(error instanceof Error ? error.message : labels.keyFailed!);
      }
    });
  };

  return (
    <div className="grid gap-5">
      {state.error || browserError ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error ?? browserError}
        </Callout>
      ) : null}
      {methods.totp || methods.recovery ? (
        <form action={action} className="grid gap-4">
          <Field label={labels.code!} htmlFor="code" hint={labels.codeHint}>
            <Input
              id="code"
              name="code"
              autoComplete="one-time-code"
              required
              autoFocus
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? labels.checking : labels.continue}
          </Button>
        </form>
      ) : null}
      {methods.webauthn && webauthnOptions ? (
        <Button type="button" variant="quiet" disabled={keyPending} onClick={useSecurityKey}>
          <Key size={17} /> {keyPending ? labels.waitingForKey : labels.useKey}
        </Button>
      ) : null}
      <a href="/login" className="text-sm text-ink-muted underline">
        {labels.startAgain}
      </a>
    </div>
  );
}
