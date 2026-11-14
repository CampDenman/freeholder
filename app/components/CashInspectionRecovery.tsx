// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C11.08: review the original caller through the shared human service.
import type { Translate } from "@/core/i18n";
import type { cashInspectionRecoveryList, cashInspectionRecoveryPlan } from "@/modules/invoicing/merchant-cash-inspection-stop-service";
import { CASH_INSPECTION_STOP_CONFIRMATION } from "@/modules/invoicing/merchant-cash-inspection-stop-proof";
import { Button, Callout, Card, CardBody, CardHeader, Field, Pill } from "@/ui/primitives";
import { originalCashRecoveryAction } from "../(admin)/admin/invoices/cash-recovery/actions";

type Rows = Awaited<ReturnType<typeof cashInspectionRecoveryList.call>>;
type Plan = Awaited<ReturnType<typeof cashInspectionRecoveryPlan.call>>;
const path = "/admin/invoices/cash-recovery";

export function CashInspectionRecovery({ rows, plan, changed, t }: { rows: Rows; plan: Plan | null; changed: boolean; t: Translate }) {
  return <Card><CardHeader title={t("cashInspection.title")}/><CardBody>
    <div className="grid gap-4">
      <p className="text-sm text-ink-muted">{t("cashInspection.help")}</p>
      {changed ? <Callout tone="warning">{t("cashInspection.changed")}</Callout> : null}
      {!rows.length ? <p>{t("cashInspection.empty")}</p> : <ul className="grid list-none gap-3 p-0">{rows.map(row => <li key={row.inspectionId} className="grid gap-2 rounded border border-rule p-3">
        <p>{t("cashInspection.caller", { host: row.host, pid: row.pid })}</p>
        <Pill tone="warning">{t(`cashInspection.${row.liveness}`)}</Pill>
        <a href={`${path}?inspection=${encodeURIComponent(row.inspectionId)}`} className="underline">{t("cashInspection.open")}</a>
      </li>)}</ul>}
      {plan ? <section aria-labelledby="cash-inspection-review-title" className="grid gap-3 rounded border border-rule p-3">
        <h2 id="cash-inspection-review-title" className="font-semibold">{t("cashInspection.caller", { host: plan.host, pid: plan.pid })}</h2>
        {plan.finished || plan.reviewed ? <p>{t("cashInspection.changed")}</p>
          : plan.liveness === "live" ? <Callout tone="warning">{t("cashInspection.liveHelp")}</Callout>
            : plan.liveness !== "absent" || !plan.originalBirthKnown ? <Callout tone="warning">{t("cashInspection.unobservableHelp")}</Callout>
              : <form action={originalCashRecoveryAction} className="grid gap-3">
                <input type="hidden" name="intent" value="inspectionStop"/>
                <input type="hidden" name="inspectionId" value={plan.inspectionId}/>
                <input type="hidden" name="expectedCallerId" value={plan.callerId}/>
                <input type="hidden" name="expectedAdmissionDigest" value={plan.admissionDigest}/>
                <input type="hidden" name="expectedSourceRevision" value={plan.sourceRevision}/>
                <p>{t("cashInspection.reviewHelp")}</p>
                <Field htmlFor="cash-inspection-hosting-evidence" label={t("cashInspection.evidence")}>
                  <textarea id="cash-inspection-hosting-evidence" name="hostingEvidence" required minLength={30} maxLength={2000} rows={4} className="w-full rounded border border-rule bg-surface p-2 text-ink"/>
                </Field>
                <label className="flex items-start gap-2"><input type="checkbox" name="confirmation" value={CASH_INSPECTION_STOP_CONFIRMATION} required/><span>{t("cashInspection.confirm")}</span></label>
                <div><Button type="submit">{t("cashInspection.review")}</Button></div>
              </form>}
      </section> : null}
    </div>
  </CardBody></Card>;
}
