// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: observable birth, exact reviewed evidence, independent next GET.
import { translator } from "@/core/i18n";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { PROVIDER_READER_STOP_CONFIRMATION, type providerReaderRecoveryPlan } from "@/modules/subscriptions/provider-reader-recovery";
import { recoverProviderReaderAction, reviewProviderReaderStoppedAction } from "../provider-reader-actions";
type Rows = Awaited<ReturnType<typeof providerReaderRecoveryPlan.call>>;
export function ProviderReaderRecovery({ subscriptionId, rows, locale }: { subscriptionId: string; rows: Rows; locale: string }) {
  const t = translator(locale);
  if (!rows.length) return null;
  return <Card><CardHeader title={t("subscriptions.reader.title")}/><CardBody><p className="mb-4 text-sm text-ink-muted">{t("subscriptions.reader.intro")}</p>
    <ul className="grid list-none gap-4 p-0">{rows.map(row => <li key={row.readId} className="grid gap-3 rounded-md border border-rule p-3">
      <Pill tone={row.reviewed ? "neutral" : "warning"}>{t(row.reviewed ? "subscriptions.reader.reviewed" : `subscriptions.reader.${row.liveness}`)}</Pill>
      <dl className="grid gap-2 text-sm"><div><dt>{t("subscriptions.reader.identifier")}</dt><dd dir="ltr" className="break-all font-mono">{row.readId}</dd></div>
        <div><dt>{t("subscriptions.reader.caller")}</dt><dd dir="ltr" className="break-all font-mono">{row.callerId}</dd></div></dl>
      {row.historicalBirthUnknown ? <p className="text-sm text-ink-muted">{t("subscriptions.reader.historical")}</p> : null}
      {row.reviewed ? row.canRecover ? <form action={recoverProviderReaderAction}><input type="hidden" name="subscriptionId" value={subscriptionId}/><input type="hidden" name="operationId" value={row.operationId}/><Button type="submit">{t("subscriptions.reader.recover")}</Button></form>
        : <p className="text-sm">{t("subscriptions.reader.completed")}</p> : row.liveness === "live" ? <p className="text-sm">{t("subscriptions.reader.liveHint")}</p>
        : <form action={reviewProviderReaderStoppedAction} className="grid gap-3">
          <input type="hidden" name="subscriptionId" value={subscriptionId}/>{["operationId", "readId", "callerId", "admissionDigest", "sourceRevision"].map(name => <input key={name} type="hidden" name={name} value={row[name as keyof typeof row] as string}/>)}
          <Field htmlFor={`reader-evidence-${row.readId}`} label={t("subscriptions.reader.evidence")}><textarea id={`reader-evidence-${row.readId}`} name="hostingEvidence" required minLength={30} maxLength={2000} rows={4} className="w-full rounded-md border border-rule bg-surface px-3 py-2 text-sm"/></Field>
          {row.liveness === "unobservable" ? <>
            <Field htmlFor={`reader-runtime-${row.readId}`} label={t("subscriptions.reader.runtime")}><Input id={`reader-runtime-${row.readId}`} name="stoppedRuntimeReference" required minLength={8} maxLength={300}/></Field>
            <Field htmlFor={`reader-stopped-${row.readId}`} label={t("subscriptions.reader.stoppedAt")} hint={t("subscriptions.reader.utcHint")}><Input id={`reader-stopped-${row.readId}`} name="stoppedRuntimeAt" placeholder="2026-11-13T12:00:00.000Z" required maxLength={40}/></Field>
          </> : null}
          <Field htmlFor={`reader-confirm-${row.readId}`} label={t("subscriptions.reader.confirm")} hint={PROVIDER_READER_STOP_CONFIRMATION}><Input id={`reader-confirm-${row.readId}`} name="confirmation" required autoComplete="off"/></Field>
          <div><Button type="submit">{t("subscriptions.reader.review")}</Button></div>
        </form>}
    </li>)}</ul>
  </CardBody></Card>;
}
