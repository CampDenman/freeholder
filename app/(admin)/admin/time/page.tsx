// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Hours worked, and what is still to bill (C6.16, MASTER.md §4.13).
//
// The running timer sits at the top because it is the only thing on this page
// that is happening right now, and the review list sits under it because
// billing is what the page is *for*: §4.13's whole case is the difference
// between billing what you worked and billing what you remember.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { listProjects } from "@/modules/projects/service";
import {
  hoursAndMinutes,
  listTimeEntries,
  listTimeRates,
} from "@/modules/projects/time-service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  invoiceTimeAction,
  logTimeAction,
  removeTimeAction,
  setRateAction,
  startTimerAction,
  stopTimerAction,
} from "../../time-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("time");
  const [t, business, entries, unbilled, rates, projects, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listTimeEntries.call({ limit: 50 }, actor)),
    domainOrNull(listTimeEntries.call({ unbilledOnly: true, limit: 200 }, actor)),
    domainOrNull(listTimeRates.call({}, actor)),
    domainOrNull(listProjects.call({ limit: 100 }, actor)),
    searchParams,
  ]);

  const locale = business?.defaultLocale ?? "en";
  const currency = business?.baseCurrency ?? "GBP";
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const running = (entries ?? []).find((entry) => entry.endedAt === null);
  const billable = (unbilled ?? []).filter((entry) => entry.endedAt !== null);
  const outstanding = billable.reduce((total, entry) => total + entry.amountMinor, 0);
  const named = new Map((projects ?? []).map((project) => [project.id, project.title]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("time.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("time.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("time.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("time.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={running ? t("time.running") : t("time.startOne")} />
        <CardBody>
          {running ? (
            <div className="grid gap-3">
              <p className="text-sm">
                {running.description}
                {running.projectId ? ` · ${named.get(running.projectId) ?? ""}` : ""}
              </p>
              <form action={stopTimerAction} className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("time.field.roundTo")}</span>
                  <select
                    name="roundToMinutes"
                    defaultValue="1"
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  >
                    {[1, 6, 15, 30].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {t("time.roundTo", { minutes: String(minutes) })}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit">{t("time.action.stop")}</Button>
              </form>
              {/* A business that bills in fifteens is saying a twenty-minute
                  call costs thirty, so stopping rounds up. */}
              <p className="max-w-prose text-sm text-ink-muted">{t("time.roundHint")}</p>
            </div>
          ) : (
            <form action={startTimerAction} className="flex flex-wrap items-end gap-3">
              <label className="grid grow gap-1 text-sm">
                <span className="text-ink-muted">{t("time.field.what")}</span>
                <input
                  name="description"
                  required
                  className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("time.field.project")}</span>
                <select
                  name="projectId"
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                >
                  <option value="">{t("time.noProject")}</option>
                  {(projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit">{t("time.action.start")}</Button>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("time.toBill")} />
        <CardBody>
          {billable.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("time.nothingToBill")}</p>
          ) : (
            <form action={invoiceTimeAction} className="grid gap-3">
              <input type="hidden" name="currency" value={currency} />
              <ul className="grid list-none gap-2 p-0">
                {billable.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="entryIds"
                      value={entry.id}
                      defaultChecked
                    />
                    <span>{entry.description}</span>
                    {entry.projectId ? (
                      <Pill tone="neutral">{named.get(entry.projectId) ?? ""}</Pill>
                    ) : null}
                    <span className="ms-auto tabular-nums text-ink-muted">
                      {hoursAndMinutes(entry.minutes)}
                    </span>
                    <span className="tabular-nums">{money(entry.amountMinor)}</span>
                  </li>
                ))}
              </ul>
              <p className="flex justify-between text-base font-semibold">
                <span>{t("time.outstanding")}</span>
                <span className="tabular-nums">{money(outstanding)}</span>
              </p>
              <div>
                <Button type="submit">{t("time.action.bill")}</Button>
              </div>
              {/* Every ticked hour gets stamped with the invoice it went on, so
                  none of them can be billed a second time. */}
              <p className="max-w-prose text-sm text-ink-muted">{t("time.billHint")}</p>
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("time.recent")} />
        <CardBody>
          <form action={logTimeAction} className="flex flex-wrap items-end gap-3">
            <label className="grid grow gap-1 text-sm">
              <span className="text-ink-muted">{t("time.field.what")}</span>
              <input
                name="description"
                required
                className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("time.field.howLong")}</span>
              <input
                name="minutes"
                required
                placeholder={t("time.howLongPlaceholder")}
                className="w-28 rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("time.field.project")}</span>
              <select
                name="projectId"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="">{t("time.noProject")}</option>
                {(projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="quiet">
              {t("time.action.log")}
            </Button>
          </form>

          {entries === null ? (
            <p className="text-sm text-danger">{t("time.unavailable")}</p>
          ) : entries.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("time.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {entries
                .filter((entry) => entry.endedAt !== null)
                .map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-2 text-sm"
                  >
                    <span>{entry.description}</span>
                    {entry.billable ? null : (
                      <Pill tone="neutral">{t("time.unbillable")}</Pill>
                    )}
                    {entry.invoiceId ? (
                      <a
                        href={`/admin/invoices/${entry.invoiceId}`}
                        className="underline"
                      >
                        {t("time.billed")}
                      </a>
                    ) : null}
                    <span className="ms-auto tabular-nums text-ink-muted">
                      {hoursAndMinutes(entry.minutes)}
                    </span>
                    <span className="tabular-nums">{money(entry.amountMinor)}</span>
                    {entry.invoiceId ? null : (
                      <form action={removeTimeAction}>
                        <input type="hidden" name="id" value={entry.id} />
                        <Button type="submit" variant="quiet">
                          {t("time.action.remove")}
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("time.rates")} />
        <CardBody>
          {(rates ?? []).length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("time.noRates")}</p>
          ) : (
            <ul className="grid list-none gap-1 p-0 text-sm">
              {(rates ?? []).map((rate) => (
                <li key={rate.id} className="flex gap-3">
                  <span className="text-ink-muted">{t(`time.scope.${rate.scope}`)}</span>
                  <span className="tabular-nums">
                    {formatMoney(rate.rateMinor, rate.currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form action={setRateAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="currency" value={currency} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("time.field.appliesTo")}</span>
              <select
                name="scope"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="business">{t("time.scope.business")}</option>
                <option value="project">{t("time.scope.project")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("time.field.project")}</span>
              <select
                name="scopeId"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                <option value="">{t("time.everything")}</option>
                {(projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("time.field.perHour")}</span>
              <input
                name="rate"
                inputMode="decimal"
                className="w-28 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <Button type="submit" variant="quiet">
              {t("time.action.setRate")}
            </Button>
          </form>
          {/* The rate on an entry is frozen when it is made, so changing this
              never re-prices work already recorded. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("time.rateHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
