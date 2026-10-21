// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.19: add and remove the passkeys you sign in with.
"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import {
  beginPortalPasskeyRegistration,
  beginPortalPasskeyStepUp,
  finishPortalPasskeyRegistration,
  finishPortalPasskeyStepUp,
  portalRecoveryStepUp,
  removePortalPasskey,
} from "../../passkey-actions";

type Labels = { name: string; defaultName: string; add: string; remove: string; added: string; failed: string; none: string; codesIntro: string; recoveryCode: string; useCode: string };

/** Prove it is you with a passkey you already hold. */
async function stepUp(): Promise<string | null> {
  const begun = await beginPortalPasskeyStepUp();
  if (!("options" in begun)) return begun.error ?? "";
  const credential = await startAuthentication({ optionsJSON: begun.options });
  const done = await finishPortalPasskeyStepUp({ verificationToken: begun.verificationToken, credentialResponse: credential as unknown as Record<string, unknown> });
  return done.error ?? null;
}

export function MemberPasskeys({ passkeys, labels }: { passkeys: { id: string; name: string }[]; labels: Labels }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [codes, setCodes] = useState<string[]>([]);
  function act(work: () => Promise<string | null>) {
    setMessage(null);
    startTransition(async () => {
      try {
        const failure = await work();
        if (failure !== null) { setMessage({ tone: "danger", text: failure || labels.failed }); return; }
        router.refresh();
      } catch {
        setMessage({ tone: "danger", text: labels.failed });
      }
    });
  }
  return (
    <div className="grid gap-3">
      {message ? <Callout tone={message.tone}>{message.text}</Callout> : null}
      {codes.length ? (
        <div className="grid gap-2 rounded-md border border-rule p-3">
          <p className="text-sm">{labels.codesIntro}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      ) : null}
      {passkeys.length === 0 ? <p className="text-sm text-ink-muted">{labels.none}</p> : null}
      <ul className="grid gap-2">
        {passkeys.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule p-3">
            <span>{p.name}</span>
            <Button type="button" variant="quiet" disabled={pending} onClick={() => act(async () => {
              let result = await removePortalPasskey(p.id);
              if (result.code === "step_up_required") {
                const failed = await stepUp();
                if (failed !== null) return failed;
                result = await removePortalPasskey(p.id);
              }
              return result.error ?? null;
            })}>{labels.remove}</Button>
          </li>
        ))}
      </ul>
      {passkeys.length ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const code = (() => { const v = new FormData(event.currentTarget).get("recoveryCode"); return typeof v === "string" ? v.trim() : ""; })();
            act(async () => {
              const done = await portalRecoveryStepUp(code);
              if (done.error) return done.error;
              setMessage({ tone: "success", text: labels.useCode });
              return null;
            });
          }}
        >
          <Field label={labels.recoveryCode} htmlFor="recovery-code"><Input id="recovery-code" name="recoveryCode" autoComplete="one-time-code" maxLength={40} /></Field>
          <Button type="submit" variant="quiet" disabled={pending}>{labels.useCode}</Button>
        </form>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const name = (() => { const v = new FormData(event.currentTarget).get("passkeyName"); return typeof v === "string" ? v : ""; })().trim() || labels.defaultName;
          act(async () => {
            let begun = await beginPortalPasskeyRegistration();
            if (!("options" in begun) && begun.code === "step_up_required") {
              const failed = await stepUp();
              if (failed !== null) return failed;
              begun = await beginPortalPasskeyRegistration();
            }
            if (!("options" in begun)) return begun.error ?? "";
            const credential = await startRegistration({ optionsJSON: begun.options });
            const done = await finishPortalPasskeyRegistration({ registrationToken: begun.registrationToken, name, credentialResponse: credential as unknown as Record<string, unknown> });
            if (done.error) return done.error;
            if (done.recoveryCodes?.length) setCodes(done.recoveryCodes);
            setMessage({ tone: "success", text: labels.added });
            return null;
          });
        }}
      >
        <Field label={labels.name} htmlFor="passkey-name"><Input id="passkey-name" name="passkeyName" maxLength={80} placeholder={labels.defaultName} /></Field>
        <Button type="submit" disabled={pending}>{labels.add}</Button>
      </form>
    </div>
  );
}
