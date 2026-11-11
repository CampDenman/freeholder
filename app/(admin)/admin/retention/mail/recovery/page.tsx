// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { listMailDispatchRecovery } from "@/core/mail/dispatch-services";
import { Button, Card, CardBody, Field, Input, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { domainOrNull } from "../../../../read-helpers";
import { reconcileMailDispatchAction, retryReconciledMailAction } from "../../../../mail-dispatch-actions";

const PATH = "/admin/retention/mail/recovery";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function MailDispatchRecoveryPage({ searchParams }: { searchParams: Promise<{ afterId?: string; saved?: string; error?: string }> }) {
  const actor = await requireStaffActor("mail", "manage"), query = await searchParams, t = await getT(), locale = await getLocale();
  const fresh = actor.kind === "user" && !actor.keyScopes && actor.security?.stepUpValid;
  const current = fresh ? await domainOrNull(listMailDispatchRecovery.call({ ...(query.afterId ? { afterId: query.afterId } : {}), limit: 25 }, actor)) : null;
  return <div className="grid min-w-0 gap-6">
    <div><h1 className="text-xl font-bold">{t("mail.recovery.title")}</h1><p className="mt-2 max-w-prose text-sm text-ink-muted">{t("mail.recovery.intro")}</p></div>
    {query.saved ? <p role="status">{t(query.saved === "retry" ? "mail.recovery.retrySaved" : "mail.recovery.saved")}</p> : null}
    {query.error ? <p role="alert" className="text-danger">{t("mail.recovery.error")}</p> : null}
    {!fresh ? <a className="underline" href={`/security/verify?returnTo=${encodeURIComponent(PATH)}`}>{t("security.verify.title")}</a> : !current ? <p role="alert">{t("admin.retention.mail.unavailable")}</p> : current.rows.length === 0 ? <p>{t("mail.recovery.empty")}</p> : current.rows.map(record => {
      const pending = record.dispatches.filter(item => item.state === "running" || item.state === "unknown");
      const reviewIds = record.legacy ? [undefined] : pending.map(item => item.id);
      const canRetry = !record.retryQueued && !record.legacy && record.dispatches.length > 0 && record.dispatches.every(item => item.state === "not_submitted");
      return <Card key={record.deliveryId}>
        <div className="border-b border-rule bg-surface-muted px-4 py-3"><h2 className="break-all font-semibold">{record.recipient}</h2></div>
        <CardBody>
          <p className="break-words">{record.subject}</p><p className="text-sm text-ink-muted">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(record.createdAt)}</p>
          {record.originalRoute ? <div className="mt-3 text-sm"><h3 className="font-semibold">{t("mail.recovery.route")}</h3><p className="break-all">{record.originalRoute.provider} · {record.originalRoute.host} {record.originalRoute.port ? `:${record.originalRoute.port}` : ""}</p><p className="break-all">{record.originalRoute.user ?? record.originalRoute.providerAccountId ?? record.originalRoute.from}</p><p className="break-all">{record.deliveryId}</p></div> : <p className="mt-3 text-sm text-ink-muted">{t("mail.recovery.legacy")}</p>}
          {reviewIds.map(dispatchId => <form key={dispatchId ?? "legacy"} action={reconcileMailDispatchAction} className="mt-4 grid min-w-0 gap-3">
            <input type="hidden" name="deliveryId" value={record.deliveryId} /><input type="hidden" name="expectedAttempts" value={record.attempts} /><input type="hidden" name="expectedRecipient" value={record.recipient} /><input type="hidden" name="expectedProviderRef" value={record.providerRef ?? ""} />
            {dispatchId ? <><input type="hidden" name="dispatchId" value={dispatchId} /><p className="break-all text-sm text-ink-muted">{dispatchId}</p></> : null}
            {dispatchId && record.dispatches.find(item => item.id === dispatchId)?.replyProviderRef ? <div role="alert" className="text-sm text-danger"><p>{t(record.dispatches.find(item => item.id === dispatchId)?.initialReviewedAt ? "mail.recovery.changed" : "mail.recovery.observedReply")}</p><p className="break-all">{record.dispatches.find(item => item.id === dispatchId)?.replyProviderRef}</p></div> : null}
            <Field label={t("mail.recovery.outcome")} htmlFor={`mail-outcome-${dispatchId ?? record.deliveryId}`}><Select id={`mail-outcome-${dispatchId ?? record.deliveryId}`} name="outcome" defaultValue="" required><option value="">{t("mail.recovery.choose")}</option><option value="not_submitted" disabled={Boolean(dispatchId && record.dispatches.find(item => item.id === dispatchId)?.replyProviderRef)}>{t("mail.recovery.notSubmitted")}</option><option value="submitted">{t("mail.recovery.submitted")}</option></Select></Field>
            <Field label={t("mail.recovery.operation")} htmlFor={`mail-operation-${dispatchId ?? record.deliveryId}`}><Input id={`mail-operation-${dispatchId ?? record.deliveryId}`} name="providerOperationRef" required minLength={8} maxLength={2000} /></Field>
            {(["originalRouteEvidence", "finalProviderEvidence", "stoppedCallerEvidence"] as const).map(name => <Field key={name} label={t(`mail.recovery.${name}`)} htmlFor={`mail-${name}-${dispatchId ?? record.deliveryId}`}><textarea id={`mail-${name}-${dispatchId ?? record.deliveryId}`} name={name} required minLength={20} maxLength={4000} rows={3} className="w-full min-w-0 rounded-md border border-rule bg-field p-2" /></Field>)}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="ORIGINAL PROVIDER OUTCOME VERIFIED" required className="mt-1" /><span>{t("mail.recovery.confirm")}</span></label>
            <Button type="submit">{t("mail.recovery.record")}</Button>
          </form>)}
          {record.retryQueued ? <p className="mt-3 text-sm">{t("mail.recovery.retrySaved")}</p> : null}
          {canRetry ? <form action={retryReconciledMailAction} className="mt-4 grid gap-3"><input type="hidden" name="deliveryId" value={record.deliveryId} /><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="RETRY THE ORIGINAL MESSAGE" required className="mt-1" /><span>{t("mail.recovery.retryConfirm")}</span></label><Button type="submit">{t("mail.recovery.retry")}</Button></form> : null}
        </CardBody>
      </Card>;
    })}
    {current?.nextCursor ? <a className="underline" href={`${PATH}?afterId=${encodeURIComponent(current.nextCursor)}`}>{t("mail.recovery.next")}</a> : null}
  </div>;
}
