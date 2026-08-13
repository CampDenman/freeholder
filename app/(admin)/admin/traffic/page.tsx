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
  campaignAttribution,
  classificationCandidates,
  overview,
  topPages,
  topReferrers,
  webVitalsSummary,
} from "@/modules/analytics/service";
import {
  correctAnalyticsClassificationAction,
  setAnalyticsPolicyAction,
  setIncludeBotsAction,
} from "../../analytics-actions";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { hasModuleAccess } from "@/core/service";
import { currentAnalyticsSettings } from "@/modules/analytics/read";

export const dynamic = "force-dynamic";

const DAYS = 30;

export default async function TrafficPage() {
  const actor = await requireStaffActor("analytics");
  const [business, analytics] = await Promise.all([
    currentBusiness(),
    currentAnalyticsSettings(),
  ]);
  const includeBots = analytics.includeBots;
  const timezone = business?.timezone ?? "UTC";

  const [totals, pages, referrers, daily, vitals, campaigns, candidates, t] = await Promise.all([
    overview.call({ days: DAYS, includeBots }, actor),
    topPages.call({ days: DAYS, limit: 10, includeBots }, actor),
    topReferrers.call({ days: DAYS, limit: 10, includeBots }, actor),
    dailyViews.call({ days: DAYS, timezone, includeBots }, actor),
    webVitalsSummary.call({ days: DAYS, includeBots }, actor),
    campaignAttribution.call({
      days: DAYS,
      includeBots,
      model: "first_touch",
      limit: 10,
    }, actor),
    classificationCandidates.call({ limit: 12 }, actor),
    getT(),
  ]);

  const peak = Math.max(1, ...daily.map((row) => Number(row.views)));
  const canConfigure = hasModuleAccess(actor, "settings", "manage");
  const canCorrect = hasModuleAccess(actor, "analytics", "manage");
  const decimal = new Intl.NumberFormat(business?.defaultLocale ?? "en", {
    maximumFractionDigits: 3,
  });

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
        {canConfigure ? (
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
        ) : (
          <Pill tone="neutral">
            {includeBots ? t("analytics.everything") : t("analytics.people")}
          </Pill>
        )}
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
        <CardHeader title={t("analytics.governance.title")} />
        <CardBody>
          <div className="grid gap-4">
          <p className="max-w-prose text-sm text-ink-muted">
            {t("analytics.governance.intro")}
          </p>
          {canConfigure ? (
            <form action={setAnalyticsPolicyAction} className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("analytics.governance.consentPolicy")}
                htmlFor="analytics-consent-policy"
              >
                <Select
                  id="analytics-consent-policy"
                  name="consentPolicy"
                  defaultValue={analytics.consentPolicy}
                >
                  {(["privacy_first", "opt_in", "disabled"] as const).map((policy) => (
                    <option key={policy} value={policy}>
                      {t(`analytics.governance.policy.${policy}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t("analytics.governance.retentionDays")}
                htmlFor="analytics-retention-days"
                hint={t("analytics.governance.retentionHint")}
              >
                <Input
                  id="analytics-retention-days"
                  name="retentionDays"
                  type="number"
                  min={30}
                  max={730}
                  defaultValue={analytics.retentionDays}
                  required
                />
              </Field>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
                >
                  {t("analytics.governance.save")}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-ink-muted">
              {t(`analytics.governance.policy.${analytics.consentPolicy}`)}
              {" · "}
              {t("analytics.governance.retentionValue", {
                days: analytics.retentionDays,
              })}
            </p>
          )}
          <div>
            <a
              href={`/api/analytics/export?days=90&timezone=${encodeURIComponent(timezone)}&includeBots=${includeBots ? "1" : "0"}`}
              className="inline-flex rounded-md border border-rule px-4 py-2 text-sm font-semibold text-ink"
            >
              {t("analytics.export.download")}
            </a>
          </div>
          </div>
        </CardBody>
      </Card>

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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("analytics.vitals.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("analytics.vitals.intro")}</p>
            {vitals.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("analytics.vitals.empty")}</p>
            ) : (
              <ul className="grid list-none gap-3 p-0">
                {vitals.map((row) => (
                  <li key={row.metric} className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-b border-rule pb-2 last:border-0">
                    <span className="font-mono text-xs font-semibold text-ink">{row.metric}</span>
                    <span className="text-sm tabular-nums text-ink">
                      {row.metric === "CLS"
                        ? decimal.format(Number(row.p75))
                        : `${Math.round(Number(row.p75))} ms`}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {t("analytics.vitals.samples", { count: Number(row.samples) })}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {t("analytics.vitals.poor", { count: Number(row.poor) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("analytics.campaigns.title")} />
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">{t("analytics.campaigns.intro")}</p>
            {campaigns.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("analytics.campaigns.empty")}</p>
            ) : (
              <ul className="grid list-none gap-3 p-0">
                {campaigns.map((row) => (
                  <li key={`${row.source}:${row.medium}:${row.campaign}`} className="grid gap-1 border-b border-rule pb-2 last:border-0">
                    <span className="text-sm font-semibold text-ink">
                      {row.campaign ?? row.source}
                    </span>
                    <span className="font-mono text-xs text-ink-muted">
                      {[row.source, row.medium].filter(Boolean).join(" / ")}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {t("analytics.campaigns.result", {
                        visitors: Number(row.visitors),
                        conversions: Number(row.conversions),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("analytics.correction.title")} />
        <CardBody>
          <p className="mb-4 max-w-prose text-sm text-ink-muted">
            {t("analytics.correction.intro")}
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("analytics.correction.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0">
              {candidates.map((candidate) => (
                <li key={candidate.reviewId} className="grid gap-2 border-b border-rule pb-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="neutral">{candidate.effectiveKind}</Pill>
                    <span className="font-mono text-xs text-ink-muted">
                      {candidate.visitorLabel}… · {candidate.lastPath}
                    </span>
                    <span className="ms-auto text-xs text-ink-muted">
                      {t("analytics.correction.views", { count: candidate.views })}
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    {candidate.reasons.join(" · ") || t("analytics.correction.noReason")}
                  </p>
                  {canCorrect ? (
                    <div className="flex flex-wrap gap-2">
                      {(["human", "bot", "automatic"] as const).map((kind) => (
                        <form key={kind} action={correctAnalyticsClassificationAction}>
                          <input type="hidden" name="eventId" value={candidate.reviewId} />
                          <input type="hidden" name="kind" value={kind} />
                          <input
                            type="hidden"
                            name="classificationNote"
                            value="Owner review from traffic dashboard."
                          />
                          <button type="submit" className="rounded-md border border-rule px-3 py-1.5 text-xs font-semibold text-ink">
                            {t(`analytics.correction.${kind}`)}
                          </button>
                        </form>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
