// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own appointment, reached by the link they were sent (C6.08).
//
// §4.4: "Customers reschedule through a signed `reschedule_token` link, with
// **no login and no support email**." There is no sign-in on this page and
// there is deliberately no way to get to it except by holding the link.
//
// Two clocks, always. The appointment is shown in the zone it was agreed in
// and in the business's, labelled, because §4.4 names timezone confusion as
// the single largest cause of no-shows.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { bookingByToken } from "@/core/scheduling/bookings";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../../i18n";
import { cancelMyAppointmentAction, moveMyAppointmentAction } from "../actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("myBooking.title"),
    // Never indexed, and never a referrer: the URL *is* the credential, and a
    // referring header would hand it to whatever the customer clicks next.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

const STATUS_TONES: Record<string, Tone> = {
  requested: "warning",
  confirmed: "success",
  in_progress: "accent",
  completed: "neutral",
  no_show: "danger",
  cancelled: "neutral",
};

export default async function MyAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { token } = await params;
  const [t, business, booking, query] = await Promise.all([
    getT(),
    currentBusiness(),
    bookingByToken.call({ token }, { kind: "anonymous" }),
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

  return (
    <div className="mx-auto grid max-w-2xl gap-6 p-6">
      <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
      <main id="main" className="grid gap-6">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
            {t("myBooking.heading", { business: business?.name ?? "" })}
            <Pill tone={STATUS_TONES[booking.status] ?? "neutral"}>
              {t(`appointments.status.${booking.status}`)}
            </Pill>
          </h1>
          <p className="mt-2 text-lg">{inZone(booking.timezoneAtBooking)}</p>
          <p className="text-sm text-ink-muted">{booking.timezoneAtBooking}</p>
          {differs ? (
            <p className="mt-1 text-sm text-ink-muted">
              {t("myBooking.alsoShown", { when: inZone(timezone), timezone })}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-ink-muted">{booking.calendarName}</p>
          {booking.locationDetail ? (
            <p className="text-sm text-ink-muted">{booking.locationDetail}</p>
          ) : null}
        </div>

        {query.saved === "cancelled" ? (
          <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
            {t("myBooking.cancelled")}
          </p>
        ) : null}
        {query.error ? (
          <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {query.error.includes(" ") ? query.error : t("myBooking.failed")}
          </p>
        ) : null}

        {/* §4.4: intake and a waiver come before the slot is *confirmed*, not
            before it is booked — so this is a to-do list on an appointment
            somebody already holds, rather than a wall in front of one. */}
        {booking.intakeFormId || booking.waiverToken ? (
          <Card>
            <CardHeader title={t("myBooking.needed")} />
            <CardBody>
              <ul className="grid list-none gap-2 p-0 text-sm">
                {booking.intakeFormId ? (
                  <li>
                    <a
                      href={`/portal/appointments/${token}/intake`}
                      className="underline"
                    >
                      {t("myBooking.intake")}
                    </a>
                  </li>
                ) : null}
                {booking.waiverToken ? (
                  <li>
                    <a
                      href={`/portal/agreements/${booking.waiverToken}`}
                      className="underline"
                    >
                      {t("myBooking.waiver")}
                    </a>
                  </li>
                ) : null}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        {/* The terms are named where somebody can see them before acting, not
            only in the confirmation email they have long since deleted. */}
        {booking.policyName ? (
          <p className="max-w-prose text-sm text-ink-muted">
            {t("myBooking.terms", { name: booking.policyName })}
          </p>
        ) : null}

        {booking.mayReschedule ? (
          <Card>
            <CardHeader title={t("myBooking.move")} />
            <CardBody>
              <form
                action={moveMyAppointmentAction}
                className="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="timezone" value={booking.timezoneAtBooking} />
                <input
                  type="hidden"
                  name="durationMin"
                  value={Math.round(
                    (new Date(booking.endsAt).getTime() -
                      new Date(booking.startsAt).getTime()) /
                      60_000,
                  )}
                />
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("myBooking.field.when")}</span>
                  <input
                    type="datetime-local"
                    name="startsAt"
                    required
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <Button type="submit">{t("myBooking.action.move")}</Button>
              </form>
              <p className="max-w-prose text-sm text-ink-muted">{t("myBooking.moveHint")}</p>
            </CardBody>
          </Card>
        ) : booking.refusal ? (
          <p className="max-w-prose text-sm text-ink-muted">{booking.refusal}</p>
        ) : null}

        {booking.mayCancel ? (
          <Card>
            <CardHeader title={t("myBooking.cancel")} />
            <CardBody>
              <form
                action={cancelMyAppointmentAction}
                className="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="token" value={token} />
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("myBooking.field.reason")}</span>
                  <input
                    name="reason"
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                {/* Never disabled on what a field contains: the control acts,
                    and the handler decides (§15.10). */}
                <Button type="submit" variant="danger">
                  {t("myBooking.action.cancel")}
                </Button>
              </form>
              <p className="max-w-prose text-sm text-ink-muted">{t("myBooking.cancelHint")}</p>
            </CardBody>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
