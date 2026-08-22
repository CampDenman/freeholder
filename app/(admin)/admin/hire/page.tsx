// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The hire desk (C6.10, MASTER.md §4.2).
//
// Ordered by what an owner actually needs to see first: what is overdue, then
// what is out, then what is coming. A list sorted by identifier is a list
// nobody reads twice.
//
// There is no availability on this screen, and that is the architecture rather
// than an omission — a hire's time lives on its resource calendar, so
// `/admin/calendar` already shows it beside everything else the business has
// booked. Drawing a second diary here would be the second availability model
// §4.2 refuses.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { formatMoney } from "@/core/i18n";
import { listHires, listRentalTerms } from "@/modules/rentals/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  closeHireAction,
  handOverAction,
  takeBackAction,
} from "../../rental-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  reserved: "warning",
  out: "accent",
  overdue: "danger",
  returned: "success",
  closed: "neutral",
  cancelled: "neutral",
};

/** Overdue first: it is the only row on this screen that costs money to ignore. */
const ORDER = ["overdue", "out", "reserved", "returned", "closed", "cancelled"];

export default async function HirePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("rentals");
  const [t, business, hires, terms, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listHires.call({ limit: 100 }, actor)),
    domainOrNull(listRentalTerms.call({}, actor)),
    searchParams,
  ]);

  const locale = business?.defaultLocale ?? "en";
  const timezone = business?.timezone ?? "UTC";
  const money = (minor: number, currency: string | null) =>
    formatMoney(minor, currency ?? business?.baseCurrency ?? "GBP", locale);
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  const sorted = [...(hires ?? [])].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("hire.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("hire.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("hire.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("hire.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("hire.onLoan")} />
        <CardBody>
          {hires === null ? (
            <p className="text-sm text-danger">{t("hire.unavailable")}</p>
          ) : sorted.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("hire.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {sorted.map((hire) => (
                <li key={hire.id} className="grid gap-2 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{hire.sku}</span>
                    <Pill tone={STATUS_TONES[hire.status] ?? "neutral"}>
                      {t(`hire.status.${hire.status}`)}
                    </Pill>
                    <span className="text-sm text-ink-muted">
                      {hire.contactName ?? hire.contactEmail ?? ""}
                    </span>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {t("hire.window", {
                      from: when(hire.startsAt),
                      to: when(hire.dueAt),
                    })}
                  </p>
                  <p className="text-sm text-ink-muted tabular-nums">
                    {t("hire.money", {
                      hire: money(hire.quotedMinor, hire.currency),
                      deposit: money(hire.depositMinor, hire.currency),
                    })}
                  </p>
                  {hire.status === "returned" || hire.status === "closed" ? (
                    <p className="text-sm text-ink-muted tabular-nums">
                      {t("hire.settlement", {
                        late: money(hire.lateFeeMinor, hire.currency),
                        damage: money(hire.damageFeeMinor, hire.currency),
                        refund: money(hire.depositRefundMinor, hire.currency),
                      })}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-end gap-3">
                    {hire.status === "reserved" ? (
                      <form action={handOverAction} className="flex items-end gap-2">
                        <input type="hidden" name="id" value={hire.id} />
                        <label className="grid gap-1 text-sm">
                          <span className="text-ink-muted">{t("hire.field.condition")}</span>
                          <input
                            name="condition"
                            className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                          />
                        </label>
                        <Button type="submit" variant="quiet">
                          {t("hire.action.handOver")}
                        </Button>
                      </form>
                    ) : null}

                    {hire.status === "out" || hire.status === "overdue" ? (
                      <form action={takeBackAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={hire.id} />
                        <label className="grid gap-1 text-sm">
                          <span className="text-ink-muted">{t("hire.field.returned")}</span>
                          <select
                            name="condition"
                            defaultValue="fine"
                            className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                          >
                            <option value="fine">{t("hire.condition.fine")}</option>
                            <option value="damaged">{t("hire.condition.damaged")}</option>
                            <option value="lost">{t("hire.condition.lost")}</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="text-ink-muted">{t("hire.field.notes")}</span>
                          <input
                            name="notes"
                            className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                          />
                        </label>
                        <Button type="submit" variant="quiet">
                          {t("hire.action.takeBack")}
                        </Button>
                      </form>
                    ) : null}

                    {hire.status === "returned" ? (
                      <form action={closeHireAction}>
                        <input type="hidden" name="id" value={hire.id} />
                        <Button type="submit" variant="quiet">
                          {t("hire.action.close")}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {/* Money is decided here and moved on the invoice: a hire is not a
              payment, so charging for a broken lens stays a deliberate act. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("hire.settleHint")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("hire.catalogue")} />
        <CardBody>
          {terms === null ? (
            <p className="text-sm text-danger">{t("hire.unavailable")}</p>
          ) : terms.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("hire.noTerms")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {terms.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-2 text-sm"
                >
                  <span className="font-medium">{item.sku}</span>
                  <span className="text-ink-muted">
                    {t(`hire.unit.${item.unit}`)} · {item.calendarName}
                  </span>
                  <span className="text-ink-muted tabular-nums">
                    {t("hire.deposit", {
                      deposit: money(item.depositMinor, null),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="max-w-prose text-sm text-ink-muted">{t("hire.catalogueHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
