// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every calculator on the site (MASTER.md §4.18, C5.26).
import { Calculator as CalculatorIcon, Plus } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { listCalculators } from "@/modules/calculators/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, Pill } from "@/ui/primitives";
import { hasModuleAccess } from "@/core/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function CalculatorsPage() {
  const actor = await requireStaffActor("calculators");
  const [rows, business, t] = await Promise.all([
    listCalculators.call({}, actor),
    currentBusiness(),
    getT(),
  ]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "calculators", "manage");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("calculators.title")}</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("calculators.intro")}</p>
        </div>
        {canManage ? (
          <a
            href="/admin/calculators/new"
            className="ms-auto inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-on-accent"
          >
            <Plus size={15} weight="bold" />
            {t("calculators.new")}
          </a>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-ink-muted">{t("calculators.empty")}</p>
        </Card>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {rows.map((entry) => (
            <li key={entry.id}>
              <Card>
                <a
                  href={`/admin/calculators/${entry.id}`}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <CalculatorIcon size={15} weight="bold" />
                    {entry.name}
                  </span>
                  <span className="font-mono text-xs text-ink-muted">/{entry.slug}</span>
                  <Pill
                    tone={
                      entry.status === "active"
                        ? "success"
                        : entry.status === "draft"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {t(`calculators.status.${entry.status}`)}
                  </Pill>
                  <time
                    dateTime={entry.updatedAt.toISOString()}
                    className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                  >
                    {formatDateTime(entry.updatedAt, timezone, locale)}
                  </time>
                </a>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
