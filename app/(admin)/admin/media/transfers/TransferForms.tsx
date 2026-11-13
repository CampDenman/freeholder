// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import Link from "next/link";
import {useActionState,useId} from "react";
import {Button,Callout,Field,Input} from "@/ui/primitives";
import {advanceStorageTransferAction,planStorageTransferAction,reviewStorageTransferAction,type TransferActionState} from "../../../media-transfer-actions";
import type {transferLabels} from "./labels";
export type TransferLabels=ReturnType<typeof transferLabels>;
export function PlanTransferForm({requestKey,labels}:{requestKey:string;labels:TransferLabels}){
 const prefix=useId(),[state,action,pending]=useActionState<TransferActionState,FormData>(planStorageTransferAction,{});
 if(state.saved&&state.id)return <Callout tone="success"><Link href={`/admin/media/transfers/${state.id}`} className="underline">{labels.open}</Link></Callout>;
 return <form action={action} className="grid min-w-0 gap-4"><input type="hidden" name="requestKey" value={requestKey}/>{state.error?<Callout tone="danger">{state.error}</Callout>:null}<Field label={labels.drain} htmlFor={`${prefix}-drain`}><Input id={`${prefix}-drain`} name="drainId" autoComplete="off" dir="ltr"/></Field><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="COPY ADOPT AND RETIRE ORIGINAL STORAGE" required/><span>{labels.confirm}</span></label><Button type="submit" disabled={pending}>{labels.plan}</Button></form>;
}
export function AdvanceTransferForm({id,requestKey,labels}:{id:string;requestKey:string;labels:TransferLabels}){
 const[state,action,pending]=useActionState<TransferActionState,FormData>(advanceStorageTransferAction,{});
 return <form action={action} className="grid min-w-0 gap-4"><input type="hidden" name="id" value={id}/><input type="hidden" name="requestKey" value={requestKey}/>{state.error?<Callout tone="danger">{state.error}</Callout>:null}{state.saved?<Callout tone="success">{labels.saved}</Callout>:null}<label className="flex gap-2 text-sm"><input type="checkbox" name="background" value="yes"/>{labels.background}</label><div className="flex flex-wrap gap-3"><Button type="submit" name="action" value="copy" disabled={pending}>{labels.copy}</Button><Button type="submit" name="action" value="adopt" disabled={pending}>{labels.adopt}</Button><Button type="submit" name="action" value="retire" disabled={pending}>{labels.retire}</Button></div></form>;
}
export function ReviewTransferForm({planId,row,labels}:{planId:string;row:{id:string;witness:string;returned:boolean;key:string};labels:TransferLabels}){
 const prefix=useId(),[state,action,pending]=useActionState<TransferActionState,FormData>(reviewStorageTransferAction,{});
 return <form action={action} className="grid min-w-0 gap-4"><input type="hidden" name="planId" value={planId}/><input type="hidden" name="callId" value={row.id}/><input type="hidden" name="expectedWitness" value={row.witness}/>{state.error?<Callout tone="danger">{state.error}</Callout>:null}{state.saved?<Callout tone="success">{labels.saved}</Callout>:null}
 {!row.returned?<Field label={labels.drain} htmlFor={`${prefix}-drain`}><Input id={`${prefix}-drain`} name="stopDrainId" required dir="ltr" autoComplete="off"/></Field>:null}
 {row.key.startsWith("retained:")?<><Field label={labels.originalKey} htmlFor={`${prefix}-key`}><Input id={`${prefix}-key`} name="originalKey" maxLength={2048} autoComplete="off" dir="ltr"/></Field><Field label={labels.sourceKey} htmlFor={`${prefix}-source`}><Input id={`${prefix}-source`} name="originalSourceKey" required maxLength={2048} autoComplete="off" dir="ltr"/></Field></>:null}
 <Field label={labels.outcome} htmlFor={`${prefix}-outcome`}><select id={`${prefix}-outcome`} name="outcome" className="min-w-0 rounded-md border border-rule-strong bg-field p-2 text-ink"><option value="applied">{labels.applied}</option><option value="not_applied">{labels.notApplied}</option><option value="retired">{labels.absent}</option></select></Field>
 <Field label={labels.reference} htmlFor={`${prefix}-reference`}><Input id={`${prefix}-reference`} name="providerFinalReference" required minLength={8} maxLength={300} autoComplete="off"/></Field><Field label={labels.evidence} htmlFor={`${prefix}-evidence`}><textarea id={`${prefix}-evidence`} name="providerEvidence" required minLength={20} maxLength={2000} rows={3} className="w-full rounded-md border border-rule-strong bg-field p-2 text-ink"/></Field>
 <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="retryOriginal" value="yes"/>{labels.retry}</label><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="ORIGINAL CALLER AND PROVIDER OUTCOME CONFIRMED" required/>{labels.reviewConfirm}</label><Button type="submit" disabled={pending}>{labels.review}</Button></form>;
}
