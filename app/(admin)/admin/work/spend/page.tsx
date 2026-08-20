// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What the workforce costs (C4.06, MASTER.md §40: "Spend, per agent and in
// total, against the cap"). Money is shown in the business's own currency,
// formatted from integer cents without ever dividing.
import type { Metadata } from "next";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { agentSpendReport } from "@/core/agents/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AgentSpendPage() {
  const actor = await requireStaffActor("agents");
  const [t, business, rows] = await Promise.all([
    getT(),
    currentBusiness(),
    agentSpendReport.call({}, actor),
  ]);
  const locale = business?.defaultLocale ?? "en";
  const currency = business?.baseCurrency ?? "USD";
  const money = (cents: number) => formatMoney(cents, currency, locale);
  const totalSpent = rows.reduce((sum, row) => sum + row.spentCents, 0);
  const totalBudget = rows.reduce((sum, row) => sum + row.budgetCents, 0);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/work" className="text-sm text-ink-muted">{t("work.spend.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("work.spend.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("work.spend.intro")}</p>
      </div>

      <Card>
        <CardHeader title={t("work.spend.total")} />
        <CardBody>
          <p className="font-mono text-2xl font-bold tabular-nums">
            {money(totalSpent)}
            <span className="ms-2 text-sm font-normal text-ink-muted">
              {t("work.spend.ofBudget", { budget: money(totalBudget) })}
            </span>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("work.spend.perAgent")} />
        <CardBody>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("work.spend.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {rows.map((row) => {
                const share =
                  row.budgetCents > 0
                    ? Math.min(100, Math.round((row.spentCents * 100) / row.budgetCents))
                    : 0;
                const tone =
                  row.budgetCents > 0 && row.spentCents >= row.budgetCents
                    ? "danger"
                    : share >= 80
                      ? "warning"
                      : "neutral";
                return (
                  <li key={row.id} className="grid gap-2 rounded-md border border-rule px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{row.name}</span>
                      {row.status === "paused" ? (
                        <Pill>{t("work.spend.paused")}</Pill>
                      ) : null}
                      {row.budgetCents === 0 ? (
                        <Pill tone="warning">{t("work.spend.noBudget")}</Pill>
                      ) : null}
                      {!row.priced ? (
                        <Pill tone="warning">{t("work.spend.unpriced")}</Pill>
                      ) : null}
                      <span className="ms-auto font-mono text-sm tabular-nums">
                        {money(row.spentCents)}
                        <span className="text-ink-muted">
                          {" / "}
                          {money(row.budgetCents)}
                        </span>
                      </span>
                    </div>
                    <div
                      role="meter"
                      aria-valuenow={share}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={t("work.spend.meter", { name: row.name, percent: share })}
                      className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
                    >
                      <div
                        className={
                          tone === "danger"
                            ? "h-full bg-danger"
                            : tone === "warning"
                              ? "h-full bg-warning"
                              : "h-full bg-accent"
                        }
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <p className="text-xs text-ink-muted">
                      {t("work.spend.detail", {
                        period: t(`work.spend.period.${row.budgetPeriod}`),
                        remaining: money(row.remainingCents),
                        runs: row.runs,
                        tokens: row.tokensIn + row.tokensOut,
                      })}
                      {row.model ? ` · ${row.model}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
