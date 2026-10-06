// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useState, useTransition } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Button, Callout } from "@/ui/primitives";
import { beginPasskeyLoginAction, finishPasskeyLoginAction } from "../security-actions";

export function PasskeySignIn({ labels, disabled }: { labels: { submit: string; intro: string; failed: string }; disabled?: boolean }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <div className="grid gap-4 border-b border-rule pb-5">
    <p className="text-sm text-ink-muted">{labels.intro}</p>
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Button type="button" disabled={pending || disabled} onClick={(event) => {
    const field = event.currentTarget.form?.elements.namedItem("email");
    if (!(field instanceof HTMLInputElement) || !field.reportValidity()) return;
    const email = field.value;
    setError("");
    startTransition(async () => {
      const begun = await beginPasskeyLoginAction(email);
      if (!("options" in begun)) { setError(begun.error ?? labels.failed); return; }
      let credential;
      try { credential = await startAuthentication({ optionsJSON: begun.options }); }
      catch { setError(labels.failed); return; }
      // Keep Next's redirect outside the browser-API catch.
      const result = await finishPasskeyLoginAction(credential as unknown as Record<string, unknown>);
      if (result.error) setError(result.error);
    });
  }}>{labels.submit}</Button>
  </div>;
}
