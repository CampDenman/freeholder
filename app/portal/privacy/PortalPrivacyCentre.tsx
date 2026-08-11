// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState, useState, type ReactNode } from "react";
import { CheckCircle, DownloadSimple, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import {
  portalPrivacyAction,
  type PrivacyActionState,
} from "../actions";

interface Labels {
  preferencesTitle: string;
  preferencesHint: string;
  currentGranted: string;
  currentOff: string;
  grant: string;
  withdraw: string;
  working: string;
  requestTitle: string;
  requestHint: string;
  kind: string;
  jurisdiction: string;
  jurisdictionPlaceholder: string;
  note: string;
  correctionHint: string;
  name: string;
  email: string;
  phone: string;
  preferredLocale: string;
  timezone: string;
  country: string;
  clearEmail: string;
  clearPhone: string;
  submit: string;
  historyTitle: string;
  historyEmpty: string;
  status: string;
  due: string;
  download: string;
  cancel: string;
  channels: Record<string, string>;
  kinds: Record<string, string>;
  statuses: Record<string, string>;
}

interface Preference {
  channel: string | null;
  state: string;
}

interface RequestView {
  id: string;
  kind: string;
  status: string;
  due: string;
  artifactId: string | null;
  artifactAvailable: boolean;
}

function PortalForm({
  intent,
  hidden = {},
  submitLabel,
  pendingLabel,
  variant = "primary",
  children,
}: {
  intent: string;
  hidden?: Record<string, string>;
  submitLabel: string;
  pendingLabel: string;
  variant?: "primary" | "quiet" | "danger";
  children?: ReactNode;
}) {
  const [state, action, pending] = useActionState<PrivacyActionState, FormData>(
    portalPrivacyAction,
    {},
  );
  return (
    <form action={action} className="grid gap-4" aria-busy={pending}>
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {children}
      {state.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{state.error}</Callout> : null}
      {state.saved && state.message ? <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>{state.message}</Callout> : null}
      <div><Button type="submit" variant={variant} disabled={pending}>{pending ? pendingLabel : submitLabel}</Button></div>
    </form>
  );
}

export function PortalPrivacyCentre({
  preferences,
  requests,
  profile,
  labels,
}: {
  preferences: Preference[];
  requests: RequestView[];
  profile: {
    name: string;
    email: string | null;
    phone: string | null;
    preferredLocale: string | null;
    timezone: string | null;
    country: string | null;
  };
  labels: Labels;
}) {
  const [kind, setKind] = useState("access");
  const marketing = ["email", "sms", "push"];
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={labels.preferencesTitle} />
        <CardBody>
          <p className="text-sm text-ink-muted">{labels.preferencesHint}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {marketing.map((channel) => {
              const choice = preferences.find((item) => item.channel === channel);
              const granted = choice?.state === "granted";
              return (
                <div key={channel} className="grid gap-3 rounded-md border border-rule p-4">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm">{labels.channels[channel]}</strong>
                    <Pill tone={granted ? "success" : "neutral"}>{granted ? labels.currentGranted : labels.currentOff}</Pill>
                  </div>
                  <PortalForm
                    intent="preference"
                    hidden={{ channel, state: granted ? "withdrawn" : "granted" }}
                    submitLabel={granted ? labels.withdraw : labels.grant}
                    pendingLabel={labels.working}
                    variant={granted ? "quiet" : "primary"}
                  />
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={labels.requestTitle} />
        <CardBody>
          <p className="text-sm text-ink-muted">{labels.requestHint}</p>
          <PortalForm intent="request" submitLabel={labels.submit} pendingLabel={labels.working}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={labels.kind} htmlFor="portal-privacy-kind">
                <Select id="portal-privacy-kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
                  {Object.entries(labels.kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <Field label={labels.jurisdiction} htmlFor="portal-privacy-jurisdiction">
                <Input id="portal-privacy-jurisdiction" name="jurisdiction" placeholder={labels.jurisdictionPlaceholder} />
              </Field>
            </div>
            <Field label={labels.note} htmlFor="portal-privacy-note">
              <textarea id="portal-privacy-note" name="note" rows={3} className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm" />
            </Field>
            {kind === "correction" ? (
              <fieldset className="grid gap-4 rounded-md border border-rule p-4">
                <legend className="px-1 text-sm font-semibold">{labels.correctionHint}</legend>
                <Field label={labels.name} htmlFor="portal-correction-name"><Input id="portal-correction-name" name="name" defaultValue={profile.name} /></Field>
                <Field label={labels.email} htmlFor="portal-correction-email"><Input id="portal-correction-email" name="email" type="email" defaultValue={profile.email ?? ""} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clearEmail" />{labels.clearEmail}</label>
                <Field label={labels.phone} htmlFor="portal-correction-phone"><Input id="portal-correction-phone" name="phone" defaultValue={profile.phone ?? ""} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clearPhone" />{labels.clearPhone}</label>
                <Field label={labels.preferredLocale} htmlFor="portal-correction-locale"><Input id="portal-correction-locale" name="preferredLocale" defaultValue={profile.preferredLocale ?? ""} /></Field>
                <Field label={labels.timezone} htmlFor="portal-correction-timezone"><Input id="portal-correction-timezone" name="timezone" defaultValue={profile.timezone ?? ""} /></Field>
                <Field label={labels.country} htmlFor="portal-correction-country"><Input id="portal-correction-country" name="country" maxLength={2} defaultValue={profile.country ?? ""} /></Field>
              </fieldset>
            ) : null}
          </PortalForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={labels.historyTitle} />
        <CardBody>
          {requests.length === 0 ? <p className="text-sm text-ink-muted">{labels.historyEmpty}</p> : (
            <ol className="grid list-none gap-3 p-0">
              {requests.map((request) => {
                const open = ["submitted", "verified", "in_progress"].includes(request.status);
                return (
                  <li key={request.id} className="grid gap-3 rounded-md border border-rule p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><strong>{labels.kinds[request.kind]}</strong><Pill>{labels.statuses[request.status]}</Pill></div>
                      <p className="mt-1 text-xs text-ink-muted">{labels.due}: {request.due}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {request.artifactId && request.artifactAvailable ? (
                        <a className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent" href={`/privacy/artifacts/${request.artifactId}`}>
                          <DownloadSimple size={16} weight="bold" />{labels.download}
                        </a>
                      ) : null}
                      {open ? <PortalForm intent="cancel" hidden={{ requestId: request.id }} submitLabel={labels.cancel} pendingLabel={labels.working} variant="quiet" /> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
