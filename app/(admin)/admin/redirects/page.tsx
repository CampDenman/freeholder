// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Manual redirects (C11.09 F04, MASTER.md §5). Page renames already write
// these through `cms.updatePage`; this screen is for the ones an owner types.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/ui/primitives";
import { hasModuleAccess } from "@/core/service";
import { listRedirects } from "@/core/seo/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { deleteRedirectAction, recordRedirectAction } from "../../seo-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function RedirectsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("seo");
  const query = await searchParams;
  const canManage = hasModuleAccess(actor, "seo", "manage");
  const [t, rows] = await Promise.all([
    getT(),
    domainOrNull(listRedirects.call({}, actor)),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("seo.redirects.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("seo.redirects.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("seo.redirects.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("seo.redirects.failed")}
        </p>
      ) : null}
      {!canManage ? (
        <p className="text-sm text-ink-muted">{t("seo.redirects.readOnly")}</p>
      ) : null}

      <Card>
        <CardHeader title={t("seo.redirects.list")} />
        <CardBody>
          {rows === null ? (
            <p className="text-sm text-danger">{t("seo.redirects.unavailable")}</p>
          ) : rows.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("seo.redirects.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <span className="font-mono">/{row.fromPath}</span>
                  <span className="text-ink-muted">→</span>
                  <span className="font-mono">/{row.toPath}</span>
                  <span className="text-ink-muted">
                    {row.status === "301" ? t("seo.redirects.permanent") : t("seo.redirects.temporary")}
                  </span>
                  <span className="text-xs text-ink-muted">{row.source}</span>
                  {canManage ? (
                    <form action={deleteRedirectAction} className="ms-auto flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={row.id} />
                      <label className="flex items-center gap-2 text-xs text-ink-muted">
                        <input type="checkbox" name="confirm" value="yes" required />
                        {t("seo.redirects.deleteConfirm")}
                      </label>
                      <Button type="submit" variant="danger">
                        {t("seo.redirects.delete")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title={t("seo.redirects.add")} />
          <CardBody>
            <form action={recordRedirectAction} className="grid gap-4 sm:grid-cols-2">
              <Field label={t("seo.redirects.from")} htmlFor="fromPath">
                <Input id="fromPath" name="fromPath" required />
              </Field>
              <Field label={t("seo.redirects.to")} htmlFor="toPath">
                <Input id="toPath" name="toPath" required />
              </Field>
              <Field label={t("seo.redirects.status")} htmlFor="status">
                <Select id="status" name="status" defaultValue="301">
                  <option value="301">{t("seo.redirects.permanent")}</option>
                  <option value="302">{t("seo.redirects.temporary")}</option>
                </Select>
              </Field>
              <div className="self-end">
                <Button type="submit">{t("seo.redirects.add")}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
