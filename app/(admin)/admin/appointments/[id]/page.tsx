// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One appointment, and what may happen to it next (C6.07, MASTER.md §4.4).
//
// The lifecycle buttons are exactly the transitions the service allows, and
// nothing else: a screen offering "confirm" on a completed appointment would
// be promising something the state machine refuses.
//
// Two timezones are shown when they differ — the business's and the one the
// appointment was agreed in — because §4.4 keeps `timezone_at_booking` for
// precisely this, so a clock change between booking and appointment is a known
// quantity rather than a surprise.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { getBooking } from "@/core/scheduling/bookings";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  rescheduleBookingAction,
  setBookingStatusAction,
} from "../../../booking-actions";

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

/** Mirrors the service's own map. A button that leads to a refusal is a lie. */
const NEXT: Record<string, readonly string[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "completed", "no_show", "cancelled"],
  in_progress: ["completed", "no_show", "cancelled"],
  completed: [],
  no_show: [],
  cancelled: [],
};

export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("scheduling");
  const { id } = await params;
  const [t, business, booking, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(getBooking.call({ id }, actor)),
    searchParams,
  ]);
  if (!booking) notFound();

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const inZone = (zone: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(booking.startsAt));
  const differs = booking.timezoneAtBooking !== timezone;
  const canMove = ["requested", "confirmed", "in_progress"].includes(booking.status);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/appointments" className="text-sm text-ink-muted">
          {t("appointments.back")}
        </a>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
          {inZone(timezone)}
          <Pill tone={STATUS_TONES[booking.status] ?? "neutral"}>
            {t(`appointments.status.${booking.status}`)}
          </Pill>
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {timezone}
          {differs ? ` · ${t("appointments.agreedIn", { timezone: booking.timezoneAtBooking })}` : ""}
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
        <CardHeader title={t("appointments.whatNext")} />
        <CardBody>
          {(NEXT[booking.status] ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("appointments.finished")}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              {(NEXT[booking.status] ?? [])
                .filter((next) => next !== "cancelled")
                .map((next) => (
                  <form key={next} action={setBookingStatusAction}>
                    <input type="hidden" name="id" value={booking.id} />
                    <input type="hidden" name="status" value={next} />
                    <Button type="submit" variant="quiet">
                      {t(`appointments.action.${next}`)}
                    </Button>
                  </form>
                ))}
              {(NEXT[booking.status] ?? []).includes("cancelled") ? (
                <form
                  action={setBookingStatusAction}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="id" value={booking.id} />
                  <input type="hidden" name="status" value="cancelled" />
                  <label className="grid gap-1 text-sm">
                    <span className="text-ink-muted">{t("appointments.field.reason")}</span>
                    <input
                      name="reason"
                      required
                      placeholder={t("appointments.reasonPlaceholder")}
                      className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                    />
                  </label>
                  <Button type="submit" variant="danger">
                    {t("appointments.action.cancelled")}
                  </Button>
                </form>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      {canMove ? (
        <Card>
          <CardHeader title={t("appointments.move")} />
          <CardBody>
            <form
              action={rescheduleBookingAction}
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="id" value={booking.id} />
              <input type="hidden" name="timezone" value={timezone} />
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
                  defaultValue={Math.round(
                    (new Date(booking.endsAt).getTime() -
                      new Date(booking.startsAt).getTime()) /
                      60_000,
                  )}
                  className="w-24 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                />
              </label>
              <Button type="submit" variant="quiet">
                {t("appointments.action.move")}
              </Button>
            </form>
            <p className="max-w-prose text-sm text-ink-muted">{t("appointments.moveHint")}</p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("appointments.details")} />
        <CardBody>
          <dl className="grid gap-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-40 text-ink-muted">{t("appointments.field.customer")}</dt>
              <dd>
                <a href={`/admin/contacts/${booking.contactId}`} className="underline">
                  {t("appointments.openContact")}
                </a>
              </dd>
            </div>
            {booking.notes ? (
              <div className="flex gap-2">
                <dt className="w-40 text-ink-muted">{t("appointments.field.notes")}</dt>
                <dd className="max-w-prose">{booking.notes}</dd>
              </div>
            ) : null}
            {booking.cancellationReason ? (
              <div className="flex gap-2">
                <dt className="w-40 text-ink-muted">{t("appointments.field.reason")}</dt>
                <dd className="max-w-prose">{booking.cancellationReason}</dd>
              </div>
            ) : null}
            {booking.rescheduledFromId ? (
              <div className="flex gap-2">
                <dt className="w-40 text-ink-muted">{t("appointments.movedFrom")}</dt>
                <dd>
                  <a
                    href={`/admin/appointments/${booking.rescheduledFromId}`}
                    className="underline"
                  >
                    {t("appointments.openPrevious")}
                  </a>
                </dd>
              </div>
            ) : null}
            {booking.participants.length > 0 ? (
              <div className="flex gap-2">
                <dt className="w-40 text-ink-muted">{t("appointments.guests")}</dt>
                <dd>
                  {booking.participants
                    .map((guest) => guest.name ?? t("appointments.aGuest"))
                    .join(", ")}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
