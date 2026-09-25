// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every assessment, and whether it is open (MASTER.md §4.18, C8.14).
import { ListChecks, Plus } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { listAssessments } from "@/modules/assessments/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, Pill } from "@/ui/primitives";
import { hasModuleAccess } from "@/core/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function AssessmentsPage() {
  const actor = await requireStaffActor("assessments");
  const [assessments, business, t] = await Promise.all([
    listAssessments.call({}, actor),
    currentBusiness(),
    getT(),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "assessments", "manage");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("assessments.title")}</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("assessments.intro")}</p>
        </div>
        {canManage ? (
          <a
            href="/admin/assessments/new"
            className="ms-auto inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-on-accent"
          >
            <Plus size={15} weight="bold" />
            {t("assessments.new")}
          </a>
        ) : null}
      </div>

      {assessments.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-ink-muted">{t("assessments.empty")}</p>
        </Card>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {assessments.map((assessment) => (
            <li key={assessment.id}>
              <Card>
                <a
                  href={`/admin/assessments/${assessment.id}`}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <ListChecks size={15} weight="bold" />
                    {assessment.name}
                  </span>
                  <span className="font-mono text-xs text-ink-muted">/{assessment.slug}</span>
                  <Pill
                    tone={
                      assessment.status === "active"
                        ? "success"
                        : assessment.status === "draft"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {t(`assessments.status.${assessment.status}`)}
                  </Pill>
                  <span className="text-xs text-ink-muted">
                    {t("assessments.questionCount", {
                      count: Array.isArray(assessment.questions)
                        ? assessment.questions.length
                        : 0,
                    })}
                  </span>
                  <time
                    dateTime={assessment.updatedAt.toISOString()}
                    className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                  >
                    {formatDateTime(assessment.updatedAt, timezone, locale)}
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
