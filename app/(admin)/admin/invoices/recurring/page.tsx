// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Invoices that come round again (C6.17, MASTER.md §4.3).
//
// Ordered by what goes out next, because that is the only question this page
// answers. A schedule raises a *new* invoice each period — not an installment
// of one, which is what a payment plan does on the invoice itself.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { listContacts } from "@/core/contacts/service";
import { listSchedules } from "@/modules/invoicing/recurring-service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  createScheduleAction,
  runSchedulesAction,
  setScheduleStatusAction,
} from "../../../recurring-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  active: "success",
  paused: "warning",
  ended: "neutral",
};

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("invoicing", "manage");
  const [t, business, schedules, people, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listSchedules.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
    searchParams,
  ]);

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  /** The whole schedule at a glance: one period's worth. */
  const perPeriod = (lines: unknown, currency: string) => {
    const parsed = Array.isArray(lines)
      ? (lines as { quantityMicros?: number; unitAmountMinor?: number }[])
      : [];
    const total = parsed.reduce(
      (sum, line) =>
        sum +
        Math.round(((line.unitAmountMinor ?? 0) * (line.quantityMicros ?? 1_000_000)) / 1_000_000),
      0,
    );
    return formatMoney(total, currency, locale);
  };

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/invoices" className="text-sm text-ink-muted">
          {t("recurring.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("recurring.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("recurring.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("recurring.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("recurring.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("recurring.yours")} />
        <CardBody>
          {schedules === null ? (
            <p className="text-sm text-danger">{t("recurring.unavailable")}</p>
          ) : schedules.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("recurring.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {schedules.map((schedule) => (
                <li
                  key={schedule.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium">{schedule.name}</span>
                  <Pill tone={STATUS_TONES[schedule.status] ?? "neutral"}>
                    {t(`recurring.status.${schedule.status}`)}
                  </Pill>
                  <span className="text-ink-muted">{schedule.contactName ?? ""}</span>
                  <span className="text-ink-muted">
                    {t(`recurring.cadence.${schedule.cadence}`)}
                  </span>
                  <span className="tabular-nums">
                    {perPeriod(schedule.lines, schedule.currency)}
                  </span>
                  {schedule.autoIssue ? (
                    <Pill tone="accent">{t("recurring.autoIssue")}</Pill>
                  ) : null}
                  <span className="ms-auto text-ink-muted">
                    {schedule.status === "active"
                      ? t("recurring.nextOn", { when: when(schedule.nextRunAt) })
                      : t("recurring.raised", { count: String(schedule.occurrences) })}
                  </span>
                  {schedule.status !== "ended" ? (
                    <form action={setScheduleStatusAction}>
                      <input type="hidden" name="id" value={schedule.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={schedule.status === "active" ? "paused" : "active"}
                      />
                      <Button type="submit" variant="quiet">
                        {schedule.status === "active"
                          ? t("recurring.action.pause")
                          : t("recurring.action.resume")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <form action={runSchedulesAction}>
            <Button type="submit" variant="quiet">
              {t("recurring.action.runNow")}
            </Button>
          </form>
          {/* One occurrence per run, and the next date is the next one after
              now — an instance that was off for a fortnight does not send a
              fortnight of invoices when it wakes up. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("recurring.runHint")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("recurring.add")} />
        <CardBody>
          <form action={createScheduleAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="currency" value={business?.baseCurrency ?? "GBP"} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("recurring.field.name")}</span>
              <input
                name="name"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("recurring.field.customer")}</span>
              <select
                name="contactId"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {(people?.rows ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid grow gap-1 text-sm">
              <span className="text-ink-muted">{t("recurring.field.forWhat")}</span>
              <input
                name="description"
                required
                className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("recurring.field.amount")}</span>
              <input
                name="amount"
                required
                inputMode="decimal"
                className="w-28 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("recurring.field.howOften")}</span>
              <select
                name="cadence"
                defaultValue="monthly"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              >
                {["weekly", "monthly", "quarterly", "yearly"].map((cadence) => (
                  <option key={cadence} value={cadence}>
                    {t(`recurring.cadence.${cadence}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("recurring.field.dueInDays")}</span>
              <input
                type="number"
                name="dueInDays"
                min={0}
                defaultValue={14}
                className="w-20 rounded-md border border-rule bg-field px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="autoIssue" />
              <span className="text-ink-muted">{t("recurring.field.autoIssue")}</span>
            </label>
            <Button type="submit">{t("recurring.action.add")}</Button>
          </form>
          <p className="max-w-prose text-sm text-ink-muted">{t("recurring.addHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
