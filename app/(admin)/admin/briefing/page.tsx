// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The daily briefing (C4.15, MASTER.md §42).
//
// One screen answering: what needs me, what is today, what changed — in that
// order, because needs-me-first is the only ordering that survives a busy
// morning. Everything here is a read: the sections were assembled before
// anybody arrived, and the page does no work beyond laying them out.
//
// It reports and links. Nothing on it fires irreversible work, which is §42's
// deliberate omission: a summary screen with buttons that act is how people
// learn not to trust summaries.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { readBriefing } from "@/core/briefing/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  markBriefingReadAction,
  setBriefingSectionAction,
} from "../../briefing-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TONES: Record<string, Tone> = {
  attention: "danger",
  today: "accent",
  changed: "neutral",
};

export default async function BriefingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStaffActor("admin");
  const [t, business, briefing, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(readBriefing.call({}, actor)),
    searchParams,
  ]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const day = briefing
    ? new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date(`${briefing.onDate}T12:00:00Z`))
    : "";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("briefing.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("briefing.intro")}</p>
      </div>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {t("briefing.failed")}
        </p>
      ) : null}

      {!briefing ? (
        <Card>
          <CardHeader title={t("briefing.notYet")} />
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">{t("briefing.notYetBody")}</p>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={day}
              status={
                briefing.readAt ? (
                  <Pill tone="success">{t("briefing.read")}</Pill>
                ) : (
                  <form action={markBriefingReadAction}>
                    <input type="hidden" name="id" value={briefing.id} />
                    <Button type="submit" variant="quiet">
                      {t("briefing.markRead")}
                    </Button>
                  </form>
                )
              }
            />
            <CardBody>
              {briefing.sections.length === 0 ? (
                // A quiet day is a real answer, and a better one than a screen
                // padded out with sections that had nothing in them.
                <p className="text-sm text-ink-muted">{t("briefing.quiet")}</p>
              ) : (
                <ul className="grid list-none gap-5 p-0">
                  {briefing.sections.map((section) => (
                    <li key={section.key} className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{section.title}</h3>
                        <Pill tone={TONES[section.severity] ?? "neutral"}>
                          {t(`briefing.severity.${section.severity}`)}
                        </Pill>
                        <form action={setBriefingSectionAction} className="ms-auto">
                          <input type="hidden" name="key" value={section.key} />
                          <input type="hidden" name="enabled" value="false" />
                          <Button type="submit" variant="quiet">
                            {t("briefing.hide")}
                          </Button>
                        </form>
                      </div>
                      {section.body ? (
                        <p className="max-w-prose text-sm text-ink-muted">{section.body}</p>
                      ) : null}
                      {section.items.length > 0 ? (
                        <ul className="grid list-none gap-1 p-0 text-sm">
                          {section.items.map((item, index) => (
                            <li
                              key={`${section.key}-${index}`}
                              className="flex flex-wrap items-baseline gap-2 rounded-md border border-rule px-3 py-2"
                            >
                              {item.href ? (
                                <a href={item.href} className="font-medium underline">
                                  {item.label}
                                </a>
                              ) : (
                                <span className="font-medium">{item.label}</span>
                              )}
                              {item.detail ? (
                                <span className="text-ink-muted">{item.detail}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {briefing.hidden.length > 0 ? (
            <Card>
              <CardHeader title={t("briefing.hidden")} />
              <CardBody>
                <p className="max-w-prose text-sm text-ink-muted">
                  {t("briefing.hiddenBody")}
                </p>
                <ul className="grid list-none gap-2 p-0">
                  {briefing.hidden.map((section) => (
                    <li
                      key={section.key}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-rule px-3 py-2 text-sm"
                    >
                      <span>{section.title}</span>
                      <form action={setBriefingSectionAction} className="ms-auto">
                        <input type="hidden" name="key" value={section.key} />
                        <input type="hidden" name="enabled" value="true" />
                        <Button type="submit" variant="quiet">
                          {t("briefing.show")}
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
