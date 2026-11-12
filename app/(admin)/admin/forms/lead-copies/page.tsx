// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { listLeadCopyRecovery } from "@/modules/forms/lead-copy-services";
import { Button, Card, CardBody, Field, Input, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import { reviewLeadCopyAction } from "../../../lead-copy-actions";
const PATH = "/admin/forms/lead-copies";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function LeadCopyRecoveryPage({ searchParams }: { searchParams: Promise<{ afterId?: string; saved?: string; error?: string }> }) {
  const actor = await requireStaffActor("forms", "manage"), query = await searchParams, t = await getT();
  const fresh = actor.kind === "user" && !actor.keyScopes && actor.security?.stepUpValid;
  const current = fresh ? await domainOrNull(listLeadCopyRecovery.call({ ...(query.afterId ? { afterId: query.afterId } : {}), limit: 25 }, actor)) : null;
  return <div className="grid min-w-0 gap-6">
    <div><h1 className="text-xl font-bold">{t("forms.leads.title")}</h1><p className="mt-2 max-w-prose text-sm text-ink-muted">{t("forms.leads.intro")}</p></div>
    {query.saved ? <p role="status">{t("forms.leads.saved")}</p> : null}
    {query.error ? <p role="alert" className="text-danger">{t("forms.leads.error")}</p> : null}
    {!fresh ? <a className="underline" href={`/security/verify?returnTo=${encodeURIComponent(PATH)}`}>{t("security.verify.title")}</a> : !current ? <p role="alert">{t("forms.leads.error")}</p> : current.rows.length === 0 ? <p>{t("forms.leads.empty")}</p> : current.rows.map(record => <Card key={record.id}><CardBody>
      <h2 className="break-all font-semibold">{record.originalBaseUrl ?? t("forms.leads.legacy")}</h2>
      <p className="break-all text-sm text-ink-muted">{record.id} · {t(`forms.leads.state.${record.state}`)}</p>
      {!record.originalResourceKnown ? <p className="mt-2 text-sm">{t("forms.leads.legacy")}</p> : null}
      {record.retiredAt ? <p className="mt-2 text-sm">{t(record.remoteErasedAt ? "forms.leads.erased" : "forms.leads.retired")}</p> : null}
      {record.lastError ? <p role="status" className="mt-2 text-sm">{t("forms.leads.pending")}</p> : null}
      <ul className="mt-3 grid gap-2 text-sm">{record.attempts.map(operation => <li key={operation.id} className="break-all"><p>{operation.attempt} · {t(`forms.leads.state.${operation.observed}`)}{operation.humanOutcome ? ` · ${t("forms.leads.reviewed")}: ${t(`forms.leads.state.${operation.humanOutcome}`)}` : ""}</p><p className="text-ink-muted">{operation.id}{operation.httpStatus ? ` · HTTP ${operation.httpStatus}` : ""}</p></li>)}</ul>
      {record.attempts.length ? <form action={reviewLeadCopyAction} className="mt-4 grid min-w-0 gap-3">
        <input type="hidden" name="id" value={record.id} /><input type="hidden" name="expectedRevision" value={record.revision} />
        <Field label={t("forms.leads.operation")} htmlFor={`operation-${record.id}`}><Select id={`operation-${record.id}`} name="operationId" required>{record.attempts.map(operation => <option key={operation.id} value={operation.id}>{operation.attempt} · {operation.id}</option>)}</Select></Field>
        <Field label={t("forms.leads.outcome")} htmlFor={`outcome-${record.id}`}><Select id={`outcome-${record.id}`} name="outcome" required><option value="copied">{t("forms.leads.state.copied")}</option><option value="not_copied">{t("forms.leads.state.not_copied")}</option></Select></Field>
        <Field label={t("forms.leads.reference")} htmlFor={`reference-${record.id}`}><Input id={`reference-${record.id}`} name="providerOperationRef" required maxLength={2000} /></Field>
        {(["originalResourceEvidence", "finalProviderEvidence", "stoppedCallerEvidence", "remoteErasureEvidence"] as const).map(name => <Field key={name} label={t(`forms.leads.${name}`)} htmlFor={`${name}-${record.id}`}><textarea id={`${name}-${record.id}`} name={name} required={name !== "remoteErasureEvidence"} minLength={20} maxLength={4000} rows={3} className="w-full min-w-0 rounded-md border border-rule bg-field p-2" /></Field>)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="ORIGINAL LEAD OUTCOME VERIFIED" required className="mt-1" /><span>{t("forms.leads.confirm")}</span></label>
        <Button type="submit">{t("forms.leads.record")}</Button>
      </form> : null}
      {record.retryAvailable ? <form action={reviewLeadCopyAction} className="mt-4 grid gap-3"><input type="hidden" name="action" value="retry" /><input type="hidden" name="id" value={record.id} /><input type="hidden" name="expectedRevision" value={record.revision} /><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="RETRY ORIGINAL LEAD COPY" required className="mt-1" /><span>{t("forms.leads.retryConfirm")}</span></label><Button type="submit">{t("forms.leads.retry")}</Button></form> : null}
    </CardBody></Card>)}
    {current?.nextCursor ? <a className="underline" href={`${PATH}?afterId=${encodeURIComponent(current.nextCursor)}`}>{t("forms.leads.next")}</a> : null}
  </div>;
}
