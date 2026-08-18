// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {
  Bell,
  BellRinging,
  EnvelopeSimple,
  Info,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { getLocale, getT } from "../../../i18n";
import { currentBusiness } from "@/core/settings/read";
import {
  listNotifications,
  notificationPreferenceStatus,
  type NotificationChannel,
  type NotificationMode,
} from "@/core/notifications/service";
import { Callout, Card, CardBody, CardHeader, Pill, cx } from "@/ui/primitives";
import { requireStaffActor } from "../guard";
import {
  DigestSettingsForm,
  MarkAllRead,
  NotificationItemActions,
  PreferencesForm,
  type ControlLabels,
} from "./NotificationControls";

export const dynamic = "force-dynamic";

type InboxItem = Awaited<ReturnType<typeof listNotifications.call>>[number];

function rail(priority: InboxItem["priority"]): string {
  return priority === "critical"
    ? "border-s-danger"
    : priority === "warning"
      ? "border-s-warning"
      : "border-s-accent";
}

function icon(priority: InboxItem["priority"]) {
  return priority === "critical"
    ? <WarningCircle size={18} weight="fill" />
    : priority === "warning"
      ? <Warning size={18} weight="fill" />
      : <Info size={18} weight="fill" />;
}

function tone(priority: InboxItem["priority"]) {
  return priority === "critical" ? "danger" : priority === "warning" ? "warning" : "accent";
}

function controlLabels(t: Awaited<ReturnType<typeof getT>>): ControlLabels {
  return {
    markRead: t("notifications.markRead"),
    markUnread: t("notifications.markUnread"),
    archive: t("notifications.archive"),
    markAllRead: t("notifications.markAllRead"),
    save: t("common.saveChanges"),
    saving: t("common.saving"),
    saved: t("notifications.saved"),
    modes: {
      immediate: t("notifications.mode.immediate"),
      digest: t("notifications.mode.digest"),
      off: t("notifications.mode.off"),
    },
  };
}

function topicLabel(topic: string, t: Awaited<ReturnType<typeof getT>>): string {
  const keys: Record<string, string> = {
    "forms.submission": "notifications.topic.forms",
    "connections.attention": "notifications.topic.connections",
    "agents.failed": "notifications.topic.agents",
    "mail.delivery": "notifications.topic.mail",
    "contribute.ingested": "notifications.topic.contribute",
    "contribute.status": "notifications.topic.contributeStatus",
  };
  return t(keys[topic] ?? topic);
}

function NotificationList({
  title,
  items,
  format,
  labels,
  t,
}: {
  title: string;
  items: InboxItem[];
  format: Intl.DateTimeFormat;
  labels: ControlLabels;
  t: Awaited<ReturnType<typeof getT>>;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={`notification-group-${title.replace(/\s+/g, "-")}`}>
      <h2 id={`notification-group-${title.replace(/\s+/g, "-")}`} className="mb-2 font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </h2>
      <ol className="overflow-hidden rounded-lg border border-rule bg-surface">
        {items.map((item) => (
          <li
            key={item.id}
            className={cx(
              "grid gap-3 border-s-4 border-b border-b-rule px-4 py-4 last:border-b-0",
              rail(item.priority),
              item.readAt ? "bg-surface" : "bg-surface-muted/40",
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className={cx("mt-0.5 shrink-0", item.priority === "critical" ? "text-danger" : item.priority === "warning" ? "text-warning" : "text-accent")}>
                {icon(item.priority)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {item.href ? (
                    <a href={item.href} className="font-semibold text-ink underline-offset-2 hover:underline">{item.title}</a>
                  ) : (
                    <h3 className="font-semibold text-ink">{item.title}</h3>
                  )}
                  {!item.readAt ? <span className="size-2 rounded-full bg-accent" aria-label={t("notifications.unread")} /> : null}
                  {item.occurrenceCount > 1 ? <Pill tone="neutral">{t("notifications.repeated", { count: item.occurrenceCount })}</Pill> : null}
                  <Pill tone={tone(item.priority)}>{t(`notifications.priority.${item.priority}`)}</Pill>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{item.body}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-ink-muted">
                  <span>{topicLabel(item.topic, t)}</span>
                  <time dateTime={item.lastOccurredAt.toISOString()}>{format.format(item.lastOccurredAt)}</time>
                  {item.escalatedAt ? <span className="text-warning">{t("notifications.escalated")}</span> : null}
                </div>
              </div>
            </div>
            <div className="ps-7">
              <NotificationItemActions id={item.id} read={Boolean(item.readAt)} labels={labels} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const actor = await requireStaffActor();
  const query = await searchParams;
  const state = ["all", "unread", "critical"].includes(query.state ?? "")
    ? query.state as "all" | "unread" | "critical"
    : "all";
  const [items, preferences, business, locale, t] = await Promise.all([
    listNotifications.call({ state, limit: 75 }, actor),
    notificationPreferenceStatus.call({}, actor),
    currentBusiness(),
    getLocale(),
    getT(),
  ]);
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: business?.timezone ?? "UTC",
  });
  const labels = controlLabels(t);
  const urgent = items.filter((item) => item.priority === "critical" && !item.readAt);
  const fresh = items.filter((item) => !item.readAt && !urgent.includes(item));
  const earlier = items.filter((item) => Boolean(item.readAt));
  const modes = new Map(
    preferences.preferences.map((preference) => [
      `${preference.topic}:${preference.channel}`,
      preference.mode,
    ]),
  );
  const defaultMode = (channel: NotificationChannel): NotificationMode =>
    channel === "in_app" || channel === "email" ? "immediate" : "off";
  const adapterAvailable = new Map(preferences.adapters.map((adapter) => [adapter.channel, adapter.available]));
  const available = {
    in_app: true,
    email: true,
    sms: adapterAvailable.get("sms") ?? false,
    push: adapterAvailable.get("push") ?? false,
  };
  const settings = preferences.settings;

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BellRinging size={22} weight="fill" className="text-accent" />
            <h1 className="text-xl font-bold tracking-tight">{t("notifications.title")}</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">{t("notifications.intro")}</p>
        </div>
        <div className="ms-auto"><MarkAllRead labels={labels} /></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="grid content-start gap-6">
          <nav aria-label={t("notifications.filters")} className="flex flex-wrap gap-2">
            {(["all", "unread", "critical"] as const).map((filter) => (
              <a
                key={filter}
                href={filter === "all" ? "/admin/notifications" : `/admin/notifications?state=${filter}`}
                aria-current={state === filter ? "page" : undefined}
                className={cx(
                  "rounded-full border px-3 py-1.5 text-sm",
                  state === filter ? "border-accent bg-accent-soft font-semibold text-accent" : "border-rule text-ink-muted",
                )}
              >
                {t(`notifications.filter.${filter}`)}
              </a>
            ))}
          </nav>

          {items.length === 0 ? (
            <div className="grid justify-items-center gap-3 rounded-lg border border-dashed border-rule bg-surface px-6 py-12 text-center">
              <Bell size={26} className="text-ink-muted" />
              <h2 className="font-semibold">{t("notifications.emptyTitle")}</h2>
              <p className="max-w-sm text-sm text-ink-muted">{t("notifications.emptyBody")}</p>
            </div>
          ) : (
            <>
              <NotificationList title={t("notifications.group.urgent")} items={urgent} format={format} labels={labels} t={t} />
              <NotificationList title={t("notifications.group.new")} items={fresh} format={format} labels={labels} t={t} />
              <NotificationList title={t("notifications.group.earlier")} items={earlier} format={format} labels={labels} t={t} />
            </>
          )}
        </div>

        <aside className="grid content-start gap-4" aria-label={t("notifications.deliveryStatus")}>
          <Card>
            <CardHeader icon={<EnvelopeSimple size={17} weight="fill" />} title={t("notifications.deliveryStatus")} />
            <CardBody>
              <p className="text-sm text-ink-muted">{t("notifications.deliveryIntro")}</p>
              <dl className="grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-3"><dt>{t("notifications.channel.inApp")}</dt><dd><Pill tone="success">{t("notifications.ready")}</Pill></dd></div>
                <div className="grid gap-1 border-t border-rule pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <dt>{t("notifications.channel.email")}</dt>
                    <dd><Pill tone={preferences.email.ready ? "success" : "warning"}>{preferences.email.ready ? t("notifications.ready") : t("notifications.needsSetup")}</Pill></dd>
                  </div>
                  <dd className="text-xs text-ink-muted">
                    {preferences.email.ready
                      ? t("notifications.emailReady", { provider: preferences.email.provider })
                      : t("notifications.emailNotReady")}
                  </dd>
                </div>
                {preferences.adapters.map((adapter) => (
                  <div className="grid gap-1 border-t border-rule pt-3" key={adapter.channel}>
                    <div className="flex items-center justify-between gap-3">
                      <dt>{t(`notifications.channel.${adapter.channel}`)}</dt>
                      <dd><Pill tone={adapter.available ? "success" : "neutral"}>{adapter.available ? t("notifications.ready") : t("notifications.unavailable")}</Pill></dd>
                    </div>
                    <dd className="text-xs text-ink-muted">
                      {adapter.provider === "none"
                        ? t("notifications.adapterNotConfigured")
                        : t("notifications.adapterFuture", { provider: adapter.provider })}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <Callout tone="warning" icon={<WarningCircle size={16} weight="fill" />}>
            {t("notifications.escalationNote", { minutes: settings.escalationMinutes })}
          </Callout>
        </aside>
      </div>

      <section className="grid gap-4" aria-labelledby="notification-preferences-heading">
        <div>
          <h2 id="notification-preferences-heading" className="text-lg font-bold">{t("notifications.preferences")}</h2>
          <p className="mt-1 text-sm text-ink-muted">{t("notifications.preferencesIntro")}</p>
        </div>
        <PreferencesForm
          rows={preferences.topics.map((topic) => ({
            topic,
            label: topicLabel(topic, t),
            values: {
              in_app: modes.get(`${topic}:in_app`) ?? defaultMode("in_app"),
              email: modes.get(`${topic}:email`) ?? defaultMode("email"),
              sms: modes.get(`${topic}:sms`) ?? defaultMode("sms"),
              push: modes.get(`${topic}:push`) ?? defaultMode("push"),
            },
          }))}
          available={available}
          labels={labels}
          channelLabels={{
            in_app: t("notifications.channel.inApp"),
            email: t("notifications.channel.email"),
            sms: t("notifications.channel.sms"),
            push: t("notifications.channel.push"),
          }}
          topicLabel={t("notifications.topic")}
        />
      </section>

      <section id="notification-schedule" className="scroll-mt-6">
        <Card>
          <CardHeader title={t("notifications.schedule")} />
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">{t("notifications.scheduleIntro")}</p>
            <div className="max-w-lg">
              <DigestSettingsForm
                values={{
                  digestCadence: settings.digestCadence,
                  digestMinute: settings.digestMinute,
                  digestWeekday: settings.digestWeekday,
                  timezone: settings.timezone ?? business?.timezone ?? "UTC",
                  escalationMinutes: settings.escalationMinutes,
                }}
                labels={labels}
                fields={{
                  cadence: t("notifications.cadence"),
                  daily: t("notifications.cadence.daily"),
                  weekly: t("notifications.cadence.weekly"),
                  weekday: t("notifications.weekday"),
                  weekdays: Array.from({ length: 7 }, (_, index) => t(`notifications.weekday.${index + 1}`)),
                  time: t("notifications.time"),
                  timezone: t("business.timezone"),
                  escalation: t("notifications.escalationDelay"),
                  escalationHint: t("notifications.escalationHint"),
                }}
              />
            </div>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
