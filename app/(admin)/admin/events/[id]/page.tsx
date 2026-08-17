// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { notFound } from "next/navigation";
import { getEvent } from "@/modules/events/service";
import { ServiceError } from "@/core/service";
import { Button, Card, CardBody, CardHeader, Field, Input } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { eventAction } from "../../../event-actions";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor("events");
  const { id } = await params;
  const [bundle, t] = await Promise.all([
    getEvent.call({ id }, actor).catch((error: unknown) => {
      if (error instanceof ServiceError) notFound();
      throw error;
    }),
    getT(),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/events" className="text-sm text-ink-muted">{t("events.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{bundle.event.name}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("events.listMeta", {
            status: t(`events.status.${bundle.event.status}`),
            path: t("events.publicPath", { slug: bundle.event.slug }),
          })}
        </p>
      </div>

      {bundle.event.status === "draft" ? (
        <form action={eventAction}>
          <input type="hidden" name="intent" value="publish" />
          <input type="hidden" name="id" value={bundle.event.id} />
          <input type="hidden" name="expectedVersion" value={bundle.event.version} />
          <Button type="submit">{t("events.publish")}</Button>
        </form>
      ) : bundle.event.status === "published" ? (
        <form action={eventAction}>
          <input type="hidden" name="intent" value="cancel" />
          <input type="hidden" name="id" value={bundle.event.id} />
          <input type="hidden" name="expectedVersion" value={bundle.event.version} />
          <Button type="submit">{t("events.cancel")}</Button>
        </form>
      ) : null}

      <Card>
        <CardHeader title={t("events.sessions")} />
        <CardBody>
          <form action={eventAction} className="mb-4 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="intent" value="session" />
            <input type="hidden" name="id" value={bundle.event.id} />
            <Field label={t("events.startsAt")} htmlFor="startsAt">
              <Input id="startsAt" name="startsAt" type="datetime-local" required />
            </Field>
            <Field label={t("events.endsAt")} htmlFor="endsAt">
              <Input id="endsAt" name="endsAt" type="datetime-local" required />
            </Field>
            <Field label={t("events.capacity")} htmlFor="capacity">
              <Input id="capacity" name="capacity" type="number" min={0} defaultValue={20} required />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" name="waitlistEnabled" defaultChecked />
              {t("events.waitlist")}
            </label>
            <Button type="submit">{t("events.sessionAdd")}</Button>
          </form>
          <ul className="grid list-none gap-2 p-0 text-sm">
            {bundle.sessions.map((session) => (
              <li key={session.id}>
                {session.startsAt.toISOString()} → {session.endsAt.toISOString()} · {session.remaining}/
                {session.capacity}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("events.tickets")} />
        <CardBody>
          <form action={eventAction} className="mb-4 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="intent" value="ticket" />
            <input type="hidden" name="id" value={bundle.event.id} />
            <Field label={t("events.ticketName")} htmlFor="ticketName">
              <Input id="ticketName" name="ticketName" required maxLength={120} />
            </Field>
            <Field label={t("events.price")} htmlFor="priceMinor">
              <Input id="priceMinor" name="priceMinor" type="number" min={0} defaultValue={0} required />
            </Field>
            <Field label={t("events.currency")} htmlFor="currency">
              <Input id="currency" name="currency" defaultValue="CAD" maxLength={3} />
            </Field>
            <Button type="submit">{t("events.ticketAdd")}</Button>
          </form>
          <ul className="grid list-none gap-2 p-0 text-sm">
            {bundle.tickets.map((ticket) => (
              <li key={ticket.id}>
                {ticket.name} · {ticket.priceMinor} {ticket.currency}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("events.registrations")} />
        <CardBody>
          <ul className="grid list-none gap-3 p-0">
            {bundle.registrations.map((registration) => (
              <li key={registration.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  {t("events.registrationMeta", {
                    status: t(`events.registration.${registration.status}`),
                    quantity: registration.quantity,
                  })}
                </span>
                {registration.status === "confirmed" ? (
                  <form action={eventAction}>
                    <input type="hidden" name="intent" value="checkin" />
                    <input type="hidden" name="id" value={bundle.event.id} />
                    <input type="hidden" name="registrationId" value={registration.id} />
                    <Button type="submit">{t("events.checkIn")}</Button>
                  </form>
                ) : null}
                {registration.status === "confirmed" || registration.status === "waitlisted" ? (
                  <form action={eventAction}>
                    <input type="hidden" name="intent" value="cancelRegistration" />
                    <input type="hidden" name="id" value={bundle.event.id} />
                    <input type="hidden" name="registrationId" value={registration.id} />
                    <Button type="submit">{t("events.cancelRegistration")}</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
