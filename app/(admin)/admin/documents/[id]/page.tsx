// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One document: its revisions, who may open it, and who has
// (C8.13, MASTER.md §4.5).
//
// The access history is the reason this screen exists. §4.5: "'prove you sent
// it' is the reason this exists" — so the log is on the page rather than
// behind an export, it shows denials as well as opens, and it says which of
// the four refusals it was.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listAssets } from "@/core/media/service";
import { listContacts } from "@/core/contacts/service";
import {
  accessHistory,
  listDocuments,
  shares,
  versions,
} from "@/modules/documents/service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  addVersionAction,
  revokeShareAction,
  saveDocumentAction,
  shareDocumentAction,
} from "../../../document-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; token?: string }>;
}) {
  const actor = await requireStaffActor("documents", "manage");
  const { id } = await params;
  const query = await searchParams;

  const [t, business, all, history, shared, opens, library, people] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listDocuments.call({ limit: 200 }, actor)),
    domainOrNull(versions.call({ documentId: id }, actor)),
    domainOrNull(shares.call({ documentId: id }, actor)),
    domainOrNull(accessHistory.call({ documentId: id }, actor)),
    domainOrNull(listAssets.call({ kind: "doc", limit: 100 }, actor)),
    domainOrNull(listContacts.call({ limit: 200 }, actor)),
  ]);

  const document = (all ?? []).find((each) => each.id === id);
  if (!document) notFound();

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  const nameOf = new Map((people?.rows ?? []).map((each) => [each.id, each.name]));

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/documents" className="text-sm underline">
          {t("documents.back")}
        </Link>
        <h1 className="text-xl font-bold tracking-tight">{document.title}</h1>
        <Pill tone={document.status === "shared" ? "success" : "neutral"}>
          {t(`documents.status.${document.status}`)}
        </Pill>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("documents.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      {/* Once, and never again. §4.5 stores only the HMAC, so there is no
          service that can read a token back — if it is not copied now, the
          remedy is a new share. Better said plainly than discovered. */}
      {query.token ? (
        <Callout tone="warning">
          <p className="font-medium">{t("documents.tokenOnce")}</p>
          <code className="mt-1 block break-all font-mono text-xs">{query.token}</code>
        </Callout>
      ) : null}

      <Card>
        <CardHeader title={t("documents.versions")} />
        <CardBody>
          {history === null || history.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("documents.noVersions")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {history.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium tabular-nums">v{version.version}</span>
                  {document.currentVersionId === version.id ? (
                    <Pill tone="success">{t("documents.current")}</Pill>
                  ) : null}
                  <span className="text-ink-muted">{version.note ?? "—"}</span>
                  <span className="ms-auto text-ink-muted">{when(version.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}

          <form action={addVersionAction} className="mt-3 grid gap-3 md:grid-cols-3">
            <input type="hidden" name="documentId" value={document.id} />
            <Field
              label={t("documents.field.file")}
              htmlFor="assetId"
              hint={t("documents.field.fileHint")}
            >
              <Select id="assetId" name="assetId" required defaultValue="">
                <option value="">—</option>
                {(library?.rows ?? []).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.filename}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("documents.field.note")} htmlFor="note">
              <Input id="note" name="note" maxLength={2000} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("documents.action.addVersion")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("documents.shares")} />
        <CardBody>
          {shared === null || shared.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("documents.noShares")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {shared.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <Pill tone="accent">{t(`documents.access.${entry.access}`)}</Pill>
                  {entry.contactId ? (
                    <span>{nameOf.get(entry.contactId) ?? entry.contactId}</span>
                  ) : (
                    <span className="text-ink-muted">{t("documents.anyoneWithLink")}</span>
                  )}
                  <span className="text-ink-muted">
                    {t(`documents.policy.${entry.downloadPolicy}`)}
                  </span>
                  {entry.pinnedVersionId ? (
                    <Pill tone="neutral">{t("documents.pinned")}</Pill>
                  ) : null}
                  {entry.expiresAt ? (
                    <span className="text-ink-muted">
                      {t("documents.until", { when: when(entry.expiresAt) })}
                    </span>
                  ) : null}
                  {entry.revokedAt ? (
                    <Pill tone="danger">{t("documents.revoked")}</Pill>
                  ) : (
                    <form action={revokeShareAction} className="ms-auto">
                      <input type="hidden" name="documentId" value={document.id} />
                      <input type="hidden" name="shareId" value={entry.id} />
                      <Button type="submit" variant="quiet">
                        {t("documents.action.revoke")}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form action={shareDocumentAction} className="mt-3 grid gap-3 md:grid-cols-3">
            <input type="hidden" name="documentId" value={document.id} />
            <Field label={t("documents.field.access")} htmlFor="access">
              <Select id="access" name="access" defaultValue="link">
                <option value="link">{t("documents.access.link")}</option>
                <option value="password">{t("documents.access.password")}</option>
                <option value="login">{t("documents.access.login")}</option>
              </Select>
            </Field>
            <Field label={t("documents.field.password")} htmlFor="password">
              <Input id="password" name="password" type="password" minLength={6} />
            </Field>
            <Field label={t("documents.field.contact")} htmlFor="shareContact">
              <Select id="shareContact" name="contactId" defaultValue={document.contactId ?? ""}>
                <option value="">—</option>
                {(people?.rows ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("documents.field.pinned")}
              htmlFor="pinnedVersionId"
              hint={t("documents.field.pinnedHint")}
            >
              <Select id="pinnedVersionId" name="pinnedVersionId" defaultValue="">
                <option value="">{t("documents.followCurrent")}</option>
                {(history ?? []).map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("documents.field.policy")} htmlFor="downloadPolicy">
              <Select id="downloadPolicy" name="downloadPolicy" defaultValue="download">
                <option value="download">{t("documents.policy.download")}</option>
                <option value="view">{t("documents.policy.view")}</option>
                <option value="none">{t("documents.policy.none")}</option>
              </Select>
            </Field>
            <Field label={t("documents.field.downloadLimit")} htmlFor="downloadLimit">
              <Input id="downloadLimit" name="downloadLimit" type="number" min={1} />
            </Field>
            <Field label={t("documents.field.expiresAt")} htmlFor="expiresAt">
              <Input id="expiresAt" name="expiresAt" type="date" />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("documents.action.share")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("documents.history")} />
        <CardBody>
          {opens === null || opens.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("documents.noOpens")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {opens.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <Pill tone={entry.action === "denied" ? "danger" : "success"}>
                    {t(`documents.action.${entry.action}`)}
                  </Pill>
                  {/* Which of the four refusals it was. An access log of
                      successes alone cannot answer the question a dispute
                      actually asks. */}
                  {entry.reason ? (
                    <span className="text-ink-muted">
                      {t(`documents.reason.${entry.reason}`)}
                    </span>
                  ) : null}
                  {entry.contactId ? (
                    <span>{nameOf.get(entry.contactId) ?? entry.contactId}</span>
                  ) : null}
                  <span className="ms-auto text-ink-muted">{when(entry.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("documents.settings")} />
        <CardBody>
          <form action={saveDocumentAction} className="grid gap-3 md:grid-cols-3">
            <input type="hidden" name="id" value={document.id} />
            <Field label={t("documents.field.title")} htmlFor="title">
              <Input id="title" name="title" defaultValue={document.title} required />
            </Field>
            <Field label={t("documents.field.contact")} htmlFor="contactId">
              <Select id="contactId" name="contactId" defaultValue={document.contactId ?? ""}>
                <option value="">—</option>
                {(people?.rows ?? []).map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("documents.field.status")} htmlFor="status">
              <Select id="status" name="status" defaultValue={document.status}>
                <option value="draft">{t("documents.status.draft")}</option>
                <option value="shared">{t("documents.status.shared")}</option>
                <option value="archived">{t("documents.status.archived")}</option>
              </Select>
            </Field>
            <Field label={t("documents.field.description")} htmlFor="description">
              <Input id="description" name="description" defaultValue={document.description ?? ""} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{t("documents.action.save")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
