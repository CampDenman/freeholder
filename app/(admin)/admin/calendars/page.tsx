// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The calendars workspace (C6.01, MASTER.md §4.4).
//
// Three kinds on one screen, deliberately: the business, its people, and the
// things they use. §4.4's point is that a room and a therapist behave
// identically, and a workspace that filed them under different headings would
// be the first place that stops being true.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listCalendars } from "@/core/scheduling/service";
import { listRoleUsers } from "@/core/roles/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  archiveCalendarAction,
  createCalendarAction,
  updateCalendarAction,
} from "../../calendar-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const KIND_TONES: Record<string, Tone> = {
  business: "accent",
  person: "success",
  resource: "neutral",
};

export default async function CalendarsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("scheduling");
  const [t, business, calendars, people, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listCalendars.call({ includeArchived: true }, actor)),
    domainOrNull(listRoleUsers.call({}, actor)),
    searchParams,
  ]);
  const timezone = business?.timezone ?? "UTC";
  const active = (calendars ?? []).filter((calendar) => calendar.status === "active");
  const archived = (calendars ?? []).filter((calendar) => calendar.status === "archived");
  const hasBusiness = active.some((calendar) => calendar.kind === "business");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("calendars.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("calendars.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("calendars.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("calendars.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("calendars.yours")} />
        <CardBody>
          {calendars === null ? (
            <p className="text-sm text-danger">{t("calendars.unavailable")}</p>
          ) : active.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("calendars.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {active.map((calendar) => (
                <li key={calendar.id} className="grid gap-3 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{calendar.name}</span>
                    <Pill tone={KIND_TONES[calendar.kind] ?? "neutral"}>
                      {t(`calendars.kind.${calendar.kind}`)}
                    </Pill>
                    <span className="text-xs text-ink-muted">{calendar.timezone}</span>
                    {calendar.externalCalendarId ? (
                      <Pill tone="neutral">{t("calendars.linked")}</Pill>
                    ) : null}
                  </div>

                  <form
                    action={updateCalendarAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="id" value={calendar.id} />
                    <label className="grid gap-1 text-sm">
                      <span className="text-ink-muted">{t("calendars.field.name")}</span>
                      <input
                        name="name"
                        defaultValue={calendar.name}
                        className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-ink-muted">{t("calendars.field.timezone")}</span>
                      <input
                        name="timezone"
                        defaultValue={calendar.timezone}
                        className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-ink-muted">{t("calendars.field.capacity")}</span>
                      <input
                        name="capacityDefault"
                        type="number"
                        min={1}
                        defaultValue={calendar.capacityDefault}
                        className="w-24 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-ink-muted">{t("calendars.field.notice")}</span>
                      <input
                        name="minNoticeMin"
                        type="number"
                        min={0}
                        defaultValue={calendar.minNoticeMin}
                        className="w-24 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-ink-muted">{t("calendars.field.horizon")}</span>
                      <input
                        name="bookingHorizonDays"
                        type="number"
                        min={1}
                        defaultValue={calendar.bookingHorizonDays}
                        className="w-24 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
                      />
                    </label>
                    <Button type="submit" variant="quiet">
                      {t("calendars.save")}
                    </Button>
                  </form>

                  {calendar.kind !== "business" ? (
                    <form action={archiveCalendarAction}>
                      <input type="hidden" name="id" value={calendar.id} />
                      <input type="hidden" name="archived" value="true" />
                      <Button type="submit" variant="quiet">
                        {t("calendars.archive")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("calendars.add")} />
        <CardBody>
          <form action={createCalendarAction} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("calendars.field.kind")}</span>
              <select
                name="kind"
                defaultValue={hasBusiness ? "resource" : "business"}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {!hasBusiness ? (
                  <option value="business">{t("calendars.kind.business")}</option>
                ) : null}
                <option value="person">{t("calendars.kind.person")}</option>
                <option value="resource">{t("calendars.kind.resource")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("calendars.field.name")}</span>
              <input
                name="name"
                required
                placeholder={t("calendars.namePlaceholder")}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("calendars.field.person")}</span>
              <select
                name="userId"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="">{t("calendars.noPerson")}</option>
                {(people ?? [])
                  .filter((person) => person.role !== "customer")
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.email}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("calendars.field.timezone")}</span>
              <input
                name="timezone"
                placeholder={timezone}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit">{t("calendars.create")}</Button>
          </form>
          <p className="max-w-prose text-sm text-ink-muted">{t("calendars.addHint")}</p>
        </CardBody>
      </Card>

      {archived.length > 0 ? (
        <Card>
          <CardHeader title={t("calendars.archived")} />
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">
              {t("calendars.archivedHint")}
            </p>
            <ul className="grid list-none gap-2 p-0">
              {archived.map((calendar) => (
                <li
                  key={calendar.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-rule px-3 py-2 text-sm"
                >
                  <span>{calendar.name}</span>
                  <form action={archiveCalendarAction} className="ms-auto">
                    <input type="hidden" name="id" value={calendar.id} />
                    <input type="hidden" name="archived" value="false" />
                    <Button type="submit" variant="quiet">
                      {t("calendars.restore")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
