// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One figure, and everything it has ever been (MASTER.md §4.18, C8.15).
//
// The ledger is the page. What the business says now is one row at the top of
// a list of what it used to say, with the date each was true and why each
// changed — because a correction an owner cannot see beside the thing it
// corrected is a correction nobody can check.
import { notFound } from "next/navigation";
import { ArrowRight, Warning } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { currentFact, factHistory } from "@/core/attestations/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { hasModuleAccess } from "@/core/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { CorrectFactForm, WithdrawFactForm } from "../FactForms";
import { factFormLabels } from "../labels";

export const dynamic = "force-dynamic";

export default async function FactPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ kind?: string; id?: string }>;
}) {
  const [{ key }, query] = await Promise.all([params, searchParams]);
  const factKey = decodeURIComponent(key);
  const actor = await requireStaffActor("core");
  const subject = query.kind || query.id ? { kind: query.kind, id: query.id } : undefined;

  const [current, ledger, business, t] = await Promise.all([
    currentFact.call({ key: factKey, subject }, actor),
    factHistory.call({ key: factKey, subject }, actor),
    currentBusiness(),
    getT(),
  ]);

  // Nothing was ever published under this key: not an empty page, a missing one.
  if (ledger.length === 0) notFound();

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "core", "manage");
  const newestFirst = [...ledger].reverse();
  const shown = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-tight">{factKey}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {current
              ? t("facts.currentValue", { value: shown(current.value) })
              : t("facts.nothingCurrent")}
          </p>
        </div>
        {current?.stale ? (
          <Pill tone="warning">
            <Warning size={13} weight="bold" />
            {t("facts.stale")}
          </Pill>
        ) : null}
      </div>

      <Card>
        <CardHeader
          title={t("facts.ledger.title")}
          status={
            <span className="ms-auto text-xs text-ink-muted tabular-nums">
              {t("facts.ledger.count", { count: ledger.length })}
            </span>
          }
        />
        <ul className="grid list-none gap-0 p-0">
          {newestFirst.map((entry) => {
            const retired = entry.supersededAt !== null || entry.withdrawnAt !== null;
            return (
              <li
                key={entry.id}
                className="grid gap-1 border-b border-rule px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className={
                      retired
                        ? "text-sm text-ink-muted line-through tabular-nums"
                        : "text-sm font-semibold text-ink tabular-nums"
                    }
                  >
                    {shown(entry.value)}
                  </span>
                  {retired ? null : <Pill tone="success">{t("facts.currentPill")}</Pill>}
                  {entry.withdrawnAt ? (
                    <Pill tone="neutral">{t("facts.withdrawnPill")}</Pill>
                  ) : null}
                  <time
                    dateTime={entry.asOf.toISOString()}
                    className="font-mono text-xs text-ink-muted tabular-nums"
                  >
                    {formatDateTime(entry.asOf, timezone, locale)}
                  </time>
                  <span className="ms-auto text-xs text-ink-muted">{entry.source}</span>
                </div>
                {entry.correctionNote ? (
                  <p className="flex items-start gap-1.5 text-xs text-ink-muted">
                    <ArrowRight size={12} weight="bold" className="mt-0.5 shrink-0" />
                    {entry.correctionNote}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {canManage && current ? (
        <>
          <CorrectFactForm
            factKey={factKey}
            subjectKind={query.kind ?? null}
            subjectId={query.id ?? null}
            labels={factFormLabels(t)}
          />
          <Card>
            <CardHeader title={t("facts.withdraw.title")} />
            <CardBody>
              <p className="text-sm text-ink-muted">{t("facts.withdraw.intro")}</p>
              <WithdrawFactForm
                id={current.id}
                factKey={factKey}
                labels={factFormLabels(t)}
              />
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
