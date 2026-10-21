// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Starting an assessment (MASTER.md §4.18, C8.14).
//
// It is created as a draft with no outcomes yet, because the outcomes are the
// part that needs thinking about and the questions are the part people start
// with. Publishing is what checks the two agree.
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { QuestionBuilder } from "../QuestionBuilder";
import { questionLabels } from "../labels";

export const dynamic = "force-dynamic";

export default async function NewAssessmentPage() {
  await requireStaffActor("assessments", "manage");
  const t = await getT();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("assessments.builder.newTitle")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("assessments.builder.newIntro")}
        </p>
      </div>
      <QuestionBuilder
        assessment={{
          slug: "",
          name: "",
          intro: null,
          destination: "contact",
          notify: [],
          questions: [],
        }}
        labels={questionLabels(t, true)}
      />
    </div>
  );
}
