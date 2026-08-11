// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { CheckCircle, Key, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input, Pill } from "@/ui/primitives";
import {
  beginTotpAction,
  beginWebAuthnAction,
  confirmTotpAction,
  finishWebAuthnAction,
  regenerateRecoveryCodesAction,
  removeTotpAction,
  removeWebAuthnAction,
  type SecurityActionState,
} from "../security-actions";

type Credential = { id: string; name: string; createdAt: Date | string; lastUsedAt: Date | string | null };

function RecoveryCodes({ codes, label }: { codes?: string[]; label: string }) {
  if (!codes?.length) return null;
  return (
    <Callout tone="warning">
      <div className="grid gap-3">
        <strong>{label}</strong>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((code) => <code key={code}>{code}</code>)}
        </div>
      </div>
    </Callout>
  );
}

export function SecurityControls({
  status,
  labels,
}: {
  status: {
    required: boolean;
    stepUpValid: boolean;
    totp: boolean;
    webauthn: Credential[];
    recoveryCodesRemaining: number;
  };
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SecurityActionState>({});
  const [totp, setTotp] = useState<SecurityActionState>({});
  const [keyName, setKeyName] = useState(labels.defaultKeyName!);

  const run = (work: () => Promise<SecurityActionState>) => {
    setState({});
    startTransition(async () => {
      const result = await work();
      setState(result);
      if (result.saved) router.refresh();
    });
  };

  const beginTotp = () => startTransition(async () => setTotp(await beginTotpAction()));
  const confirmTotp = (form: FormData) => startTransition(async () => {
    const result = await confirmTotpAction({}, form);
    setTotp(result);
    if (result.saved) router.refresh();
  });
  const addKey = () => startTransition(async () => {
    setState({});
    const begun = await beginWebAuthnAction();
    if (!("options" in begun)) return setState(begun);
    try {
      const response = await startRegistration({ optionsJSON: begun.options });
      const result = await finishWebAuthnAction({
        registrationToken: begun.registrationToken,
        name: keyName,
        credentialResponse: response as unknown as Record<string, unknown>,
      });
      setState(result);
      if (result.saved) router.refresh();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : labels.keyFailed! });
    }
  });

  return (
    <div className="grid gap-8">
      {status.required ? (
        <Callout tone={status.totp || status.webauthn.length ? "success" : "warning"}>
          {status.totp || status.webauthn.length ? labels.requiredReady! : labels.requiredMissing!}
        </Callout>
      ) : null}
      {state.error ? <Callout tone="danger" icon={<WarningCircle size={17} />}>{state.error}</Callout> : null}
      {state.saved ? <Callout tone="success" icon={<CheckCircle size={17} />}>{labels.saved!}</Callout> : null}
      <RecoveryCodes codes={state.recoveryCodes} label={labels.saveCodes!} />

      <section className="grid gap-4 rounded-lg border border-rule bg-surface p-5">
        <div className="flex items-center gap-3">
          <div><h2 className="font-semibold">{labels.authenticator}</h2><p className="text-sm text-ink-muted">{labels.authenticatorIntro}</p></div>
          <Pill tone={status.totp ? "success" : "neutral"}>{status.totp ? labels.enrolled : labels.notEnrolled}</Pill>
        </div>
        {status.totp ? (
          <Button type="button" variant="quiet" disabled={pending} onClick={() => run(removeTotpAction)}>{labels.remove}</Button>
        ) : !totp.enrollmentToken ? (
          <Button type="button" disabled={pending} onClick={beginTotp}>{labels.setUpAuthenticator}</Button>
        ) : (
          <div className="grid gap-4">
            {totp.error ? <Callout tone="danger">{totp.error}</Callout> : null}
            {totp.qrSvg ? <div className="w-56 max-w-full bg-white p-3" dangerouslySetInnerHTML={{ __html: totp.qrSvg }} /> : null}
            <p className="text-sm text-ink-muted">{labels.manualSecret} <code className="select-all font-mono text-ink">{totp.secret}</code></p>
            <form action={confirmTotp} className="grid gap-3">
              <input type="hidden" name="enrollmentToken" value={totp.enrollmentToken} />
              <Field label={labels.code!} htmlFor="enrollment-code"><Input id="enrollment-code" name="code" inputMode="numeric" autoComplete="one-time-code" required /></Field>
              <Button type="submit" disabled={pending}>{labels.confirm}</Button>
            </form>
          </div>
        )}
        <RecoveryCodes codes={totp.recoveryCodes} label={labels.saveCodes!} />
      </section>

      <section className="grid gap-4 rounded-lg border border-rule bg-surface p-5">
        <div><h2 className="font-semibold">{labels.keys}</h2><p className="text-sm text-ink-muted">{labels.keysIntro}</p></div>
        {status.webauthn.map((credential) => (
          <div key={credential.id} className="flex items-center gap-3 rounded-md bg-surface-muted p-3">
            <Key size={19} className="text-accent" /><span className="text-sm font-medium">{credential.name}</span>
            <Button type="button" variant="quiet" className="ms-auto" disabled={pending} onClick={() => run(async () => { const form = new FormData(); form.set("id", credential.id); return removeWebAuthnAction(form); })}>{labels.remove}</Button>
          </div>
        ))}
        <Field label={labels.keyName!} htmlFor="security-key-name" hint={labels.keyNameHint}>
          <Input id="security-key-name" value={keyName} maxLength={80} onChange={(event) => setKeyName(event.target.value)} />
        </Field>
        <Button type="button" disabled={pending} onClick={addKey}>{labels.addKey}</Button>
      </section>

      {(status.totp || status.webauthn.length > 0) ? (
        <section className="grid gap-4 rounded-lg border border-rule bg-surface p-5">
          <div><h2 className="font-semibold">{labels.recovery}</h2><p className="text-sm text-ink-muted">{labels.recoveryIntro!.replace("{count}", String(status.recoveryCodesRemaining))}</p></div>
          {!status.stepUpValid ? <a href="/security/verify?returnTo=/security" className="text-sm font-medium text-accent underline">{labels.verifyFirst}</a> : null}
          <Button type="button" variant="quiet" disabled={pending} onClick={() => run(regenerateRecoveryCodesAction)}>{labels.regenerate}</Button>
        </section>
      ) : null}
    </div>
  );
}
