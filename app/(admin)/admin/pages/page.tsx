// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every page on the site (MASTER.md §32).
import { FileText, Plus } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { listPages } from "@/modules/cms/service";
import { Card, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { SeedSiteButton } from "./SeedSiteButton";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";

export const dynamic = "force-dynamic";


export default async function PagesPage() {
  const actor = await requireStaffActor("cms");
  const [pages, business, t] = await Promise.all([
    listPages.call({}, actor),
    currentBusiness(),
    getT(),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "cms", "manage");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {t("cms.pages.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{t("cms.pages.intro")}</p>
        </div>
        {canManage ? (
          <a
            href="/admin/pages/new"
            className="ms-auto inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)]"
          >
            <Plus size={15} weight="bold" />
            {t("cms.pages.new")}
          </a>
        ) : null}
      </div>

      <Card>
        {pages.length === 0 ? (
          <div className="grid justify-items-start gap-3 px-4 py-10">
            <FileText size={26} weight="light" className="text-ink-muted" />
            <p className="text-sm text-ink-muted">{t("cms.pages.empty")}</p>
            {/* Owner-only: re-creating the starting site is a repair, and
                offering it to staff invites a confusing refusal. */}
            {canManage ? <SeedSiteButton label={t("cms.pages.seed")} /> : null}
          </div>
        ) : (
          <ul className="grid list-none gap-0 p-0">
            {pages.map((page) => (
              <li
                key={page.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-3 last:border-b-0"
              >
                {canManage ? (
                  <a
                    href={`/admin/pages/${page.id}`}
                    className="font-medium underline decoration-rule underline-offset-2"
                  >
                    {page.title}
                  </a>
                ) : (
                  <span className="font-medium">{page.title}</span>
                )}
                <span className="font-mono text-xs text-ink-muted">
                  /{page.slug}
                </span>
                <Pill tone={page.status === "published" ? "success" : "neutral"}>
                  {t(`cms.status.${page.status}`)}
                </Pill>
                <time
                  dateTime={page.updatedAt.toISOString()}
                  className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                >
                  {formatDateTime(page.updatedAt, timezone, locale)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
