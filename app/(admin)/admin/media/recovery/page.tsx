// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: human recovery uses the same service as HTTP and MCP refusals.
import Link from "next/link";
import { listStorageOperations } from "@/core/media/write-recovery";
import { listMultipartOperations } from "@/core/media/multipart-recovery";
import { Card, Callout } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { RecoveryForm, type RecoveryLabels } from "./RecoveryForm";
import { MultipartRecoveryForm, type MultipartRecoveryLabels } from "./MultipartRecoveryForm";

export const dynamic = "force-dynamic";
export default async function StorageRecoveryPage() {
  const actor = await requireStaffActor("media", "manage");
  const [t, { rows }, multipart] = await Promise.all([getT(), listStorageOperations.call({}, actor),listMultipartOperations.call({},actor)]);
  const labels: RecoveryLabels = { namespace: t("media.recovery.namespace"), originalKey:t("media.recovery.originalKey"),sha256: t("media.recovery.sha256"), bytes: t("media.recovery.bytes"), outcome: t("media.recovery.outcome"),
    applied: t("media.recovery.applied"), notApplied: t("media.recovery.notApplied"), reference: t("media.recovery.reference"), evidence: t("media.recovery.evidence"),
    stopped: t("media.recovery.stopped"), confirm: t("media.recovery.confirm"), submit: t("media.recovery.submit"), saved: t("media.recovery.saved") };
  const multipartLabels:MultipartRecoveryLabels={...labels,providerUploadId:t("media.recovery.providerUploadId"),verifyOriginal:t("media.recovery.verifyOriginal"),cleanup:t("media.recovery.cleanup"),multipartConfirm:t("media.recovery.multipartConfirm")};
  const needsStepUp = actor.kind === "user" && actor.security !== undefined && !actor.security.stepUpValid;
  return <div className="grid min-w-0 gap-6">
    <div><h1 className="text-xl font-bold">{t("media.recovery.title")}</h1><p className="mt-2 text-sm text-ink-muted">{t("media.recovery.intro")}</p></div>
    {multipart.rows.some(row=>row.resource.state==="open")?<Callout>{t("media.recovery.partsUnavailable")}</Callout>:null}
    <Link href="/admin/media" className="text-sm font-semibold text-accent underline">{t("media.title")}</Link>
    {needsStepUp ? <Callout><a href="/security/verify?returnTo=%2Fadmin%2Fmedia%2Frecovery" className="underline">{t("media.recovery.verify")}</a></Callout> : null}
    {!rows.length&&!multipart.rows.length ? <Callout>{t("media.recovery.empty")}</Callout> : null}
    {rows.map(row => <Card key={row.id} className="grid min-w-0 gap-4">
      <dl className="grid min-w-0 gap-2 text-sm"><dt className="font-semibold">{t("media.recovery.operation")}</dt><dd>{t(row.operation === "put" ? "media.recovery.put" : "media.recovery.delete")}</dd>
        <dt className="font-semibold">{t("media.recovery.object")}</dt><dd className="break-all font-mono" dir="ltr">{row.key}</dd>
        <dt className="font-semibold">{t("media.recovery.receipt")}</dt><dd className="break-all font-mono" dir="ltr">{row.id}</dd></dl>
      {row.observedAcceptedAt ? <Callout>{t("media.recovery.acknowledged")}</Callout> : null}
      {!needsStepUp ? <RecoveryForm id={row.id} updatedAt={new Date(row.updatedAt).toISOString()} namespace={row.namespace} sha256={row.sha256} bytes={row.bytes} labels={labels} originalKeyRequired={row.key.startsWith("retained:")} /> : null}
    </Card>)}
    {multipart.rows.map(row=><Card key={`${row.resource.id}:${row.operation?.id??"resource"}`} className="grid min-w-0 gap-4">
      <dl className="grid min-w-0 gap-2 text-sm"><dt className="font-semibold">{t("media.recovery.operation")}</dt><dd>{t(row.operation?.kind==="create"?"media.recovery.create":row.operation?.kind==="complete"?"media.recovery.complete":row.operation?.kind==="abort"?"media.recovery.abort":"media.recovery.multipart")}</dd>
        <dt className="font-semibold">{t("media.recovery.object")}</dt><dd className="break-all font-mono" dir="ltr">{row.resource.key}</dd><dt className="font-semibold">{t("media.recovery.receipt")}</dt><dd className="break-all font-mono" dir="ltr">{row.operation?.id??row.resource.id}</dd></dl>
      {row.operation?.providerAcceptedAt?<Callout>{t("media.recovery.acknowledged")}</Callout>:null}
      {!needsStepUp?<MultipartRecoveryForm resourceId={row.resource.id} operationId={row.operation?.id??null} witness={row.witness} namespace={row.resource.namespace} providerUploadId={row.resource.providerUploadId} sha256={row.sha256} bytes={row.bytes} labels={multipartLabels} originalKeyRequired={row.resource.key.startsWith("retained:")}/>:null}
    </Card>)}
  </div>;
}
