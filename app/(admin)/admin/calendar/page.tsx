// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The unified calendar (C4.13, MASTER.md §4.4, §41).
//
// One week, every connected calendar, merged into the periods the business is
// already committed. There is nothing to click into and no event to open,
// because there is nothing behind a block: the page renders the busy union,
// which carries times and only times. A screen that could show a title would
// be a screen somebody could leave open in a meeting.
//
// What it does show, deliberately, is every calendar that is *not* counted and
// why — personal, or ignored, or needing a reconnection. That is the list
// somebody checks after a double booking, and a page that only showed the
// blocks would send them looking in the wrong place.
import type { Metadata } from "next";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { addDays, zonedDate, zonedInstant } from "@/core/i18n/zoned";
import { busyWindows, calendarSources } from "@/core/connections/busy";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type CalendarDate = { year: number; month: number; day: number };

/** A block as the grid draws it: one day, and a share of that day. */
type DayBlock = { topPercent: number; heightPercent: number; label: string };

function parseWeek(value: string | undefined): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function isoDate(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor("connections");
  const params = await searchParams;
  const [t, business] = await Promise.all([getT(), currentBusiness()]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";

  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;
  const today = zonedDate(new Date(), timezone);
  const anchor = parseWeek(weekParam) ?? today;
  // Monday-first, computed from the anchor's own weekday in its own zone.
  const anchorInstant = zonedInstant(timezone, { ...anchor, hour: 12 });
  const weekday = (anchorInstant.getUTCDay() + 6) % 7;
  const monday = addDays(anchor, -weekday);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    return {
      date,
      startsAt: zonedInstant(timezone, date),
      endsAt: zonedInstant(timezone, addDays(date, 1)),
    };
  });
  const from = days[0]!.startsAt;
  const to = days[6]!.endsAt;

  const [windows, sources] = await Promise.all([
    domainOrNull(busyWindows.call({ from: from.toISOString(), to: to.toISOString() }, actor)),
    domainOrNull(calendarSources.call({}, actor)),
  ]);

  const time = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const dayName = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short" });
  const dayNumber = new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric" });
  const monthRange = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    month: "long",
    year: "numeric",
  });

  // Blocks are cut at each day's real boundary, so a 23- or 25-hour day drawn
  // over a clock change is still drawn to scale.
  const columns: DayBlock[][] = days.map(() => []);
  for (const window of windows ?? []) {
    const startsAt = new Date(window.startsAt);
    const endsAt = new Date(window.endsAt);
    days.forEach((day, index) => {
      const length = day.endsAt.getTime() - day.startsAt.getTime();
      const start = Math.max(startsAt.getTime(), day.startsAt.getTime());
      const end = Math.min(endsAt.getTime(), day.endsAt.getTime());
      if (end <= start) return;
      columns[index]!.push({
        topPercent: ((start - day.startsAt.getTime()) / length) * 100,
        heightPercent: ((end - start) / length) * 100,
        label: t("calendar.busyFromTo", {
          from: time.format(new Date(start)),
          to: time.format(new Date(end)),
        }),
      });
    });
  }

  const previous = isoDate(addDays(monday, -7));
  const next = isoDate(addDays(monday, 7));
  const blocking = (sources ?? []).filter((source) => source.blocking);
  const excluded = (sources ?? []).filter((source) => !source.blocking);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("calendar.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("calendar.intro")}</p>
      </div>

      <Card>
        <CardHeader
          title={monthRange.format(days[0]!.startsAt)}
          status={
            <div className="flex items-center gap-2">
              <a
                href={`/admin/calendar?week=${previous}`}
                className="rounded-md border border-rule px-3 py-1 text-sm"
              >
                {t("calendar.previous")}
              </a>
              <a
                href="/admin/calendar"
                className="rounded-md border border-rule px-3 py-1 text-sm"
              >
                {t("calendar.today")}
              </a>
              <a
                href={`/admin/calendar?week=${next}`}
                className="rounded-md border border-rule px-3 py-1 text-sm"
              >
                {t("calendar.next")}
              </a>
            </div>
          }
        />
        <CardBody>
          {windows === null ? (
            <p className="text-sm text-danger">{t("calendar.unavailable")}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <div className="grid min-w-[42rem] grid-cols-7 gap-1">
                  {days.map((day, index) => {
                    const isToday = isoDate(day.date) === isoDate(today);
                    return (
                      <div key={isoDate(day.date)} className="grid gap-1">
                        <div
                          className={`rounded-md px-2 py-1 text-center text-xs ${
                            isToday ? "bg-accent-soft font-bold" : "text-ink-muted"
                          }`}
                        >
                          <div>{dayName.format(day.startsAt)}</div>
                          <div className="text-base tabular-nums">
                            {dayNumber.format(day.startsAt)}
                          </div>
                        </div>
                        <div className="relative h-64 rounded-md border border-rule bg-surface-muted">
                          {columns[index]!.map((block) => (
                            <div
                              key={`${block.topPercent}-${block.heightPercent}`}
                              className="absolute inset-x-1 rounded-sm bg-accent"
                              style={{
                                top: `${block.topPercent}%`,
                                height: `${Math.max(block.heightPercent, 1.5)}%`,
                              }}
                              title={block.label}
                            >
                              <span className="sr-only">{block.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-3 text-sm text-ink-muted">
                {windows.length === 0
                  ? t("calendar.clear")
                  : t("calendar.summary", { count: windows.length })}
              </p>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("calendar.sources.title")} />
        <CardBody>
          {sources === null ? (
            <p className="text-sm text-danger">{t("calendar.sources.unavailable")}</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("calendar.sources.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {[...blocking, ...excluded].map((source) => (
                <li
                  key={source.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule p-3"
                >
                  <div>
                    <p className="font-medium">{source.name}</p>
                    <p className="text-sm text-ink-muted">{source.account}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {source.status === "needs_reconnect" ? (
                      <Pill tone="danger">{t("calendar.sources.needsReconnect")}</Pill>
                    ) : null}
                    {source.blocking ? (
                      <Pill tone="success">{t("calendar.sources.blocking")}</Pill>
                    ) : (
                      <Pill tone="neutral">
                        {source.role === "ignored"
                          ? t("calendar.sources.ignored")
                          : t("calendar.sources.personal")}
                      </Pill>
                    )}
                    {source.detailVisibility === "full" ? (
                      <Pill tone="neutral">{t("calendar.sources.details")}</Pill>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 max-w-prose text-sm text-ink-muted">
            {t("calendar.sources.privacy")}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
