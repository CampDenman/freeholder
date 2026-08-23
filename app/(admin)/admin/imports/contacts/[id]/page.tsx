// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One contact import: map → dry run → apply → undo (C7.07, MASTER.md §4.1).
//
// The three steps are on one page because they are one decision made in stages,
// and a wizard that hid the earlier steps would stop an owner going back to fix
// a column after seeing what it did to the numbers.
//
// The dry run is the point of the screen. It says exactly how many people would
// be created, how many changed, how many left alone and how many rows the
// importer cannot use — before anything is written, and computed by the same
// code that will do the writing.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { getContactImport, IMPORTABLE_FIELDS } from "@/core/import/contacts-service";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { domainOrNull } from "../../../../read-helpers";
import {
  commitContactImportAction,
  mapContactImportAction,
  revertContactImportAction,
} from "../../../../contact-import-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const OUTCOME_TONES: Record<string, Tone> = {
  create: "success",
  update: "accent",
  unchanged: "neutral",
  skip: "neutral",
  error: "danger",
};

export default async function ContactImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; outcome?: string }>;
}) {
  const actor = await requireStaffActor("contacts", "manage");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [t, business, batch] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(getContactImport.call({ id, limit: 200 }, actor)),
  ]);
  if (!batch) notFound();

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  const counts = (batch.counts ?? {}) as Record<string, number>;
  const problems = batch.rows.filter((line) => line.outcome === "error");

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/imports/contacts" className="text-sm text-ink-muted">
          {t("contactImports.back2")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{batch.filename}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          <Pill tone={batch.status === "committed" ? "success" : "neutral"}>
            {t(`contactImports.status.${batch.status}`)}
          </Pill>
          <span>{when(batch.createdAt)}</span>
          {batch.committedAt ? (
            <span>{t("contactImports.appliedAt", { when: when(batch.committedAt) })}</span>
          ) : null}
        </p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t(`contactImports.saved.${query.saved}`)}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("contactImports.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("contactImports.columns")} />
        <CardBody>
          <form action={mapContactImportAction} className="grid gap-3">
            <input type="hidden" name="id" value={batch.id} />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule bg-surface-muted">
                    <th className="px-3 py-2 text-start font-mono text-xs text-ink-muted">
                      {t("contactImports.column.header")}
                    </th>
                    <th className="px-3 py-2 text-start font-mono text-xs text-ink-muted">
                      {t("contactImports.column.sample")}
                    </th>
                    <th className="px-3 py-2 text-start font-mono text-xs text-ink-muted">
                      {t("contactImports.column.means")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {batch.headers.map((header, index) => (
                    <tr key={`${header}-${index}`} className="border-b border-rule last:border-b-0">
                      <td className="px-3 py-2 font-medium">{header}</td>
                      {/* The first row's value, because a header alone rarely
                          settles what a column is. */}
                      <td className="px-3 py-2 text-ink-muted">
                        {batch.rows[0]?.cells[index] ?? ""}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          name="mapping"
                          defaultValue={batch.mapping[index] ?? "ignore"}
                          disabled={batch.status === "committed" || batch.status === "reverted"}
                          className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                        >
                          {IMPORTABLE_FIELDS.map((field) => (
                            <option key={field} value={field}>
                              {t(`contactImports.field.${field}`)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {batch.status === "committed" || batch.status === "reverted" ? null : (
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("contactImports.field.source")}</span>
                  <input
                    name="source"
                    defaultValue={batch.source}
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <Button type="submit">{t("contactImports.action.check")}</Button>
              </div>
            )}
          </form>
        </CardBody>
      </Card>

      {batch.status === "mapping" ? null : (
        <Card>
          <CardHeader title={t("contactImports.dryRun")} />
          <CardBody>
            {/* Computed by the same code that does the writing, so this is a
                promise rather than an estimate. */}
            <ul className="flex flex-wrap list-none gap-4 p-0 text-sm">
              {(["create", "update", "unchanged", "skip", "error"] as const).map((outcome) => (
                <li key={outcome} className="flex items-center gap-2">
                  <Pill tone={OUTCOME_TONES[outcome] ?? "neutral"}>
                    {t(`contactImports.outcome.${outcome}`)}
                  </Pill>
                  <span className="tabular-nums">{counts[outcome] ?? 0}</span>
                </li>
              ))}
            </ul>

            {problems.length > 0 ? (
              <div className="grid gap-1">
                <p className="text-sm font-medium">{t("contactImports.problems")}</p>
                <ul className="grid list-none gap-1 p-0 text-sm">
                  {problems.slice(0, 20).map((line) => (
                    <li key={line.id} className="flex flex-wrap items-baseline gap-2">
                      {/* The line in the file, so the message points at
                          something the owner can open and fix. */}
                      <span className="font-mono text-xs text-ink-muted tabular-nums">
                        {t("contactImports.line", { line: String(line.lineNumber) })}
                      </span>
                      <span className="text-ink-muted">{line.errors.join(" ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {batch.status === "validated" ? (
              <form action={commitContactImportAction}>
                <input type="hidden" name="id" value={batch.id} />
                <Button type="submit">{t("contactImports.action.apply")}</Button>
              </form>
            ) : null}
            {batch.status === "committed" ? (
              <form action={revertContactImportAction} className="grid gap-2">
                <input type="hidden" name="id" value={batch.id} />
                <Button type="submit" variant="quiet">
                  {t("contactImports.action.undo")}
                </Button>
                {/* Anybody who has done business with you since is kept. */}
                <p className="max-w-prose text-sm text-ink-muted">
                  {t("contactImports.undoHint")}
                </p>
              </form>
            ) : null}
            {batch.status === "reverted" ? (
              <p className="max-w-prose text-sm text-ink-muted">
                {t("contactImports.reverted", {
                  restored: String(counts.restored ?? 0),
                  deleted: String(counts.deleted ?? 0),
                  kept: String(counts.kept ?? 0),
                })}
              </p>
            ) : null}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t("contactImports.rows")} />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule bg-surface-muted">
                  <th className="px-3 py-2 text-start font-mono text-xs text-ink-muted">
                    {t("contactImports.column.line")}
                  </th>
                  <th className="px-3 py-2 text-start font-mono text-xs text-ink-muted">
                    {t("contactImports.column.email")}
                  </th>
                  <th className="px-3 py-2 text-start font-mono text-xs text-ink-muted">
                    {t("contactImports.column.outcome")}
                  </th>
                  <th className="px-3 py-2 text-start font-mono text-xs text-ink-muted">
                    {t("contactImports.column.changes")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {batch.rows.map((line) => (
                  <tr key={line.id} className="border-b border-rule last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs tabular-nums">{line.lineNumber}</td>
                    <td className="px-3 py-2">
                      {line.contactId ? (
                        <a href={`/admin/contacts/${line.contactId}`} className="underline">
                          {line.email ?? ""}
                        </a>
                      ) : (
                        (line.email ?? "")
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone={OUTCOME_TONES[line.outcome] ?? "neutral"}>
                        {t(`contactImports.outcome.${line.outcome}`)}
                      </Pill>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {Object.keys((line.changes ?? {}) as Record<string, unknown>).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
