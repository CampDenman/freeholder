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
import { formatMoney } from "@/core/i18n";
import { getBooking } from "@/core/scheduling/bookings";
import { bookingRequirements } from "@/core/scheduling/requirements";
import { listBookingReminders } from "@/core/scheduling/reminders";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  addGuestAction,
  addReminderAction,
  issueWaiverAction,
  markGuestAction,
  removeGuestAction,
  rescheduleBookingAction,
  setBookingStatusAction,
  stopReminderAction,
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
  const [t, business, booking, requirements, reminders, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(getBooking.call({ id }, actor)),
    domainOrNull(bookingRequirements.call({ id }, actor)),
    domainOrNull(listBookingReminders.call({ bookingId: id }, actor)),
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
  // Integer minor units all the way to the screen (§15.4). The currency comes
  // from the invoice the outcome was decided against, so a business that
  // trades in two never shows one appointment's fee in the other's.
  const money = (minor: number, currency: string | null) =>
    formatMoney(minor, currency ?? business?.baseCurrency ?? "GBP", locale);

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
                    {/* Somebody who signed on paper in the shop has met the
                        requirement in the way that matters. The platform must
                        not enforce its bookkeeping against the business. */}
                    {next === "confirmed" && requirements && !requirements.ready ? (
                      <label className="mb-1 flex items-center gap-2 text-sm">
                        <input type="checkbox" name="overrideRequirements" />
                        <span className="text-ink-muted">{t("appointments.override")}</span>
                      </label>
                    ) : null}
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
              {/* The policy binds the customer, not the business. An owner who
                  agrees to move somebody as a favour should not have to cancel
                  and rebook to do it. */}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="overridePolicy" />
                <span className="text-ink-muted">{t("appointments.override")}</span>
              </label>
              <Button type="submit" variant="quiet">
                {t("appointments.action.move")}
              </Button>
            </form>
            <p className="max-w-prose text-sm text-ink-muted">{t("appointments.moveHint")}</p>
          </CardBody>
        </Card>
      ) : null}

      {/* Money is decided here and moved in the invoice. §4.4: a booking is not
          a payment, so what the policy said is a record the owner acts on
          rather than something a status change did to somebody's card. */}
      {booking.cancellationOutcome ? (
        <Card>
          <CardHeader title={t("appointments.outcome")} />
          <CardBody>
            <p className="max-w-prose text-sm">{booking.cancellationOutcome.reason}</p>
            <dl className="grid gap-2 text-sm">
              <div className="flex gap-2">
                <dt className="w-40 text-ink-muted">{t("appointments.field.policy")}</dt>
                <dd>{booking.cancellationOutcome.policyName}</dd>
              </div>
              {booking.cancellationOutcome.feeMinor > 0 ? (
                <div className="flex gap-2">
                  <dt className="w-40 text-ink-muted">{t("appointments.field.fee")}</dt>
                  <dd className="tabular-nums">
                    {money(booking.cancellationOutcome.feeMinor, booking.cancellationOutcome.currency)}
                  </dd>
                </div>
              ) : null}
              {booking.cancellationOutcome.refundDueMinor > 0 ? (
                <div className="flex gap-2">
                  <dt className="w-40 text-ink-muted">{t("appointments.field.refundDue")}</dt>
                  <dd className="tabular-nums">
                    {money(
                      booking.cancellationOutcome.refundDueMinor,
                      booking.cancellationOutcome.currency,
                    )}
                  </dd>
                </div>
              ) : null}
              {booking.cancellationOutcome.outstandingMinor > 0 ? (
                <div className="flex gap-2">
                  <dt className="w-40 text-ink-muted">{t("appointments.field.outstanding")}</dt>
                  <dd className="tabular-nums">
                    {money(
                      booking.cancellationOutcome.outstandingMinor,
                      booking.cancellationOutcome.currency,
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
            {booking.invoiceId &&
            (booking.cancellationOutcome.refundDueMinor > 0 ||
              booking.cancellationOutcome.outstandingMinor > 0) ? (
              <p className="max-w-prose text-sm text-ink-muted">
                {t("appointments.settleHint")}{" "}
                <a href={`/admin/invoices/${booking.invoiceId}`} className="underline">
                  {t("appointments.openInvoice")}
                </a>
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* §4.4: intake and a signed waiver come before the slot is *confirmed*.
          The screen says what is outstanding rather than hiding the confirm
          button, because a button that vanishes teaches nobody anything. */}
      {requirements && !requirements.ready ? (
        <Card>
          <CardHeader title={t("appointments.requirements")} />
          <CardBody>
            <ul className="grid list-none gap-2 p-0 text-sm">
              {requirements.intakeFormId ? (
                <li>{t("appointments.intakeOutstanding")}</li>
              ) : null}
              {requirements.waiverOutstanding ? (
                <li>{t("appointments.waiverOutstanding")}</li>
              ) : null}
            </ul>
            {requirements.waiverOutstanding ? (
              <form action={issueWaiverAction}>
                <input type="hidden" name="bookingId" value={booking.id} />
                <Button type="submit" variant="quiet">
                  {t("appointments.issueWaiver")}
                </Button>
              </form>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {canMove ? (
        <Card>
          <CardHeader title={t("appointments.reminders")} />
          <CardBody>
            {(reminders ?? []).length === 0 ? (
              <p className="max-w-prose text-sm text-ink-muted">
                {t("appointments.noReminders")}
              </p>
            ) : (
              <ul className="grid list-none gap-2 p-0">
                {(reminders ?? []).map((reminder) => (
                  <li
                    key={reminder.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-2 text-sm"
                  >
                    <span className="tabular-nums">
                      {new Intl.DateTimeFormat(locale, {
                        timeZone: timezone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(reminder.sendAt))}
                    </span>
                    <Pill tone={reminder.status === "failed" ? "danger" : "neutral"}>
                      {t(`appointments.reminderStatus.${reminder.status}`)}
                    </Pill>
                    {/* Why it was not sent, in words an owner can act on —
                        "was she reminded?" deserves a real answer. */}
                    {reminder.skipReason ? (
                      <span className="text-ink-muted">{reminder.skipReason}</span>
                    ) : null}
                    {reminder.status === "scheduled" ? (
                      <form action={stopReminderAction}>
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="id" value={reminder.id} />
                        <Button type="submit" variant="quiet">
                          {t("appointments.reminderStop")}
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <form action={addReminderAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="bookingId" value={booking.id} />
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("appointments.field.reminder")}</span>
                <input
                  type="number"
                  name="offsetMin"
                  min={0}
                  step={30}
                  defaultValue={1440}
                  className="w-28 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                />
              </label>
              <Button type="submit" variant="quiet">
                {t("appointments.reminderAdd")}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("appointments.guests")} />
        <CardBody>
          {booking.participants.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("appointments.noGuests")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {booking.participants.map((guest) => (
                <li
                  key={guest.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-2"
                >
                  <span className="font-medium">
                    {guest.name ?? t("appointments.aGuest")}
                  </span>
                  <Pill tone={guest.status === "no_show" ? "danger" : "neutral"}>
                    {t(`appointments.guestStatus.${guest.status}`)}
                  </Pill>
                  {guest.seatCount > 1 ? (
                    <span className="text-sm text-ink-muted tabular-nums">
                      {t("appointments.seats", { count: String(guest.seatCount) })}
                    </span>
                  ) : null}
                  {canMove
                    ? ["attended", "no_show"].map((status) => (
                        <form key={status} action={markGuestAction}>
                          <input type="hidden" name="bookingId" value={booking.id} />
                          <input type="hidden" name="id" value={guest.id} />
                          <input type="hidden" name="status" value={status} />
                          <Button type="submit" variant="quiet">
                            {t(`appointments.guestAction.${status}`)}
                          </Button>
                        </form>
                      ))
                    : null}
                  {canMove ? (
                    <form action={removeGuestAction}>
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <input type="hidden" name="id" value={guest.id} />
                      <Button type="submit" variant="danger">
                        {t("appointments.guestAction.remove")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canMove ? (
            <form action={addGuestAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="bookingId" value={booking.id} />
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("appointments.field.guestName")}</span>
                <input
                  name="name"
                  autoComplete="name"
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("appointments.field.guestEmail")}</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("appointments.field.seats")}</span>
                <input
                  type="number"
                  name="seatCount"
                  min={1}
                  defaultValue={1}
                  className="w-20 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                />
              </label>
              <Button type="submit" variant="quiet">
                {t("appointments.guestAction.add")}
              </Button>
            </form>
          ) : null}
          <p className="max-w-prose text-sm text-ink-muted">{t("appointments.guestHint")}</p>
        </CardBody>
      </Card>

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
            {/* The terms as they stood when this was booked, not as the
                policy reads today — §4.4's "the customer saw the terms before
                booking" is only true while those are different things. */}
            {booking.cancellationPolicy ? (
              <div className="flex gap-2">
                <dt className="w-40 text-ink-muted">{t("appointments.field.policy")}</dt>
                <dd className="max-w-prose">
                  {t("appointments.policySummary", {
                    name: booking.cancellationPolicy.name,
                    hours: String(booking.cancellationPolicy.freeUntilHours),
                  })}
                </dd>
              </div>
            ) : null}
            {booking.rescheduleCount > 0 ? (
              <div className="flex gap-2">
                <dt className="w-40 text-ink-muted">{t("appointments.field.moves")}</dt>
                <dd className="tabular-nums">{booking.rescheduleCount}</dd>
              </div>
            ) : null}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
