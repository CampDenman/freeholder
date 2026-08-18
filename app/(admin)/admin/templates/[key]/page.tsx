// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Edit a template in the same editor as a page (C2.13).
import { notFound } from "next/navigation";
import { getTemplate, previewEmail } from "@/modules/cms/service";
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
import { EmailInboxPreview } from "./EmailInboxPreview";

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
  const inbox =
    template.kind === "email"
      ? await previewEmail.call({ key: template.key, locale }, actor)
      : null;

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
      {inbox ? (
        <EmailInboxPreview
          subject={inbox.subject}
          html={inbox.html}
          text={inbox.text}
          templateKey={template.key}
          locale={locale}
          labels={{
            inbox: t("cms.email.inbox"),
            from: t("cms.email.from"),
            to: t("cms.email.to"),
            subject: t("cms.email.subject"),
            testSend: t("cms.email.testSend"),
            fromSample: t("cms.email.fromSample"),
            toSample: t("cms.email.toSample"),
          }}
        />
      ) : null}
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
          template.kind === "email" ? "email" : "page",
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
