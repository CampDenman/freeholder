// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who is waiting, in order (C6.08, MASTER.md §4.4).
//
// The queue is shown in the order it will actually be offered — position
// first, then when somebody joined — so this page is a prediction rather than
// a second opinion. An owner who reorders it here changes what happens next,
// which is the only honest relationship between a list and a queue.
//
// The offer token is deliberately absent. It is a credential that lets
// somebody book without an account, and a list is the easiest place in the
// product for one to end up in a screenshot or a support ticket.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listWaitlist } from "@/core/scheduling/waitlist";
import { listCalendars } from "@/core/scheduling/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  moveWaitlistAction,
  offerWaitlistAction,
  withdrawWaitlistAction,
} from "../../../booking-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  waiting: "neutral",
  offered: "warning",
  booked: "success",
  expired: "neutral",
  withdrawn: "neutral",
};

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ calendarId?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("scheduling");
  const query = await searchParams;
  const [t, business, calendars, queue] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listCalendars.call({}, actor)),
    domainOrNull(
      listWaitlist.call(
        query.calendarId ? { calendarId: query.calendarId } : {},
        actor,
      ),
    ),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/calendars" className="text-sm text-ink-muted">
          {t("waitlist.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("waitlist.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("waitlist.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {query.saved === "offered" ? t("waitlist.offered") : query.saved}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("waitlist.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("waitlist.filter")} />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("waitlist.field.calendar")}</span>
              <select
                name="calendarId"
                defaultValue={query.calendarId ?? ""}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="">{t("waitlist.allCalendars")}</option>
                {(calendars ?? []).map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="quiet">
              {t("waitlist.action.show")}
            </Button>
          </form>
        </CardBody>
      </Card>

      {query.calendarId ? (
        <Card>
          <CardHeader title={t("waitlist.offerTitle")} />
          <CardBody>
            <form action={offerWaitlistAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="calendarId" value={query.calendarId} />
              <input type="hidden" name="timezone" value={timezone} />
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("waitlist.field.when")}</span>
                <input
                  type="datetime-local"
                  name="startsAt"
                  required
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("waitlist.field.minutes")}</span>
                <input
                  type="number"
                  name="durationMin"
                  min={5}
                  step={5}
                  defaultValue={60}
                  className="w-24 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                />
              </label>
              <Button type="submit" variant="quiet">
                {t("waitlist.action.offer")}
              </Button>
            </form>
            <p className="max-w-prose text-sm text-ink-muted">{t("waitlist.offerHint")}</p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("waitlist.queue")} />
        <CardBody>
          {queue === null ? (
            <p className="text-sm text-danger">{t("waitlist.unavailable")}</p>
          ) : queue.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("waitlist.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {queue.map((entry) => (
                <li key={entry.id} className="grid gap-2 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {entry.contactName ?? entry.contactEmail ?? t("waitlist.someone")}
                    </span>
                    <Pill tone={STATUS_TONES[entry.status] ?? "neutral"}>
                      {t(`waitlist.status.${entry.status}`)}
                    </Pill>
                    {entry.seatCount > 1 ? (
                      <Pill tone="neutral">
                        {t("waitlist.seats", { count: String(entry.seatCount) })}
                      </Pill>
                    ) : null}
                  </div>
                  <p className="text-sm text-ink-muted">
                    {t("waitlist.window", {
                      from: when(entry.windowStart),
                      to: when(entry.windowEnd),
                    })}
                  </p>
                  {entry.status === "offered" && entry.offerExpiresAt ? (
                    <p className="text-sm text-ink-muted">
                      {t("waitlist.held", { until: when(entry.offerExpiresAt) })}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-end gap-3">
                    <form action={moveWaitlistAction} className="flex items-end gap-2">
                      <input type="hidden" name="id" value={entry.id} />
                      <input
                        type="hidden"
                        name="calendarId"
                        value={query.calendarId ?? ""}
                      />
                      <label className="grid gap-1 text-sm">
                        <span className="text-ink-muted">{t("waitlist.field.position")}</span>
                        <input
                          type="number"
                          name="position"
                          min={0}
                          defaultValue={entry.position}
                          className="w-20 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                        />
                      </label>
                      <Button type="submit" variant="quiet">
                        {t("waitlist.action.move")}
                      </Button>
                    </form>
                    {entry.status === "waiting" || entry.status === "offered" ? (
                      <form action={withdrawWaitlistAction}>
                        <input type="hidden" name="id" value={entry.id} />
                        <input
                          type="hidden"
                          name="calendarId"
                          value={query.calendarId ?? ""}
                        />
                        <Button type="submit" variant="danger">
                          {t("waitlist.action.withdraw")}
                        </Button>
                      </form>
                    ) : null}
                    {entry.bookingId ? (
                      <a
                        href={`/admin/appointments/${entry.bookingId}`}
                        className="text-sm underline"
                      >
                        {t("waitlist.openBooking")}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
