// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One agreement and the evidence behind it (C6.09, C6.14, MASTER.md §4.3).
//
// The fingerprints are shown rather than hidden, and the page says what they
// mean. A hash nobody can act on is decoration; a hash beside the words it
// covers, next to a download of both, is something a person can hand to
// somebody else and have checked.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { getContract } from "@/modules/contracts/service";
import { exportContract } from "@/modules/contracts/template-service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const STATUS_TONES: Record<string, Tone> = {
  issued: "warning",
  signed: "success",
  declined: "neutral",
  void: "neutral",
};

export default async function AgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor("contracts");
  const { id } = await params;
  const [t, business, document, file] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(getContract.call({ id }, actor)),
    domainOrNull(exportContract.call({ id }, actor)),
  ]);
  if (!document) notFound();

  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
      new Date(value),
    );

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/agreements" className="text-sm text-ink-muted">
          {t("agreements.back")}
        </a>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
          {document.title}
          <Pill tone={STATUS_TONES[document.status] ?? "neutral"}>
            {t(`agreement.status.${document.status}`)}
          </Pill>
        </h1>
      </div>

      <Card>
        <CardHeader title={t("agreement.terms")} />
        <CardBody>
          {/* The snapshot, exactly as signed. Not re-rendered from a template
              somebody may have rewritten since. */}
          <div className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
            {document.body}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("agreements.evidence")} />
        <CardBody>
          <dl className="grid gap-2 text-sm">
            {document.signedAt ? (
              <>
                <div className="flex gap-2">
                  <dt className="w-44 text-ink-muted">{t("agreements.field.signedBy")}</dt>
                  <dd>{document.signerName ?? t("agreements.erased")}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-44 text-ink-muted">{t("agreements.field.signedAt")}</dt>
                  <dd>{when(document.signedAt)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-44 text-ink-muted">{t("agreements.field.from")}</dt>
                  <dd className="font-mono text-xs">
                    {document.signerIp ?? t("agreements.unrecorded")}
                  </dd>
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <dt className="w-44 text-ink-muted">{t("agreements.field.issuedAt")}</dt>
                <dd>{when(document.issuedAt)}</dd>
              </div>
            )}
            {document.countersignedAt ? (
              <div className="flex gap-2">
                <dt className="w-44 text-ink-muted">{t("agreements.field.countersigned")}</dt>
                <dd>
                  {document.countersignerName ?? t("agreements.erased")} ·{" "}
                  {when(document.countersignedAt)}
                </dd>
              </div>
            ) : null}
            <div className="flex gap-2">
              <dt className="w-44 text-ink-muted">{t("agreements.field.fingerprint")}</dt>
              <dd className="max-w-full overflow-x-auto font-mono text-xs">
                {document.bodyHash}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-44 text-ink-muted">{t("agreements.field.intact")}</dt>
              <dd>
                {/* Recomputed on read rather than trusted. A stored hash nobody
                    checks is a comment with a database column. */}
                {document.bodyIntact
                  ? t("agreements.intactYes")
                  : t("agreements.intactNo")}
              </dd>
            </div>
          </dl>
          <p className="max-w-prose text-sm text-ink-muted">{t("agreements.evidenceHint")}</p>
        </CardBody>
      </Card>

      {file ? (
        <Card>
          <CardHeader title={t("agreements.copy")} />
          <CardBody>
            {/* Rendered inline rather than offered as a download: the sandboxed
                admin has no reliable save, and a person can select and copy
                what they can see. */}
            <pre className="max-h-96 overflow-auto rounded-md border border-rule bg-field p-3 font-mono text-xs">
              {file.body}
            </pre>
            <p className="max-w-prose text-sm text-ink-muted">{t("agreements.copyHint")}</p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
