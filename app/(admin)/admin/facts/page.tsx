// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every figure the business currently stands behind (MASTER.md §4.18, C8.15).
//
// Sorted by as-of rather than by key, so the oldest thing still being shown to
// the public is the first thing an owner sees. A rate nobody has touched since
// spring is not a tidy record; it is a page telling somebody a number that
// stopped being true months ago.
import { Quotes, Warning } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { listFacts } from "@/core/attestations/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, Pill } from "@/ui/primitives";
import { hasModuleAccess } from "@/core/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { RecordFactForm } from "./FactForms";
import { factFormLabels } from "./labels";

export const dynamic = "force-dynamic";

export default async function FactsPage() {
  const actor = await requireStaffActor("core");
  const [facts, business, t] = await Promise.all([
    listFacts.call({}, actor),
    currentBusiness(),
    getT(),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "core", "manage");
  const now = Date.now();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("facts.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("facts.intro")}</p>
      </div>

      {facts.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-ink-muted">{t("facts.empty")}</p>
        </Card>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {facts.map((entry) => {
            const stale =
              entry.validUntil !== null && entry.validUntil.getTime() <= now;
            return (
              <li key={entry.id}>
                <Card>
                  <a
                    href={`/admin/facts/${encodeURIComponent(entry.key)}`}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4"
                  >
                    <span className="flex items-center gap-2 font-mono text-xs text-ink-muted">
                      <Quotes size={14} weight="bold" />
                      {entry.key}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {typeof entry.value === "string"
                        ? entry.value
                        : JSON.stringify(entry.value)}
                    </span>
                    {entry.subjectKind ? (
                      <Pill tone="neutral">
                        {entry.subjectKind}
                        {entry.subjectId ? `/${entry.subjectId}` : ""}
                      </Pill>
                    ) : null}
                    {stale ? (
                      <Pill tone="warning">
                        <Warning size={13} weight="bold" />
                        {t("facts.stale")}
                      </Pill>
                    ) : null}
                    <span className="text-xs text-ink-muted">{entry.source}</span>
                    <time
                      dateTime={entry.asOf.toISOString()}
                      className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                    >
                      {formatDateTime(entry.asOf, timezone, locale)}
                    </time>
                  </a>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? <RecordFactForm labels={factFormLabels(t)} /> : null}
    </div>
  );
}
