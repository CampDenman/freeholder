// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The site chrome, as data (MASTER.md §32: "menus are rows, not JSX").
import { Layout } from "@phosphor-icons/react/dist/ssr";
import { listSections } from "@/modules/cms/service";
import { Card, Pill } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { languageName } from "@/core/i18n/customer";
import { hasModuleAccess } from "@/core/service";
import { getT } from "../../../i18n";
import { createSectionLocaleAction } from "../../cms-actions";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function SectionsPage() {
  const actor = await requireStaffActor("cms");
  const [sections, business, t] = await Promise.all([
    listSections.call({}, actor),
    currentBusiness(),
    getT(),
  ]);
  const sourceLocale = business?.defaultLocale ?? "en";
  const locales = business?.enabledLocales ?? [sourceLocale];
  const sectionKeys = [...new Set(sections.map((section) => section.key))];
  const byVariant = new Map(
    sections.map((section) => [`${section.key}:${section.locale}`, section]),
  );
  const sourceSections = sectionKeys
    .map((key) => byVariant.get(`${key}:${sourceLocale}`)
      ?? sections.find((section) => section.key === key))
    .filter((section): section is (typeof sections)[number] => Boolean(section));
  const canManage = hasModuleAccess(actor, "cms", "manage");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("cms.sections.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t("cms.sections.intro")}</p>
      </div>
      <Card>
        {sourceSections.length === 0 ? (
          <div className="grid justify-items-start gap-3 px-4 py-10">
            <Layout size={26} weight="light" className="text-ink-muted" />
            <p className="text-sm text-ink-muted">{t("cms.sections.empty")}</p>
          </div>
        ) : (
          <ul className="grid list-none gap-0 p-0">
            {sourceSections.map((section) => (
              <li
                key={section.id}
                className="grid gap-3 border-b border-rule px-4 py-4 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{section.name}</span>
                  <span className="font-mono text-xs text-ink-muted">
                    {section.key}
                  </span>
                  <Pill tone={section.kind === "chrome" ? "accent" : "neutral"}>
                    {t(`cms.sectionKind.${section.kind}`)}
                  </Pill>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {locales.map((locale) => {
                    const variant = byVariant.get(`${section.key}:${locale}`);
                    if (variant) {
                      return (
                        <a
                          key={locale}
                          href={`/admin/sections/${encodeURIComponent(section.key)}?locale=${encodeURIComponent(locale)}`}
                          className="rounded-md border border-rule px-3 py-1.5 text-sm text-ink underline decoration-rule underline-offset-2"
                        >
                          {languageName(locale)}
                        </a>
                      );
                    }
                    if (!canManage) {
                      return (
                        <span key={locale} className="text-sm text-ink-muted">
                          {languageName(locale)} · {t("translations.missing")}
                        </span>
                      );
                    }
                    return (
                      <form
                        key={locale}
                        action={createSectionLocaleAction.bind(null, section.key, locale)}
                      >
                        <button
                          type="submit"
                          className="rounded-md border border-dashed border-rule px-3 py-1.5 text-sm text-accent"
                        >
                          {t("cms.sections.addLocale", { locale: languageName(locale) })}
                        </button>
                      </form>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
