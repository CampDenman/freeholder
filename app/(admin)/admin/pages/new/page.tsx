// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A new page starts empty and unpublished — content is added in the editor,
// and nothing reaches the public surface until it is deliberately published.
import { listTemplates } from "@/modules/cms/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { NewPageForm } from "./NewPageForm";

export const dynamic = "force-dynamic";

export default async function NewPagePage() {
  const actor = await requireStaffActor("cms", "manage");
  const [t, templates] = await Promise.all([
    getT(),
    listTemplates.call({}, actor),
  ]);
  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/pages" className="text-sm text-ink-muted">
          {t("cms.pages.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">
          {t("cms.pages.new")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t("cms.pages.newIntro")}</p>
      </div>
      <NewPageForm
        templates={templates
          .filter((row) => row.kind !== "email")
          .map((row) => ({ key: row.key, name: row.name }))}
        labels={{
          title: t("cms.field.pageTitle"),
          slug: t("cms.field.slug"),
          slugHint: t("cms.field.slugHint"),
          template: t("cms.pages.template"),
          templateNone: t("cms.pages.templateNone"),
          submit: t("cms.pages.create"),
          pending: t("common.saving"),
        }}
      />
    </div>
  );
}
