// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// First-party traffic (MASTER.md §4.7, §36).
//
// Six numbers and two lists, because that is what is true. A dashboard that
// invents precision an owner cannot act on teaches them to stop opening it —
// the same argument the overview screen makes about fake figures.
import { ChartLine } from "@phosphor-icons/react/dist/ssr";
import {
  dailyViews,
  includeBotsSetting,
  overview,
  topPages,
  topReferrers,
} from "@/modules/analytics/service";
import { setIncludeBotsAction } from "../../analytics-actions";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardBody, CardHeader } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

const DAYS = 30;

export default async function TrafficPage() {
  const actor = await requireStaffActor();
  const [business, includeBots] = await Promise.all([
    currentBusiness(),
    includeBotsSetting(),
  ]);
  const timezone = business?.timezone ?? "UTC";

  const [totals, pages, referrers, daily, t] = await Promise.all([
    overview.call({ days: DAYS, includeBots }, actor),
    topPages.call({ days: DAYS, limit: 10, includeBots }, actor),
    topReferrers.call({ days: DAYS, limit: 10, includeBots }, actor),
    dailyViews.call({ days: DAYS, timezone, includeBots }, actor),
    getT(),
  ]);

  const peak = Math.max(1, ...daily.map((row) => Number(row.views)));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("analytics.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("analytics.intro")}
        </p>
      </div>

      {/*
        Two buttons rather than a checkbox: each is a plain form posting one
        value, so the choice works with no JavaScript and reads correctly to a
        screen reader without any ARIA at all.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-md border border-rule p-1">
          {[false, true].map((value) => (
            <form key={String(value)} action={setIncludeBotsAction}>
              <input type="hidden" name="includeBots" value={value ? "1" : "0"} />
              <button
                type="submit"
                aria-pressed={includeBots === value}
                className={
                  includeBots === value
                    ? "rounded bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent"
                    : "rounded px-3 py-1.5 text-sm text-ink-muted"
                }
              >
                {value ? t("analytics.everything") : t("analytics.people")}
              </button>
            </form>
          ))}
        </div>
        <p className="text-xs text-ink-muted">
          {t(
            includeBots ? "analytics.automatedShown" : "analytics.automated",
            { count: totals.automated },
          )}
          {" · "}
          {t("analytics.countingIntro")}
        </p>
      </div>

      <Card>
        <CardHeader
          icon={<ChartLine size={17} weight="bold" />}
          title={t("analytics.window", { days: DAYS })}
        />
        <CardBody>
          {totals.views === 0 ? (
            <p className="text-sm text-ink-muted">{t("analytics.empty")}</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {[
                  ["analytics.views", totals.views],
                  ["analytics.visitors", totals.visitors],
                  ["analytics.sessions", totals.sessions],
                  ["analytics.conversions", totals.conversions],
                  ["analytics.identified", totals.identified],
                ].map(([key, value]) => (
                  <div key={String(key)} className="grid gap-1">
                    <dt className="font-mono text-xs text-ink-muted">
                      {t(String(key))}
                    </dt>
                    <dd className="text-2xl font-bold tabular-nums">
                      {Number(value)}
                    </dd>
                  </div>
                ))}
              </dl>

              {/*
                Bars as a list of rows rather than a canvas: it is readable by
                a screen reader, prints, and needs no client JavaScript — which
                keeps the admin's one hydration boundary where it already is.
              */}
              <ul className="mt-6 grid list-none gap-1 p-0">
                {daily.map((row) => (
                  <li key={row.day} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 font-mono text-xs text-ink-muted tabular-nums">
                      {row.day}
                    </span>
                    <span
                      className="h-2 rounded-sm bg-accent"
                      style={{ width: `${(Number(row.views) / peak) * 100}%` }}
                    />
                    <span className="font-mono text-xs text-ink-muted tabular-nums">
                      {Number(row.views)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("analytics.topPages")} />
          <CardBody>
            {pages.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("analytics.empty")}</p>
            ) : (
              <ul className="grid list-none gap-2 p-0">
                {pages.map((row) => (
                  <li key={row.path} className="flex items-baseline gap-3">
                    <a
                      href={row.path}
                      className="truncate font-mono text-xs text-accent"
                    >
                      {row.path}
                    </a>
                    <span className="ms-auto text-sm font-medium tabular-nums">
                      {Number(row.views)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("analytics.topReferrers")} />
          <CardBody>
            {referrers.length === 0 ? (
              <p className="text-sm text-ink-muted">
                {t("analytics.noReferrers")}
              </p>
            ) : (
              <ul className="grid list-none gap-2 p-0">
                {referrers.map((row) => (
                  <li key={row.referrer} className="flex items-baseline gap-3">
                    <span className="truncate font-mono text-xs text-ink">
                      {row.referrer ?? t("analytics.direct")}
                    </span>
                    <span className="ms-auto text-sm font-medium tabular-nums">
                      {Number(row.visitors)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
