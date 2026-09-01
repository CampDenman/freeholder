// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scheduled exports and the accounting shapes (MASTER.md §2535, §43 C9.32).
//
// The screen is arranged around one question — *did the last one arrive?* —
// because that is the question a scheduled delivery fails at. A wrong figure
// on the reports page is wrong loudly; a file that stopped being emailed is
// wrong by being absent, and an absence needs somewhere to be shown.
//
// So the state of the last delivery is the first thing on every row, an
// overdue export says so at the top of the page in words, and a failed
// delivery keeps its download link: a report that did not send is a delayed
// report, and the owner can still hand the file over themselves.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowSquareOut, FileArrowDown, Warning } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { formatDateTime, formatMoney } from "@/core/i18n";
import { listExportRuns, listExports } from "@/modules/reporting/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  deleteExportAction,
  retryExportDeliveryAction,
  runExportAction,
  saveExportAction,
} from "../../../export-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const SHAPES = ["csv", "quickbooks", "xero"] as const;
const BASES = ["paid", "issued"] as const;
const PERIODS = ["previous_week", "previous_month", "previous_quarter"] as const;
const DATE_FORMATS = ["iso", "dmy", "mdy"] as const;

const STATUS_TONE = {
  delivered: "success",
  built: "neutral",
  pending: "warning",
  failed: "danger",
} as const;

export default async function ReportExportsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; error?: string; saved?: string; ran?: string }>;
}) {
  const actor = await requireStaffActor("reporting");
  const query = await searchParams;

  const [t, business, exports] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listExports.call({}, actor)),
  ]);

  const all = exports ?? [];
  const selected = all.find((each) => each.definition.id === query.id) ?? all[0] ?? null;
  const history = selected
    ? ((await domainOrNull(
        listExportRuns.call({ id: selected.definition.id }, actor),
      )) ?? [])
    : [];

  const locale = business?.defaultLocale ?? "en";
  const zone = business?.timezone ?? "UTC";
  const money = (amountMinor: number, currency: string) =>
    formatMoney(amountMinor, currency, locale);
  const when = (at: Date | null) => (at ? formatDateTime(at, zone, locale) : "—");
  const overdue = all.filter((each) => each.overdue);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <FileArrowDown size={22} weight="duotone" className="text-accent" />
          {t("exports.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("exports.intro")}</p>
        <Link href="/admin/reports" className="mt-2 inline-flex items-center gap-1 text-sm text-accent underline">
          <ArrowSquareOut size={14} weight="bold" />
          {t("exports.backToReports")}
        </Link>
      </div>

      {query.error ? (
        <Callout tone="danger" icon={<Warning size={18} weight="fill" />}>
          {query.error}
        </Callout>
      ) : null}

      {/* An export that should have gone and did not is said out loud, in
          words, at the top. The state it describes — a worker that is not
          running at all — looks exactly like nothing happening. */}
      {overdue.length > 0 ? (
        <Callout tone="danger" icon={<Warning size={18} weight="fill" />}>
          {t("exports.overdueWarning", {
            count: overdue.length,
            names: overdue.map((each) => each.definition.name).join(", "),
          })}
        </Callout>
      ) : null}

      <Card>
        <CardHeader title={t("exports.list")} />
        <CardBody>
          {all.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("exports.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {all.map(({ definition, lastRun, due, overdue: late }) => (
                <li key={definition.id} className="rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{definition.name}</span>
                    <Pill tone="neutral">{t(`exports.shape.${definition.shape}`)}</Pill>
                    <Pill tone="neutral">{definition.currency}</Pill>
                    <Pill tone="neutral">{t(`exports.basis.${definition.basis}`)}</Pill>
                    <Pill tone={definition.scheduled ? "success" : "neutral"}>
                      {definition.scheduled
                        ? t(`exports.period.${definition.period}`)
                        : t("exports.manualOnly")}
                    </Pill>
                    {late ? <Pill tone="danger">{t("exports.overdue")}</Pill> : null}
                    {due && !late ? <Pill tone="warning">{t("exports.due")}</Pill> : null}
                  </div>

                  {/* The answer to "did it arrive?", on the row rather than a
                      click away. */}
                  <p className="mt-2 text-sm text-ink-muted">
                    {lastRun ? (
                      <>
                        <Pill tone={STATUS_TONE[lastRun.status]}>
                          {t(`exports.status.${lastRun.status}`)}
                        </Pill>{" "}
                        {t("exports.lastRun", {
                          when: when(lastRun.deliveredAt ?? lastRun.failedAt ?? lastRun.startedAt),
                          rows: lastRun.rowCount,
                          invoices: lastRun.invoiceCount,
                          total: money(lastRun.totalMinor, lastRun.currency),
                        })}
                        {lastRun.error ? (
                          <span className="ms-1 text-danger">{lastRun.error}</span>
                        ) : null}
                      </>
                    ) : (
                      t("exports.neverRun")
                    )}
                  </p>

                  {lastRun && lastRun.excludedCurrencies.length > 0 ? (
                    // Never summed, and never silently dropped either.
                    <p className="mt-1 max-w-prose text-sm text-ink-muted">
                      {t("exports.excluded", {
                        count: lastRun.excludedInvoiceCount,
                        currencies: lastRun.excludedCurrencies.join(", "),
                        currency: lastRun.currency,
                      })}
                    </p>
                  ) : null}

                  {lastRun && lastRun.refundedMinor > 0 ? (
                    <p className="mt-1 max-w-prose text-sm text-ink-muted">
                      {t("exports.refundNote", {
                        refunded: money(lastRun.refundedMinor, lastRun.currency),
                      })}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <form action={runExportAction}>
                      <input type="hidden" name="id" value={definition.id} />
                      <Button type="submit">{t("exports.runNow")}</Button>
                    </form>
                    {lastRun?.filename ? (
                      <Link
                        href={`/admin/reports/exports/${lastRun.id}/download`}
                        className="text-sm text-accent underline"
                      >
                        {t("exports.download")}
                      </Link>
                    ) : null}
                    {/* A failed delivery keeps its file and its retry: the
                        report is late, not lost. */}
                    {lastRun?.status === "failed" && lastRun.filename ? (
                      <form action={retryExportDeliveryAction}>
                        <input type="hidden" name="id" value={definition.id} />
                        <input type="hidden" name="runId" value={lastRun.id} />
                        <Button type="submit" variant="quiet">
                          {t("exports.retry")}
                        </Button>
                      </form>
                    ) : null}
                    <form method="get">
                      <input type="hidden" name="id" value={definition.id} />
                      <Button type="submit" variant="quiet">
                        {t("exports.history")}
                      </Button>
                    </form>
                    <form action={deleteExportAction} className="ms-auto">
                      <input type="hidden" name="id" value={definition.id} />
                      <Button type="submit" variant="quiet">
                        {t("exports.delete")}
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {selected ? (
        <Card>
          <CardHeader title={t("exports.historyFor", { name: selected.definition.name })} />
          <CardBody>
            {history.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("exports.neverRun")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-ink-muted">
                      <th className="p-2 text-start font-normal">{t("exports.periodColumn")}</th>
                      <th className="p-2 text-start font-normal">{t("exports.statusColumn")}</th>
                      <th className="p-2 text-start font-normal">{t("exports.rowsColumn")}</th>
                      <th className="p-2 text-start font-normal">{t("exports.totalColumn")}</th>
                      <th className="p-2 text-start font-normal">{t("exports.fileColumn")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((run) => (
                      <tr key={run.id} className="border-t border-rule align-top">
                        <td className="p-2 font-mono text-xs">
                          {run.periodFrom.toISOString().slice(0, 10)} →{" "}
                          {run.periodTo.toISOString().slice(0, 10)}
                        </td>
                        <td className="p-2">
                          <Pill tone={STATUS_TONE[run.status]}>
                            {t(`exports.status.${run.status}`)}
                          </Pill>
                          <span className="ms-2 text-xs text-ink-muted">
                            {when(run.deliveredAt ?? run.failedAt ?? run.startedAt)}
                          </span>
                          {run.error ? (
                            <p className="mt-1 max-w-prose text-xs text-danger">{run.error}</p>
                          ) : null}
                        </td>
                        <td className="p-2 tabular-nums">{run.rowCount}</td>
                        <td className="p-2 tabular-nums">
                          {money(run.totalMinor, run.currency)}
                        </td>
                        <td className="p-2">
                          {run.filename ? (
                            <Link
                              href={`/admin/reports/exports/${run.id}/download`}
                              className="text-accent underline"
                            >
                              {t("exports.download")}
                            </Link>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("exports.newTitle")} />
        <CardBody>
          <p className="mb-4 max-w-prose text-sm text-ink-muted">{t("exports.newIntro")}</p>
          <form action={saveExportAction} className="grid gap-4 sm:grid-cols-2">
            <Field label={t("exports.field.name")} htmlFor="export-name">
              <Input id="export-name" name="name" required maxLength={120} />
            </Field>

            <Field
              label={t("exports.field.shape")}
              htmlFor="export-shape"
              hint={t("exports.field.shapeHint")}
            >
              <Select id="export-shape" name="shape" defaultValue="csv">
                {SHAPES.map((shape) => (
                  <option key={shape} value={shape}>
                    {t(`exports.shape.${shape}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label={t("exports.field.currency")}
              htmlFor="export-currency"
              hint={t("exports.field.currencyHint")}
            >
              <Input
                id="export-currency"
                name="currency"
                required
                maxLength={3}
                defaultValue={business?.baseCurrency ?? "CAD"}
              />
            </Field>

            <Field
              label={t("exports.field.basis")}
              htmlFor="export-basis"
              hint={t("exports.field.basisHint")}
            >
              <Select id="export-basis" name="basis" defaultValue="paid">
                {BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {t(`exports.basis.${basis}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t("exports.field.period")} htmlFor="export-period">
              <Select id="export-period" name="period" defaultValue="previous_month">
                {PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {t(`exports.period.${period}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label={t("exports.field.dateFormat")}
              htmlFor="export-date-format"
              hint={t("exports.field.dateFormatHint")}
            >
              <Select id="export-date-format" name="dateFormat" defaultValue="iso">
                {DATE_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {t(`exports.dateFormat.${format}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t("exports.field.timezone")} htmlFor="export-timezone">
              <Input id="export-timezone" name="timezone" defaultValue={zone} maxLength={100} />
            </Field>

            <Field
              label={t("exports.field.recipients")}
              htmlFor="export-recipients"
              hint={t("exports.field.recipientsHint")}
            >
              <Input id="export-recipients" name="recipients" maxLength={2000} />
            </Field>

            <Field
              label={t("exports.field.itemCode")}
              htmlFor="export-item-code"
              hint={t("exports.field.itemCodeHint")}
            >
              <Input id="export-item-code" name="itemCode" maxLength={200} />
            </Field>

            <Field
              label={t("exports.field.accountCode")}
              htmlFor="export-account-code"
              hint={t("exports.field.accountCodeHint")}
            >
              <Input id="export-account-code" name="accountCode" maxLength={50} />
            </Field>

            <Field
              label={t("exports.field.taxCode")}
              htmlFor="export-tax-code"
              hint={t("exports.field.taxCodeHint")}
            >
              <Input id="export-tax-code" name="taxCode" maxLength={80} />
            </Field>

            <div className="grid gap-1.5">
              <label
                htmlFor="export-scheduled"
                className="flex items-center gap-2 font-mono text-xs font-medium text-ink-muted"
              >
                <input
                  id="export-scheduled"
                  name="scheduled"
                  type="checkbox"
                  className="size-4 accent-accent"
                />
                {t("exports.field.scheduled")}
              </label>
              <p className="text-xs text-ink-muted">{t("exports.field.scheduledHint")}</p>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit">{t("exports.save")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("exports.definitions")} />
        <CardBody>
          <dl className="grid gap-4">
            {(["boundary", "currency", "basisRule", "delivery", "reconcile"] as const).map(
              (key) => (
                <div key={key} className="border-s-2 border-rule ps-3">
                  <dt className="text-sm font-semibold text-ink">
                    {t(`exports.note.${key}Title`)}
                  </dt>
                  <dd className="mt-1 max-w-prose text-sm text-ink-muted">
                    {t(`exports.note.${key}`)}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
