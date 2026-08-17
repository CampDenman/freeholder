// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { CalendarBlank, Plus } from "@phosphor-icons/react/dist/ssr";
import { listEvents } from "@/modules/events/service";
import { Button, Card, CardBody, CardHeader, Field, Input } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { eventAction } from "../../event-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const actor = await requireStaffActor("events");
  const [rows, t] = await Promise.all([listEvents.call({}, actor), getT()]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <CalendarBlank size={22} weight="duotone" className="text-accent" />
          {t("events.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("events.intro")}</p>
      </div>

      <Card>
        <CardHeader title={t("events.add")} />
        <CardBody>
          <form action={eventAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="intent" value="create" />
            <Field label={t("events.name")} htmlFor="name">
              <Input id="name" name="name" required maxLength={240} />
            </Field>
            <Field label={t("events.slug")} htmlFor="slug">
              <Input id="slug" name="slug" required maxLength={180} className="font-mono" />
            </Field>
            <Field label={t("events.summary")} htmlFor="summary">
              <Input id="summary" name="summary" maxLength={500} />
            </Field>
            <Field label={t("events.venueName")} htmlFor="venueName">
              <Input id="venueName" name="venueName" maxLength={200} />
            </Field>
            <Field label={t("events.venueAddress")} htmlFor="venueAddress">
              <Input id="venueAddress" name="venueAddress" maxLength={500} />
            </Field>
            <div className="self-end">
              <Button type="submit">
                <Plus size={16} weight="bold" />
                {t("events.add")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <ul className="grid list-none gap-3 p-0">
        {rows.length === 0 ? <li className="text-sm text-ink-muted">{t("events.empty")}</li> : null}
        {rows.map((event) => (
          <li key={event.id} className="rounded-lg border border-rule bg-surface px-4 py-3">
            <a href={`/admin/events/${event.id}`} className="font-semibold text-ink">
              {event.name}
            </a>
            <p className="mt-1 text-sm text-ink-muted">
              {t("events.listMeta", {
                status: t(`events.status.${event.status}`),
                path: t("events.publicPath", { slug: event.slug }),
              })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
