// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.13 (MASTER.md §44): what happened, and the member's say over it.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime } from "@/core/i18n";
import { listNotifications, notificationPreferenceStatus } from "@/core/notifications/service";
import { currentBusiness } from "@/core/settings/read";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { markAllReadAction, savePreferencesAction, saveQuietHoursAction } from "./actions";
import { PushToggle } from "./PushToggle";
import { MEMBER_TOPICS } from "./topics";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.notifications.title"), robots: { index: false, follow: false } };
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const [t, locale, business, jar, query] = await Promise.all([getT(), getLocale(), currentBusiness(), cookies(), searchParams]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const [items, status] = await Promise.all([
    listNotifications.call({ limit: 50 }, actor),
    notificationPreferenceStatus.call({}, actor),
  ]);
  const mode = (topic: string, channel: "in_app" | "email" | "push") =>
    status.preferences.find((p) => p.topic === topic && p.channel === channel)?.mode ??
    status.preferences.find((p) => p.topic === "*" && p.channel === channel)?.mode ??
    (channel === "email" ? "digest" : channel === "push" ? "off" : "immediate");
  const clock = (minute: number | null, fallback: string) =>
    minute === null ? fallback : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const quiet = status.settings.quietStartMinute !== null && status.settings.quietEndMinute !== null;
  const timezone = business?.timezone ?? "UTC";
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t("members.notifications.title")}</h1>
      {query.saved ? <Callout tone="success">{t("members.notifications.saved")}</Callout> : null}
      {query.error === "quiet" ? <Callout tone="danger">{t("members.notifications.quietInvalid")}</Callout> : null}
      <Card>
        <CardHeader title={t("members.notifications.thisBrowser")} />
        <CardBody>
          <PushToggle labels={{
            on: t("members.notifications.push.on"),
            off: t("members.notifications.push.off"),
            turnOn: t("members.notifications.push.turnOn"),
            turnOff: t("members.notifications.push.turnOff"),
            unsupported: t("members.notifications.push.unsupported"),
            blocked: t("members.notifications.push.blocked"),
            failed: t("members.notifications.push.failed"),
          }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("members.notifications.quietTitle")} />
        <CardBody>
          <form action={saveQuietHoursAction} className="grid gap-3">
            <p className="text-sm text-ink-muted">{t("members.notifications.quietIntro")}</p>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="quietOn" value="yes" defaultChecked={quiet} />
              <span>{t("members.notifications.quietOn")}</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("members.notifications.quietStart")} htmlFor="quiet-start"><Input id="quiet-start" name="quietStart" type="time" defaultValue={clock(status.settings.quietStartMinute, "22:00")} /></Field>
              <Field label={t("members.notifications.quietEnd")} htmlFor="quiet-end"><Input id="quiet-end" name="quietEnd" type="time" defaultValue={clock(status.settings.quietEndMinute, "07:00")} /></Field>
            </div>
            <p className="text-xs text-ink-muted">{t("members.notifications.quietTimezone", { timezone: status.settings.timezone ?? "UTC" })}</p>
            <div><Button type="submit">{t("members.notifications.quietSave")}</Button></div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("members.notifications.recent")} />
        <CardBody>
          {items.length === 0 ? (
            <p className="text-ink-muted">{t("members.notifications.empty")}</p>
          ) : (
            <>
              <form action={markAllReadAction} className="mb-3">
                <Button type="submit" variant="quiet">{t("members.notifications.markAllRead")}</Button>
              </form>
              <ul className="grid gap-3">
                {items.map((item) => (
                  <li key={item.id} className="grid gap-1 rounded-md border border-rule p-3">
                    <p className="flex flex-wrap items-center gap-2">
                      {item.href ? <a className="font-semibold underline" href={item.href}>{item.title}</a> : <strong>{item.title}</strong>}
                      {!item.readAt ? <span className="text-sm text-accent">{t("members.notifications.unread")}</span> : null}
                      {item.occurrenceCount > 1 ? <span className="text-sm text-ink-muted">×{item.occurrenceCount}</span> : null}
                    </p>
                    <p className="text-sm">{item.body}</p>
                    <p className="text-xs text-ink-muted">{formatDateTime(item.lastOccurredAt, timezone, locale)}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("members.notifications.settings")} />
        <CardBody>
          <p className="mb-4 text-sm text-ink-muted">{t("members.notifications.settingsIntro")}</p>
          <form action={savePreferencesAction} className="grid gap-4">
            {MEMBER_TOPICS.map((topic) => (
              <fieldset key={topic} className="grid gap-2 sm:grid-cols-3 sm:items-end">
                <legend className="font-medium sm:col-span-3">{t(`members.notifications.topic.${topic.split(".")[1]}`)}</legend>
                <Field label={t("members.notifications.inApp")} htmlFor={`${topic}-in_app`}>
                  <Select id={`${topic}-in_app`} name={`${topic}:in_app`} defaultValue={mode(topic, "in_app")}>
                    <option value="immediate">{t("notifications.mode.immediate")}</option>
                    <option value="off">{t("notifications.mode.off")}</option>
                  </Select>
                </Field>
                <Field label={t("members.notifications.email")} htmlFor={`${topic}-email`}>
                  <Select id={`${topic}-email`} name={`${topic}:email`} defaultValue={mode(topic, "email")}>
                    <option value="immediate">{t("notifications.mode.immediate")}</option>
                    <option value="digest">{t("notifications.mode.digest")}</option>
                    <option value="off">{t("notifications.mode.off")}</option>
                  </Select>
                </Field>
                <Field label={t("members.notifications.pushLabel")} htmlFor={`${topic}-push`}>
                  <Select id={`${topic}-push`} name={`${topic}:push`} defaultValue={mode(topic, "push")}>
                    <option value="immediate">{t("notifications.mode.immediate")}</option>
                    <option value="off">{t("notifications.mode.off")}</option>
                  </Select>
                </Field>
              </fieldset>
            ))}
            <Button type="submit">{t("members.notifications.save")}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
