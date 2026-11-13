// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { translator } from "@/core/i18n";
import { Button,Card,CardBody,CardHeader,Field,Input,Pill } from "@/ui/primitives";
import { type controlledProviderRecoveryPlan,type controlledProviderResourceStatus,CONTROLLED_PROVIDER_STOP_CONFIRMATION } from "@/modules/subscriptions/controlled-provider-stop";
import { reviewControlledProviderStopAction,recoverControlledProviderOperationAction,recoverControlledProviderCalendarAction,stopControlledProviderCalendarAction,closeControlledZeroProviderResourceAction } from "../controlled-provider-actions";
type Calls=Awaited<ReturnType<typeof controlledProviderRecoveryPlan.call>>;
type Resources=Awaited<ReturnType<typeof controlledProviderResourceStatus.call>>;
const recoverable=new Set(["bootstrap","discover_bootstrap","read_bootstrap","pause_drafts","read_invoice","read_customer_financials","read_calendar","cancel_calendar","list_invoices"]);
export function ControlledProviderRecovery({subscriptionId,calls,resources,locale,moneyRecovery=false}:{subscriptionId:string;calls:Calls;resources:Resources;locale:string;moneyRecovery?:boolean}){
 const t=translator(locale);if(!resources.length)return null;const closedIds=new Set(resources.filter(row=>row.closed).map(row=>row.resourceId));
 return <Card><CardHeader title={t("subscriptions.controlled.title")}/><CardBody><p className="mb-4 text-sm text-ink-muted">{t("subscriptions.controlled.intro")}</p>
  <ul className="grid list-none gap-4 p-0">{calls.map(row=><li key={row.callId} className="grid gap-3 rounded-md border border-rule p-3">
   <Pill tone={row.reviewed?"neutral":"warning"}>{t(row.reviewed?"subscriptions.reader.reviewed":`subscriptions.reader.${row.liveness}`)}</Pill>
   <dl className="grid gap-2 text-sm"><div><dt>{t("subscriptions.reader.identifier")}</dt><dd dir="ltr" className="break-all font-mono">{row.callId}</dd></div><div><dt>{t("subscriptions.reader.caller")}</dt><dd dir="ltr" className="break-all font-mono">{row.callerId}</dd></div></dl>
   {row.reviewed?recoverable.has(row.kind)&&!closedIds.has(row.resourceId)?<form action={recoverControlledProviderOperationAction}><input type="hidden" name="subscriptionId" value={subscriptionId}/>{moneyRecovery?<input type="hidden" name="moneyRecovery" value="1"/>:null}<input type="hidden" name="operationId" value={row.operationId}/><Button type="submit">{t("subscriptions.reader.recover")}</Button></form>:<p className="text-sm">{t("subscriptions.controlled.retained")}</p>
    :row.liveness==="live"?<p className="text-sm">{t("subscriptions.reader.liveHint")}</p>:<form action={reviewControlledProviderStopAction} className="grid gap-3">
     <input type="hidden" name="subscriptionId" value={subscriptionId}/>{moneyRecovery?<input type="hidden" name="moneyRecovery" value="1"/>:null}{(["resourceId","operationId","callId","callerId","admissionDigest","currentEvidenceRevision"] as const).map(name=><input key={name} type="hidden" name={name} value={row[name]}/>)}
     <Field htmlFor={`controlled-evidence-${row.callId}`} label={t("subscriptions.reader.evidence")}><textarea id={`controlled-evidence-${row.callId}`} name="hostingEvidence" required minLength={30} maxLength={2000} rows={4} className="w-full rounded-md border border-rule bg-surface px-3 py-2 text-sm"/></Field>
     {row.liveness==="unobservable"?<><Field htmlFor={`controlled-runtime-${row.callId}`} label={t("subscriptions.reader.runtime")}><Input id={`controlled-runtime-${row.callId}`} name="stoppedRuntimeReference" required minLength={8} maxLength={300}/></Field><Field htmlFor={`controlled-time-${row.callId}`} label={t("subscriptions.reader.stoppedAt")} hint={t("subscriptions.reader.utcHint")}><Input id={`controlled-time-${row.callId}`} name="stoppedRuntimeAt" required placeholder="2026-11-13T12:00:00.000Z" maxLength={40}/></Field></>:null}
     <Field htmlFor={`controlled-confirm-${row.callId}`} label={t("subscriptions.reader.confirm")} hint={CONTROLLED_PROVIDER_STOP_CONFIRMATION}><Input id={`controlled-confirm-${row.callId}`} name="confirmation" required autoComplete="off"/></Field><Button type="submit">{t("subscriptions.reader.review")}</Button>
    </form>}
  </li>)}</ul>
  <ul className="mt-4 grid list-none gap-4 p-0">{resources.map(resource=><li key={resource.resourceId} className="grid gap-3 rounded-md border border-rule p-3"><span dir="ltr" className="break-all font-mono text-sm">{resource.resourceId}</span>
   {resource.closed?<Pill>{t("subscriptions.controlled.closed")}</Pill>:resource.unfinishedCallers?<p className="text-sm">{t("subscriptions.controlled.wait")}</p>:<>
    {resource.zeroTransport?<form action={recoverControlledProviderCalendarAction}><input type="hidden" name="subscriptionId" value={subscriptionId}/>{moneyRecovery?<input type="hidden" name="moneyRecovery" value="1"/>:null}<input type="hidden" name="resourceId" value={resource.resourceId}/><Button type="submit">{t("subscriptions.reader.recover")}</Button></form>:null}
    <form action={stopControlledProviderCalendarAction}><input type="hidden" name="subscriptionId" value={subscriptionId}/>{moneyRecovery?<input type="hidden" name="moneyRecovery" value="1"/>:null}<input type="hidden" name="resourceId" value={resource.resourceId}/><Button type="submit">{t("subscriptions.controlled.cancel")}</Button></form>
    {resource.zeroTransport?<form action={closeControlledZeroProviderResourceAction}><input type="hidden" name="subscriptionId" value={subscriptionId}/>{moneyRecovery?<input type="hidden" name="moneyRecovery" value="1"/>:null}<input type="hidden" name="resourceId" value={resource.resourceId}/><Button type="submit">{t("subscriptions.controlled.closeZero")}</Button></form>:null}
   </>}
  </li>)}</ul>
 </CardBody></Card>;
}
