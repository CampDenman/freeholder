// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Importing a contact list (C7.07, MASTER.md §4.1).
//
// The list of past imports and the place to start a new one. Every batch stays
// here after it has run, because "what did that file do" and "undo it" are
// questions people ask a week later, and an importer that forgets is one nobody
// trusts with a second file.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listContactImports } from "@/core/import/contacts-service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import { beginContactImportAction } from "../../../contact-import-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  mapping: "neutral",
  validated: "accent",
  committed: "success",
  reverted: "warning",
  failed: "danger",
};

export default async function ContactImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("contacts", "manage");
  const [t, business, batches, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listContactImports.call({}, actor)),
    searchParams,
  ]);

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/contacts" className="text-sm text-ink-muted">
          {t("contactImports.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("contactImports.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("contactImports.intro")}</p>
      </div>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("contactImports.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("contactImports.start")} />
        <CardBody>
          <form action={beginContactImportAction} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("contactImports.field.file")}</span>
              <input
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("contactImports.field.source")}</span>
              <input
                name="source"
                defaultValue="import"
                className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <Button type="submit">{t("contactImports.action.read")}</Button>
          </form>
          {/* Nothing is written until the columns are confirmed and the dry run
              has been looked at. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("contactImports.startHint")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("contactImports.past")} />
        <CardBody>
          {batches === null ? (
            <p className="text-sm text-danger">{t("contactImports.unavailable")}</p>
          ) : batches.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("contactImports.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {batches.map((batch) => (
                <li
                  key={batch.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <a href={`/admin/imports/contacts/${batch.id}`} className="font-medium underline">
                    {batch.filename}
                  </a>
                  <Pill tone={STATUS_TONES[batch.status] ?? "neutral"}>
                    {t(`contactImports.status.${batch.status}`)}
                  </Pill>
                  <span className="ms-auto text-ink-muted">{when(batch.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
