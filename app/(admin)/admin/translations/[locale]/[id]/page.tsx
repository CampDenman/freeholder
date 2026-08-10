// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// One page, in one language (MASTER.md §4.9).
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { getTranslation } from "@/core/i18n/service";
import { getPage } from "@/modules/cms/service";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import { pathKey, translatableStrings } from "@/modules/cms/translate";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { label } from "../../../editorLabels";
import {
  TranslationEditor,
  type TranslationRow,
} from "../../TranslationEditor";

export const dynamic = "force-dynamic";

export default async function TranslatePagePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const actor = await requireStaffActor();
  const { locale, id } = await params;
  const [t, business] = await Promise.all([getT(), currentBusiness()]);

  const sourceLocale = business?.defaultLocale ?? "en";
  // A locale the site does not publish is not an empty form, it is a wrong
  // URL — and `i18n.setTranslation` would refuse the save anyway, so refusing
  // to draw the screen is the honest version of the same rule.
  if (locale === sourceLocale || !(business?.enabledLocales ?? []).includes(locale)) {
    notFound();
  }

  const page = await getPage.call({ id }, actor);
  const existing = await getTranslation.call(
    { entityType: "page", entityId: id, locale, includeUnreviewed: true },
    actor,
  );

  const fields = (existing?.fields ?? {}) as {
    title?: string;
    blocks?: unknown;
  };

  // The saved translation is read as a *lookup*, never as the structure: the
  // rows come from the source tree, and a translation whose block has since
  // been deleted simply has nowhere to appear. Same rule as applyTranslations.
  const saved: Record<string, string> = {};
  if (fields.blocks) {
    try {
      for (const row of translatableStrings(parseBlockTree(fields.blocks, "page"))) {
        saved[pathKey(row.path)] = row.value;
      }
    } catch {
      // A stored translation that no longer parses is a translation to be
      // rewritten, not a screen that refuses to open.
    }
  }

  const source = parseBlockTree(page.blocks, "page");
  const rows: TranslationRow[] = [
    {
      key: "title",
      source: page.title,
      value: fields.title ?? "",
      group: t("translations.pageItself"),
      label: t("translations.pageTitle"),
      multiline: false,
    },
    ...translatableStrings(source).map((string) => {
      const key = pathKey(string.path);
      return {
        key,
        source: string.value,
        value: saved[key] ?? "",
        group: string.blockType
          ? t(`cms.block.${string.blockType}`)
          : t("translations.pageItself"),
        label: label(t, `cms.field.${string.field}`, string.field),
        multiline: string.multiline,
      };
    }),
  ];

  const names = new Intl.DisplayNames([sourceLocale], { type: "language" });
  const languageName = names.of(locale) ?? locale;

  return (
    <div className="grid gap-6">
      <div>
        <a
          href="/admin/translations"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted"
        >
          <ArrowLeft size={14} weight="bold" />
          {t("translations.back")}
        </a>
        <h1 className="mt-1 text-xl font-bold tracking-tight">
          {t("translations.heading", { page: page.title, language: languageName })}
        </h1>
      </div>
      <TranslationEditor
        entityId={id}
        locale={locale}
        rows={rows}
        reviewed={existing?.status === "reviewed"}
        labels={{
          cardTitle: languageName,
          intro: t("translations.editorIntro"),
          source: names.of(sourceLocale) ?? sourceLocale,
          target: languageName,
          save: t("common.saveChanges"),
          pending: t("common.saving"),
          saved: t("admin.settings.saved"),
          markReviewed: t("translations.markReviewed"),
          reviewedHint: t("translations.reviewedHint"),
          status: t("translations.statusLabel"),
          empty: t("translations.nothingToTranslate"),
        }}
      />
    </div>
  );
}
