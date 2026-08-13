// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDateTime } from "@/core/i18n";
import {
  contactPrivacySources,
  getDataRequest,
} from "@/core/privacy/service";
import { ServiceError, hasModuleAccess } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { PrivacyActionForm } from "../PrivacyActionForm";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("privacy.request.details")} · ${t("privacy.title")}`,
    robots: { index: false, follow: false },
  };
}
const OPEN = new Set(["submitted", "verified", "in_progress"]);

export default async function PrivacyRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor("contacts");
  const id = (await params).id;
  let detail: Awaited<ReturnType<typeof getDataRequest.call>>;
  try {
    detail = await getDataRequest.call({ id }, actor);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }
  const [t, business] = await Promise.all([getT(), currentBusiness()]);
  const { request, exceptions, artifact } = detail;
  const canManage = hasModuleAccess(actor, "contacts", "manage");
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const open = OPEN.has(request.status);
  const canFulfill = request.status === "verified" || request.status === "in_progress";
  const stepUpValid = actor.kind === "user" && Boolean(actor.security?.stepUpValid);
  const details = request.details && typeof request.details === "object"
    ? request.details as Record<string, unknown>
    : {};

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/contacts/privacy" className="text-sm text-ink-muted">{t("privacy.request.back")}</a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">{t(`privacy.kind.${request.kind}`)}</h1>
          <Pill>{t(`privacy.status.${request.status}`)}</Pill>
        </div>
        <p className="mt-1 font-mono text-xs text-ink-muted">{request.id}</p>
      </div>

      <Card>
        <CardHeader title={t("privacy.request.details")} />
        <CardBody>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-ink-muted">{t("privacy.contactId")}</dt><dd><a className="underline" href={`/admin/contacts/${request.contactId}`}>{request.contactId}</a></dd></div>
            <div><dt className="text-xs text-ink-muted">{t("privacy.due")}</dt><dd>{formatDateTime(request.responseDueAt, timezone, locale)}</dd></div>
            <div><dt className="text-xs text-ink-muted">{t("privacy.jurisdiction")}</dt><dd>{request.jurisdiction ?? t("common.emptyValue")}</dd></div>
            <div><dt className="text-xs text-ink-muted">{t("privacy.verification")}</dt><dd>{request.verificationMethod ?? t("privacy.unverified")}</dd></div>
            {typeof details.note === "string" ? <div className="sm:col-span-2"><dt className="text-xs text-ink-muted">{t("privacy.note")}</dt><dd>{details.note}</dd></div> : null}
            {details.changes && typeof details.changes === "object" ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-ink-muted">{t("privacy.request.corrections")}</dt>
                <dd>
                  <ul className="mt-1 grid list-none gap-1 p-0">
                    {Object.entries(details.changes as Record<string, unknown>).map(([field, value]) => (
                      <li key={field}><span className="font-mono text-xs">{field}</span>: {value === null
                        ? t("privacy.request.clearField")
                        : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
                          ? String(value)
                          : JSON.stringify(value)}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {request.resolution ? <div className="sm:col-span-2"><dt className="text-xs text-ink-muted">{t("privacy.resolution")}</dt><dd>{request.resolution}</dd></div> : null}
          </dl>
          {artifact && artifact.expiresAt > new Date() ? (
            <a href={`/privacy/artifacts/${artifact.id}`} className="font-semibold text-accent underline">
              {t("privacy.download")} · {t("privacy.checksum")} {artifact.sha256.slice(0, 12)}…
            </a>
          ) : artifact ? <p className="text-sm text-warning">{t("privacy.artifactExpired")}</p> : null}
        </CardBody>
      </Card>

      {canManage && open ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {request.status === "submitted" ? (
            <Card><CardHeader title={t("privacy.verify.title")} /><CardBody>
              <PrivacyActionForm intent="verify" hidden={{ requestId: request.id }} submitLabel={t("privacy.verify.submit")} pendingLabel={t("privacy.working")}>
                <Field label={t("privacy.verify.method")} htmlFor="privacy-verification-method" hint={t("privacy.verify.hint")}>
                  <Input id="privacy-verification-method" name="method" required />
                </Field>
              </PrivacyActionForm>
            </CardBody></Card>
          ) : request.status === "verified" ? (
            <Card><CardHeader title={t("privacy.start.title")} /><CardBody>
              <p className="text-sm text-ink-muted">{t("privacy.start.hint")}</p>
              <PrivacyActionForm intent="start" hidden={{ requestId: request.id }} submitLabel={t("privacy.start.submit")} pendingLabel={t("privacy.working")} />
            </CardBody></Card>
          ) : null}

          <Card><CardHeader title={t("privacy.fulfill.title")} /><CardBody>
            <p className="text-sm text-ink-muted">{request.kind === "erasure" ? t("privacy.fulfill.erasureHint") : t("privacy.fulfill.hint")}</p>
            {!stepUpValid ? <a className="text-sm font-semibold text-accent underline" href={`/security/verify?returnTo=/admin/contacts/privacy/${request.id}`}>{t("privacy.stepUp")}</a> : null}
            <PrivacyActionForm
              intent="fulfill"
              hidden={{ requestId: request.id }}
              submitLabel={t("privacy.fulfill.submit")}
              pendingLabel={t("privacy.working")}
              variant={request.kind === "erasure" ? "danger" : "primary"}
              disabled={!canFulfill || !stepUpValid}
            >
              {request.kind === "erasure" ? (
                <Field label={t("privacy.fulfill.confirmation")} htmlFor="privacy-erasure-confirm" hint={t("privacy.fulfill.confirmationHint")}>
                  <Input id="privacy-erasure-confirm" name="confirmation" required pattern="ERASE" autoComplete="off" />
                </Field>
              ) : null}
            </PrivacyActionForm>
          </CardBody></Card>

          <Card><CardHeader title={t("privacy.deny.title")} /><CardBody>
            <PrivacyActionForm intent="deny" hidden={{ requestId: request.id }} submitLabel={t("privacy.deny.submit")} pendingLabel={t("privacy.working")} variant="quiet">
              <Field label={t("privacy.resolution")} htmlFor="privacy-denial-resolution">
                <textarea id="privacy-denial-resolution" name="resolution" required rows={3} className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm" />
              </Field>
            </PrivacyActionForm>
          </CardBody></Card>
        </div>
      ) : null}

      {request.kind === "erasure" ? (
        <Card>
          <CardHeader title={t("privacy.retention.title")} status={<Pill>{exceptions.length}</Pill>} />
          <CardBody>
            <p className="text-sm text-ink-muted">{t("privacy.retention.hint")}</p>
            {exceptions.length ? <ul className="grid list-none gap-3 p-0">{exceptions.map((item) => (
              <li key={item.id} className="rounded-md border border-rule p-3 text-sm">
                <div className="flex flex-wrap gap-2"><strong>{item.scope}</strong><Pill>{t(`privacy.reason.${item.reason}`)}</Pill></div>
                <p className="mt-1 text-ink-muted">{item.legalBasis}</p>
                {canManage && open ? <PrivacyActionForm intent="remove-retention" hidden={{ exceptionId: item.id, requestId: request.id }} submitLabel={t("privacy.retention.remove")} pendingLabel={t("privacy.working")} variant="quiet" className="mt-3 grid gap-3" /> : null}
              </li>
            ))}</ul> : <p className="text-sm text-ink-muted">{t("privacy.retention.empty")}</p>}
            {canManage && open ? (
              <PrivacyActionForm intent="retain" hidden={{ requestId: request.id }} submitLabel={t("privacy.retention.save")} pendingLabel={t("privacy.working")}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("privacy.retention.scope")} htmlFor="privacy-retention-scope">
                    <Select id="privacy-retention-scope" name="scope">{contactPrivacySources().map((source) => <option key={source.scope} value={source.scope}>{source.scope}</option>)}</Select>
                  </Field>
                  <Field label={t("privacy.retention.reason")} htmlFor="privacy-retention-reason">
                    <Select id="privacy-retention-reason" name="reason">{(["legal_obligation", "legal_claim", "contractual_obligation", "accounting_tax", "security_fraud"] as const).map((reason) => <option key={reason} value={reason}>{t(`privacy.reason.${reason}`)}</option>)}</Select>
                  </Field>
                </div>
                <Field label={t("privacy.retention.legalBasis")} htmlFor="privacy-retention-basis">
                  <textarea id="privacy-retention-basis" name="legalBasis" required rows={3} className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm" />
                </Field>
                <Field label={t("privacy.retention.expiry")} htmlFor="privacy-retention-expiry">
                  <Input id="privacy-retention-expiry" name="expiresAt" type="datetime-local" />
                </Field>
              </PrivacyActionForm>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
