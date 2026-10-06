// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState, useState } from "react";
import { Button, Callout, Field, Input, Select } from "@/ui/primitives";
import { createConnectionAction, type ConnectionState } from "./actions";

export function ConnectForm({ endpoint, labels }: { endpoint: string; labels: Record<string, string> }) {
  const [state, action, pending] = useActionState<ConnectionState, FormData>(createConnectionAction, {});
  const [client, setClient] = useState("replit");
  const [profile, setProfile] = useState("read");
  const [copy, setCopy] = useState("");
  const [tested, setTested] = useState("");
  const [testing, setTesting] = useState(false);
  const config = JSON.stringify({ mcpServers: { freeholder: { type: "http", url: endpoint, headers: { Authorization: "Bearer <YOUR_CONNECTION_CREDENTIAL>" } } } }, null, 2);
  const copyText = async (value: string, name: string) => { try { await navigator.clipboard.writeText(value); setCopy(name); } catch { setCopy(""); } };
  const test = async () => {
    setTesting(true); setTested("");
    try {
      // Same origin only: an incorrectly configured APP_URL must not receive a token.
      const response = await fetch("/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${state.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { result?: { tools?: { name: string }[] } };
      const tools = data.result?.tools;
      if (!response.ok || !Array.isArray(tools) || !state.scopes?.some(scope => tools.some(tool => tool.name === scope.replaceAll(".", "_")))) throw new Error("No permitted tools discovered");
      setTested(labels.tested!);
    } catch { setTested(labels.failed!); } finally { setTesting(false); }
  };
  return <div className="grid gap-6">
    <form action={action} className="grid gap-5 rounded-lg border border-rule bg-surface p-5" onSubmit={() => { setTested(""); setCopy(""); }}>
      {state.error ? <Callout tone="danger">{state.error}{state.stepUp ? <a className="ms-2 underline" href="/security/verify?returnTo=/admin/connect">{labels.verify}</a> : null}</Callout> : null}
      <Field htmlFor="connect-client" label={labels.client!}><Select id="connect-client" value={client} onChange={event => setClient(event.target.value)}><option value="replit">{labels.replitName}</option><option value="lovable">{labels.lovableName}</option><option value="other">{labels.otherName}</option></Select></Field>
      <Field htmlFor="connect-name" label={labels.name!}><Input id="connect-name" name="name" placeholder={client === "other" ? labels.defaultName! : client === "replit" ? "Replit" : "Lovable"} required maxLength={80} /></Field>
      <Field htmlFor="connect-profile" label={labels.permissions!} hint={labels[`${profile}Hint`]}><Select id="connect-profile" name="profile" value={profile} onChange={event => setProfile(event.target.value)}><option value="read">{labels.read}</option><option value="website">{labels.website}</option><option value="health">{labels.health}</option></Select></Field>
      <Field htmlFor="connect-days" label={labels.expiry!}><Select id="connect-days" name="days" defaultValue="90"><option value="30">{labels.days30}</option><option value="90">{labels.days90}</option><option value="365">{labels.days365}</option></Select></Field>
      <Button type="submit" disabled={pending}>{labels.create}</Button>
    </form>
    {state.token ? <section className="grid gap-4 rounded-lg border border-rule bg-surface p-5">
      <h2 className="font-semibold">{labels.created}</h2><p className="text-sm text-ink-muted">{labels.secretHint}</p>
      <Field htmlFor="connect-endpoint" label={labels.endpoint!}><Input id="connect-endpoint" readOnly value={endpoint} /></Field>
      <Button variant="quiet" type="button" onClick={() => { void copyText(endpoint, "url"); }}>{copy === "url" ? labels.copied : labels.copy} — {labels.endpoint}</Button>
      <Field htmlFor="connect-token" label={labels.token!}><Input id="connect-token" type="password" readOnly value={state.token} autoComplete="off" /></Field>
      <Button variant="quiet" type="button" onClick={() => { void copyText(state.token!, "token"); }}>{copy === "token" ? labels.copied : labels.copy} — {labels.token}</Button>
      <h3 className="font-semibold">{labels.instructions}</h3><p className="text-sm">{labels[`${client}Instructions`]}</p>
      {client === "other" ? <><pre className="overflow-x-auto rounded bg-surface-muted p-3 text-xs">{config}</pre><Button variant="quiet" type="button" onClick={() => { void copyText(config, "config"); }}>{copy === "config" ? labels.copied : labels.copy} — {labels.config}</Button></> : null}
      <Button type="button" onClick={() => { void test(); }} disabled={testing}>{testing ? labels.testing : labels.test}</Button>
      {tested ? <p role="status" className="text-sm">{tested}</p> : null}
      <h3 className="font-semibold">{labels.prompt}</h3><p className="text-sm">{labels.promptText}</p>
      <a className="text-sm underline" href="/admin/settings#api-keys">{labels.manage}</a>
    </section> : null}
    <a className="text-sm underline" href="/admin/settings#api-keys">{labels.advanced}</a>
  </div>;
}
