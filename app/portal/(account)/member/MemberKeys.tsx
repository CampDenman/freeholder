// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.14: make and stop keys for your own agent. A new key is shown once.
"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Callout, Field, Input, Select } from "@/ui/primitives";
import { createKeyAction, revokeKeyAction } from "../../key-actions";

type Labels = {
  name: string; defaultName: string; read: string; post: string; message: string; days: string; create: string;
  shownOnce: string; stop: string; none: string; expires: string; failed: string; endpoint: string;
};

export function MemberKeys({ keys, labels, endpoint }: { keys: { id: string; name: string; prefix: string; expiresAt: string }[]; labels: Labels; endpoint: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {token ? (
        <Callout tone="success">
          <p>{labels.shownOnce}</p>
          <p className="mt-2 break-all font-mono text-sm">{token}</p>
          <p className="mt-2 text-sm">{labels.endpoint} <span className="font-mono">{endpoint}</span></p>
        </Callout>
      ) : null}
      {keys.length === 0 ? <p className="text-sm text-ink-muted">{labels.none}</p> : null}
      <ul className="grid gap-2">
        {keys.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule p-3 text-sm">
            <span><strong>{k.name}</strong> · <span className="font-mono">{k.prefix}…</span> · {labels.expires} {k.expiresAt.slice(0, 10)}</span>
            <Button type="button" variant="quiet" disabled={pending} onClick={() => start(async () => {
              const done = await revokeKeyAction(k.id);
              if (done.error) setError(done.error);
              else router.refresh();
            })}>{labels.stop}</Button>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const name = (() => { const v = form.get("keyName"); return typeof v === "string" && v.trim() ? v.trim() : labels.defaultName; })();
          const presets = form.getAll("preset").filter((v): v is string => typeof v === "string");
          const days = Number(form.get("days")) || 30;
          setError("");
          setToken("");
          start(async () => {
            const done = await createKeyAction({ name, presets, days });
            if (done.error || !done.token) setError(done.error ?? labels.failed);
            else { setToken(done.token); router.refresh(); }
          });
        }}
      >
        <Field label={labels.name} htmlFor="key-name"><Input id="key-name" name="keyName" maxLength={60} placeholder={labels.defaultName} /></Field>
        <fieldset className="grid gap-1">
          {(["read", "post", "message"] as const).map((p) => (
            <label key={p} className="flex items-start gap-2 text-sm"><input type="checkbox" name="preset" value={p} defaultChecked={p === "read"} /><span>{labels[p]}</span></label>
          ))}
        </fieldset>
        <Field label={labels.days} htmlFor="key-days">
          <Select id="key-days" name="days" defaultValue="30">
            {[7, 30, 90].map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
        <div><Button type="submit" disabled={pending}>{labels.create}</Button></div>
      </form>
    </div>
  );
}
