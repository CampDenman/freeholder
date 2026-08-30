// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Documents: what has been sent to whom (C8.13, MASTER.md §4.5).
import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listDocuments } from "@/modules/documents/service";
import { listContacts } from "@/core/contacts/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { createDocumentAction } from "../../document-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TONE = { draft: "neutral", shared: "success", archived: "neutral" } as const;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStaffActor("documents");
  const query = await searchParams;
  const [t, business, docs, people] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listDocuments.call({ limit: 100 }, actor)),
    domainOrNull(listContacts.call({ limit: 200 }, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const nameOf = new Map((people?.rows ?? []).map((each) => [each.id, each.name]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("documents.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("documents.intro")}</p>
      </div>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("documents.yours")} />
        <CardBody>
          {docs === null ? (
            <p className="text-sm text-danger">{t("documents.unavailable")}</p>
          ) : docs.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("documents.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {docs.map((document) => (
                <li key={document.id} className="grid gap-1 rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <Link href={`/admin/documents/${document.id}`} className="font-medium underline">
                      {document.title}
                    </Link>
                    <Pill tone={TONE[document.status]}>
                      {t(`documents.status.${document.status}`)}
                    </Pill>
                    {document.contactId ? (
                      <span className="text-ink-muted">
                        {nameOf.get(document.contactId) ?? document.contactId}
                      </span>
                    ) : (
                      <span className="text-ink-muted">{t("documents.noContact")}</span>
                    )}
                    {/* No file yet is worth saying: a document with no version
                        cannot be shared, and the reason should not be a
                        surprise at the share button. */}
                    {document.currentVersionId === null ? (
                      <Pill tone="warning">{t("documents.noFile")}</Pill>
                    ) : null}
                    <span className="ms-auto text-ink-muted">{when(document.updatedAt)}</span>
                  </div>
                  {document.description ? (
                    <p className="text-sm text-ink-muted">{document.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("documents.new")} />
        <CardBody>
          <form action={createDocumentAction} className="grid gap-3 md:grid-cols-3">
            <Field label={t("documents.field.title")} htmlFor="title">
              <Input id="title" name="title" required maxLength={200} />
            </Field>
            <Field
              label={t("documents.field.contact")}
              htmlFor="contactId"
              hint={t("documents.field.contactHint")}
            >
              <Select id="contactId" name="contactId" defaultValue="">
                <option value="">—</option>
                {(people?.rows ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("documents.field.description")} htmlFor="description">
              <Input id="description" name="description" maxLength={4000} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("documents.action.create")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
