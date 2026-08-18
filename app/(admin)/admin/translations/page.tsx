// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What is translated, and what is not (MASTER.md §4.9).
//
// The screen answers one question — where are the gaps — because that is the
// question a multilingual site actually poses. §4.9 renders an untranslated
// page in the site's own language rather than 404ing, which is the right
// behaviour and also the reason a gap is invisible from the front: nothing
// breaks, the French visitor simply reads English. This is where it shows.
//
// Pages use entity_translations. Chrome is a locale variant of a Section
// (C2.16) — a French header is a row, not a translation of one.
import { Translate as TranslateIcon } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { listPages, listSections, pageTranslationReport } from "@/modules/cms/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { hasModuleAccess } from "@/core/service";

export const dynamic = "force-dynamic";

export default async function TranslationsPage() {
  const actor = await requireStaffActor("i18n");
  const [pages, business, t, sections] = await Promise.all([
    listPages.call({}, actor),
    currentBusiness(),
    getT(),
    listSections.call({}, actor),
  ]);

  const sourceLocale = business?.defaultLocale ?? "en";
  const targets = (business?.enabledLocales ?? []).filter(
    (locale) => locale !== sourceLocale,
  );
  const reports = Object.fromEntries(
    await Promise.all(
      targets.map(async (locale) => [
        locale,
        await pageTranslationReport.call({ locale }, actor),
      ]),
    ),
  ) as Record<string, Awaited<ReturnType<typeof pageTranslationReport.call>>>;
  // Nothing to translate into is not an empty screen, it is a screen that
  // should not exist: the nav hides it, and a typed URL says so too.
  if (targets.length === 0) notFound();

  const canManage = hasModuleAccess(actor, "i18n", "manage");
  const names = new Intl.DisplayNames([sourceLocale], { type: "language" });
  const chromeKeys = [...new Set(sections.map((section) => section.key))];
  const chromeLocales = new Map(
    sections.map((section) => [`${section.key}:${section.locale}`, section]),
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("translations.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("translations.intro", { locale: names.of(sourceLocale) ?? sourceLocale })}
        </p>
      </div>

      {pages.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-ink-muted">{t("translations.noPages")}</p>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule text-start">
                  <th scope="col" className="p-3 text-start font-semibold">
                    {t("translations.page")}
                  </th>
                  {targets.map((locale) => (
                    <th
                      key={locale}
                      scope="col"
                      className="p-3 text-start font-semibold"
                    >
                      {names.of(locale) ?? locale}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.id} className="border-b border-rule last:border-0">
                    <th scope="row" className="p-3 text-start font-medium text-ink">
                      {page.title}
                      <span className="ms-2 font-mono text-xs font-normal text-ink-muted">
                        /{page.slug}
                      </span>
                    </th>
                    {targets.map((locale) => {
                      const row = reports[locale]?.find((item) => item.pageId === page.id);
                      const status = (
                        <>
                          {row && row.status !== "missing" ? (
                            <Pill
                              tone={row.status === "reviewed" ? "success" : "warning"}
                            >
                              {t(`translations.status.${row.status}`)}
                            </Pill>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-accent">
                              <TranslateIcon size={14} weight="bold" />
                              {t("translations.missing")}
                            </span>
                          )}
                          {row && row.status === "reviewed" && !row.seoComplete ? (
                            <span className="text-xs text-warning">
                              {t("translations.seoIncomplete")}
                            </span>
                          ) : null}
                        </>
                      );
                      return (
                        <td key={locale} className="p-3">
                          {canManage ? (
                            <a
                              href={`/admin/translations/${locale}/${page.id}`}
                              className="inline-flex items-center gap-2"
                            >
                              {status}
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              {status}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {chromeKeys.length > 0 ? (
        <Card>
          <div className="border-b border-rule px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">{t("translations.chrome")}</h2>
            <p className="mt-1 text-sm text-ink-muted">{t("translations.chromeIntro")}</p>
          </div>
          <ul className="grid list-none gap-0 p-0">
            {chromeKeys.map((key) => {
              const source = chromeLocales.get(`${key}:${sourceLocale}`) ?? sections.find((row) => row.key === key);
              return (
                <li key={key} className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3 last:border-0">
                  <span className="font-medium">{source?.name ?? key}</span>
                  <span className="font-mono text-xs text-ink-muted">{key}</span>
                  {targets.map((locale) => {
                    const variant = chromeLocales.get(`${key}:${locale}`);
                    return variant ? (
                      <a
                        key={locale}
                        href={`/admin/sections/${encodeURIComponent(key)}?locale=${encodeURIComponent(locale)}`}
                        className="text-sm text-ink underline decoration-rule underline-offset-2"
                      >
                        {names.of(locale) ?? locale}
                      </a>
                    ) : (
                      <span key={locale} className="text-sm text-ink-muted">
                        {names.of(locale) ?? locale} · {t("translations.missing")}
                      </span>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <p className="max-w-prose text-sm text-ink-muted">
        {t("translations.reviewedOnly")}
      </p>
    </div>
  );
}
