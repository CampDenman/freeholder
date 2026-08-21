// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One calendar's hours (C6.02, MASTER.md §4.4).
//
// The week is edited as a shape and saved in one go, because that is how
// somebody reads their own hours: "Tuesdays and Thursdays, nine to five", not
// seven separate facts. Exceptions are added and removed one at a time,
// because that is how they arrive — on the day somebody hears about them.
//
// Leaving a day's times empty closes it. There is no delete button per row for
// the same reason there is no row for a day nobody works: an empty day is the
// absence of hours, not a thing to remove.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { getCalendar } from "@/core/scheduling/service";
import { listAvailability } from "@/core/scheduling/availability-service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  addExceptionAction,
  removeExceptionAction,
  setAvailabilityAction,
} from "../../../availability-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** 0 = Sunday, matching Date#getDay and the opening-hours table. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export default async function CalendarHoursPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("scheduling");
  const { id } = await params;
  const [t, business, calendar, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(getCalendar.call({ id }, actor)),
    searchParams,
  ]);
  if (!calendar) notFound();

  const availability = await domainOrNull(
    listAvailability.call({ calendarId: calendar.id }, actor),
  );
  const rules = availability?.rules ?? [];
  const exceptions = availability?.exceptions ?? [];
  const locale = business?.defaultLocale ?? "en";
  const dayName = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  // 2024-01-07 was a Sunday, so index 0 lands on Sunday in every locale.
  const nameOf = (weekday: number) =>
    dayName.format(new Date(Date.UTC(2024, 0, 7 + weekday)));

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/calendars" className="text-sm text-ink-muted">
          {t("availability.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{calendar.name}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("availability.intro", { timezone: calendar.timezone })}
        </p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("availability.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("availability.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("availability.week")} />
        <CardBody>
          <form action={setAvailabilityAction} className="grid gap-3">
            <input type="hidden" name="calendarId" value={calendar.id} />
            {WEEKDAYS.map((weekday) => {
              const forDay = rules.filter((rule) => rule.weekday === weekday);
              const bookable = forDay.find((rule) => rule.kind === "bookable");
              const onCall = forDay.find((rule) => rule.kind === "on_call");
              return (
                <div
                  key={weekday}
                  className="flex flex-wrap items-end gap-3 rounded-md border border-rule p-3"
                >
                  <span className="w-28 text-sm font-medium">{nameOf(weekday)}</span>
                  <label className="grid gap-1 text-sm">
                    <span className="text-ink-muted">{t("availability.opens")}</span>
                    <input
                      type="time"
                      name={`open-${weekday}`}
                      defaultValue={bookable?.starts.slice(0, 5) ?? ""}
                      className="rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-ink-muted">{t("availability.closes")}</span>
                    <input
                      type="time"
                      name={`close-${weekday}`}
                      defaultValue={bookable?.ends.slice(0, 5) ?? ""}
                      className="rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-ink-muted">{t("availability.onCallFrom")}</span>
                    <input
                      type="time"
                      name={`oncall-open-${weekday}`}
                      defaultValue={onCall?.starts.slice(0, 5) ?? ""}
                      className="rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-ink-muted">{t("availability.onCallTo")}</span>
                    <input
                      type="time"
                      name={`oncall-close-${weekday}`}
                      defaultValue={onCall?.ends.slice(0, 5) ?? ""}
                      className="rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                    />
                  </label>
                  {forDay.length === 0 ? (
                    <Pill tone="neutral">{t("availability.closedDay")}</Pill>
                  ) : null}
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit">{t("availability.save")}</Button>
              <p className="text-sm text-ink-muted">{t("availability.hint")}</p>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("availability.exceptions")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">
            {t("availability.exceptionsHint")}
          </p>

          {exceptions.length > 0 ? (
            <ul className="grid list-none gap-2 p-0">
              {exceptions.map((exception) => (
                <li
                  key={exception.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-rule px-3 py-2 text-sm"
                >
                  <span className="tabular-nums">
                    {exception.startsOn === exception.endsOn
                      ? exception.startsOn
                      : `${exception.startsOn} → ${exception.endsOn}`}
                  </span>
                  <Pill tone={exception.kind === "closed" ? "danger" : "accent"}>
                    {t(`availability.kind.${exception.kind}`)}
                  </Pill>
                  {exception.starts ? (
                    <span className="tabular-nums text-ink-muted">
                      {exception.starts.slice(0, 5)}–{exception.ends?.slice(0, 5)}
                    </span>
                  ) : null}
                  {exception.reason ? (
                    <span className="text-ink-muted">{exception.reason}</span>
                  ) : null}
                  <form action={removeExceptionAction} className="ms-auto">
                    <input type="hidden" name="id" value={exception.id} />
                    <input type="hidden" name="calendarId" value={calendar.id} />
                    <Button type="submit" variant="quiet">
                      {t("availability.remove")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          <form action={addExceptionAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="calendarId" value={calendar.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("availability.from")}</span>
              <input
                type="date"
                name="startsOn"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("availability.to")}</span>
              <input
                type="date"
                name="endsOn"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("availability.what")}</span>
              <select
                name="kind"
                defaultValue="closed"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="closed">{t("availability.kind.closed")}</option>
                <option value="reduced">{t("availability.kind.reduced")}</option>
                <option value="open">{t("availability.kind.open")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("availability.opens")}</span>
              <input
                type="time"
                name="starts"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("availability.closes")}</span>
              <input
                type="time"
                name="ends"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("availability.reason")}</span>
              <input
                name="reason"
                placeholder={t("availability.reasonPlaceholder")}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit" variant="quiet">
              {t("availability.add")}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
