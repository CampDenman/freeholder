// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One assessment: its outcomes, its escalations, and who has answered
// (MASTER.md §4.18, C8.14).
//
// Outcomes come first on the page, above the questions link, because they are
// the part an owner is accountable for. The questions decide a number; the
// bands decide what a person is told, and that is the thing worth putting at
// the top of the screen.
import { notFound } from "next/navigation";
import { ArrowSquareOut, Warning } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { getAssessment, listResponses } from "@/modules/assessments/service";
import { reachableScoreRange, type AssessmentQuestion } from "@/modules/assessments/questions";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardHeader, Pill } from "@/ui/primitives";
import { ServiceError, hasModuleAccess } from "@/core/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { BandEditor } from "../BandEditor";
import { EscalationEditor } from "../EscalationEditor";
import { PublishControls } from "../PublishControls";
import { bandLabels, escalationLabels, publishLabels } from "../labels";

export const dynamic = "force-dynamic";

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireStaffActor("assessments");

  const detail = await getAssessment.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  });

  const [responses, business, t] = await Promise.all([
    listResponses.call({ assessmentId: id }, actor),
    currentBusiness(),
    getT(),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "assessments", "manage");
  const questions = detail.questions as AssessmentQuestion[];
  const range = questions.length
    ? reachableScoreRange(questions)
    : { min: 0, max: 0 };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{detail.name}</h1>
          <p className="mt-1 font-mono text-xs text-ink-muted">/{detail.slug}</p>
        </div>
        <Pill
          tone={
            detail.status === "active"
              ? "success"
              : detail.status === "draft"
                ? "warning"
                : "neutral"
          }
        >
          {t(`assessments.status.${detail.status}`)}
        </Pill>
        <a
          href={`/admin/assessments/${detail.id}/edit`}
          className="ms-auto inline-flex items-center gap-2 rounded-md border border-rule px-3 py-2 text-sm font-semibold text-ink"
        >
          {t("assessments.editQuestions", { count: questions.length })}
          <ArrowSquareOut size={14} weight="bold" />
        </a>
      </div>

      {canManage ? (
        <PublishControls
          id={detail.id}
          status={detail.status}
          labels={publishLabels(t)}
        />
      ) : null}

      <BandEditor
        assessmentId={detail.id}
        bands={detail.bands.map((band) => ({
          id: band.id,
          key: band.key,
          label: band.label,
          body: band.body,
          minScore: band.minScore,
          maxScore: band.maxScore,
          ordinal: band.ordinal,
        }))}
        range={range}
        labels={bandLabels(t)}
      />

      <EscalationEditor
        assessmentId={detail.id}
        escalations={detail.escalations.map((escalation) => ({
          id: escalation.id,
          questionKey: escalation.questionKey,
          optionKey: escalation.optionKey,
          instruction: escalation.instruction,
          ordinal: escalation.ordinal,
        }))}
        questions={questions}
        labels={escalationLabels(t)}
      />

      <Card>
        <CardHeader
          title={t("assessments.responses.title")}
          status={
            <span className="ms-auto text-xs text-ink-muted tabular-nums">
              {t("assessments.responses.count", { count: detail.responseCount })}
            </span>
          }
        />
        {responses.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">{t("assessments.responses.empty")}</p>
        ) : (
          <ul className="grid list-none gap-0 p-0">
            {responses.map((response) => (
              <li
                key={response.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule px-4 py-3 last:border-b-0"
              >
                {/* An escalated response is the one somebody has to look at
                    today, so it is marked rather than left to a score the
                    reader has to interpret. */}
                {response.escalated ? (
                  <Pill tone="danger">
                    <Warning size={13} weight="bold" />
                    {t("assessments.responses.escalated")}
                  </Pill>
                ) : null}
                <span className="text-sm font-medium text-ink">{response.bandLabel}</span>
                <span className="font-mono text-xs text-ink-muted tabular-nums">
                  {t("assessments.responses.score", { count: response.score })}
                </span>
                <span className="text-xs text-ink-muted">
                  {response.contactId
                    ? t("assessments.responses.identified")
                    : t("assessments.responses.anonymous")}
                </span>
                <time
                  dateTime={response.createdAt.toISOString()}
                  className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                >
                  {formatDateTime(response.createdAt, timezone, locale)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
