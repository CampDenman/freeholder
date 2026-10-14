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
import { Button, Callout, Card, CardBody, CardHeader, Field, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { markAllReadAction, savePreferencesAction } from "./actions";
import { MEMBER_TOPICS } from "./topics";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.notifications.title"), robots: { index: false, follow: false } };
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const [t, locale, business, jar, query] = await Promise.all([getT(), getLocale(), currentBusiness(), cookies(), searchParams]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const [items, status] = await Promise.all([
    listNotifications.call({ limit: 50 }, actor),
    notificationPreferenceStatus.call({}, actor),
  ]);
  const mode = (topic: string, channel: "in_app" | "email") =>
    status.preferences.find((p) => p.topic === topic && p.channel === channel)?.mode ?? (channel === "email" ? "digest" : "immediate");
  const timezone = business?.timezone ?? "UTC";
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t("members.notifications.title")}</h1>
      {query.saved ? <Callout tone="success">{t("members.notifications.saved")}</Callout> : null}
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
              </fieldset>
            ))}
            <Button type="submit">{t("members.notifications.save")}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
