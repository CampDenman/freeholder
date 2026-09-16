// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every page on the site (MASTER.md §32).
import { FileText, Plus } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { helpCategoryList, listPages } from "@/modules/cms/service";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { SeedSiteButton } from "./SeedSiteButton";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";
import { domainOrNull } from "../../read-helpers";
import {
  deleteHelpCategoryAction,
  saveHelpCategoryAction,
} from "../../cms-actions";

export const dynamic = "force-dynamic";


export default async function PagesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("cms");
  const query = await searchParams;
  const [pages, business, t, categories] = await Promise.all([
    listPages.call({}, actor),
    currentBusiness(),
    getT(),
    domainOrNull(helpCategoryList.call({ locale: "en" }, actor)),
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
            className="ms-auto inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-press"
          >
            <Plus size={15} weight="bold" />
            {t("cms.pages.new")}
          </a>
        ) : null}
      </div>

      {query.saved === "help" ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("help.admin.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("help.admin.failed")}
        </p>
      ) : null}

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

      <Card>
        <CardHeader title={t("help.admin.categories")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("help.admin.intro")}</p>
          {categories === null ? (
            <p className="text-sm text-danger">{t("help.admin.failed")}</p>
          ) : categories.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{t("help.admin.categoriesEmpty")}</p>
          ) : (
            <ul className="mt-3 grid list-none gap-2 p-0">
              {categories.map((category) => (
                <li key={category.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <span className="font-medium">{category.name}</span>
                  <span className="font-mono text-xs text-ink-muted">{category.slug}</span>
                  <span className="text-ink-muted">
                    {t("help.admin.articleCount", { count: category.articleCount })}
                  </span>
                  {canManage ? (
                    <form action={deleteHelpCategoryAction} className="ms-auto flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={category.id} />
                      <label className="flex items-center gap-2 text-xs text-ink-muted">
                        <input type="checkbox" name="confirm" value="yes" required />
                        {t("help.admin.deleteCategoryConfirm")}
                      </label>
                      <Button type="submit" variant="danger">
                        {t("help.admin.deleteCategory")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <form action={saveHelpCategoryAction} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="locale" value={business?.defaultLocale ?? "en"} />
              <Field label={t("help.admin.categoryName")} htmlFor="help-name">
                <Input id="help-name" name="name" required maxLength={120} />
              </Field>
              <Field label={t("help.admin.categorySlug")} htmlFor="help-slug">
                <Input id="help-slug" name="slug" required maxLength={80} />
              </Field>
              <Field label={t("help.admin.categoryDescription")} htmlFor="help-description">
                <Input id="help-description" name="description" maxLength={400} />
              </Field>
              <div className="self-end">
                <Button type="submit">{t("help.admin.addCategory")}</Button>
              </div>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
