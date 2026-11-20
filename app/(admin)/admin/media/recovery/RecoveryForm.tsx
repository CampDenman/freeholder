// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState, useId } from "react";
import { Button, Callout, Field, Input } from "@/ui/primitives";
import { reconcileStorageAction, type MediaActionState } from "../../../media-actions";

export type RecoveryLabels = { namespace: string; originalKey:string;sha256: string; bytes: string; outcome: string; applied: string; notApplied: string; retireOriginal:string; monotonicHint:string;
  reference: string; evidence: string; stopDrainId:string;stopDrainHint:string;stopped: string; confirm: string; submit: string; saved: string };
export function RecoveryForm({ id, updatedAt, namespace, sha256, bytes, labels,operation="put",originalKeyRequired=false }: {
  id: string; updatedAt: string; namespace: string | null; sha256: string | null; bytes: number | null; labels: RecoveryLabels;operation?:"put"|"delete";originalKeyRequired?:boolean;
}) {
  const prefix = useId();
  const [state, action, pending] = useActionState<MediaActionState, FormData>(reconcileStorageAction, {});
  if (state.saved) return <Callout tone="success">{labels.saved}</Callout>;
  return <form action={action} className="grid min-w-0 gap-4">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="expectedUpdatedAt" value={updatedAt} />
    {state.error ? <Callout tone="danger">{state.error}</Callout> : null}
    {originalKeyRequired?<Field label={labels.originalKey} htmlFor={`${prefix}-key`}><Input id={`${prefix}-key`} name="originalKey" required maxLength={2048} autoComplete="off" dir="ltr"/></Field>:null}
    <Field label={labels.namespace} htmlFor={`${prefix}-namespace`}><Input id={`${prefix}-namespace`} name="originalNamespace" defaultValue={namespace ?? ""} required pattern="[a-f0-9]{64}" maxLength={64} autoComplete="off" dir="ltr" /></Field>
    <Field label={labels.sha256} htmlFor={`${prefix}-sha256`}><Input id={`${prefix}-sha256`} name="sha256" defaultValue={sha256 ?? ""} pattern="[a-f0-9]{64}" maxLength={64} autoComplete="off" dir="ltr" /></Field>
    <Field label={labels.bytes} htmlFor={`${prefix}-bytes`}><Input id={`${prefix}-bytes`} name="bytes" defaultValue={bytes ?? ""} type="number" min={0} max={5 * 1024 ** 3} step={1} dir="ltr" /></Field>
    {operation==="delete"?<Callout>{labels.monotonicHint}</Callout>:null}
    <Field label={labels.outcome} htmlFor={`${prefix}-outcome`}><select id={`${prefix}-outcome`} name="outcome" required className="min-w-0 rounded-md border border-rule-strong bg-field p-2 text-ink">
      <option value="applied">{operation==="delete"?labels.retireOriginal:labels.applied}</option>{operation==="put"?<option value="not_applied">{labels.notApplied}</option>:null}
    </select></Field>
    <Field label={labels.reference} htmlFor={`${prefix}-reference`}><Input id={`${prefix}-reference`} name="providerFinalReference" required minLength={8} maxLength={300} autoComplete="off" /></Field>
    <Field label={labels.evidence} htmlFor={`${prefix}-evidence`}><textarea id={`${prefix}-evidence`} name="providerEvidence" required minLength={20} maxLength={2000} rows={3} className="w-full rounded-md border border-rule-strong bg-field p-2 text-ink" /></Field>
    <Field label={labels.stopDrainId} htmlFor={`${prefix}-stop-id`}><Input id={`${prefix}-stop-id`} name="stopDrainId" maxLength={36} autoComplete="off" dir="ltr" aria-describedby={`${prefix}-stop-hint`}/><p id={`${prefix}-stop-hint`} className="text-sm text-ink-muted">{labels.stopDrainHint}</p></Field>
    <Field label={labels.stopped} htmlFor={`${prefix}-stopped`}><textarea id={`${prefix}-stopped`} name="stoppedWriterEvidence" required minLength={20} maxLength={2000} rows={3} className="w-full rounded-md border border-rule-strong bg-field p-2 text-ink" /></Field>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="ORIGINAL STORAGE OUTCOME CONFIRMED" required className="mt-1" /><span>{labels.confirm}</span></label>
    <Button type="submit" disabled={pending}>{labels.submit}</Button>
  </form>;
}
