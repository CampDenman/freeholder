// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C11.08: the same exact human service owns UI/HTTP/MCP stop review.
import type {Translate} from "@/core/i18n";
import type {merchantFeeInvocationRecoveryList,merchantFeeInvocationStopPlan} from "@/modules/invoicing/merchant-fee-invocation-recovery";
import {MERCHANT_FEE_STOP_CONFIRMATION} from "@/modules/invoicing/merchant-fee-invocation-contract";
import {Button,Callout,Card,CardBody,CardHeader,Field} from "@/ui/primitives";
import {originalCashRecoveryAction} from "../(admin)/admin/invoices/cash-recovery/actions";
type Rows=Awaited<ReturnType<typeof merchantFeeInvocationRecoveryList.call>>;
type Plan=Awaited<ReturnType<typeof merchantFeeInvocationStopPlan.call>>;
export function MerchantFeeInvocationRecovery({rows,plan,changed,t}:{rows:Rows;plan:Plan|null;changed:boolean;t:Translate}){
 const selected=rows.find(row=>row.invocationId===plan?.invocationId);
 return <Card><CardHeader title={t("feeInvocation.title")}/><CardBody><div className="grid gap-4"><p>{t("feeInvocation.help")}</p>
  {changed?<Callout tone="warning">{t("cashInspection.changed")}</Callout>:null}
  {!rows.length?<p>{t("feeInvocation.empty")}</p>:<ul className="grid list-none gap-3 p-0">{rows.map(row=><li key={row.invocationId} className="grid gap-2 rounded border border-rule p-3">
   <p>{t("feeInvocation.caller",{host:row.host,pid:row.pid})}</p><p>{t(`feeInvocation.${row.kind}`)}</p><a href={`/admin/invoices/cash-recovery?feeCaller=${encodeURIComponent(row.invocationId)}`} className="underline">{t("cashInspection.open")}</a>
  </li>)}</ul>}
  {plan&&selected?<section className="grid gap-3 rounded border border-rule p-3"><h2 className="font-semibold">{t("feeInvocation.caller",{host:selected.host,pid:selected.pid})}</h2>
   {plan.alreadyClosed?<p>{t("cashInspection.changed")}</p>:plan.mechanicalCheck!=="absent"?<Callout tone="warning">{t(plan.mechanicalCheck==="live"?"cashInspection.liveHelp":"cashInspection.unobservableHelp")}</Callout>:<form action={originalCashRecoveryAction} className="grid gap-3">
    <input type="hidden" name="intent" value="feeInvocationStop"/><input type="hidden" name="paymentId" value={selected.paymentId}/><input type="hidden" name="invocationId" value={plan.invocationId}/><input type="hidden" name="expectedRevision" value={plan.revision}/>
    <p>{t("feeInvocation.reviewHelp")}</p><Field htmlFor="fee-invocation-evidence" label={t("cashInspection.evidence")}><textarea id="fee-invocation-evidence" name="hostingEvidence" required minLength={30} maxLength={2000} rows={4} className="w-full rounded border border-rule bg-surface p-2 text-ink"/></Field>
    <label className="flex items-start gap-2"><input type="checkbox" name="confirmation" value={MERCHANT_FEE_STOP_CONFIRMATION} required/><span>{t("feeInvocation.confirm")}</span></label><div><Button type="submit">{t("cashInspection.review")}</Button></div>
   </form>}
  </section>:null}
 </div></CardBody></Card>;
}
