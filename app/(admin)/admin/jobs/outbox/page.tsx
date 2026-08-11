// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { formatDateTime } from "@/core/i18n";
import {
  listOutboxEvents,
  outboxSummary,
} from "@/core/events/outbox-service";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("outbox.title"), robots: { index: false, follow: false } };
}

const PAGE_SIZE = 50;
const STATUSES = ["dead_letter", "pending", "dispatched"] as const;

function statusTone(status: string) {
  if (status === "dead_letter") return "danger" as const;
  if (status === "pending") return "warning" as const;
  return "success" as const;
}

export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor("platform");
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const rawStatus = one("status");
  const status = STATUSES.includes(rawStatus as (typeof STATUSES)[number])
    ? (rawStatus as (typeof STATUSES)[number])
    : "dead_letter";
  const eventName = one("eventName").trim() || undefined;
  const offset = Math.max(0, Number(one("offset")) || 0);
  const [t, business, summary, result] = await Promise.all([
    getT(),
    currentBusiness(),
    outboxSummary.call({}, actor),
    listOutboxEvents.call(
      { status, eventName, limit: PAGE_SIZE, offset },
      actor,
    ),
  ]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const pageHref = (nextOffset: number) => {
    const query = new URLSearchParams({ status, offset: String(nextOffset) });
    if (eventName) query.set("eventName", eventName);
    return `?${query}`;
  };

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/jobs" className="text-sm text-ink-muted">{t("outbox.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("outbox.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">{t("outbox.intro")}</p>
      </div>

      <dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-rule bg-surface">
        {([
          ["pending", summary.pending, "border-warning"],
          ["dispatched", summary.dispatched, "border-success"],
          ["dead_letter", summary.deadLetters, "border-danger"],
        ] as const).map(([key, count, border]) => (
          <div key={key} className={`border-t-4 ${border} px-4 py-3 not-last:border-e not-last:border-rule`}>
            <dt className="font-mono text-[0.68rem] uppercase tracking-wide text-ink-muted">
              {t(`outbox.status.${key}`)}
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>

      <Card>
        <CardHeader title={t("outbox.events")} status={<Pill>{result.total}</Pill>} />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Field label={t("outbox.status")} htmlFor="outbox-status">
              <Select id="outbox-status" name="status" defaultValue={status}>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>{t(`outbox.status.${value}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("outbox.eventName")} htmlFor="outbox-event-name">
              <Input id="outbox-event-name" name="eventName" defaultValue={eventName} />
            </Field>
            <button className="rounded-md border border-rule px-4 py-2 text-sm font-semibold" type="submit">
              {t("common.filter")}
            </button>
          </form>

          {result.items.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("outbox.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-3xl border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule">
                    <th className="px-3 py-2 text-start">{t("outbox.eventName")}</th>
                    <th className="px-3 py-2 text-start">{t("outbox.status")}</th>
                    <th className="px-3 py-2 text-start">{t("outbox.attempts")}</th>
                    <th className="px-3 py-2 text-start">{t("outbox.created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((event) => (
                    <tr key={event.id} className="border-b border-rule last:border-0">
                      <td className="px-3 py-3">
                        <a className="font-mono text-xs font-semibold underline" href={`/admin/jobs/outbox/${event.id}`}>
                          {event.eventName}
                        </a>
                        {event.lastError ? <span className="mt-1 block max-w-xl truncate text-xs text-danger">{event.lastError}</span> : null}
                      </td>
                      <td className="px-3 py-3"><Pill tone={statusTone(event.status)}>{t(`outbox.status.${event.status}`)}</Pill></td>
                      <td className="px-3 py-3 font-mono text-xs tabular-nums">{event.attempts}</td>
                      <td className="px-3 py-3 font-mono text-xs tabular-nums">{formatDateTime(event.createdAt, timezone, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-3 text-sm">
            {offset > 0 ? <a className="underline" href={pageHref(Math.max(0, offset - PAGE_SIZE))}>{t("common.previous")}</a> : null}
            {offset + result.items.length < result.total ? <a className="underline" href={pageHref(offset + PAGE_SIZE)}>{t("common.next")}</a> : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
