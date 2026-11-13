// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { translator } from "@/core/i18n";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { PRORATION_READ_STOP_CONFIRMATION, prorationPaymentReadRecoveryPlan } from "@/modules/subscriptions/proration-card-read-recovery";
import { reviewProrationPaymentReadStoppedAction } from "../proration-card-read-actions";
type Rows = Awaited<ReturnType<typeof prorationPaymentReadRecoveryPlan.call>>;
export function ProrationCardReadRecovery({ rows, locale }: { rows: Rows; locale: string }) {
  const t = translator(locale);
  if (!rows.length) return null;
  return <Card><CardHeader title={t("subscriptions.proration.cardReaderTitle")}/><CardBody>
    <p className="mb-4 text-sm text-ink-muted">{t("subscriptions.proration.cardReaderIntro")}</p>
    <ul className="grid list-none gap-4 p-0">{rows.map(row => <li key={row.readId} className="grid gap-3 rounded-md border border-rule p-3">
      <Pill tone={row.reviewed ? "neutral" : "warning"}>{t(row.reviewed ? "subscriptions.reader.reviewed" : `subscriptions.reader.${row.liveness}`)}</Pill>
      <dl className="grid gap-2 text-sm"><div><dt>{t("subscriptions.reader.identifier")}</dt><dd dir="ltr" className="break-all font-mono">{row.readId}</dd></div>
        <div><dt>{t("subscriptions.reader.caller")}</dt><dd dir="ltr" className="break-all font-mono">{row.callerId}</dd></div></dl>
      {row.reviewed ? <p className="text-sm">{t("subscriptions.proration.cardReaderRecover")}</p> : row.liveness === "live" ? <p className="text-sm">{t("subscriptions.reader.liveHint")}</p> :
        <form action={reviewProrationPaymentReadStoppedAction} className="grid gap-3">
          {["paymentId", "readId", "callerId", "admissionDigest", "sourceRevision"].map(name => <input key={name} type="hidden" name={name} value={row[name as keyof typeof row] as string}/>)}
          <Field htmlFor={`card-reader-evidence-${row.readId}`} label={t("subscriptions.reader.evidence")}><textarea id={`card-reader-evidence-${row.readId}`} name="hostingEvidence" required minLength={30} maxLength={2000} rows={4} className="w-full rounded-md border border-rule bg-surface px-3 py-2 text-sm"/></Field>
          {row.liveness === "unobservable" ? <>
            <Field htmlFor={`card-reader-runtime-${row.readId}`} label={t("subscriptions.reader.runtime")}><Input id={`card-reader-runtime-${row.readId}`} name="stoppedRuntimeReference" required minLength={8} maxLength={300}/></Field>
            <Field htmlFor={`card-reader-stopped-${row.readId}`} label={t("subscriptions.reader.stoppedAt")} hint={t("subscriptions.reader.utcHint")}><Input id={`card-reader-stopped-${row.readId}`} name="stoppedRuntimeAt" placeholder="2026-11-13T12:00:00.000Z" required maxLength={40}/></Field>
          </> : null}
          <Field htmlFor={`card-reader-confirm-${row.readId}`} label={t("subscriptions.reader.confirm")} hint={PRORATION_READ_STOP_CONFIRMATION}><Input id={`card-reader-confirm-${row.readId}`} name="confirmation" required autoComplete="off"/></Field>
          <div><Button type="submit">{t("subscriptions.reader.review")}</Button></div>
        </form>}
    </li>)}</ul>
  </CardBody></Card>;
}
