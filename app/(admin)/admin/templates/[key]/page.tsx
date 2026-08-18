// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Edit a template in the same editor as a page (C2.13).
import { notFound } from "next/navigation";
import { getTemplate } from "@/modules/cms/service";
import { listAssets } from "@/core/media/service";
import { currentBusiness } from "@/core/settings/read";
import { languageName, resolveEnabledLocale } from "@/core/i18n/customer";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { Button } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { editorBlockTypes, editorLabels } from "../../editorLabels";
import { resetTemplateAction } from "../../../cms-actions";
import { TemplateEditor } from "./TemplateEditor";
import { CreateFromTemplateForm } from "./CreateFromTemplateForm";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const actor = await requireStaffActor("cms", "manage");
  const [{ key }, query, business] = await Promise.all([
    params,
    searchParams,
    currentBusiness(),
  ]);
  const locale = resolveEnabledLocale(query.locale, {
    defaultLocale: business?.defaultLocale ?? "en",
    enabledLocales: business?.enabledLocales ?? ["en"],
  });
  const [template, library, t] = await Promise.all([
    getTemplate.call({ key, locale }, actor),
    listAssets.call({}, actor),
    getT(),
  ]);
  if (!template) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/templates" className="text-sm text-ink-muted">
          {t("cms.templates.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{template.name}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("cms.templates.editIntro")} · {languageName(locale)}
        </p>
      </div>
      {template.kind !== "email" ? (
        <CreateFromTemplateForm
          templateKey={template.key}
          labels={{
            title: t("cms.field.pageTitle"),
            slug: t("cms.field.slug"),
            slugHint: t("cms.field.slugHint"),
            submit: t("cms.templates.createFrom"),
            pending: t("common.saving"),
          }}
        />
      ) : null}
      {template.origin === "owner" ? (
        <form action={resetTemplateAction}>
          <input type="hidden" name="key" value={template.key} />
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" variant="quiet">
            {t("cms.templates.reset")}
          </Button>
        </form>
      ) : null}
      <TemplateEditor
        templateKey={template.key}
        locale={locale}
        initialBlocks={template.blocks as BlockNode[]}
        blockTypes={editorBlockTypes(
          t,
          "page",
          library.rows.map((a) => ({
            id: a.id,
            filename: a.filename,
            kind: a.kind,
          })),
        )}
        labels={editorLabels(t)}
      />
    </div>
  );
}
