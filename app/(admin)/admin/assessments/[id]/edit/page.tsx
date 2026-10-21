// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Editing the questions (MASTER.md §4.18, C8.14).
//
// Separate from the outcomes on purpose. Re-scoring a question changes the
// range the bands have to cover, and while the assessment is live the service
// refuses a change that would open a gap — so the two screens are the two
// halves of that argument, and editing either one tells you plainly what it
// did to the other.
import { notFound } from "next/navigation";
import { getAssessment } from "@/modules/assessments/service";
import { ServiceError } from "@/core/service";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { QuestionBuilder, type BuilderQuestion } from "../../QuestionBuilder";
import { questionLabels } from "../../labels";

export const dynamic = "force-dynamic";

export default async function EditAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireStaffActor("assessments", "manage");

  const detail = await getAssessment.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  });
  const t = await getT();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("assessments.builder.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("assessments.builder.editIntro")}
        </p>
        <a
          href={`/admin/assessments/${detail.id}`}
          className="mt-2 inline-block text-sm text-accent underline"
        >
          {t("assessments.backToOutcomes")}
        </a>
      </div>
      <QuestionBuilder
        assessment={{
          id: detail.id,
          slug: detail.slug,
          name: detail.name,
          intro: detail.intro,
          destination: detail.destination,
          notify: detail.notify,
          questions: detail.questions as BuilderQuestion[],
        }}
        labels={questionLabels(t, false)}
      />
    </div>
  );
}
