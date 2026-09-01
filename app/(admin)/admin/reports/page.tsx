// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reports an owner will actually read (MASTER.md §2535, §4.7, §43 C9.08).
//
// One page rather than a suite, because §2535's promise is modest and exact:
// "saved views, a funnel from visit to paid, revenue by service, by product,
// by location and by month". A report builder would be a bigger product than
// the thing it reports on.
//
// The definitions sit under the figures, as they do on the funnel page. That
// is the whole argument for first-party reporting: not that the numbers are
// prettier than somebody else's dashboard, but that an owner can find out what
// they mean and check them against their own invoices.
import type { Metadata } from "next";
import { ChartBar } from "@phosphor-icons/react/dist/ssr";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { formatMoney } from "@/core/i18n";
import {
  cohortReport,
  listReportViews,
  reportDefinitions,
  revenueByReport,
  revenueReport,
} from "@/modules/reporting/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { deleteReportViewAction, saveReportViewAction } from "../../report-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const PERIODS = [30, 90, 365] as const;
const DIMENSIONS = ["service", "product", "location"] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    days?: string;
    dimension?: string;
    error?: string;
    saved?: string;
  }>;
}) {
  const actor = await requireStaffActor("reporting");
  const query = await searchParams;
  const asked = Number(query.days);
  const days = PERIODS.includes(asked as (typeof PERIODS)[number]) ? asked : 90;
  const dimension = DIMENSIONS.includes(query.dimension as (typeof DIMENSIONS)[number])
    ? (query.dimension as (typeof DIMENSIONS)[number])
    : "service";

  const [t, business, revenue, definitions, cohorts, views] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(revenueReport.call({ days }, actor)),
    domainOrNull(reportDefinitions.call({}, actor)),
    domainOrNull(cohortReport.call({ months: 12 }, actor)),
    domainOrNull(listReportViews.call({}, actor)),
  ]);

  // Asked only when something can answer, so the page shows a plain sentence
  // rather than an empty chart when a dimension has no source installed.
  const answerable =
    definitions?.dimensions.find((each) => each.dimension === dimension)?.available ?? false;
  const cut = answerable
    ? await domainOrNull(revenueByReport.call({ dimension, days }, actor))
    : null;

  const locale = business?.defaultLocale ?? "en";
  const money = (amountMinor: number, currency: string) =>
    formatMoney(amountMinor, currency, locale);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <ChartBar size={22} weight="duotone" className="text-accent" />
          {t("reports.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("reports.intro")}</p>
      </div>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      {/* Plain GET forms: the question lives in the URL, so it can be
          bookmarked, shared with a bookkeeper, and saved as a view. */}
      <div className="flex flex-wrap gap-1 rounded-md border border-rule p-1">
        {PERIODS.map((period) => (
          <form key={period} method="get">
            <input type="hidden" name="days" value={period} />
            <input type="hidden" name="dimension" value={dimension} />
            <button
              type="submit"
              aria-pressed={period === days}
              className={
                period === days
                  ? "rounded bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent"
                  : "rounded px-3 py-1.5 text-sm text-ink-muted"
              }
            >
              {t("reports.period", { days: period })}
            </button>
          </form>
        ))}
      </div>

      <Card>
        <CardHeader title={t("reports.label.revenue")} />
        <CardBody>
          {(revenue?.months ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("reports.empty")}</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-3">
                {(revenue?.totals ?? []).map((total) => (
                  <span
                    key={total.currency}
                    className="rounded-md border border-rule px-3 py-2 text-lg font-semibold tabular-nums text-ink"
                  >
                    {money(total.amountMinor, total.currency)}
                  </span>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-ink-muted">
                      <th className="p-2 text-start font-normal">{t("reports.month")}</th>
                      <th className="p-2 text-start font-normal">{t("reports.gross")}</th>
                      <th className="p-2 text-start font-normal">{t("reports.refunded")}</th>
                      <th className="p-2 text-start font-normal">{t("reports.net")}</th>
                      <th className="p-2 text-start font-normal">{t("reports.invoices")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(revenue?.months ?? []).map((month) => (
                      <tr key={`${month.month}:${month.currency}`} className="border-t border-rule">
                        <td className="p-2 font-mono text-xs">
                          {month.month} · {month.currency}
                        </td>
                        <td className="p-2 tabular-nums">
                          {money(month.paidMinor, month.currency)}
                        </td>
                        <td className="p-2 tabular-nums text-ink-muted">
                          {money(month.refundedMinor, month.currency)}
                        </td>
                        <td className="p-2 font-semibold tabular-nums">
                          {money(month.amountMinor, month.currency)}
                        </td>
                        <td className="p-2 tabular-nums text-ink-muted">{month.invoices}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("reports.label.revenueBy")} />
        <CardBody>
          <div className="mb-4 flex flex-wrap gap-1 rounded-md border border-rule p-1">
            {DIMENSIONS.map((each) => (
              <form key={each} method="get">
                <input type="hidden" name="days" value={days} />
                <input type="hidden" name="dimension" value={each} />
                <button
                  type="submit"
                  aria-pressed={each === dimension}
                  className={
                    each === dimension
                      ? "rounded bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent"
                      : "rounded px-3 py-1.5 text-sm text-ink-muted"
                  }
                >
                  {t(`reports.dimension.${each}`)}
                </button>
              </form>
            ))}
          </div>

          {!answerable ? (
            <p className="text-sm text-ink-muted">{t("reports.unavailable")}</p>
          ) : (
            <>
              {/* The basis, stated where the numbers are rather than in a
                  footnote: a `lines` cut deliberately does not add up to the
                  revenue total above it, and an owner who spots that without
                  being told will assume something is broken. */}
              <p className="mb-3 max-w-prose text-sm text-ink-muted">
                <Pill tone="neutral">{t(`reports.basis.${cut?.basis ?? "invoice"}`)}</Pill>{" "}
                {t(`reports.basis.${cut?.basis ?? "invoice"}Hint`)}
              </p>
              {(cut?.buckets ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">{t("reports.empty")}</p>
              ) : (
                <ul className="grid list-none gap-2 p-0">
                  {(cut?.buckets ?? []).map((bucket) => (
                    <li
                      key={`${bucket.bucket}:${bucket.currency}`}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                    >
                      <span className="font-semibold text-ink">{bucket.bucket}</span>
                      <span className="ms-auto tabular-nums">
                        {money(bucket.amountMinor, bucket.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("reports.label.cohort")} />
        <CardBody>
          {(cohorts?.cohorts ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("reports.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-ink-muted">
                    <th className="p-2 text-start font-normal">{t("reports.cohortMonth")}</th>
                    <th className="p-2 text-start font-normal">{t("reports.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(cohorts?.cohorts ?? []).map((cohort) => (
                    <tr
                      key={`${cohort.cohort}:${cohort.currency}`}
                      className="border-t border-rule"
                    >
                      <td className="p-2">
                        <span className="font-mono text-xs">
                          {cohort.cohort} · {cohort.currency}
                        </span>
                        <span className="ms-2 text-xs text-ink-muted">
                          {t("reports.cohortSize", { count: cohort.customers })}
                        </span>
                      </td>
                      <td className="p-2">
                        <span className="flex flex-wrap gap-2">
                          {cohort.cells.map((cell) => (
                            <span
                              key={cell.monthsSince}
                              className="rounded-md border border-rule px-2 py-1 text-xs tabular-nums"
                            >
                              {t("reports.monthsSince", { count: cell.monthsSince })}{" "}
                              {money(cell.amountMinor, cohort.currency)}
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("reports.saved")} />
        <CardBody>
          <p className="mb-3 max-w-prose text-sm text-ink-muted">{t("reports.savedIntro")}</p>
          {(views ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("reports.savedEmpty")}</p>
          ) : (
            <ul className="mb-4 grid list-none gap-2 p-0">
              {(views ?? []).map((view) => (
                <li
                  key={view.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-semibold text-ink">{view.name}</span>
                  <Pill tone="neutral">{t(`reports.label.${view.key}`)}</Pill>
                  <form method="get" className="ms-auto">
                    {typeof (view.params as { days?: number }).days === "number" ? (
                      <input
                        type="hidden"
                        name="days"
                        value={(view.params as { days: number }).days}
                      />
                    ) : null}
                    {typeof (view.params as { dimension?: string }).dimension === "string" ? (
                      <input
                        type="hidden"
                        name="dimension"
                        value={(view.params as { dimension: string }).dimension}
                      />
                    ) : null}
                    <Button type="submit" variant="quiet">
                      {t("reports.open")}
                    </Button>
                  </form>
                  <form action={deleteReportViewAction}>
                    <input type="hidden" name="id" value={view.id} />
                    <Button type="submit" variant="quiet">
                      {t("reports.delete")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {/* Saves the question on screen rather than one retyped into a
              dialog, so a view always opens the thing the owner was looking
              at when they decided it was worth keeping. */}
          <form action={saveReportViewAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="key" value="revenueBy" />
            <input type="hidden" name="days" value={days} />
            <input type="hidden" name="dimension" value={dimension} />
            <Field label={t("reports.saveName")} htmlFor="name">
              <Input id="name" name="name" required maxLength={120} />
            </Field>
            <Button type="submit">{t("reports.save")}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("reports.definitions")} />
        <CardBody>
          <dl className="grid gap-4">
            {(definitions?.reports ?? []).map((report) => (
              <div key={report.key} className="border-s-2 border-rule ps-3">
                <dt className="text-sm font-semibold text-ink">{t(report.labelKey)}</dt>
                <dd className="mt-1 max-w-prose text-sm text-ink-muted">
                  {t(report.definitionKey)}
                </dd>
              </div>
            ))}
            {(definitions?.dimensions ?? []).map((each) => (
              <div key={each.dimension} className="border-s-2 border-rule ps-3">
                <dt className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-ink">
                  {t("reports.label.revenueBy")} {t(`reports.dimension.${each.dimension}`)}
                  {each.basis ? (
                    <span className="text-xs font-normal text-ink-muted">
                      {t(`reports.basis.${each.basis}`)}
                    </span>
                  ) : null}
                </dt>
                <dd className="mt-1 max-w-prose text-sm text-ink-muted">
                  {each.available ? (
                    <ul className="grid list-none gap-1 p-0">
                      {each.sources.map((source) => (
                        <li key={source.module}>
                          {t(source.definitionKey)}{" "}
                          <span className="text-xs">
                            {t("reports.answeredBy", { module: source.module })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    t("reports.unavailable")
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
