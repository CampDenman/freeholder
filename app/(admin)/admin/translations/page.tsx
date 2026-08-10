// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// What is translated, and what is not (MASTER.md §4.9).
//
// The screen answers one question — where are the gaps — because that is the
// question a multilingual site actually poses. §4.9 renders an untranslated
// page in the site's own language rather than 404ing, which is the right
// behaviour and also the reason a gap is invisible from the front: nothing
// breaks, the French visitor simply reads English. This is where it shows.
//
// Pages only, for now. Sections carry their own locale column — a French
// header is a section row, not a translation of one — so the mechanism is
// already there and needs a different screen.
import { Translate as TranslateIcon } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { formatDateTime } from "@/core/i18n";
import { translationIndex } from "@/core/i18n/service";
import { listPages } from "@/modules/cms/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function TranslationsPage() {
  const actor = await requireStaffActor();
  const [pages, rows, business, t] = await Promise.all([
    listPages.call({}, actor),
    translationIndex.call({ entityType: "page" }, actor),
    currentBusiness(),
    getT(),
  ]);

  const sourceLocale = business?.defaultLocale ?? "en";
  const targets = (business?.enabledLocales ?? []).filter(
    (locale) => locale !== sourceLocale,
  );
  // Nothing to translate into is not an empty screen, it is a screen that
  // should not exist: the nav hides it, and a typed URL says so too.
  if (targets.length === 0) notFound();

  const timezone = business?.timezone ?? "UTC";
  const names = new Intl.DisplayNames([sourceLocale], { type: "language" });
  const byKey = new Map(rows.map((row) => [`${row.entityId}:${row.locale}`, row]));

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
                      const row = byKey.get(`${page.id}:${locale}`);
                      return (
                        <td key={locale} className="p-3">
                          <a
                            href={`/admin/translations/${locale}/${page.id}`}
                            className="inline-flex items-center gap-2"
                          >
                            {row ? (
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
                            {row ? (
                              <time
                                dateTime={row.updatedAt.toISOString()}
                                className="font-mono text-xs text-ink-muted tabular-nums"
                              >
                                {formatDateTime(row.updatedAt, timezone, sourceLocale)}
                              </time>
                            ) : null}
                          </a>
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

      <p className="max-w-prose text-sm text-ink-muted">
        {t("translations.reviewedOnly")}
      </p>
    </div>
  );
}
