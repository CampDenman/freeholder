// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Editing a form's questions (MASTER.md §4.6).
//
// The one thing this screen has to get right is not a control: it is knowing
// which keys already have answers stored under them. A stored submission is a
// jsonb object keyed by field key, so renaming a key on a live form does not
// migrate anything — it orphans every past answer, silently, and the owner
// discovers it as a column of blanks in their export. So a key that has been
// used is read-only, and the screen says why.
import { notFound } from "next/navigation";
import { getFormById, listSubmissions } from "@/modules/forms/service";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { FieldBuilder, type BuilderField } from "../../FieldBuilder";
import { builderLabels, kindOptions } from "../../builderLabels";

export const dynamic = "force-dynamic";

export default async function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor();
  const { id } = await params;
  const [t, form] = await Promise.all([
    getT(),
    getFormById.call({ id }, actor),
  ]);
  if (!form) notFound();

  // Which keys are established. Sampled rather than exhaustive: a form with
  // ten thousand submissions does not need all of them counted to answer
  // "has anyone answered this question", and the answer only ever locks a
  // field — being wrong in the safe direction costs an owner nothing.
  const recent = await listSubmissions.call(
    { formId: form.id, status: "all", limit: 200 },
    actor,
  );
  const established = new Set<string>();
  for (const submission of recent) {
    const answers = submission.data;
    if (answers && typeof answers === "object") {
      for (const key of Object.keys(answers)) established.add(key);
    }
  }

  const fields: BuilderField[] = (form.fields as BuilderField[]).map((field) => ({
    key: field.key,
    label: field.label,
    kind: field.kind,
    required: Boolean(field.required),
    placeholder: field.placeholder,
    help: field.help,
    options: field.options,
    established: established.has(field.key),
  }));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* The card below carries the explanation; a heading that repeats it
            just pushes the questions further down the screen. */}
        <h1 className="text-xl font-bold tracking-tight">{form.name}</h1>
        <a href={`/admin/forms/${form.id}`} className="text-sm text-ink-muted">
          {t("forms.builder.viewSubmissions")}
        </a>
      </div>
      <FieldBuilder
        formId={form.id}
        kinds={kindOptions(t)}
        labels={builderLabels(t, false)}
        initial={{
          name: form.name,
          slug: form.slug,
          submitLabel: form.submitLabel ?? "",
          successMessage: form.successMessage ?? "",
          destination: form.destination,
          notify: (form.notify ?? []).join(", "),
          status: form.status,
          fields,
        }}
      />
    </div>
  );
}
