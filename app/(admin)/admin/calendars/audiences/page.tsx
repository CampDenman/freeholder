// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who can book you (C6.05, MASTER.md §41).
//
// §41's example is the one to keep in mind while reading this screen:
// customers book during shop hours, friends book any time, and the dentist
// appointment blocks both without telling anybody it is a dentist appointment.
// The first two are configured here; the third is not configurable, because
// busy time unioning is not a setting.
//
// The tokenised link is deliberately absent from this page. It is a
// credential, handed over once through `audiences.link` behind a step-up,
// rather than sitting in a list that a screenshot or a support ticket carries
// off somewhere else.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { listAudiences } from "@/core/scheduling/audiences";
import { listCalendars } from "@/core/scheduling/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  createAudienceAction,
  removeAudienceAction,
  setAudienceCalendarsAction,
  setAudienceHoursAction,
} from "../../../audience-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const WHO_TONES: Record<string, Tone> = {
  public: "accent",
  token: "warning",
  tag: "success",
  signed_in: "neutral",
};

export default async function AudiencesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("scheduling");
  const [t, audiences, calendars, query] = await Promise.all([
    getT(),
    domainOrNull(listAudiences.call({}, actor)),
    domainOrNull(listCalendars.call({}, actor)),
    searchParams,
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/calendars" className="text-sm text-ink-muted">
          {t("audiences.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("audiences.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("audiences.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("audiences.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("audiences.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("audiences.yours")} />
        <CardBody>
          {audiences === null ? (
            <p className="text-sm text-danger">{t("audiences.unavailable")}</p>
          ) : audiences.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("audiences.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0">
              {audiences.map((audience) => (
                <li key={audience.id} className="grid gap-3 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{audience.name}</span>
                    <Pill tone={WHO_TONES[audience.who] ?? "neutral"}>
                      {t(`audiences.who.${audience.who}`)}
                    </Pill>
                    <Pill tone="neutral">{t(`audiences.hours.${audience.hours}`)}</Pill>
                    {audience.contactTag ? (
                      <span className="text-xs text-ink-muted">{audience.contactTag}</span>
                    ) : null}
                    {audience.hasToken ? (
                      <span className="text-xs text-ink-muted">
                        {t("audiences.hasLink")}
                      </span>
                    ) : null}
                  </div>

                  <form
                    action={setAudienceCalendarsAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="id" value={audience.id} />
                    <fieldset className="grid gap-1">
                      <legend className="text-sm text-ink-muted">
                        {t("audiences.writesTo")}
                      </legend>
                      <div className="flex flex-wrap gap-3">
                        {(calendars ?? []).map((calendar) => (
                          <label
                            key={calendar.id}
                            className="flex items-center gap-1.5 text-sm"
                          >
                            <input
                              type="checkbox"
                              name="calendarIds"
                              value={calendar.id}
                            />
                            <span>{calendar.name}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <Button type="submit" variant="quiet">
                      {t("audiences.save")}
                    </Button>
                  </form>

                  <form
                    action={setAudienceHoursAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="id" value={audience.id} />
                    <label className="grid gap-1 text-sm">
                      <span className="text-ink-muted">{t("audiences.field.hours")}</span>
                      <select
                        name="hours"
                        defaultValue={audience.hours}
                        className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                      >
                        <option value="calendar">{t("audiences.hours.calendar")}</option>
                        <option value="any">{t("audiences.hours.any")}</option>
                        <option value="custom">{t("audiences.hours.custom")}</option>
                      </select>
                    </label>
                    {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
                      <label key={weekday} className="grid gap-1 text-xs">
                        <span className="text-ink-muted">
                          {t(`audiences.weekday.${weekday}`)}
                        </span>
                        <span className="flex gap-1">
                          <input
                            type="time"
                            name={`open-${weekday}`}
                            className="w-24 rounded-md border border-rule bg-field px-1 py-1 text-xs tabular-nums"
                          />
                          <input
                            type="time"
                            name={`close-${weekday}`}
                            className="w-24 rounded-md border border-rule bg-field px-1 py-1 text-xs tabular-nums"
                          />
                        </span>
                      </label>
                    ))}
                    <Button type="submit" variant="quiet">
                      {t("audiences.save")}
                    </Button>
                  </form>

                  <form action={removeAudienceAction}>
                    <input type="hidden" name="id" value={audience.id} />
                    <Button type="submit" variant="quiet">
                      {t("audiences.remove")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("audiences.add")} />
        <CardBody>
          <form action={createAudienceAction} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("audiences.field.name")}</span>
              <input
                name="name"
                required
                placeholder={t("audiences.namePlaceholder")}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("audiences.field.who")}</span>
              <select
                name="who"
                defaultValue="public"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="public">{t("audiences.who.public")}</option>
                <option value="token">{t("audiences.who.token")}</option>
                <option value="tag">{t("audiences.who.tag")}</option>
                <option value="signed_in">{t("audiences.who.signed_in")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("audiences.field.tag")}</span>
              <input
                name="contactTag"
                placeholder={t("audiences.tagPlaceholder")}
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("audiences.field.hours")}</span>
              <select
                name="hours"
                defaultValue="calendar"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="calendar">{t("audiences.hours.calendar")}</option>
                <option value="any">{t("audiences.hours.any")}</option>
                <option value="custom">{t("audiences.hours.custom")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("audiences.field.notice")}</span>
              <input
                name="minNoticeMin"
                type="number"
                min={0}
                className="w-24 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("audiences.field.order")}</span>
              <input
                name="position"
                type="number"
                min={0}
                defaultValue={0}
                className="w-20 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <Button type="submit">{t("audiences.create")}</Button>
          </form>
          <p className="max-w-prose text-sm text-ink-muted">{t("audiences.addHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
