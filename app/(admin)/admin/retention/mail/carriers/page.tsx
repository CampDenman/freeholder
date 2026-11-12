// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { listCarrierGrantRecovery } from "@/core/mail/carrier-services";
import { Button, Card, CardBody, Field, Input } from "@/ui/primitives";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { domainOrNull } from "../../../../read-helpers";
import { confirmCarrierWithdrawalAction } from "../../../../mail-carrier-actions";
const PATH = "/admin/retention/mail/carriers";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function CarrierGrantRecoveryPage({ searchParams }: { searchParams: Promise<{ afterId?: string; saved?: string; error?: string }> }) {
  const actor = await requireStaffActor("mail", "manage"), query = await searchParams, t = await getT();
  const fresh = actor.kind === "user" && !actor.keyScopes && actor.security?.stepUpValid;
  const current = fresh ? await domainOrNull(listCarrierGrantRecovery.call({ ...(query.afterId ? { afterId: query.afterId } : {}), limit: 25 }, actor)) : null;
  return <div className="grid min-w-0 gap-6">
    <div><h1 className="text-xl font-bold">{t("mail.carrier.title")}</h1><p className="mt-2 max-w-prose text-sm text-ink-muted">{t("mail.carrier.intro")}</p></div>
    {query.saved ? <p role="status">{t("mail.recovery.saved")}</p> : null}
    {query.error ? <p role="alert" className="text-danger">{t("mail.recovery.error")}</p> : null}
    {!fresh ? <a className="underline" href={`/security/verify?returnTo=${encodeURIComponent(PATH)}`}>{t("security.verify.title")}</a> : !current ? <p role="alert">{t("admin.retention.mail.unavailable")}</p> : current.rows.length === 0 ? <p>{t("mail.carrier.empty")}</p> : current.rows.map(record => <Card key={record.id}>
      <div className="border-b border-rule bg-surface-muted px-4 py-3"><h2 className="break-all font-semibold">{record.email || t("mail.carrier.erasedAddress")}</h2></div>
      <CardBody>
        <p className="break-all text-sm">{record.originalBaseUrl ?? t("mail.carrier.legacy")}</p>
        <p className="break-all text-sm text-ink-muted">{record.id}</p>
        {!record.originalResourceKnown ? <p className="mt-2 text-sm">{t("mail.carrier.legacy")}</p> : null}
        {record.withdrawalError ? <p role="status" className="mt-2 text-sm">{t("mail.carrier.pending")}</p> : null}
        {record.operations.length ? <ul className="mt-3 grid gap-2 text-sm">{record.operations.map(operation => <li key={operation.id} className="break-all"><span>{t(`mail.carrier.kind.${operation.kind}`)} · {t(`mail.carrier.state.${operation.state}`)}</span><p className="text-ink-muted">{operation.id}{operation.httpStatus ? ` · HTTP ${operation.httpStatus}` : ""}{operation.providerCode ? ` · ${operation.providerCode}` : ""}</p></li>)}</ul> : null}
        <form action={confirmCarrierWithdrawalAction} className="mt-4 grid min-w-0 gap-3">
          <input type="hidden" name="id" value={record.id} /><input type="hidden" name="expectedEmail" value={record.email} /><input type="hidden" name="expectedRevision" value={record.revision} />
          <Field label={t("mail.recovery.operation")} htmlFor={`carrier-operation-${record.id}`}><Input id={`carrier-operation-${record.id}`} name="providerOperationRef" required minLength={8} maxLength={2000} /></Field>
          {(["originalResourceEvidence", "finalProviderEvidence", "stoppedCallerEvidence"] as const).map(name => <Field key={name} label={t(name === "originalResourceEvidence" ? "mail.recovery.originalRouteEvidence" : `mail.recovery.${name}`)} htmlFor={`carrier-${name}-${record.id}`}><textarea id={`carrier-${name}-${record.id}`} name={name} required minLength={20} maxLength={4000} rows={3} className="w-full min-w-0 rounded-md border border-rule bg-field p-2" /></Field>)}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="ORIGINAL CARRIER WITHDRAWAL VERIFIED" required className="mt-1" /><span>{t("mail.carrier.confirm")}</span></label>
          <Button type="submit">{t("mail.carrier.record")}</Button>
        </form>
      </CardBody>
    </Card>)}
    {current?.nextCursor ? <a className="underline" href={`${PATH}?afterId=${encodeURIComponent(current.nextCursor)}`}>{t("mail.recovery.next")}</a> : null}
  </div>;
}
