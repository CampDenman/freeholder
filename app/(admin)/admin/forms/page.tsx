// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Every form, and how much is waiting in each (MASTER.md §4.6, §36).
import { Envelope, Warning } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { listForms, submissionCounts } from "@/modules/forms/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const actor = await requireStaffActor();
  const [forms, counts, business, t] = await Promise.all([
    listForms.call({}, actor),
    submissionCounts.call({}, actor),
    currentBusiness(),
    getT(),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("forms.title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("forms.intro")}</p>
        </div>
        {counts.spam > 0 ? (
          // The quarantine queue is only a queue if somebody is told it has
          // something in it (§36). A count nobody surfaces is a bin.
          <Pill tone="warning">
            <Warning size={13} weight="bold" />
            {t("forms.quarantine", { count: counts.spam })}
          </Pill>
        ) : null}
      </div>

      {forms.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-ink-muted">{t("forms.empty")}</p>
        </Card>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {forms.map((form) => (
            <li key={form.id}>
              <Card>
                <a
                  href={`/admin/forms/${form.id}`}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Envelope size={15} weight="bold" />
                    {form.name}
                  </span>
                  <span className="font-mono text-xs text-ink-muted">
                    /{form.slug}
                  </span>
                  <Pill tone={form.status === "active" ? "success" : "neutral"}>
                    {form.status === "active" ? t("forms.active") : t("forms.closed")}
                  </Pill>
                  <span className="text-xs text-ink-muted">
                    {t("forms.fields", {
                      count: Array.isArray(form.fields) ? form.fields.length : 0,
                    })}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {form.destination === "contact"
                      ? t("forms.destinationContact")
                      : t("forms.destinationNone")}
                  </span>
                  <span className="ms-auto text-sm font-medium tabular-nums">
                    {t("forms.submissions", { count: Number(form.submissions) })}
                  </span>
                  <time
                    dateTime={form.updatedAt.toISOString()}
                    className="font-mono text-xs text-ink-muted tabular-nums"
                  >
                    {formatDateTime(form.updatedAt, timezone, locale)}
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
