// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import {useActionState,useId} from "react";
import {Button,Callout,Field,Input} from "@/ui/primitives";
import {reconcileMultipartAction,type MediaActionState} from "../../../media-actions";
import type {RecoveryLabels} from "./RecoveryForm";
export type MultipartRecoveryLabels=RecoveryLabels&{providerUploadId:string;verifyOriginal:string;cleanup:string;multipartConfirm:string};
export function MultipartRecoveryForm({resourceId,operationId,witness,namespace,providerUploadId,sha256,bytes,labels,originalKeyRequired=false}:{resourceId:string;operationId:string|null;witness:string;namespace:string|null;providerUploadId:string|null;sha256:string|null;bytes:number|null;labels:MultipartRecoveryLabels;originalKeyRequired?:boolean}){
 const prefix=useId(),[state,action,pending]=useActionState<MediaActionState,FormData>(reconcileMultipartAction,{});
 if(state.saved)return <Callout tone="success">{labels.saved}</Callout>;
 return <form action={action} className="grid min-w-0 gap-4">
  <input type="hidden" name="resourceId" value={resourceId}/><input type="hidden" name="operationId" value={operationId??""}/><input type="hidden" name="expectedWitness" value={witness}/>
  {state.error?<Callout tone="danger">{state.error}</Callout>:null}
  {originalKeyRequired?<Field label={labels.originalKey} htmlFor={`${prefix}-key`}><Input id={`${prefix}-key`} name="originalKey" required maxLength={2048} autoComplete="off" dir="ltr"/></Field>:null}
  <Field label={labels.namespace} htmlFor={`${prefix}-namespace`}><Input id={`${prefix}-namespace`} name="originalNamespace" defaultValue={namespace??""} required pattern="[a-f0-9]{64}" maxLength={64} autoComplete="off" dir="ltr"/></Field>
  <Field label={labels.providerUploadId} htmlFor={`${prefix}-provider`}><Input id={`${prefix}-provider`} name="providerUploadId" defaultValue={providerUploadId??""} maxLength={4096} autoComplete="off" dir="ltr"/></Field>
  <Field label={labels.sha256} htmlFor={`${prefix}-sha256`}><Input id={`${prefix}-sha256`} name="sha256" defaultValue={sha256??""} pattern="[a-f0-9]{64}" maxLength={64} autoComplete="off" dir="ltr"/></Field>
  <Field label={labels.bytes} htmlFor={`${prefix}-bytes`}><Input id={`${prefix}-bytes`} name="bytes" defaultValue={bytes??""} type="number" min={0} max={5*1024**3} step={1} dir="ltr"/></Field>
  <Field label={labels.outcome} htmlFor={`${prefix}-action`}><select id={`${prefix}-action`} name="action" required className="min-w-0 rounded-md border border-rule-strong bg-field p-2 text-ink">
   {operationId?<><option value="applied">{labels.applied}</option><option value="not_applied">{labels.notApplied}</option></>:<><option value="verify_original">{labels.verifyOriginal}</option><option value="cleanup">{labels.cleanup}</option></>}
  </select></Field>
  <Field label={labels.reference} htmlFor={`${prefix}-reference`}><Input id={`${prefix}-reference`} name="providerFinalReference" required minLength={8} maxLength={300} autoComplete="off"/></Field>
  <Field label={labels.evidence} htmlFor={`${prefix}-evidence`}><textarea id={`${prefix}-evidence`} name="providerEvidence" required minLength={20} maxLength={2000} rows={3} className="w-full rounded-md border border-rule-strong bg-field p-2 text-ink"/></Field>
  <Field label={labels.stopped} htmlFor={`${prefix}-stopped`}><textarea id={`${prefix}-stopped`} name="stoppedWriterEvidence" required minLength={20} maxLength={2000} rows={3} className="w-full rounded-md border border-rule-strong bg-field p-2 text-ink"/></Field>
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="ORIGINAL MULTIPART RESOURCE CONFIRMED" required className="mt-1"/><span>{labels.multipartConfirm}</span></label>
  <Button type="submit" disabled={pending}>{labels.submit}</Button>
 </form>;
}
