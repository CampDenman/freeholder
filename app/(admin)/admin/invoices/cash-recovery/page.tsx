// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual original cash, explicit human money and hosting review.
import { hasModuleAccess, ServiceError } from "@/core/service";
import { originalCashReturnRecovery } from "@/modules/invoicing/original-cash-recovery-read";
import { ORIGINAL_CASH_RETURN_CONFIRMATION, ORIGINAL_CASH_STOP_CONFIRMATION } from "@/modules/invoicing/original-cash-recovery-proof";
import { Button, Callout, Card, CardBody, Field } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { money } from "../format";
import { originalCashRecoveryAction } from "./actions";
import { ORIGINAL_PARTIAL_CASH_CONFIRMATION, ORIGINAL_UNASSIGNED_CASH_CONFIRMATION } from "@/modules/invoicing/original-cash-partial-contract";
import { cashInspectionRecoveryList, cashInspectionRecoveryPlan } from "@/modules/invoicing/merchant-cash-inspection-stop-service";
import { CashInspectionRecovery } from "../../../../components/CashInspectionRecovery";
export const dynamic = "force-dynamic";
export default async function OriginalCashRecoveryPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; inspection?: string }> }) {
  const actor = await requireStaffActor("invoicing"), [rows, t, query] = await Promise.all([originalCashReturnRecovery.call({}, actor), getT(), searchParams]);
  const manage = hasModuleAccess(actor, "invoicing", "manage"), human = manage && actor.kind === "user" && !actor.keyScopes;
  const inspections = human ? await cashInspectionRecoveryList.call({}, actor) : [];
  let inspectionPlan: Awaited<ReturnType<typeof cashInspectionRecoveryPlan.call>> | null = null, changed = false;
  if (human && query.inspection) {
    if (!inspections.some(row => row.inspectionId === query.inspection)) changed = true;
    else try { inspectionPlan = await cashInspectionRecoveryPlan.call({ inspectionId: query.inspection }, actor); }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") changed = true; else throw error; }
  }
  return <div className="grid gap-6"><a href="/admin/invoices" className="underline">{t("cashRecovery.back")}</a>
    <h1 className="text-xl font-semibold">{t("cashRecovery.title")}</h1><p>{t("cashRecovery.help")}</p>
    {query.error ? <Callout tone="danger">{t("cashRecovery.error")}</Callout> : null}{query.saved ? <Callout tone="success">{t("cashRecovery.saved")}</Callout> : null}
    {human ? <CashInspectionRecovery rows={inspections} plan={inspectionPlan} changed={changed} t={t}/> : null}
    {!rows.length ? <p>{t("cashRecovery.empty")}</p> : rows.map(row => {
      const sourceId = row.source.kind === "subscription" ? row.source.receiptId : row.source.paymentId;
      return <Card key={row.recoveryId ?? `${sourceId}:${row.source.observationId ?? "original"}`}><CardBody><div className="grid gap-4">
        <h2 className="font-semibold">{money(row.amountMinor, row.currency)} · <bdi>{sourceId}</bdi></h2><p>{t(row.closed ? "cashRecovery.closed" : row.partialConfirmed?"cashRecovery.partialClosed":"cashRecovery.pending")}</p>{row.partialConfirmed?<p>{t("cashRecovery.partialTotal",{amount:money(row.confirmedReturnedMinor,row.currency)})}</p>:null}
        {manage && row.recoveryId ? <form action={originalCashRecoveryAction}><input type="hidden" name="intent" value="inspect"/><input type="hidden" name="recoveryId" value={row.recoveryId}/><Button type="submit">{t("cashRecovery.inspect")}</Button></form> : null}
        {human&&row.partialPaymentId?<form action={originalCashRecoveryAction} className="grid gap-3"><input type="hidden" name="intent" value="partial"/><input type="hidden" name="paymentId" value={row.partialPaymentId}/><p>{t("cashRecovery.partialHelp")}</p><label className="flex items-start gap-2"><input type="checkbox" name="confirmation" value={ORIGINAL_PARTIAL_CASH_CONFIRMATION} required/><span>{t("cashRecovery.partialConfirm")}</span></label><Button type="submit">{t("cashRecovery.partial")}</Button></form>:null}
        {human&&row.recoveryId?row.unassigned.map(resource=><form key={resource.rawFactId} action={originalCashRecoveryAction} className="grid gap-3 rounded border border-rule p-3"><input type="hidden" name="intent" value="reviewUnassigned"/><input type="hidden" name="recoveryId" value={row.recoveryId!}/><input type="hidden" name="operationId" value={resource.operationId}/><input type="hidden" name="rawFactId" value={resource.rawFactId}/><p>{t("cashRecovery.unassignedHelp")}</p><p><bdi>{resource.providerRef}</bdi> · {money(resource.amountMinor,resource.currency)}</p><label className="flex items-start gap-2"><input type="checkbox" name="confirmation" value={ORIGINAL_UNASSIGNED_CASH_CONFIRMATION} required/><span>{t("cashRecovery.unassignedConfirm")}</span></label><Button type="submit">{t("cashRecovery.unassigned")}</Button></form>):null}
        {human && !row.closed && row.canReturnFull ? <form action={originalCashRecoveryAction} className="grid gap-3"><input type="hidden" name="intent" value="return"/><input type="hidden" name="sourceKind" value={row.source.kind}/><input type="hidden" name="sourceId" value={sourceId}/><input type="hidden" name="observationId" value={row.source.observationId ?? ""}/>
          <label className="flex items-start gap-2"><input type="checkbox" name="confirmation" value={ORIGINAL_CASH_RETURN_CONFIRMATION} required/><span>{t("cashRecovery.confirmReturn")}</span></label><Button type="submit">{t("cashRecovery.return")}</Button></form> : null}
        {row.callers.map(caller => <section key={caller.operationId} className="grid gap-3 rounded border border-rule p-3"><h3>{t("cashRecovery.caller", { host: caller.host, pid: caller.pid })}</h3>
          {caller.liveness === "live" ? <Callout tone="warning">{t("cashRecovery.live")}</Callout> : human ? <form action={originalCashRecoveryAction} className="grid gap-3"><input type="hidden" name="intent" value="stop"/><input type="hidden" name="operationId" value={caller.operationId}/><input type="hidden" name="callerId" value={caller.callerId}/><input type="hidden" name="expectedDigest" value={caller.digest}/>
            <Field htmlFor={`cash-stop-${caller.operationId}`} label={t("cashRecovery.evidence")}><textarea id={`cash-stop-${caller.operationId}`} name="hostingEvidence" required minLength={30} maxLength={2000} className="w-full rounded border border-rule bg-surface p-2 text-ink"/></Field>
            <label className="flex items-start gap-2"><input type="checkbox" name="confirmation" value={ORIGINAL_CASH_STOP_CONFIRMATION} required/><span>{t("cashRecovery.confirmStop")}</span></label><Button type="submit">{t("cashRecovery.reviewStop")}</Button></form> : null}</section>)}
        {human && row.recoveryId ? row.legacyFees.map(fee => <form key={fee.id} action={originalCashRecoveryAction} className="grid gap-3 rounded border border-rule p-3"><p>{t("cashRecovery.oldFeeHelp")}</p><input type="hidden" name="intent" value="legacyFeeStop"/><input type="hidden" name="recoveryId" value={row.recoveryId!}/><input type="hidden" name="feeOperationId" value={fee.id}/><input type="hidden" name="expectedDigest" value={fee.digest}/>
          <Field htmlFor={`cash-fee-stop-${fee.id}`} label={t("cashRecovery.evidence")}><textarea id={`cash-fee-stop-${fee.id}`} name="hostingEvidence" required minLength={30} maxLength={2000} className="w-full rounded border border-rule bg-surface p-2 text-ink"/></Field>
          <label className="flex items-start gap-2"><input type="checkbox" name="confirmation" value={ORIGINAL_CASH_STOP_CONFIRMATION} required/><span>{t("cashRecovery.confirmStop")}</span></label><Button type="submit">{t("cashRecovery.reviewStop")}</Button></form>) : null}
      </div></CardBody></Card>;
    })}</div>;
}
