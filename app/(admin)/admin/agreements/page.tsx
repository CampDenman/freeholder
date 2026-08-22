// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Agreements and the templates behind them (C6.09, C6.14, MASTER.md §4.3).
//
// Two things on one screen, and the order is deliberate: what is *waiting on
// somebody* first, then the library. An owner opens this page because a
// customer has signed and needs countersigning, not to admire their templates.
//
// The signing links are absent throughout. They are credentials, and a screen
// is the easiest place in the product for one to be photographed.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { listContacts } from "@/core/contacts/service";
import { listContracts } from "@/modules/contracts/service";
import { listTemplates } from "@/modules/contracts/template-service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  archiveTemplateAction,
  countersignAction,
  issueFromTemplateAction,
  saveTemplateAction,
  voidContractAction,
} from "../../contract-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  issued: "warning",
  signed: "success",
  declined: "neutral",
  void: "neutral",
};

/** Enough rows to describe a template's variables without reloading. */
const VARIABLE_ROWS = 4;

export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("contracts");
  const [t, business, documents, templates, people, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listContracts.call({ limit: 100 }, actor)),
    domainOrNull(listTemplates.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
    searchParams,
  ]);

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  // Signed-and-not-yet-countersigned first: that is the only row here that is
  // waiting on the owner.
  const sorted = [...(documents ?? [])].sort(
    (a, b) => (a.status === "signed" ? 0 : 1) - (b.status === "signed" ? 0 : 1),
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("agreements.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("agreements.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("agreements.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("agreements.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("agreements.outstanding")} />
        <CardBody>
          {documents === null ? (
            <p className="text-sm text-danger">{t("agreements.unavailable")}</p>
          ) : sorted.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("agreements.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {sorted.map((document) => (
                <li
                  key={document.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium">{document.title}</span>
                  <Pill tone={STATUS_TONES[document.status] ?? "neutral"}>
                    {t(`agreement.status.${document.status}`)}
                  </Pill>
                  {document.signedAt ? (
                    <span className="text-ink-muted">
                      {t("agreements.signedOn", {
                        name: document.signerName ?? "",
                        when: when(document.signedAt),
                      })}
                    </span>
                  ) : (
                    <span className="text-ink-muted">
                      {t("agreements.issuedOn", { when: when(document.issuedAt) })}
                    </span>
                  )}
                  <a
                    href={`/admin/agreements/${document.id}`}
                    className="ms-auto underline"
                  >
                    {t("agreements.open")}
                  </a>
                  {document.status === "signed" ? (
                    <form action={countersignAction} className="flex items-end gap-2">
                      <input type="hidden" name="id" value={document.id} />
                      <label className="grid gap-1">
                        <span className="sr-only">{t("agreements.field.signer")}</span>
                        <input
                          name="signerName"
                          required
                          placeholder={t("agreements.field.signer")}
                          autoComplete="name"
                          className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                        />
                      </label>
                      <Button type="submit" variant="quiet">
                        {t("agreements.action.countersign")}
                      </Button>
                    </form>
                  ) : null}
                  {document.status === "issued" ? (
                    <form action={voidContractAction}>
                      <input type="hidden" name="id" value={document.id} />
                      <Button type="submit" variant="danger">
                        {t("agreements.action.withdraw")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("agreements.templates")} />
        <CardBody>
          {templates === null ? (
            <p className="text-sm text-danger">{t("agreements.unavailable")}</p>
          ) : templates.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("agreements.noTemplates")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {templates.map((template) => (
                <li
                  key={template.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                >
                  <span className="font-medium">{template.name}</span>
                  <Pill tone="neutral">
                    {t("quote.version", { version: String(template.version) })}
                  </Pill>
                  {template.requiresCountersignature ? (
                    <Pill tone="accent">{t("agreements.mutual")}</Pill>
                  ) : null}
                  <form action={issueFromTemplateAction} className="ms-auto flex items-end gap-2">
                    <input type="hidden" name="templateId" value={template.id} />
                    <label className="grid gap-1">
                      <span className="sr-only">{t("agreements.field.sendTo")}</span>
                      <select
                        name="contactId"
                        required
                        className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                      >
                        {(people?.rows ?? []).map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit" variant="quiet">
                      {t("agreements.action.send")}
                    </Button>
                  </form>
                  <form action={archiveTemplateAction}>
                    <input type="hidden" name="id" value={template.id} />
                    <Button type="submit" variant="quiet">
                      {t("agreements.action.retire")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("agreements.write")} />
        <CardBody>
          <form action={saveTemplateAction} className="grid gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("agreements.field.name")}</span>
                <input
                  name="name"
                  required
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("agreements.field.kind")}</span>
                <select
                  name="kind"
                  className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                >
                  <option value="waiver">{t("agreements.kind.waiver")}</option>
                  <option value="agreement">{t("agreements.kind.agreement")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="requiresCountersignature" />
                <span className="text-ink-muted">{t("agreements.field.mutual")}</span>
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("agreements.field.heading")}</span>
              <input
                name="title"
                required
                className="max-w-prose rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("agreements.field.body")}</span>
              <textarea
                name="body"
                required
                rows={10}
                className="max-w-prose rounded-md border border-rule bg-field px-2 py-1 font-mono text-sm"
              />
            </label>
            {Array.from({ length: VARIABLE_ROWS }, (_, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-sm">
                  <span className="sr-only">{t("agreements.field.variable")}</span>
                  <input
                    name="variableKey"
                    placeholder={t("agreements.field.variable")}
                    className="rounded-md border border-rule bg-field px-2 py-1 font-mono text-sm"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="sr-only">{t("agreements.field.variableLabel")}</span>
                  <input
                    name="variableLabel"
                    placeholder={t("agreements.field.variableLabel")}
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="sr-only">{t("agreements.field.fallback")}</span>
                  <input
                    name="variableFallback"
                    placeholder={t("agreements.field.fallback")}
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
              </div>
            ))}
            <div>
              <Button type="submit">{t("agreements.action.saveTemplate")}</Button>
            </div>
          </form>
          <p className="max-w-prose text-sm text-ink-muted">{t("agreements.writeHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
