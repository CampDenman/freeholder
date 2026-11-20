// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: actual original fee cash stays separate from an owed target.
import type {Translate} from "@/core/i18n";
import type {reviewAtomicFeeReconciliation} from "@/modules/invoicing/controlled-atomic-fee-review";
import {Button,Callout,Card,CardBody,CardHeader} from "@/ui/primitives";
import {reconcileAtomicFeeAction} from "../atomic-fee-reconciliation-actions";
type Rows=Awaited<ReturnType<typeof reviewAtomicFeeReconciliation.call>>;
export function AtomicFeeReconciliation({invoiceId,rows,manage,t,money}:{invoiceId:string;rows:Rows;manage:boolean;t:Translate;money:(minor:number,currency:string)=>string}){
 if(!rows.length)return null;
 return <Card><CardHeader title={t("atomicFee.title")}/><CardBody><div className="grid gap-4"><p>{t("atomicFee.help")}</p>{rows.map(row=><section key={row.paymentId} className="grid gap-2 rounded border border-rule p-3">
  <p><bdi>{row.paymentId}</bdi></p><dl className="grid gap-2"><div><dt>{t("atomicFee.original")}</dt><dd>{money(row.originalFeeMinor,row.currency)}</dd></div><div><dt>{t("atomicFee.target")}</dt><dd>{row.targetRetainedFeeMinor===null?t("atomicFee.unknown"):money(row.targetRetainedFeeMinor,row.currency)}</dd></div><div><dt>{t("atomicFee.actual")}</dt><dd>{row.actualRetainedFeeMinor===null?t("atomicFee.unknown"):money(row.actualRetainedFeeMinor,row.currency)}</dd></div></dl>
  {row.pending?<Callout tone="warning">{t("atomicFee.pending")}</Callout>:<p>{t("atomicFee.reconciled")}</p>}
  {manage&&row.pending?<form action={reconcileAtomicFeeAction}><input type="hidden" name="invoiceId" value={invoiceId}/><input type="hidden" name="paymentId" value={row.paymentId}/><Button type="submit">{t("atomicFee.reconcile")}</Button></form>:null}
  {manage&&row.pending?<form action={reconcileAtomicFeeAction}><input type="hidden" name="intent" value="inspect"/><input type="hidden" name="invoiceId" value={invoiceId}/><input type="hidden" name="paymentId" value={row.paymentId}/><Button type="submit" variant="quiet">{t("atomicFee.inspect")}</Button></form>:null}
 </section>)}</div></CardBody></Card>;
}
