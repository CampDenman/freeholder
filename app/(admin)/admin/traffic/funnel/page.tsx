// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Visit → lead → quote/booking/cart → invoice → paid (MASTER.md §4.7, C9.07).
//
// The definitions are on the page rather than behind a help link, because the
// whole claim of first-party analytics is that the owner can check the number
// rather than trust it. A funnel whose steps are undefined is the same
// black box as somebody else's dashboard, only self-hosted.
//
// Bars are a list of rows, like the traffic chart next door: readable by a
// screen reader, printable, and no client JavaScript.
import type { Metadata } from "next";
import Link from "next/link";
import { ChartLineDown } from "@phosphor-icons/react/dist/ssr";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { funnel, funnelDefinitions } from "@/modules/analytics/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The periods an owner actually asks about. */
const PERIODS = [7, 30, 90, 365] as const;

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const actor = await requireStaffActor("analytics");
  const query = await searchParams;
  const asked = Number(query.days);
  const days = PERIODS.includes(asked as (typeof PERIODS)[number]) ? asked : 30;

  const [t, business, result, definitions] = await Promise.all([
    getT(),
    currentBusiness(),
    funnel.call({ days }, actor),
    funnelDefinitions.call({}, actor),
  ]);

  const number = new Intl.NumberFormat(business?.defaultLocale ?? "en");
  // Widths are relative to the widest band rather than to the first, so a
  // business whose customers mostly arrive by word of mouth — more invoices
  // than visits — still gets a chart that reads.
  const widest = Math.max(1, ...result.bands.map((band) => band.people));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/traffic" className="text-sm underline">
          {t("funnel.back")}
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <ChartLineDown size={22} weight="duotone" className="text-accent" />
          {t("funnel.title")}
        </h1>
      </div>
      <p className="max-w-prose text-sm text-ink-muted">{t("funnel.intro")}</p>

      {/* A plain GET form: no JavaScript, and the period is in the URL, so an
          owner can bookmark the question they keep asking. */}
      <div className="flex flex-wrap gap-1 rounded-md border border-rule p-1">
        {PERIODS.map((period) => (
          <form key={period} method="get">
            <input type="hidden" name="days" value={period} />
            <button
              type="submit"
              aria-pressed={period === days}
              className={
                period === days
                  ? "rounded bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent"
                  : "rounded px-3 py-1.5 text-sm text-ink-muted"
              }
            >
              {t("funnel.period", { days: period })}
            </button>
          </form>
        ))}
      </div>

      <Card>
        <CardHeader title={t("funnel.title")} />
        <CardBody>
          {result.bands.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("funnel.empty")}</p>
          ) : (
            <ul className="grid list-none gap-5 p-0">
              {result.bands.map((band) => (
                <li key={band.band} className="grid gap-2">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-semibold text-ink">
                      {t(`funnel.band.${band.band}`)}
                    </span>
                    <span className="text-sm tabular-nums text-ink-muted">
                      {t("funnel.people", { count: band.people })}
                    </span>
                    {/* The conversion rate, and immediately beside it the
                        number that says whether it describes the same people
                        moving along or two populations side by side. */}
                    {band.previousBand && band.fromPrevious !== null ? (
                      <span className="text-xs text-ink-muted">
                        {t("funnel.ofPrevious", {
                          count: number.format(band.fromPrevious),
                          band: t(`funnel.band.${band.previousBand}`),
                        })}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        band.band === "returned"
                          ? "h-3 rounded-sm bg-warning"
                          : "h-3 rounded-sm bg-accent"
                      }
                      style={{ width: `${Math.round((band.people / widest) * 100)}%` }}
                    />
                    <span className="font-mono text-xs tabular-nums text-ink-muted">
                      {number.format(band.people)}
                    </span>
                  </div>
                  {/* The stages that make up the band. They do not add up to
                      it, and should not: somebody quoted *and* booked is one
                      person in the band and two rows here. */}
                  <ul className="flex flex-wrap gap-2 p-0">
                    {band.stages.map((stage) => (
                      <li key={stage.key}>
                        <Pill tone="neutral">
                          {t(stage.labelKey)} · {number.format(stage.people)}
                        </Pill>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 max-w-prose text-sm text-ink-muted">{t("funnel.caveat")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("funnel.definitions")} />
        <CardBody>
          <p className="mb-4 max-w-prose text-sm text-ink-muted">
            {t("funnel.definitionsIntro")}
          </p>
          <dl className="grid gap-4">
            {definitions.stages.map((stage) => (
              <div key={stage.key} className="border-s-2 border-rule ps-3">
                <dt className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-ink">
                  {t(stage.labelKey)}
                  <span className="text-xs font-normal text-ink-muted">
                    {t("funnel.answeredBy", { module: stage.module })}
                  </span>
                </dt>
                <dd className="mt-1 max-w-prose text-sm text-ink-muted">
                  {t(stage.definitionKey)}
                </dd>
              </div>
            ))}
          </dl>

          <h2 className="mt-6 text-sm font-semibold text-ink">
            {t("funnel.attributionTitle")}
          </h2>
          <dl className="mt-2 grid gap-4">
            {definitions.attribution.map((model) => (
              <div key={model.model} className="border-s-2 border-rule ps-3">
                <dt className="text-sm font-semibold text-ink">{t(model.labelKey)}</dt>
                <dd className="mt-1 max-w-prose text-sm text-ink-muted">
                  {t(model.definitionKey)}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
