// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The appointments workspace (C6.07, MASTER.md §4.4).
//
// Grouped by day rather than listed flat, because a diary is read a day at a
// time and "what is on Thursday" is the question somebody actually has.
//
// Every time is shown in the business's zone, labelled. §4.4 calls timezone
// confusion the single largest cause of no-shows, so the label is not
// decoration — a screen that showed a bare "10:00" would be the ambiguity.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listBookings } from "@/core/scheduling/bookings";
import { listCalendars } from "@/core/scheduling/service";
import { zonedDate } from "@/core/i18n/zoned";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { createBookingAction } from "../../booking-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  requested: "warning",
  confirmed: "success",
  in_progress: "accent",
  completed: "neutral",
  no_show: "danger",
  cancelled: "neutral",
};

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; calendar?: string }>;
}) {
  const actor = await requireStaffActor("scheduling");
  const [t, business, calendars, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listCalendars.call({}, actor)),
    searchParams,
  ]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";

  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const to = new Date(now.getTime() + 60 * 86_400_000);
  const appointments = await domainOrNull(
    listBookings.call(
      {
        from: from.toISOString(),
        to: to.toISOString(),
        calendarId: query.calendar || undefined,
        statuses: ["requested", "confirmed", "in_progress", "completed", "no_show"],
      },
      actor,
    ),
  );

  const clock = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const dayLabel = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Grouped in the business's own zone, so an evening appointment does not
  // land on tomorrow because the server keeps UTC.
  const byDay = new Map<string, typeof appointments>();
  for (const appointment of appointments ?? []) {
    const date = zonedDate(new Date(appointment.startsAt), timezone);
    const key = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
    byDay.set(key, [...(byDay.get(key) ?? []), appointment]);
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("appointments.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("appointments.intro", { timezone })}
        </p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("appointments.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("appointments.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("appointments.diary")} />
        <CardBody>
          {appointments === null ? (
            <p className="text-sm text-danger">{t("appointments.unavailable")}</p>
          ) : byDay.size === 0 ? (
            <p className="text-sm text-ink-muted">{t("appointments.empty")}</p>
          ) : (
            <ul className="grid list-none gap-5 p-0">
              {[...byDay.entries()].map(([day, forDay]) => (
                <li key={day} className="grid gap-2">
                  <h3 className="text-sm font-semibold">
                    {dayLabel.format(new Date(`${day}T12:00:00Z`))}
                  </h3>
                  <ul className="grid list-none gap-2 p-0">
                    {(forDay ?? []).map((appointment) => (
                      <li
                        key={appointment.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-rule px-3 py-2 text-sm"
                      >
                        <span className="tabular-nums">
                          {clock.format(new Date(appointment.startsAt))}–
                          {clock.format(new Date(appointment.endsAt))}
                        </span>
                        <a
                          href={`/admin/appointments/${appointment.id}`}
                          className="font-medium underline"
                        >
                          {appointment.contactName ?? appointment.contactEmail}
                        </a>
                        <span className="text-ink-muted">{appointment.calendarName}</span>
                        <Pill tone={STATUS_TONES[appointment.status] ?? "neutral"}>
                          {t(`appointments.status.${appointment.status}`)}
                        </Pill>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("appointments.add")} />
        <CardBody>
          <form action={createBookingAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="timezone" value={timezone} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("appointments.field.calendar")}</span>
              <select
                name="calendarId"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {(calendars ?? []).map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("appointments.field.when")}</span>
              <input
                type="datetime-local"
                name="startsAt"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("appointments.field.minutes")}</span>
              <input
                type="number"
                name="durationMin"
                min={5}
                step={5}
                defaultValue={60}
                className="w-24 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("appointments.field.email")}</span>
              <input
                type="email"
                name="email"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("appointments.field.name")}</span>
              <input
                name="name"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="status" value="confirmed" defaultChecked />
              <span className="text-ink-muted">{t("appointments.field.confirmed")}</span>
            </label>
            <Button type="submit">{t("appointments.create")}</Button>
          </form>
          <p className="max-w-prose text-sm text-ink-muted">{t("appointments.addHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
