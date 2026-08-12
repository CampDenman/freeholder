// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { Archive, Check, CheckCircle, EyeSlash, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Field, Input, Select } from "@/ui/primitives";
import {
  notificationItemAction,
  notificationPreferencesAction,
  notificationSettingsAction,
  type NotificationActionState,
} from "../../notification-actions";

export interface ControlLabels {
  markRead: string;
  markUnread: string;
  archive: string;
  markAllRead: string;
  save: string;
  saving: string;
  saved: string;
  modes: { immediate: string; digest: string; off: string };
}

function Feedback({ state, labels }: { state: NotificationActionState; labels: ControlLabels }) {
  if (state.error) {
    return <Callout tone="danger" icon={<WarningCircle size={15} weight="fill" />}>{state.error}</Callout>;
  }
  if (state.saved) {
    return <Callout tone="success" icon={<CheckCircle size={15} weight="fill" />}>{labels.saved}</Callout>;
  }
  return null;
}

export function NotificationItemActions({
  id,
  read,
  labels,
}: {
  id: string;
  read: boolean;
  labels: ControlLabels;
}) {
  const [state, action, pending] = useActionState<NotificationActionState, FormData>(notificationItemAction, {});
  return (
    <form action={action} className="grid gap-2" aria-busy={pending}>
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value={read ? "unread" : "read"} variant="quiet" disabled={pending}>
          {read ? <EyeSlash size={14} /> : <Check size={14} />}
          {read ? labels.markUnread : labels.markRead}
        </Button>
        <Button type="submit" name="intent" value="archive" variant="quiet" disabled={pending}>
          <Archive size={14} />
          {labels.archive}
        </Button>
      </div>
      <Feedback state={state} labels={labels} />
    </form>
  );
}

export function MarkAllRead({ labels }: { labels: ControlLabels }) {
  const [state, action, pending] = useActionState<NotificationActionState, FormData>(notificationItemAction, {});
  return (
    <form action={action} className="grid justify-items-end gap-2" aria-busy={pending}>
      <Button type="submit" name="intent" value="read-all" variant="quiet" disabled={pending}>
        <CheckCircle size={15} />
        {labels.markAllRead}
      </Button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

interface PreferenceRow {
  topic: string;
  label: string;
  values: Record<"in_app" | "email" | "sms" | "push", "immediate" | "digest" | "off">;
}

export function PreferencesForm({
  rows,
  available,
  labels,
  channelLabels,
  topicLabel,
}: {
  rows: PreferenceRow[];
  available: Record<"in_app" | "email" | "sms" | "push", boolean>;
  labels: ControlLabels;
  channelLabels: Record<"in_app" | "email" | "sms" | "push", string>;
  topicLabel: string;
}) {
  const [state, action, pending] = useActionState<NotificationActionState, FormData>(notificationPreferencesAction, {});
  const channels = ["in_app", "email", "sms", "push"] as const;
  return (
    <form action={action} className="grid gap-4" aria-busy={pending}>
      <div className="overflow-x-auto rounded-md border border-rule">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="border-b border-rule bg-surface-muted font-mono text-xs text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-medium">{topicLabel}</th>
              {channels.map((channel) => (
                <th scope="col" className="px-3 py-2.5 font-medium" key={channel}>{channelLabels[channel]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.topic} className="border-b border-rule last:border-0">
                <th scope="row" className="px-3 py-3 font-semibold text-ink">{row.label}</th>
                {channels.map((channel) => {
                  const enabled = available[channel];
                  return (
                    <td className="px-3 py-2" key={channel}>
                      {!enabled ? <input type="hidden" name={`preference:${row.topic}:${channel}`} value="off" /> : null}
                      <Select
                        name={`preference:${row.topic}:${channel}`}
                        defaultValue={enabled ? row.values[channel] : "off"}
                        disabled={!enabled || pending}
                        aria-label={`${row.label}: ${channelLabels[channel]}`}
                        className="min-w-28 py-1.5 text-xs"
                      >
                        <option value="immediate">{labels.modes.immediate}</option>
                        {channel === "email" ? <option value="digest">{labels.modes.digest}</option> : null}
                        <option value="off">{labels.modes.off}</option>
                      </Select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Feedback state={state} labels={labels} />
      <div><Button type="submit" disabled={pending}>{pending ? labels.saving : labels.save}</Button></div>
    </form>
  );
}

export function DigestSettingsForm({
  values,
  labels,
  fields,
}: {
  values: {
    digestCadence: "daily" | "weekly";
    digestMinute: number;
    digestWeekday: number;
    timezone: string;
    escalationMinutes: number;
  };
  labels: ControlLabels;
  fields: {
    cadence: string;
    daily: string;
    weekly: string;
    weekday: string;
    weekdays: string[];
    time: string;
    timezone: string;
    escalation: string;
    escalationHint: string;
  };
}) {
  const [state, action, pending] = useActionState<NotificationActionState, FormData>(notificationSettingsAction, {});
  const hh = String(Math.floor(values.digestMinute / 60)).padStart(2, "0");
  const mm = String(values.digestMinute % 60).padStart(2, "0");
  return (
    <form action={action} className="grid gap-4" aria-busy={pending}>
      <Field label={fields.cadence} htmlFor="notification-digest-cadence">
        <Select id="notification-digest-cadence" name="digestCadence" defaultValue={values.digestCadence} disabled={pending}>
          <option value="daily">{fields.daily}</option>
          <option value="weekly">{fields.weekly}</option>
        </Select>
      </Field>
      <Field label={fields.weekday} htmlFor="notification-digest-weekday">
        <Select id="notification-digest-weekday" name="digestWeekday" defaultValue={String(values.digestWeekday)} disabled={pending}>
          {fields.weekdays.map((weekday, index) => <option value={index + 1} key={weekday}>{weekday}</option>)}
        </Select>
      </Field>
      <Field label={fields.time} htmlFor="notification-digest-time">
        <Input id="notification-digest-time" name="digestTime" type="time" defaultValue={`${hh}:${mm}`} required disabled={pending} />
      </Field>
      <Field label={fields.timezone} htmlFor="notification-timezone">
        <Input id="notification-timezone" name="timezone" defaultValue={values.timezone} required maxLength={100} disabled={pending} />
      </Field>
      <Field label={fields.escalation} htmlFor="notification-escalation" hint={fields.escalationHint}>
        <Input id="notification-escalation" name="escalationMinutes" type="number" min={5} max={10080} defaultValue={values.escalationMinutes} required disabled={pending} />
      </Field>
      <Feedback state={state} labels={labels} />
      <div><Button type="submit" disabled={pending}>{pending ? labels.saving : labels.save}</Button></div>
    </form>
  );
}
