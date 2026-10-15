// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.19: sign in with a passkey; the email link stays the other way in.
"use client";
import { useState, useTransition } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { beginPortalPasskeyLogin, finishPortalPasskeyLogin } from "../passkey-actions";

export function PortalPasskeySignIn({ returnTo, labels }: { returnTo: string; labels: { heading: string; intro: string; email: string; submit: string; failed: string } }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid gap-3 border-b border-rule pb-5"
      onSubmit={(event) => {
        event.preventDefault();
        const email = (() => { const v = new FormData(event.currentTarget).get("email"); return typeof v === "string" ? v : ""; })();
        setError("");
        startTransition(async () => {
          const begun = await beginPortalPasskeyLogin(email);
          if (!("options" in begun)) { setError(begun.error ?? labels.failed); return; }
          let credential;
          try { credential = await startAuthentication({ optionsJSON: begun.options }); }
          catch { setError(labels.failed); return; }
          const result = await finishPortalPasskeyLogin(credential as unknown as Record<string, unknown>, returnTo);
          if (result?.error) setError(result.error);
        });
      }}
    >
      <h2 className="text-lg font-semibold">{labels.heading}</h2>
      <p className="text-sm text-ink-muted">{labels.intro}</p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Field label={labels.email} htmlFor="passkey-email"><Input id="passkey-email" name="email" type="email" autoComplete="username webauthn" required /></Field>
      <div><Button type="submit" disabled={pending}>{labels.submit}</Button></div>
    </form>
  );
}
