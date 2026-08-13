// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A new form (MASTER.md §4.6).
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { FieldBuilder } from "../FieldBuilder";
import { builderLabels, kindOptions } from "../builderLabels";

export const dynamic = "force-dynamic";

export default async function NewFormPage() {
  await requireStaffActor("forms", "manage");
  const t = await getT();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("forms.builder.newTitle")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("forms.builder.newIntro")}
        </p>
      </div>
      <FieldBuilder
        formId={null}
        kinds={kindOptions(t)}
        labels={builderLabels(t, true)}
        initial={{
          name: "",
          slug: "",
          submitLabel: "",
          successMessage: "",
          destination: "contact",
          notify: "",
          status: "active",
          // One question to start from, because an empty builder is a screen
          // that does not say what it is for.
          fields: [
            { key: "name", label: "Your name", kind: "text", required: true, established: false },
            { key: "email", label: "Email", kind: "email", required: true, established: false },
          ],
        }}
      />
    </div>
  );
}
